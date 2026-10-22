// SRD stat blocks for the transformation engine: every creature of the
// SRD 5.1 (src/lib/srd/srd-creatures.ts) as a form a character or a
// creature can take. The beasts are the forms druids take with Wild Shape
// and the targets of Polymorph and Animal Shapes; True Polymorph and
// Shapechange may give any creature (src/lib/srd/shape-rules.ts says which).
// Before this table the model invented every number (formHp/formAc were
// free integers) and the form had no abilities, speed, or attacks at all.
//
// Data derived from the SRD 5.1, (c) Wizards of the Coast LLC, CC-BY-4.0.
// See docs/LICENSES.md.

import { compareNames, findNamed, namesHolding } from "@/lib/language/text-logic";
import type { CreatureAttack } from "@/lib/srd/creature-attacks";
import { SRD_CREATURES, traitLine, type CreatureSize, type CreatureSpeeds, type SrdCreature } from "@/lib/srd/srd-creatures";
import type { WildShape } from "@/lib/schemas/sheet";

export type BeastAttack = CreatureAttack;

export type BeastForm = {
  name: string;
  // Its creature type ("beast", "elemental", "dragon").
  type: string;
  cr: number;
  ac: number;
  hp: number;
  // Walking speed in feet, every movement mode, and whether the form flies
  // or swims, which gates the druid levels that may take it.
  speed: number;
  speeds: CreatureSpeeds;
  fly?: boolean;
  swim?: boolean;
  size: CreatureSize;
  // Full ability scores. Wild Shape swaps only STR/DEX/CON onto the druid;
  // Polymorph replaces all six.
  abilities: SrdCreature["abilities"];
  // The saving throws its block lists as proficient, and the damage and
  // conditions it shrugs off, in the words damageAdjust reads.
  saves?: SrdCreature["saves"];
  resist?: string;
  immune?: string;
  vulnerable?: string;
  conditionImmune?: string;
  // Its natural attacks; none at all for a frog or a sea horse, which then
  // cannot attack in the form.
  attacks: BeastAttack[];
  // Attacks per turn (Multiattack); 1 when absent.
  attacksPerTurn?: number;
  routines?: SrdCreature["routines"];
  senses?: SrdCreature["senses"];
  // Its traits as the block prints them, and as one line for the DM.
  traitLines: string[];
  traits?: string;
};

function beastForm(creature: SrdCreature): BeastForm {
  return {
    name: creature.name,
    type: creature.type,
    cr: creature.cr,
    ac: creature.ac,
    hp: creature.hp,
    speed: creature.speeds.walk,
    speeds: creature.speeds,
    ...(creature.speeds.fly ? { fly: true } : {}),
    ...(creature.speeds.swim ? { swim: true } : {}),
    size: creature.size,
    abilities: creature.abilities,
    ...(creature.saves?.length ? { saves: creature.saves } : {}),
    ...(creature.resist ? { resist: creature.resist } : {}),
    ...(creature.immune ? { immune: creature.immune } : {}),
    ...(creature.vulnerable ? { vulnerable: creature.vulnerable } : {}),
    ...(creature.conditionImmune ? { conditionImmune: creature.conditionImmune } : {}),
    attacks: creature.attacks,
    ...(creature.attacksPerTurn ? { attacksPerTurn: creature.attacksPerTurn } : {}),
    ...(creature.routines ? { routines: creature.routines } : {}),
    ...(creature.senses ? { senses: creature.senses } : {}),
    traitLines: creature.traits,
    ...(creature.traits.length ? { traits: traitLine(creature.traits, 600) } : {}),
  };
}

// Every creature as a form (True Polymorph, Shapechange), and the beasts
// alone (Wild Shape, Polymorph, Animal Shapes).
export const SHAPE_FORMS: BeastForm[] = SRD_CREATURES.map(beastForm);
export const BEAST_FORMS: BeastForm[] = SHAPE_FORMS.filter((form) => form.type === "beast");

export function findBeastForm(term: string): BeastForm | null {
  return findNamed(BEAST_FORMS, term, (form) => [form.name]);
}

// Any creature's form by name, beast or not.
export function findShapeForm(term: string): BeastForm | null {
  return findNamed(SHAPE_FORMS, term, (form) => [form.name]);
}

// The forms whose name holds a word a refused name was, for the refusal.
export function beastFormsHolding(term: string, forms: BeastForm[] = BEAST_FORMS): BeastForm[] {
  return namesHolding(forms, term, (form) => [form.name]);
}

// The record a sheet keeps while it wears the form: the form's hit points,
// Armor Class, speed, its natural attacks (an empty list for a form with
// none, so the character's own weapons stay out of reach) and its
// Multiattack, and what the creature is: its type, challenge rating, saving
// throws and defenses (a fire elemental's immunity to fire). `abilities`
// are the scores the spell or feature gives it.
export function wildShapeRecord(
  form: BeastForm,
  shape: { kind: "wildshape" | "polymorph"; abilities: NonNullable<WildShape>["abilities"]; keepsTraining?: boolean },
): NonNullable<WildShape> {
  return {
    form: form.name,
    beastHp: form.hp,
    beastMaxHp: form.hp,
    beastAc: form.ac,
    kind: shape.kind,
    ...(shape.keepsTraining ? { keepsTraining: true } : {}),
    abilities: shape.abilities,
    speed: form.speed,
    attacks: form.attacks.slice(0, 4).map((attack) => ({ ...attack })),
    ...((form.attacksPerTurn ?? 1) > 1 ? { attacksPerTurn: form.attacksPerTurn } : {}),
    type: form.type,
    cr: form.cr,
    ...(form.saves?.length ? { saves: form.saves } : {}),
    ...(form.resist ? { resist: form.resist } : {}),
    ...(form.immune ? { immune: form.immune } : {}),
    ...(form.vulnerable ? { vulnerable: form.vulnerable } : {}),
    ...(form.conditionImmune ? { conditionImmune: form.conditionImmune } : {}),
  };
}

// Creatures as a question or a refusal names them, the lowest challenge
// rating first: "Wolf (CR 1/4), Brown Bear (CR 1)".
export function formList(forms: Array<{ name: string; cr: number }>): string {
  return [...forms].sort((a, b) => a.cr - b.cr || compareNames(a.name, b.name)).map((form) => `${form.name} (CR ${formatCr(form.cr)})`).join(", ");
}

// The forms Wild Shape's caps allow (wildShapeCapsFor).
export function wildShapeForms(caps: { maxCr: number; fly: boolean; swim: boolean }): BeastForm[] {
  return BEAST_FORMS.filter((form) => form.cr <= caps.maxCr && (caps.fly || !form.fly) && (caps.swim || !form.swim));
}

// SRD Wild Shape ceilings by druid level (the class table's
// Wild Shape Improvement at 4th and 8th); Circle of the Moon raises the CR
// (1 from 2nd, level/3 from 6th) but not the movement gates.
export function wildShapeCapsFor(
  level: number,
  moonDruid: boolean,
): { maxCr: number; fly: boolean; swim: boolean } {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  const baseCr = clamped >= 8 ? 1 : clamped >= 4 ? 0.5 : 0.25;
  const moonCr = clamped >= 6 ? Math.max(1, Math.floor(clamped / 3)) : 1;
  return {
    maxCr: moonDruid ? Math.max(baseCr, moonCr) : baseCr,
    fly: clamped >= 8,
    swim: clamped >= 4,
  };
}

// The most hit points a creature of a challenge rating has (DMG, Monster
// Statistics by Challenge Rating), for a form the table above does not list:
// the caller states the beast's challenge rating, and the numbers it sends
// with it may not be those of something stronger.
const HP_CEILING_BY_CR: Array<[number, number]> = [
  [0, 6], [0.125, 35], [0.25, 49], [0.5, 70], [1, 85], [2, 100], [3, 115],
  [4, 130], [5, 145], [6, 160],
];

export function hitPointCeilingForCr(cr: number): number {
  const row = HP_CEILING_BY_CR.find(([rating]) => cr <= rating);
  return row ? row[1] : HP_CEILING_BY_CR[HP_CEILING_BY_CR.length - 1][1];
}

// No beast a druid can become wears better than natural armor of 18.
export const UNLISTED_FORM_MAX_AC = 18;

// How long a Wild Shape lasts: half the druid's level in hours, rounded
// down (SRD 5.1, Wild Shape), and an hour at the least.
export function wildShapeHours(druidLevel: number): number {
  return Math.max(1, Math.floor(druidLevel / 2));
}

// Human-readable CR ("1/4" not "0.25") for error messages.
export function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}
