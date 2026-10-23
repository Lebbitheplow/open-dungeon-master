// Wild Shape spent through use_resource (SRD 5.1, Druid): the beast a druid
// becomes, held to the druid-level ceilings, and Circle of the Moon's
// Elemental Wild Shape at 10th level, which spends two uses at once for an
// air, earth, fire or water elemental. Split out of resource-tools.ts, which
// pays for the use and then asks here for the form; a refusal from here
// leaves the use unspent, as the caller patches nothing.

import type { CharacterSheet } from "@/lib/schemas/sheet";
import {
  beastFormsHolding,
  findBeastForm,
  findShapeForm,
  formatCr,
  formList,
  hitPointCeilingForCr,
  UNLISTED_FORM_MAX_AC,
  wildShapeCapsFor,
  wildShapeForms,
  wildShapeHours,
  wildShapeRecord,
  type BeastForm,
} from "@/lib/srd/beast-forms";
import { attackSummary } from "@/lib/srd/creature-attacks";
import { speedWords } from "@/lib/srd/srd-creatures";
import { classLevelFor, classListFor } from "@/lib/srd/multiclass";
import { subclassNamed } from "@/lib/srd/subclass-name";
import { holdingHint, type ToolError } from "@/lib/dm/tool-errors";
import type { Outcome } from "@/lib/dm/resource-tools";

// The form use_resource names, and the stat block it brings for a beast the
// table does not list.
export type WildShapeAsk = { name?: string; hp?: number; ac?: number; cr?: number; flies?: boolean; swims?: boolean };

// Multiclass: the caps read the DRUID levels and the druid entry's circle,
// not the character's summed level or primary subclass.
function druidOf(sheet: CharacterSheet): { druidLevel: number; moonDruid: boolean } {
  const druidEntry = classListFor(sheet).find((entry) => entry.id.toLowerCase() === "druid");
  return {
    druidLevel: classLevelFor(sheet, "druid") || sheet.level,
    moonDruid: subclassNamed(druidEntry?.subclass ?? sheet.subclass ?? "", "Circle of the Moon"),
  };
}

// Elemental Wild Shape (Circle of the Moon, 10th level): "you can expend two
// uses of Wild Shape at the same time to transform into an air elemental,
// an earth elemental, a fire elemental, or a water elemental".
export const ELEMENTAL_WILD_SHAPE_COST = 2;
const ELEMENTALS = ["Air Elemental", "Earth Elemental", "Fire Elemental", "Water Elemental"];

// The elemental a Wild Shape names, or why this druid cannot take it; null
// when the form named is no elemental, an ordinary Wild Shape.
export function elementalWildShape(sheet: CharacterSheet, name: string | undefined): { form: BeastForm } | ToolError | null {
  const form = name?.trim() ? findShapeForm(name) : null;
  if (!form || !ELEMENTALS.includes(form.name)) {
    return null;
  }
  const { druidLevel, moonDruid } = druidOf(sheet);
  if (!moonDruid || druidLevel < 10) {
    return {
      error: `${form.name} is no beast: only a Circle of the Moon druid of 10th level or higher becomes an elemental, with Elemental Wild Shape for two uses of Wild Shape, and ${sheet.name} is ${moonDruid ? `a druid of level ${druidLevel}` : "not of the Circle of the Moon"}. Nothing was spent.`,
      refused: "rules",
    };
  }
  return { form };
}

// The elemental's whole block on the druid: its hit points, Armor Class,
// physical scores, attacks and defenses (a fire elemental is immune to
// fire), for the druid-level hours Wild Shape lasts.
function elementalOutcome(sheet: CharacterSheet, outcome: Outcome, form: BeastForm, druidLevel: number): Outcome {
  outcome.patch.wildShape = wildShapeRecord(form, {
    kind: "wildshape",
    abilities: { str: form.abilities.str, dex: form.abilities.dex, con: form.abilities.con },
  });
  outcome.result.elementalWildShape = `two uses of Wild Shape for the ${form.name}`;
  outcome.result.form = `${form.name}: ${form.hp} HP, AC ${form.ac}, speed ${speedWords(form.speeds)}, STR ${form.abilities.str}/DEX ${form.abilities.dex}/CON ${form.abilities.con}`;
  outcome.result.attacks = `${form.attacks.map(attackSummary).join(", ")}${(form.attacksPerTurn ?? 1) > 1 ? ` (${form.attacksPerTurn} per Attack action)` : ""}`;
  if (form.traits) {
    outcome.result.formTraits = form.traits;
  }
  outcome.shapeHours = wildShapeHours(druidLevel);
  outcome.result.lasts = `${outcome.shapeHours} hour${outcome.shapeHours === 1 ? "" : "s"}`;
  outcome.result.note = `Damage lands on the elemental's ${form.hp} hit points first, after its own resistances and immunities; ${sheet.name}'s own ${sheet.currentHp}/${sheet.maxHp} waits for them when the form drops. Physical rolls use the elemental's scores; they keep their own mind and cannot cast while shaped. Resolve its attacks with pc_attack. Call use_resource on Wild Shape again to revert (no use spent).`;
  return outcome;
}

// The form a Wild Shape takes, once its use is paid for: an elemental from
// elementalWildShape, a beast of the table within the druid's ceilings, or
// one the table does not list with the stat block the caller brings.
export function wildShapeUse(
  sheet: CharacterSheet,
  outcome: Outcome,
  displayName: string,
  form: WildShapeAsk | undefined,
  elemental: BeastForm | null,
): Outcome | ToolError {
  const name = (form?.name ?? "").trim();
  const { druidLevel, moonDruid } = druidOf(sheet);
  if (elemental) {
    return elementalOutcome(sheet, outcome, elemental, druidLevel);
  }
  const caps = wildShapeCapsFor(druidLevel, moonDruid);
  // The forms they can take now, for every question and refusal below.
  const offer = formList(wildShapeForms(caps));
  if (!name) {
    return {
      error: `${displayName} needs the beast being assumed in form; at druid level ${druidLevel} ${sheet.name} can take: ${offer}. Ask the player which, unless they named one.`,
      retry: true,
    };
  }
  // A known form loads its real stat block and is validated against the
  // druid-level ceilings; Circle of the Moon raises the CR cap.
  const known = findBeastForm(name);
  if (known) {
    if (known.cr > caps.maxCr) {
      return {
        error: `${known.name} is CR ${formatCr(known.cr)}; at level ${druidLevel}${moonDruid ? " (Circle of the Moon)" : ""} ${sheet.name} can Wild Shape into beasts of CR ${formatCr(caps.maxCr)} or lower: ${offer}. Offer a form within the limit.`,
        retry: true,
      };
    }
    if (known.fly && !caps.fly) {
      return {
        error: `${known.name} has a flying speed; Wild Shape allows flying forms only from druid level 8. Offer a ground form instead: ${offer}.`,
        retry: true,
      };
    }
    if (known.swim && !caps.swim) {
      return {
        error: `${known.name} has a swimming speed; Wild Shape allows swimming forms only from druid level 4. Offer a land form instead: ${offer}.`,
        retry: true,
      };
    }
    // Wild Shape swaps the physical scores; INT/WIS/CHA stay the
    // druid's own, so only these three are stored.
    outcome.patch.wildShape = wildShapeRecord(known, {
      kind: "wildshape",
      abilities: { str: known.abilities.str, dex: known.abilities.dex, con: known.abilities.con },
    });
    outcome.result.form = `${known.name}: ${known.hp} HP, AC ${known.ac}, speed ${speedWords(known.speeds)}, STR ${known.abilities.str}/DEX ${known.abilities.dex}/CON ${known.abilities.con}`;
    // A form with no attack (a frog, a sea horse) leaves the druid none:
    // their own weapons melded into it.
    outcome.result.attacks = known.attacks.length
      ? `${known.attacks.map(attackSummary).join(", ")}${(known.attacksPerTurn ?? 1) > 1 ? ` (${known.attacksPerTurn} per Attack action)` : ""}`
      : "none: this form has no attack, and the druid's own weapons merged into it";
    if (known.traits) {
      outcome.result.formTraits = known.traits;
    }
    outcome.shapeHours = wildShapeHours(druidLevel);
    outcome.result.lasts = `${outcome.shapeHours} hour${outcome.shapeHours === 1 ? "" : "s"}`;
    outcome.result.note = `Damage lands on the beast's ${known.hp} hit points first; ${sheet.name}'s own ${sheet.currentHp}/${sheet.maxHp} waits for them when the form drops. Physical rolls use the beast's scores; they keep their own mind and cannot cast while shaped. Resolve the beast's attacks with pc_attack. Call use_resource on Wild Shape again to revert (no use spent).`;
    return outcome;
  }
  // A creature of the table that is no beast (an ogre, a dragon) is no
  // Wild Shape, whatever numbers come with it.
  const other = findShapeForm(name);
  if (other) {
    return {
      error: `${other.name} is a ${other.type}, not a beast; Wild Shape takes a beast's form${moonDruid && druidLevel >= 10 ? ", or an air, earth, fire or water elemental's with Elemental Wild Shape" : ""}. At druid level ${druidLevel} ${sheet.name} can take: ${offer}.`,
      refused: "rules",
    };
  }
  // A beast the table does not list: the caller brings its stat block,
  // challenge rating included, and the same level caps hold. Numbers
  // above what that challenge rating carries are refused, so naming a
  // dragon a CR 1/4 beast buys nothing.
  const limits = `CR ${formatCr(caps.maxCr)} or lower${caps.fly ? "" : ", no flying forms"}${caps.swim ? "" : ", no swimming forms"}`;
  if (!form?.hp || !form?.ac || form.cr === undefined) {
    return {
      error: `"${name}" is not in the beast-form table; pass formHp, formAc and formCr from its stat block (and formFlies or formSwims if it does). At druid level ${druidLevel} the form must be ${limits}; the table's forms within it: ${offer}.${holdingHint(name, beastFormsHolding(name).map((form) => form.name))}`,
      retry: true,
    };
  }
  if (form.cr > caps.maxCr) {
    return {
      error: `${name} is CR ${formatCr(form.cr)}; at level ${druidLevel}${moonDruid ? " (Circle of the Moon)" : ""} ${sheet.name} can Wild Shape into beasts of ${limits}. Offer a form within the limit.`,
      retry: true,
    };
  }
  if (form.flies && !caps.fly) {
    return {
      error: `${name} has a flying speed; Wild Shape allows flying forms only from druid level 8. Offer a ground form instead.`,
      retry: true,
    };
  }
  if (form.swims && !caps.swim) {
    return {
      error: `${name} has a swimming speed; Wild Shape allows swimming forms only from druid level 4. Offer a land form instead.`,
      retry: true,
    };
  }
  const hpCeiling = hitPointCeilingForCr(form.cr);
  if (form.hp > hpCeiling || form.ac > UNLISTED_FORM_MAX_AC) {
    return {
      error: `A CR ${formatCr(form.cr)} beast has at most ${hpCeiling} hit points and AC ${UNLISTED_FORM_MAX_AC}; ${form.hp} HP and AC ${form.ac} are not ${name}'s numbers at that challenge rating. Send its real stat block, or a form from the table.`,
      retry: true,
    };
  }
  const beastHp = Math.max(1, form.hp);
  const beastAc = Math.max(1, form.ac);
  outcome.patch.wildShape = {
    form: name.slice(0, 60),
    beastHp,
    beastMaxHp: beastHp,
    beastAc,
    kind: "wildshape",
  };
  outcome.shapeHours = wildShapeHours(druidLevel);
  outcome.result.lasts = `${outcome.shapeHours} hour${outcome.shapeHours === 1 ? "" : "s"}`;
  outcome.result.form = `${name}: ${beastHp} HP, AC ${beastAc}`;
  outcome.result.note = `Damage lands on the beast's ${beastHp} hit points first; ${sheet.name}'s own ${sheet.currentHp}/${sheet.maxHp} waits for them when the form drops. Call use_resource on Wild Shape again to revert (no use spent).`;
  return outcome;
}
