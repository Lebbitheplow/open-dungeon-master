// Structured spell mechanics: what a spell actually resolves as, so the
// cast tools derive the save, the half-on-save rule, the damage type, the
// condition applied, and the buff granted from data instead of trusting the
// model's arguments.
//
// Three layers, first hit wins:
//   1. `mech` blocks authored per spell in authored-spells.json.
//   2. MECH_OVERRIDES below, for the widely played SRD spells whose effect
//      (a buff, a named condition) cannot be parsed from prose.
//   3. The prose parsers in spell-scaling.ts, which read the SRD's regular
//      phrasing. content/index.ts spellMechanicsFor combines all three.
//
// Pure and dependency-light so scripts/test-spell-mechanics.mjs can exercise
// every branch without the content database.

import authoredSpellsJson from "@/lib/srd/authored-spells.json";
import {
  attackKindFor,
  baseDamageDice,
  baseHealingDice,
  conditionAppliedFor,
  damageTypeFor,
  halfOnSaveFor,
  saveAbilityFor,
} from "@/lib/srd/spell-scaling";
import type { SaveAbilityId } from "@/lib/srd/condition-effects";

export type SpellMech = {
  // How the spell resolves at the table:
  //   attack  - spell attack roll: pc_attack
  //   save    - target saves: cast_at_enemy / cast_at_player / aoe_damage
  //   auto    - hits without roll or save (magic missile): damage applies
  //   heal    - restores hit points: heal
  //   buff    - grants an effect condition to self/allies: cast_buff
  //   summon  - conjures creatures: add_enemies / add_companion + narration
  //   utility - everything else; narrated
  resolution: "attack" | "save" | "auto" | "heal" | "buff" | "summon" | "utility";
  save?: SaveAbilityId;
  halfOnSave?: boolean;
  damageType?: string;
  // Condition applied to the target on a failed save (or on a hit).
  condition?: { name: string; rounds?: number; saveEnds?: boolean };
  // The effect condition cast_buff applies. `rounds` in combat rounds
  // (1 minute = 10). `variants` for spells with a choice (enlarge/reduce);
  // the first is the default. `tempHp` grants temporary hit points at cast
  // time, scaled per slot level above the spell's own.
  buff?: {
    condition: string;
    target: "self" | "ally" | "allies";
    rounds: number;
    variants?: string[];
    tempHp?: { base: number; perSlotLevel?: number };
  };
  // Dice the prose cannot be read for (a garbled upcast line): the base
  // expression at `baseLevel` and what each slot level above it adds.
  dice?: { base: string; perSlotLevel?: string; baseLevel: number };
  // Magic Missile: so many darts, one more for each slot level above the
  // spell's own, each dealing `each`. They hit without a roll.
  darts?: { count: number; perSlotLevel: number; each: string };
  // Several attack rolls from one casting: Eldritch Blast's beams grow with
  // the caster's level (two at 5th, three at 11th, four at 17th), Scorching
  // Ray's rays with the slot.
  attacks?: { count: number; perSlotLevel?: number; byCasterLevel?: boolean };
  // Sleep: a pool of hit points rolled by the caster and no saving throw. A
  // creature with more hit points than the pool is untouched.
  hitPointPool?: { dice: string; perSlotLevel: string; condition: string; rounds: number };
  // How many creatures one casting may affect, and how many more each slot
  // level above the spell's own adds. Absent means one.
  targets?: { count: number; perSlotLevel?: number };
  // The creature types the spell can take hold of (Hold Person: humanoid).
  // Absent means any.
  targetTypes?: string[];
  // One line the tool result hands the model for the parts no engine covers.
  note?: string;
};

type AuthoredSpellRow = {
  name: string;
  level: number;
  concentration?: boolean;
  duration?: string;
  desc: string;
  higher_level?: string;
  mech?: SpellMech;
};

const AUTHORED_SPELLS = (authoredSpellsJson as unknown as { spells: AuthoredSpellRow[] }).spells;

// A minute of combat, the standard buff duration.
const MINUTE = 10;
const TEN_MINUTES = 100;
const HOUR = 600;

// The SRD staples whose mechanics prose cannot state (buffs and named
// conditions above all). Keys are lowercased spell names; alias resolution
// happens in the caller via the content pack's alias list.
export const MECH_OVERRIDES: Record<string, SpellMech> = {
  bless: {
    resolution: "buff",
    buff: { condition: "blessed", target: "allies", rounds: MINUTE },
    targets: { count: 3, perSlotLevel: 1 },
    note: "Up to three creatures, one more per slot level above 1st; concentration.",
  },
  bane: {
    resolution: "save",
    save: "cha",
    condition: { name: "baned", rounds: MINUTE },
    targets: { count: 3, perSlotLevel: 1 },
    note: "Up to three targets, one more per slot level above 1st; concentration.",
  },
  "shield of faith": {
    resolution: "buff",
    buff: { condition: "shield of faith", target: "ally", rounds: TEN_MINUTES },
  },
  "mage armor": {
    resolution: "buff",
    buff: { condition: "mage armor", target: "ally", rounds: HOUR * 8 },
    note: "Ends early if the target dons armor.",
  },
  haste: {
    resolution: "buff",
    buff: { condition: "hasted", target: "ally", rounds: MINUTE },
    note: "When the spell ends the target cannot move or act until after its next turn; the server applies the lethargy.",
  },
  polymorph: {
    resolution: "buff",
    buff: { condition: "polymorphed", target: "ally", rounds: HOUR },
    note: "Pass variant with the beast form (e.g. 'giant ape', 'tyrannosaurus rex'); the server applies the form's full stat block. The beast's CR must not exceed the target's level. Concentration; ends early at 0 beast HP.",
  },
  slow: {
    resolution: "save",
    save: "wis",
    condition: { name: "slowed", saveEnds: true },
    note: "Up to six creatures in a 40-foot cube; concentration.",
  },
  "hold person": {
    resolution: "save",
    save: "wis",
    condition: { name: "paralyzed", saveEnds: true },
    targets: { count: 1, perSlotLevel: 1 },
    targetTypes: ["humanoid"],
  },
  "hold monster": {
    resolution: "save",
    save: "wis",
    condition: { name: "paralyzed", saveEnds: true },
    targets: { count: 1, perSlotLevel: 1 },
  },
  "charm person": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: HOUR },
    targets: { count: 1, perSlotLevel: 1 },
    targetTypes: ["humanoid"],
  },
  "dominate person": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: MINUTE },
    targetTypes: ["humanoid"],
    note: "The caster commands the charmed creature; it saves again each time it takes damage. Concentration.",
  },
  "dominate beast": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: MINUTE },
    targetTypes: ["beast"],
    note: "The caster commands the charmed beast; it saves again each time it takes damage. Concentration.",
  },
  sleep: {
    resolution: "auto",
    hitPointPool: { dice: "5d8", perSlotLevel: "2d8", condition: "unconscious", rounds: MINUTE },
    note: "No saving throw: creatures fall asleep from the lowest hit points up while the roll lasts. Undead and creatures immune to being charmed are not affected. A sleeper wakes when it takes damage or is shaken awake.",
  },
  "eldritch blast": {
    resolution: "attack",
    damageType: "force",
    attacks: { count: 1, byCasterLevel: true },
    note: "One pc_attack call for each beam: two beams at 5th level, three at 11th, four at 17th, all from the one action.",
  },
  "scorching ray": {
    resolution: "attack",
    damageType: "fire",
    attacks: { count: 3, perSlotLevel: 1 },
    note: "One pc_attack call for each ray: three rays, one more per slot level above 2nd, all from the one slot.",
  },
  "wall of fire": {
    resolution: "save",
    save: "dex",
    halfOnSave: true,
    damageType: "fire",
    dice: { base: "5d8", perSlotLevel: "1d8", baseLevel: 4 },
    note: "Concentration. A creature that ends its turn within 10 feet of the hot side, or enters the wall, takes the same damage again.",
  },
  // Spells that move or remake rather than harm. Their text mentions damage
  // only as what a mishap does to the caster.
  "dimension door": { resolution: "utility" },
  teleport: { resolution: "utility" },
  wish: { resolution: "utility" },
  barkskin: {
    resolution: "buff",
    buff: { condition: "barkskin", target: "ally", rounds: HOUR },
  },
  blur: {
    resolution: "buff",
    buff: { condition: "blurred", target: "self", rounds: MINUTE },
  },
  stoneskin: {
    resolution: "buff",
    buff: { condition: "stoneskin", target: "ally", rounds: HOUR },
  },
  longstrider: {
    resolution: "buff",
    buff: { condition: "longstrider", target: "ally", rounds: HOUR },
  },
  guidance: {
    resolution: "buff",
    buff: { condition: "guidance", target: "ally", rounds: MINUTE },
  },
  resistance: {
    resolution: "buff",
    buff: { condition: "resistance (spell)", target: "ally", rounds: MINUTE },
  },
  "true strike": {
    resolution: "buff",
    buff: { condition: "true strike", target: "self", rounds: 1 },
  },
  "divine favor": {
    resolution: "buff",
    buff: { condition: "divine favor", target: "self", rounds: MINUTE },
  },
  "hunter's mark": {
    resolution: "buff",
    buff: { condition: "hunter's mark", target: "self", rounds: HOUR },
    note: "Name the quarry in the condition, e.g. \"hunter's mark (the ogre)\".",
  },
  hex: {
    resolution: "buff",
    buff: { condition: "hexing", target: "self", rounds: HOUR },
    note: "Name the target in the condition; it also has disadvantage on checks with one chosen ability.",
  },
  heroism: {
    resolution: "buff",
    buff: { condition: "heroism", target: "ally", rounds: MINUTE },
  },
  "enlarge/reduce": {
    resolution: "buff",
    buff: {
      condition: "enlarged",
      target: "ally",
      rounds: MINUTE,
      variants: ["enlarged", "reduced"],
    },
  },
  invisibility: {
    resolution: "buff",
    buff: { condition: "invisible", target: "ally", rounds: HOUR },
    note: "Ends when the target attacks or casts a spell.",
  },
  "greater invisibility": {
    resolution: "buff",
    buff: { condition: "invisible", target: "ally", rounds: MINUTE },
  },
  "mirror image": {
    resolution: "buff",
    buff: { condition: "mirror image", target: "self", rounds: MINUTE },
  },
  "spiritual weapon": {
    resolution: "buff",
    buff: { condition: "spiritual weapon", target: "self", rounds: MINUTE },
    note: "Attack with it via pc_attack, weapon 'Spiritual Weapon' (a bonus action).",
  },
  "faerie fire": {
    resolution: "save",
    save: "dex",
    condition: { name: "faerie fire", rounds: MINUTE },
    note: "Each creature in a 20-foot cube saves; concentration.",
  },
  "magic missile": {
    resolution: "auto",
    damageType: "force",
    darts: { count: 3, perSlotLevel: 1, each: "1d4+1" },
    note: "Three darts, 1d4+1 each, +1 dart per slot level above 1st; they always hit. Every dart named at one target is rolled together.",
  },
  sanctuary: {
    resolution: "buff",
    buff: { condition: "sanctuary", target: "ally", rounds: MINUTE },
    note: "Attackers must first pass a WIS save or pick a new target; ends if the warded creature attacks.",
  },
  "expeditious retreat": {
    resolution: "buff",
    buff: { condition: "expeditious retreat", target: "self", rounds: TEN_MINUTES },
  },
  fly: {
    resolution: "buff",
    buff: { condition: "flying", target: "ally", rounds: TEN_MINUTES },
  },
  "protection from poison": {
    resolution: "buff",
    buff: { condition: "protected from poison", target: "ally", rounds: HOUR },
  },
  "false life": {
    resolution: "buff",
    buff: {
      condition: "false life",
      target: "self",
      rounds: HOUR,
      tempHp: { base: 5, perSlotLevel: 5 },
    },
  },
};

function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const AUTHORED_MECH = new Map<string, { row: AuthoredSpellRow; mech: SpellMech }>();
for (const row of AUTHORED_SPELLS) {
  if (row.mech) {
    AUTHORED_MECH.set(normalize(row.name), { row, mech: row.mech });
  }
}

// The authored row for a spell name, mech or not (for level/concentration
// when the content database is absent).
export function authoredSpellRow(name: string): AuthoredSpellRow | null {
  const wanted = normalize(name);
  return AUTHORED_SPELLS.find((row) => normalize(row.name) === wanted) ?? null;
}

// Layer 1 + 2: an authored or overridden mechanics row for any of a spell's
// names, or null. Callers pass the canonical name plus aliases.
export function spellMechFor(names: string[]): SpellMech | null {
  for (const name of names) {
    const wanted = normalize(name);
    const authored = AUTHORED_MECH.get(wanted);
    if (authored) {
      return authored.mech;
    }
    const override = MECH_OVERRIDES[wanted];
    if (override) {
      return override;
    }
  }
  return null;
}

// Layer 3: mechanics parsed from SRD-regular prose. Null when the text
// yields nothing actionable (a pure-utility spell).
export function parseSpellMech(input: { desc: string; higherLevel?: string }): SpellMech | null {
  const desc = input.desc;
  const attack = attackKindFor(desc);
  if (attack) {
    const type = damageTypeFor(desc);
    return { resolution: "attack", ...(type ? { damageType: type } : {}) };
  }
  const save = saveAbilityFor(desc);
  if (save) {
    const type = damageTypeFor(desc);
    const condition = conditionAppliedFor(desc);
    return {
      resolution: "save",
      save,
      halfOnSave: halfOnSaveFor(desc),
      ...(type ? { damageType: type } : {}),
      ...(condition ? { condition: { name: condition, saveEnds: true } } : {}),
    };
  }
  if (baseHealingDice(desc)) {
    return { resolution: "heal" };
  }
  const damage = baseDamageDice(desc);
  if (damage && !damageIsTheCastersOwn(desc)) {
    const type = damageTypeFor(desc);
    return { resolution: "auto", ...(type ? { damageType: type } : {}) };
  }
  return null;
}

// Whether the only damage a text speaks of is what the caster suffers when
// the spell goes wrong ("you and any creature traveling with you each take
// 4d6 force damage"). That is a mishap, not what the spell does to a target.
function damageIsTheCastersOwn(desc: string): boolean {
  const sentences = desc.split(/(?<=[.!?])\s+/).filter((sentence) => /\d+d\d+/.test(sentence) && /damage/i.test(sentence));
  return sentences.length > 0 && sentences.every((sentence) => /\byou\b[^.]{0,80}?\btake\b/i.test(sentence));
}

// How many attack rolls, darts or targets one casting holds: what the row
// states at the spell's own level, more from a higher slot, and for a cantrip
// that grows with its caster one more at 5th, 11th and 17th level.
export function castShares(
  mech: SpellMech | null,
  input: { spellLevel: number; slotLevel: number | null; casterLevel: number },
): number {
  const rule = mech?.attacks ?? mech?.targets ?? null;
  if (!rule) {
    return 1;
  }
  if ("byCasterLevel" in rule && rule.byCasterLevel) {
    const level = input.casterLevel;
    return rule.count + (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0);
  }
  const above = Math.max(0, (input.slotLevel ?? input.spellLevel) - input.spellLevel);
  return rule.count + (rule.perSlotLevel ?? 0) * above;
}
