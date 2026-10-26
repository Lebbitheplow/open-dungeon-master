import { z } from "zod";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { petAttackCost } from "@/lib/dm/pet-attack-cost";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { attackDamage, attackSummary } from "@/lib/srd/creature-attacks";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { naturalAttackProfile, pickNaturalAttack } from "@/lib/dm/natural-attack";
import { landNaturalOnHit } from "@/lib/dm/natural-onhit";
import { landBlow } from "@/lib/dm/pc-attack-damage";
import { noneNamed, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { buildPet, defenseWords, DRAKE_ESSENCES } from "@/lib/dm/pet-build";
import { damageAdjust } from "@/lib/dm/damage-logic";
import { findTableMonster } from "@/lib/bestiary/homebrew-monsters";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";

// The creatures bound to a character: familiars (Find Familiar, Pact of the
// Chain), the Beast Master's companion, the Drakewarden's drake, and story
// pets. Before this engine a familiar was pure narration: no stat block,
// nothing for an enemy to hit, no rules on who may even have one.
//
// Pets live on the owner's sheet (schemas/sheet.ts petSchema), so they need
// no user row and travel with the character. summon_pet validates the
// source feature and loads the stat block; pet_attack resolves a natural
// attack against an enemy with real dice; damage_pet (apply_damage with a
// petName, issue #471) routes an enemy's hit into the pet's own pool (a familiar at 0 HP vanishes, a companion drops).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const PET_TOOL_NAMES = ["summon_pet", "pet_attack", "damage_pet", "dismiss_pet"] as const;

export const petTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "summon_pet",
      description:
        "Summon or bond a creature a feature grants: kind familiar (Find Familiar), beast_companion (Beast Master), drake (Drakewarden, its essence) or other (a story pet: a stat block's name, or hp and ac). A story pet with no stat block cannot attack. A Find Familiar form is bat, cat, crab, frog, hawk, lizard, octopus, owl, poisonous snake, quipper, rat, raven, sea horse, spider or weasel, or imp, quasit, pseudodragon or sprite with Pact of the Chain. A Beast Master companion is a Medium or smaller beast of CR 1/4 or lower. A story pet named for an SRD creature (mastiff, wolf, riding horse) or a monster the table made in the workshop takes that stat block, and fights with it when its CR is no higher than a druid of the owner's level could become (1/4, 1/2 from 4th level, 1 from 8th). The server validates the feature, loads the stat block, and attaches the pet to their sheet. Call it BEFORE narrating the summon.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          kind: { type: "string", enum: ["familiar", "beast_companion", "drake", "other"] },
          form: { type: "string", description: "The creature ('owl', 'wolf', 'drake'); for a story pet its stat block's name when it has one." },
          name: { type: "string", description: "The pet's given name. Default: the form." },
          essence: {
            type: "string",
            enum: [...DRAKE_ESSENCES],
            description: "kind=drake only: its Draconic Essence, the damage type it is immune to. The player chooses it at each summon.",
          },
          hp: { type: "integer", minimum: 1, maximum: 300, description: "kind=other with no stat block only, and required for it: the pet's HP." },
          ac: { type: "integer", minimum: 1, maximum: 30, description: "kind=other with no stat block only, and required for it: the pet's armor class." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "kind", "form"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pet_attack",
      description:
        "Resolve a character's pet attacking an enemy; in a fight it happens on the owner's own turn, and the server rolls and applies it with the pet's real numbers. The server checks the pet may attack at all (plain familiars cannot; Pact of the Chain forms, companions and drakes can) and rolls to-hit against the enemy's real AC. In a fight the owner must be able to act, and the server charges the attack: a Beast Master companion costs the ranger's action, a drake the bonus action, a Pact of the Chain familiar one of the warlock's attacks of the Attack action (once a turn), a story pet the owner's action. A refusal spends nothing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner: exact characterId from GAME STATE." },
          petName: { type: "string", description: "Which pet, when they have several." },
          targetEnemyId: { type: "string", description: "The enemy being attacked: exact enemyId from GAME STATE." },
          attack: { type: "string", description: "Named attack when the pet has several." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "targetEnemyId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismiss_pet",
      description:
        "Remove a pet from its owner's sheet when it is dismissed, sent away, or dies in the fiction. Call it when the story ends the bond.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner: exact characterId from GAME STATE." },
          petName: { type: "string", description: "Which pet, when they have several." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId"],
      },
    },
  },
];

const summonSchema = z.object({
  characterId: z.string(),
  kind: z.enum(["familiar", "beast_companion", "drake", "other"]),
  form: z.string().trim().min(1).max(60),
  name: z.string().trim().max(60).optional(),
  essence: z.string().trim().max(20).optional(),
  hp: z.coerce.number().int().min(1).max(300).optional(),
  ac: z.coerce.number().int().min(1).max(30).optional(),
  reason: z.string().optional(),
});

const petAttackSchema = z.object({
  characterId: z.string(),
  petName: z.string().trim().max(60).optional(),
  targetEnemyId: z.string(),
  attack: z.string().trim().max(40).optional(),
  reason: z.string().optional(),
});

const damagePetSchema = z.object({
  characterId: z.string(),
  petName: z.string().trim().max(60).optional(),
  amount: z.coerce.number().int().min(0).max(300),
  // What the damage is, which the pet's defenses meet (issue 520): an imp
  // shrugs off fire, a fire drake its essence.
  type: z.string().trim().max(20).optional(),
  magical: z.boolean().optional(),
  reason: z.string().optional(),
});

const dismissSchema = z.object({
  characterId: z.string(),
  petName: z.string().trim().max(60).optional(),
  reason: z.string().optional(),
});

// A creature the call names that the sheet does not hold: the call's to fix,
// from the creatures they have.
function noPet(sheet: CharacterSheet, petName?: string): ToolError {
  const held = sheet.pets.map((pet) => `${pet.name} (${pet.form})`);
  if (!petName && held.length > 1) {
    return { error: `${sheet.name} has several bound creatures; name one: ${held.join(", ")}.`, retry: true };
  }
  return {
    error: `${sheet.name} has no bound creature${petName ? ` called "${petName}"` : ""}.${
      held.length ? ` Their creatures: ${held.join(", ")}.` : " They have none."
    }`,
    retry: true,
  };
}

// The creature a call names, by its whole name or form; with no name, the
// only one there is. Never the nearest name, nor the first of several.
function findPet(sheet: CharacterSheet, petName?: string): SheetPet | null {
  const wanted = textKey(petName ?? "");
  if (!wanted) {
    return sheet.pets.length === 1 ? sheet.pets[0] : null;
  }
  return sheet.pets.find((pet) => textKey(pet.name) === wanted || textKey(pet.form) === wanted) ?? null;
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const sheet = getSheetById(sheetId);
  if (sheet) {
    publishPersisted(campaign.id, "sheet_updated", { sheet });
  }
}

// The stat blocks a summon produces live in src/lib/dm/pet-build.ts.
export { buildPet };

export function handleSummonPet(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof summonSchema>;
  try {
    args = summonSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: summon_pet needs characterId, kind, and form.", retry: true };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  if (sheet.pets.length >= 3) {
    return { error: `${sheet.name} already has ${sheet.pets.length} bound creatures (${sheet.pets.map((pet) => pet.name).join(", ")}); one is dismissed first. Ask the player which.`, retry: true };
  }
  // One creature per source: a second familiar replaces the first (5e: the
  // ritual re-shapes the same spirit), companions and drakes are unique. A
  // story pet may be a monster this table's DMs built in the workshop.
  const authors = spellAuthorsFor(campaign);
  const built = buildPet(sheet, args, { tableMonster: (name) => findTableMonster(authors, name) });
  if ("error" in built) {
    return built;
  }
  const remaining = sheet.pets.filter((pet) => pet.kind !== built.kind || built.kind === "other");
  const pets = [...remaining, built];
  patchSheet(sheet.id, { pets });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    pet: `${built.name} (${built.form}): ${built.hp} HP, AC ${built.ac}, speed ${built.speed} ft`,
    ...(built.attacks.length
      ? {
          attacks: built.attacks.map(attackSummary).join(", "),
        }
      : { attacks: "none: this creature cannot attack" }),
    ...(defenseWords(built) ? { defenses: defenseWords(built) } : {}),
    ...(built.notes ? { notes: built.notes } : {}),
  };
}

export function handlePetAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof petAttackSchema>;
  try {
    args = petAttackSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: pet_attack needs characterId and targetEnemyId.", retry: true };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return noPet(sheet, args.petName);
  }
  if (pet.hp <= 0) {
    return { error: `${pet.name} is down; it cannot attack.`, refused: "rules" };
  }
  if (!pet.attacks.length) {
    return {
      error:
        pet.kind === "familiar"
          ? `${pet.name} is an ordinary familiar and cannot attack (only Pact of the Chain forms fight). It can scout, deliver touch spells, and grant its senses instead.`
          : `${pet.name} has no attacks on record, so it cannot attack.`,
      refused: "rules",
    };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "pet_attack needs an active encounter and a target.", retry: true };
  }
  const enemy = resolveTargetFoe(encounter.campaignId, encounter, args.targetEnemyId);
  if (!enemy || enemy.status !== "alive") {
    return { error: "pet_attack needs a living targetEnemyId from GAME STATE.", retry: true };
  }
  // Commanding the pet is the owner's to do, on the owner's turn, and costs
  // what the feature says (src/lib/dm/pet-attack-cost.ts).
  const charge = petAttackCost(sheet, pet, encounter);
  if ("error" in charge) {
    return toolError(charge);
  }
  const attack = pickNaturalAttack(pet.attacks, args.attack);
  if (!attack) {
    const names = pet.attacks.map((entry) => entry.name);
    return args.attack
      ? noneNamed(`${pet.name} has no attack called`, args.attack, names)
      : { error: `${pet.name} has several attacks; name one: ${names.join(", ")}.`, retry: true };
  }
  if (attack.proneTargetsOnly && !enemy.conditions.includes("prone")) {
    return { error: `${pet.name}'s ${attack.name} strikes only a prone creature, and ${enemy.displayName} is not prone. Nothing was spent.`, refused: "rules" };
  }

  const hitOutcome = rollExpression(d20Expression(attack.toHit));
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: rollAgainst(attack.name, enemy.displayName),
    result: hitOutcome,
    attacker: { kind: "pet", id: sheet.id, name: pet.name },
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: hitRoll,
    source: "digital",
  });
  turn.rollIds.push(hitRoll.id);

  const economy = charge.commit();

  // The enemy's real AC today: a spell or an effect on it counts.
  const vsAc = enemyAcWithEffects(campaign.id, enemy);
  const crit = hitOutcome.crit === "nat20";
  const hit = hitOutcome.crit !== "nat1" && (crit || hitOutcome.total >= vsAc);
  if (!hit) {
    return {
      ok: true,
      attack: `${pet.name}: ${attack.name}`,
      rolled: hitOutcome.total,
      vsAc,
      hit: false,
      economy,
    };
  }
  // The hit's dice and any rider dice of another type; a critical doubles
  // the dice, never the flat bonus (SRD 5.1).
  const { expression } = attackDamage(attack);
  const variant = campaign.gameSettings.variantRules;
  const damageOutcome = rollExpression(
    crit ? critDamageExpression(expression, 0, { powerfulCritical: variant.powerfulCritical, multiplyNumeric: variant.criticalDamageMods }) : expression,
  );
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: rollAgainst(`${attack.name}${crit ? " (CRIT)" : ""}`, enemy.displayName),
    result: damageOutcome,
    attacker: { kind: "pet", id: sheet.id, name: pet.name },
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: damageRoll,
    source: "digital",
  });
  turn.rollIds.push(damageRoll.id);
  // Exceptional Training (Beast Master 7): the companion's attacks count as
  // magical against resistance.
  const magical = activeAuthored(sheet, "pet_magical").some(({ effect }) => effect.pets.includes(pet.kind));
  // Each damage type of the blow meets the creature's resistances on its own
  // (a flying snake's bite: 1 piercing and 3d4 poison).
  const profile = naturalAttackProfile(attack, { weapon: `${pet.name} ${attack.name}`, note: `${pet.name}'s own attack` });
  const applied = landBlow({
    campaign,
    turn,
    encounter,
    enemy,
    sheets,
    sheetsById,
    profile,
    typedRiders: profile.gearTyped ?? [],
    damageOutcome,
    dealt: Math.max(0, damageOutcome.total),
    crit,
    critExtraDice: 0,
    magical,
  });
  publishEncounter(campaign.id);
  // What the hit carries besides its damage: an imp's poison, a quasit's.
  const onHit = attack.onHit && !applied.dead
    ? landNaturalOnHit(campaign, {
        turn,
        attacker: { kind: "pet", sheetId: sheet.id, name: pet.name },
        holderId: null,
        attack: `${pet.name}'s ${attack.name}`,
        enemyId: enemy.id,
        onHit: attack.onHit,
      })
    : [];
  return {
    ok: true,
    attack: `${pet.name}: ${attack.name}`,
    rolled: hitOutcome.total,
    vsAc,
    hit: true,
    ...(crit ? { crit: true } : {}),
    ...applied,
    ...(onHit.length ? { onHit } : {}),
    economy,
  };
}

export function handleDamagePet(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof damagePetSchema>;
  try {
    args = damagePetSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: apply_damage on a pet needs the owner's characterId and an amount.", retry: true };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return noPet(sheet, args.petName);
  }
  // The damage meets the pet's own defenses, as a character's meets theirs:
  // an imp takes no fire, a drake none of its essence.
  const adjusted = damageAdjust(args.amount, args.type, pet.resist ?? "", pet.immune ?? "", pet.vulnerable ?? "", {
    magical: args.magical === true,
  });
  const dealt = adjusted.amount;
  const typed = args.type?.trim() ? { type: args.type.trim() } : {};
  const defended = adjusted.note ? { defenses: `${pet.name} is ${adjusted.note}.` } : {};
  const hp = Math.max(0, pet.hp - dealt);
  if (hp <= 0 && pet.kind === "familiar") {
    // A familiar at 0 HP vanishes; the spell brings it back later.
    const pets = sheet.pets.filter((entry) => entry !== pet);
    patchSheet(sheet.id, { pets });
    publishSheet(campaign, sheet.id);
    return {
      ok: true,
      pet: pet.name,
      damage: dealt,
      ...typed,
      ...defended,
      vanished: `${pet.name} drops and dissolves into shimmering mist. ${sheet.name} can resummon it by casting Find Familiar again (10 gp of incense, one hour).`,
    };
  }
  const pets = sheet.pets.map((entry) => (entry === pet ? { ...entry, hp } : entry));
  patchSheet(sheet.id, { pets });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    pet: pet.name,
    damage: dealt,
    ...typed,
    ...defended,
    hp: `${hp}/${pet.maxHp}`,
    ...(hp <= 0 ? { down: `${pet.name} falls unconscious at 0 HP.` } : {}),
  };
}

export function handleDismissPet(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof dismissSchema>;
  try {
    args = dismissSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: dismiss_pet needs characterId.", retry: true };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return noPet(sheet, args.petName);
  }
  patchSheet(sheet.id, { pets: sheet.pets.filter((entry) => entry !== pet) });
  publishSheet(campaign, sheet.id);
  return { ok: true, dismissed: `${pet.name} (${pet.form})` };
}
