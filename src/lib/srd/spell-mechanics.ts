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
    note: "Up to three creatures; concentration.",
  },
  bane: {
    resolution: "save",
    save: "cha",
    condition: { name: "baned", rounds: MINUTE },
    note: "Up to three targets; concentration.",
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
    note: "When the spell ends the target loses a turn to lethargy.",
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
  },
  "hold monster": {
    resolution: "save",
    save: "wis",
    condition: { name: "paralyzed", saveEnds: true },
  },
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
    note: "Three darts, 1d4+1 each, +1 dart per slot level above 1st; they always hit.",
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
  if (damage) {
    const type = damageTypeFor(desc);
    return { resolution: "auto", ...(type ? { damageType: type } : {}) };
  }
  return null;
}
