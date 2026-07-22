import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { proficiencyBonus } from "@/lib/srd";
import { findBeastForm } from "@/lib/srd/beast-forms";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";

// The creatures bound to a character: familiars (Find Familiar, Pact of the
// Chain), the Beast Master's companion, the Drakewarden's drake, and story
// pets. Before this engine a familiar was pure narration: no stat block,
// nothing for an enemy to hit, no rules on who may even have one.
//
// Pets live on the owner's sheet (schemas/sheet.ts petSchema), so they need
// no user row and travel with the character. summon_pet validates the
// source feature and loads the stat block; pet_attack resolves a natural
// attack against an enemy with real dice; damage_pet routes an enemy's hit
// into the pet's own pool (a familiar at 0 HP vanishes, a companion drops).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const PET_TOOL_NAMES = ["summon_pet", "pet_attack", "damage_pet", "dismiss_pet"] as const;

// The classic familiar shapes, small enough to author inline. All are
// speed/senses flavor with 1 HP; a familiar cannot attack (Pact of the
// Chain lifts that with its special forms).
const FAMILIAR_FORMS: Array<
  Pick<SheetPet, "form" | "hp" | "maxHp" | "ac" | "speed" | "notes"> & {
    attacks?: SheetPet["attacks"];
    chainOnly?: boolean;
  }
> = [
  { form: "Owl", hp: 1, maxHp: 1, ac: 11, speed: 5, notes: "60 ft fly; Flyby (no opportunity attacks when it flies out of reach); superb night vision." },
  { form: "Raven", hp: 1, maxHp: 1, ac: 12, speed: 10, notes: "50 ft fly; Mimicry (imitates simple sounds)." },
  { form: "Cat", hp: 2, maxHp: 2, ac: 12, speed: 40, notes: "30 ft climb; Keen Smell." },
  { form: "Bat", hp: 1, maxHp: 1, ac: 12, speed: 5, notes: "30 ft fly; blindsight 60 ft (echolocation)." },
  { form: "Rat", hp: 1, maxHp: 1, ac: 10, speed: 20, notes: "Keen Smell." },
  { form: "Spider", hp: 1, maxHp: 1, ac: 12, speed: 20, notes: "20 ft climb; Spider Climb; Web Sense." },
  { form: "Weasel", hp: 1, maxHp: 1, ac: 13, speed: 30, notes: "Keen Hearing and Smell." },
  { form: "Hawk", hp: 1, maxHp: 1, ac: 13, speed: 10, notes: "60 ft fly; Keen Sight." },
  { form: "Frog", hp: 1, maxHp: 1, ac: 11, speed: 20, notes: "20 ft swim; standing leap." },
  { form: "Snake", hp: 2, maxHp: 2, ac: 13, speed: 30, notes: "30 ft swim; blindsight 10 ft." },
  // Pact of the Chain special forms: real combatants with an attack.
  { form: "Imp", hp: 10, maxHp: 10, ac: 13, speed: 20, chainOnly: true, notes: "40 ft fly; invisibility at will; devil's sight.", attacks: [{ name: "Sting", toHit: 5, damage: "1d4+3+3d6", type: "piercing (poison rides the sting)" }] },
  { form: "Quasit", hp: 7, maxHp: 7, ac: 13, speed: 40, chainOnly: true, notes: "Invisibility and Scare at will; shapechanger.", attacks: [{ name: "Claws", toHit: 4, damage: "1d4+3", type: "slashing plus poison" }] },
  { form: "Pseudodragon", hp: 7, maxHp: 7, ac: 13, speed: 15, chainOnly: true, notes: "60 ft fly; blindsight 10 ft; Sting (poison, save or sleep).", attacks: [{ name: "Bite", toHit: 4, damage: "1d4+2", type: "piercing" }, { name: "Sting", toHit: 4, damage: "1d4+2", type: "piercing plus poison save" }] },
  { form: "Sprite", hp: 2, maxHp: 2, ac: 15, speed: 10, chainOnly: true, notes: "40 ft fly; Invisibility; Shortbow (poison, save or sleep).", attacks: [{ name: "Longsword", toHit: 2, damage: "1", type: "slashing" }, { name: "Shortbow", toHit: 6, damage: "1", type: "piercing plus sleep-poison save" }] },
];

export const petTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "summon_pet",
      description:
        "A character summons or bonds the creature a feature grants them: Find Familiar (kind=familiar, form=owl/cat/raven/bat/rat/spider/weasel/hawk/frog/snake, or imp/quasit/pseudodragon/sprite with Pact of the Chain), a Beast Master ranger's companion (kind=beast_companion, any beast of CR 1/4 or lower), a Drakewarden's drake (kind=drake), or a story-granted pet (kind=other, with the stats). The server validates the feature, loads the stat block, and attaches the pet to their sheet. Call it BEFORE narrating the summon.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          kind: { type: "string", enum: ["familiar", "beast_companion", "drake", "other"] },
          form: { type: "string", description: "The creature: 'owl', 'wolf', 'drake'..." },
          name: { type: "string", description: "The pet's given name; defaults to the form." },
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
        "A character's pet attacks an enemy: the server checks the pet may attack at all (plain familiars cannot; Pact of the Chain forms, companions and drakes can), rolls to-hit and damage with the pet's real numbers, and applies the result. Commanding a Beast Master companion costs the ranger's action, a drake the bonus action; the server notes it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner's characterId." },
          petName: { type: "string", description: "Which pet, when they have several." },
          targetEnemyId: { type: "string", description: "The enemy being attacked." },
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
      name: "damage_pet",
      description:
        "An enemy or hazard damages a character's pet: the damage lands on the pet's own hit points, never the owner's. A familiar dropping to 0 HP vanishes (it can be resummoned with 10 gp and an hour's ritual); other pets fall unconscious at 0.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner's characterId." },
          petName: { type: "string", description: "Which pet, when they have several." },
          amount: { type: "integer", minimum: 0, maximum: 300 },
          reason: { type: "string" },
        },
        required: ["characterId", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismiss_pet",
      description:
        "A pet is dismissed, sent away, or dies in the fiction: the server removes it from the owner's sheet. Call it when the story ends the bond.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The owner's characterId." },
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

function featureNames(sheet: CharacterSheet): string[] {
  return [
    ...sheet.features.map((feature) => feature.name.toLowerCase()),
    ...sheet.feats.map((feat) => feat.toLowerCase()),
  ];
}

function knowsFindFamiliar(sheet: CharacterSheet): boolean {
  const spellList = sheet.spellcasting
    ? [...sheet.spellcasting.known, ...sheet.spellcasting.prepared]
    : [];
  return (
    spellList.some((entry) => entry.toLowerCase().includes("find familiar")) ||
    featureNames(sheet).some((name) => name.includes("find familiar"))
  );
}

function hasPactOfTheChain(sheet: CharacterSheet): boolean {
  return featureNames(sheet).some((name) => name.includes("pact of the chain"));
}

function hasBeastCompanionFeature(sheet: CharacterSheet): boolean {
  return (
    /beast\s*master/i.test(sheet.subclass ?? "") ||
    featureNames(sheet).some(
      (name) => name.includes("ranger's companion") || name.includes("animal companion"),
    )
  );
}

function hasDrakeFeature(sheet: CharacterSheet): boolean {
  return (
    /drakewarden/i.test(sheet.subclass ?? "") ||
    featureNames(sheet).some((name) => name.includes("drake companion"))
  );
}

function findPet(sheet: CharacterSheet, petName?: string): SheetPet | null {
  const wanted = (petName ?? "").trim().toLowerCase();
  if (!wanted) {
    return sheet.pets[0] ?? null;
  }
  return (
    sheet.pets.find(
      (pet) =>
        pet.name.toLowerCase().includes(wanted) ||
        wanted.includes(pet.name.toLowerCase()) ||
        pet.form.toLowerCase().includes(wanted),
    ) ?? null
  );
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
): SheetPet | { error: string } {
  const level = sheet.level;
  const pb = proficiencyBonus(level);
  if (args.kind === "familiar") {
    if (!knowsFindFamiliar(sheet) && !hasPactOfTheChain(sheet)) {
      return {
        error: `${sheet.name} does not know Find Familiar and has no Pact of the Chain; they cannot summon a familiar.`,
      };
    }
    const wanted = args.form.trim().toLowerCase();
    const form = FAMILIAR_FORMS.find((entry) => entry.form.toLowerCase() === wanted)
      ?? FAMILIAR_FORMS.find((entry) => wanted.includes(entry.form.toLowerCase()));
    if (!form) {
      return {
        error: `Unknown familiar form "${args.form}". Offer: ${FAMILIAR_FORMS.filter((entry) => !entry.chainOnly).map((entry) => entry.form.toLowerCase()).join(", ")}${hasPactOfTheChain(sheet) ? ", imp, quasit, pseudodragon, sprite" : ""}.`,
      };
    }
    if (form.chainOnly && !hasPactOfTheChain(sheet)) {
      return {
        error: `A ${form.form} familiar needs Pact of the Chain; ${sheet.name} can take an ordinary form instead.`,
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
      attacks: form.attacks ?? [],
      notes: `${form.notes} A familiar acts on its own but cannot attack${form.chainOnly ? "" : " (Pact of the Chain forms can)"}; the owner can see through its senses as an action.`,
    };
  }
  if (args.kind === "beast_companion") {
    if (!hasBeastCompanionFeature(sheet)) {
      return {
        error: `${sheet.name} has no Ranger's Companion feature; only a Beast Master gets a bonded beast.`,
      };
    }
    const beast = findBeastForm(args.form);
    if (!beast || beast.cr > 0.25) {
      return {
        error: `A ranger's companion must be a beast of CR 1/4 or lower (wolf, panther, boar, elk...).`,
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
      attacks: beast.attacks.map((attack) => ({
        name: attack.name,
        toHit: attack.toHit + pb,
        damage: `${attack.damage}+${pb}`,
        type: attack.type,
      })),
      notes: `${beast.traits ?? ""} Commanding an attack costs the ranger's action; it otherwise defends itself.`.trim(),
    };
  }
  if (args.kind === "drake") {
    if (!hasDrakeFeature(sheet)) {
      return { error: `${sheet.name} has no Drake Companion feature; only a Drakewarden bonds a drake.` };
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
    return { error: `A story pet needs hp and ac from its stat block.` };
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
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof summonSchema>;
  try {
    args = summonSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: summon_pet needs characterId, kind, and form." };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet.pets.length >= 3) {
    return { error: `${sheet.name} already has ${sheet.pets.length} bound creatures; dismiss one first.` };
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
          attacks: built.attacks
            .map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`)
            .join(", "),
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
): Record<string, unknown> {
  let args: z.infer<typeof petAttackSchema>;
  try {
    args = petAttackSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: pet_attack needs characterId and targetEnemyId." };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return { error: `${sheet.name} has no bound creature${args.petName ? ` called "${args.petName}"` : ""}.` };
  }
  if (pet.hp <= 0) {
    return { error: `${pet.name} is down; it cannot attack.` };
  }
  if (!pet.attacks.length) {
    return {
      error: `${pet.name} is an ordinary familiar and cannot attack (only Pact of the Chain forms fight). It can scout, deliver touch spells, and grant its senses instead.`,
    };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "pet_attack needs an active encounter and a target." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId);
  if (!enemy || enemy.status !== "alive") {
    return { error: "pet_attack needs a living targetEnemyId from GAME STATE." };
  }
  const wantedAttack = (args.attack ?? "").trim().toLowerCase();
  const attack =
    pet.attacks.find(
      (entry) =>
        wantedAttack &&
        (entry.name.toLowerCase().includes(wantedAttack) ||
          wantedAttack.includes(entry.name.toLowerCase())),
    ) ?? pet.attacks[0];

  const hitOutcome = rollExpression(d20Expression(attack.toHit));
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: `${pet.name} (${sheet.name}'s ${pet.form}): ${attack.name} vs ${enemy.displayName}`,
    result: hitOutcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: hitRoll,
    source: "digital",
  });
  turn.rollIds.push(hitRoll.id);

  const economy =
    pet.kind === "beast_companion"
      ? `Commanding ${pet.name} used ${sheet.name}'s action.`
      : pet.kind === "drake"
        ? `Commanding ${pet.name} used ${sheet.name}'s bonus action.`
        : `${pet.name} attacked with its own reaction (${sheet.name} forgoes one of their attacks).`;

  const crit = hitOutcome.crit === "nat20";
  const hit = hitOutcome.crit !== "nat1" && (crit || hitOutcome.total >= enemy.stats.ac);
  if (!hit) {
    return {
      ok: true,
      attack: `${pet.name}: ${attack.name}`,
      rolled: hitOutcome.total,
      vsAc: enemy.stats.ac,
      hit: false,
      economy,
    };
  }
  const damageOutcome = rollExpression(crit ? `${attack.damage}+${attack.damage}` : attack.damage);
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: `${pet.name}: ${attack.name} damage${crit ? " (CRIT)" : ""}`,
    result: damageOutcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: damageRoll,
    source: "digital",
  });
  turn.rollIds.push(damageRoll.id);
  const applied = applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    damageOutcome.total,
    sheets,
    sheetsById,
    attack.type,
  );
  publishEncounter(campaign.id);
  return {
    ok: true,
    attack: `${pet.name}: ${attack.name}`,
    rolled: hitOutcome.total,
    vsAc: enemy.stats.ac,
    hit: true,
    ...(crit ? { crit: true } : {}),
    ...applied,
    economy,
  };
}

export function handleDamagePet(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof damagePetSchema>;
  try {
    args = damagePetSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: damage_pet needs characterId and amount." };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return { error: `${sheet.name} has no bound creature${args.petName ? ` called "${args.petName}"` : ""}.` };
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
): Record<string, unknown> {
  let args: z.infer<typeof dismissSchema>;
  try {
    args = dismissSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: dismiss_pet needs characterId." };
  }
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const pet = findPet(sheet, args.petName);
  if (!pet) {
    return { error: `${sheet.name} has no bound creature${args.petName ? ` called "${args.petName}"` : ""}.` };
  }
  patchSheet(sheet.id, { pets: sheet.pets.filter((entry) => entry !== pet) });
  publishSheet(campaign, sheet.id);
  return { ok: true, dismissed: `${pet.name} (${pet.form})` };
}
