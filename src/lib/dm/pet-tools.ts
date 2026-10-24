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
import { proficiencyBonus } from "@/lib/srd";
import { beastFormsHolding, findBeastForm } from "@/lib/srd/beast-forms";
import { textKey } from "@/lib/language/text-logic";
import { isNamed } from "@/lib/srd/feature-names";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { petAttackCost } from "@/lib/dm/pet-attack-cost";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { familiarFormsHolding, familiarOffer, findFamiliarForm } from "@/lib/srd/familiar-forms";
import { attackDamage, attackSummary } from "@/lib/srd/creature-attacks";
import { traitLine } from "@/lib/srd/srd-creatures";
import { sizeRank } from "@/lib/bestiary/statblock";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { naturalAttackProfile, pickNaturalAttack } from "@/lib/dm/natural-attack";
import { landNaturalOnHit } from "@/lib/dm/natural-onhit";
import { landBlow } from "@/lib/dm/pc-attack-damage";
import { holdingHint, noneNamed, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { subclassNamed } from "@/lib/srd/subclass-name";

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
        "Summon or bond the creature a feature grants a character: Find Familiar (kind=familiar, form=bat/cat/crab/frog/hawk/lizard/octopus/owl/poisonous snake/quipper/rat/raven/sea horse/spider/weasel, or imp/quasit/pseudodragon/sprite with Pact of the Chain), a Beast Master ranger's companion (kind=beast_companion, a Medium or smaller beast of CR 1/4 or lower), a Drakewarden's drake (kind=drake), or a story-granted pet (kind=other, with the stats). The server validates the feature, loads the stat block, and attaches the pet to their sheet. Call it BEFORE narrating the summon.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          kind: { type: "string", enum: ["familiar", "beast_companion", "drake", "other"] },
          form: { type: "string", description: "The creature ('owl', 'wolf', 'drake')." },
          name: { type: "string", description: "The pet's given name. Default: the form." },
          hp: { type: "integer", minimum: 1, maximum: 300, description: "kind=other only." },
          ac: { type: "integer", minimum: 1, maximum: 30, description: "kind=other only." },
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
        "Resolve a character's pet attacking an enemy: the server checks the pet may attack at all (plain familiars cannot; Pact of the Chain forms, companions and drakes can), rolls to-hit against the enemy's real AC and damage with the pet's real numbers, and applies the result. In a fight it happens on the owner's own turn, while the owner can act, and the server charges it: a Beast Master companion costs the ranger's action, a drake the bonus action, a Pact of the Chain familiar one of the warlock's attacks of the Attack action (once a turn), a story pet the owner's action. A refusal spends nothing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner: exact characterId from GAME STATE." },
          petName: { type: "string", description: "Which pet, when they have several." },
          targetEnemyId: { type: "string", description: "The enemy being attacked: exact enemyId from GAME STATE." },
          attack: { type: "string", description: "Named attack when the pet has several." },
          reason: { type: "string" },
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
          reason: { type: "string" },
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
  reason: z.string().optional(),
});

const dismissSchema = z.object({
  characterId: z.string(),
  petName: z.string().trim().max(60).optional(),
  reason: z.string().optional(),
});

// The names of a sheet's features and feats, as written.
function featureNames(sheet: CharacterSheet): string[] {
  return [...sheet.features.map((feature) => feature.name), ...sheet.feats];
}

function knowsFindFamiliar(sheet: CharacterSheet): boolean {
  const spellList = sheet.spellcasting
    ? allSpellNames(sheet.spellcasting)
    : [];
  return [...spellList, ...featureNames(sheet)].some((name) => isNamed(name, "Find Familiar"));
}

function hasPactOfTheChain(sheet: CharacterSheet): boolean {
  return featureNames(sheet).some((name) => isNamed(name, "Pact of the Chain"));
}

function hasBeastCompanionFeature(sheet: CharacterSheet): boolean {
  return (
    subclassNamed(sheet.subclass ?? "", "Beast Master") ||
    featureNames(sheet).some((name) => isNamed(name, "Ranger's Companion", "Animal Companion"))
  );
}

function hasDrakeFeature(sheet: CharacterSheet): boolean {
  return (
    subclassNamed(sheet.subclass ?? "", "Drakewarden") ||
    featureNames(sheet).some((name) => isNamed(name, "Drake Companion"))
  );
}

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

// Builds the pet a summon produces, or an error string.
export function buildPet(
  sheet: CharacterSheet,
  args: {
    kind: SheetPet["kind"];
    form: string;
    name?: string;
    hp?: number;
    ac?: number;
  },
): SheetPet | ToolError {
  const level = sheet.level;
  const pb = proficiencyBonus(level);
  if (args.kind === "familiar") {
    if (!knowsFindFamiliar(sheet) && !hasPactOfTheChain(sheet)) {
      return {
        error: `${sheet.name} does not know Find Familiar and has no Pact of the Chain; they cannot summon a familiar.`,
        refused: "rules",
      };
    }
    const form = findFamiliarForm(args.form);
    if (!form) {
      const offer = familiarOffer(hasPactOfTheChain(sheet));
      return {
        error: args.form.trim()
          ? `Unknown familiar form "${args.form.trim()}". The forms there are: ${offer}.${holdingHint(args.form, familiarFormsHolding(args.form))} Ask the player which, unless they named one.`
          : `A familiar needs its form: ${offer}. Ask the player which, unless they named one.`,
        retry: true,
      };
    }
    if (form.chainOnly && !hasPactOfTheChain(sheet)) {
      return {
        error: `A ${form.form} familiar needs Pact of the Chain; ${sheet.name} can take an ordinary form instead (${familiarOffer(false)}). Ask the player which.`,
        retry: true,
      };
    }
    return {
      name: args.name?.trim() || form.form,
      kind: "familiar",
      form: form.form,
      hp: form.hp,
      maxHp: form.maxHp,
      ac: form.ac,
      speed: form.speed,
      attacks: form.attacks,
      notes: `${form.notes} A familiar acts on its own but cannot attack${form.chainOnly ? "" : " (Pact of the Chain forms can)"}; the owner can see through its senses as an action.`,
    };
  }
  if (args.kind === "beast_companion") {
    if (!hasBeastCompanionFeature(sheet)) {
      return {
        error: `${sheet.name} has no Ranger's Companion feature; only a Beast Master gets a bonded beast.`,
        refused: "rules",
      };
    }
    // PHB Beast Master: a beast no larger than Medium, of challenge rating
    // 1/4 or lower.
    const beast = findBeastForm(args.form);
    const fits = (entry: { cr: number; size: string }) => entry.cr <= 0.25 && sizeRank(entry.size) <= sizeRank("Medium");
    if (!beast || !fits(beast)) {
      return {
        error: `A ranger's companion must be a Medium or smaller beast of CR 1/4 or lower (wolf, panther, boar, mastiff...)${beast ? `; a ${beast.name} is ${beast.size}, CR ${beast.cr}` : ""}.${beast ? "" : holdingHint(args.form, beastFormsHolding(args.form).filter(fits).map((entry) => entry.name))}`,
        retry: true,
      };
    }
    // PHB Beast Master: add the ranger's proficiency bonus to the beast's
    // AC, attack and damage rolls; HP floor of four times ranger level.
    return {
      name: args.name?.trim() || beast.name,
      kind: "beast_companion",
      form: beast.name,
      hp: Math.max(beast.hp, level * 4),
      maxHp: Math.max(beast.hp, level * 4),
      ac: beast.ac + pb,
      speed: beast.speed,
      attacks: beast.attacks.slice(0, 3).map((attack) => ({
        ...attack,
        toHit: attack.toHit + pb,
        damage: `${attack.damage}+${pb}`,
      })),
      // The pet record keeps 300 characters of notes: the beast's traits as
      // fit, then the command rule.
      notes: `${traitLine(beast.traitLines, 200)} Commanding an attack costs the ranger's action; it otherwise defends itself.`.trim(),
    };
  }
  if (args.kind === "drake") {
    if (!hasDrakeFeature(sheet)) {
      return { error: `${sheet.name} has no Drake Companion feature; only a Drakewarden bonds a drake.`, refused: "rules" };
    }
    return {
      name: args.name?.trim() || "Drake",
      kind: "drake",
      form: "Drake",
      hp: 5 + level * 5,
      maxHp: 5 + level * 5,
      ac: 14,
      speed: 40,
      attacks: [{ name: "Bite", toHit: 2 + pb, damage: `1d6+${pb}`, type: "piercing" }],
      notes: `Infused with the ranger's chosen essence; commanded as a bonus action. It grows wings at higher ranger levels.`,
    };
  }
  // Story pet: the model supplies honest numbers, clamped by the schema.
  if (!args.hp || !args.ac) {
    return { error: `A story pet needs hp and ac from its stat block.`, retry: true };
  }
  return {
    name: args.name?.trim() || args.form,
    kind: "other",
    form: args.form,
    hp: args.hp,
    maxHp: args.hp,
    ac: args.ac,
    speed: 30,
    attacks: [],
    notes: "",
  };
}

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
  // ritual re-shapes the same spirit), companions and drakes are unique.
  const built = buildPet(sheet, args);
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
      error: `${pet.name} is an ordinary familiar and cannot attack (only Pact of the Chain forms fight). It can scout, deliver touch spells, and grant its senses instead.`,
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
  const hp = Math.max(0, pet.hp - args.amount);
  if (hp <= 0 && pet.kind === "familiar") {
    // A familiar at 0 HP vanishes; the spell brings it back later.
    const pets = sheet.pets.filter((entry) => entry !== pet);
    patchSheet(sheet.id, { pets });
    publishSheet(campaign, sheet.id);
    return {
      ok: true,
      pet: pet.name,
      damage: args.amount,
      vanished: `${pet.name} drops and dissolves into shimmering mist. ${sheet.name} can resummon it by casting Find Familiar again (10 gp of incense, one hour).`,
    };
  }
  const pets = sheet.pets.map((entry) => (entry === pet ? { ...entry, hp } : entry));
  patchSheet(sheet.id, { pets });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    pet: pet.name,
    damage: args.amount,
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
