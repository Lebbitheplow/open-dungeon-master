// What a character's features, traits, items and held dice add to one
// request_roll, beyond the conditions and the armor rules resolveRollExpression
// (src/lib/dm/rolls.ts) reads itself: advantage on a save keyed to what it
// resists, Feral Instinct on initiative, the magic items and traits that ride
// checks, the authored subclass riders, a held Bardic Inspiration or Dark
// One's Own Luck die, Peerless Skill, and Inspiration spent for advantage.
// Split from rolls.ts, which folds these into the expression. Pure.

import type { Advantage } from "@/lib/dice";
import { named } from "@/lib/dm/roll-about";
import { heldInspiration } from "@/lib/dm/roll-riders";
import type { RollArgs } from "@/lib/dm/roll-args";
import { computeSheetDerived, findSkill } from "@/lib/srd";
import { authoredCheckTraits, authoredRollRiders } from "@/lib/srd/authored-effects";
import { heldCheckTraits, traitCheckRiders } from "@/lib/srd/check-traits";
import { heldFeatChecks } from "@/lib/srd/feat-combat";
import { unnamedRollKeys, type RollGap, type RollKey } from "@/lib/srd/roll-keys";
import { lostSenses } from "@/lib/srd/sense-checks";
import { itemCheckRiders } from "@/lib/srd/item-check-riders";
import { heldSaveTraits, initiativeAdvantage, traitSaveAdvantages } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

// An unspent bonus die a character is holding for their next check or save:
// Bardic Inspiration from a bard, or the warlock's own Dark One's Own Luck.
// The die size rides in the condition name ("bardic inspiration (d8)",
// "dark one's own luck (d10)"), written by use_resource in
// src/lib/dm/resource-tools.ts.
function findInspiration(
  conditions: string[],
  meta: Record<string, { mote?: boolean } | undefined> = {},
): { condition: string; die: string; label: string; mote: boolean } | null {
  for (const condition of conditions) {
    const match = /^(bardic inspiration|dark one's own luck) \((d\d{1,2})\)$/i.exec(condition.trim());
    if (match) {
      return {
        condition,
        die: match[2].toLowerCase(),
        label: /own luck/i.test(match[1]) ? "Dark One's Own Luck" : "Bardic Inspiration die",
        mote: meta[condition]?.mote === true,
      };
    }
  }
  return null;
}

// A skill check's skill, by its id or name as the call writes it.
function rollSkill(args: RollArgs) {
  return args.kind === "skill_check" ? findSkill((args.skill ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")) : undefined;
}

// The check carries the skill's proficiency (or expertise).
function proficientIn(sheet: CharacterSheet, skill: string | undefined): boolean {
  return Boolean(skill && (sheet.proficiencies?.skills?.includes(skill) || (sheet.proficiencies?.expertise ?? []).includes(skill)));
}

// Every key the roller's traits, feats and conditions hold, for the ask
// below and for GAME STATE (prompt.ts rollKeyCue).
export function heldRollKeys(sheet: CharacterSheet): Array<RollKey & { feat?: string }> {
  return [...heldCheckTraits(sheet), ...authoredCheckTraits(sheet), ...lostSenses(sheet.conditions), ...heldFeatChecks(sheet), ...heldSaveTraits(sheet)];
}

// The fields a model's request_roll leaves unnamed that a trait the roller
// holds reads, with the values that would answer it (src/lib/srd/roll-keys.ts):
// the model is asked for them before anything is rolled, so the trait is
// never lost to an omission. Only the held traits are read, the same ones
// the riders below apply; a roller who holds none is never asked.
export function unnamedTraitFields(sheet: CharacterSheet, args: RollArgs): RollGap[] {
  const roll = args.kind === "saving_throw" ? "save" : args.kind === "skill_check" || args.kind === "ability_check" ? "check" : null;
  if (!roll) {
    return [];
  }
  const skill = rollSkill(args);
  // The feats' riders ride skill checks only (rolls.ts featCheckRider).
  const keys = heldRollKeys(sheet).filter((key) => key.roll === roll && (skill || !key.feat));
  return unnamedRollKeys(
    { roll, skill: skill?.id, ability: args.ability ?? skill?.ability, proficient: proficientIn(sheet, skill?.id), about: args.about, creature: args.creature, terrain: args.terrain, by: args.by, against: args.against, magical: args.magical, casterType: args.casterType },
    keys,
  );
}

// The fields an ask names, with the values that would answer them, merged
// over every roller asked (request_roll, group_check).
export function askedFields(gaps: RollGap[]): string {
  const merged = new Map<RollGap["field"], Set<string>>();
  for (const gap of gaps) {
    const values = merged.get(gap.field) ?? new Set<string>();
    gap.values.forEach((value) => values.add(value));
    merged.set(gap.field, values);
  }
  return [...merged]
    .map(([field, values]) =>
      field === "magical" ? "magical: true or false" : field === "creature" ? "creature: its type by the rules name, or 'none'" : `${field}: ${[...values].join(", ")}, or 'none'`,
    )
    .join("; ");
}

export type RollFeatureRiders = {
  advantageSources: Advantage[];
  // Dice ahead of the condition effects' own: a held inspiration die and
  // Peerless Skill's.
  dice: string;
  // Flat bonus on an ability or skill check (items and traits).
  checkBonus: number;
  // One-shot carriers the roll spends; the caller clears them.
  inspirationCondition: string | undefined;
  peerless: string | undefined;
  authoredSpent: string[];
  inspired: boolean;
  // The held die's note, then everything else, in the order the result reads.
  inspirationNotes: string[];
  notes: string[];
};

export function rollFeatureRiders(
  sheet: CharacterSheet | null,
  args: RollArgs,
  context: {
    kind: "skill_check" | "ability_check" | "saving_throw" | "initiative" | null;
    ability: "str" | "dex" | "con" | "int" | "wis" | "cha" | undefined;
    // The roller moved no more than half their speed this turn (Supreme Sneak).
    movedLittle?: boolean;
  },
): RollFeatureRiders | ToolError {
  const { kind: derivationKind, ability: derivationAbility } = context;
  const skillId = rollSkill(args)?.id;
  // Traits that give advantage on a save: Danger Sense on DEX (while the
  // barbarian can see and hear), and the ones keyed to what the save resists
  // (Brave, Fey Ancestry, Dwarven and Stout Resilience, Gnome Cunning). The
  // caller names what it resists through `against`, `magical` and
  // `casterType`; the recurring save-ends re-roll reads the same rules
  // (condition-tick.ts).
  const traitSaves =
    sheet && derivationKind === "saving_throw"
      ? traitSaveAdvantages(sheet, derivationAbility, { against: named(args.against), magical: args.magical, casterType: args.casterType })
      : [];
  // Feral Instinct: advantage on initiative.
  const feral = sheet && derivationKind === "initiative" ? initiativeAdvantage(sheet) : null;
  // Magic items that ride checks (Stone of Good Luck, Cloak of Elvenkind).
  const itemChecks =
    sheet && (derivationKind === "skill_check" || derivationKind === "ability_check")
      ? itemCheckRiders(sheet.equipment, skillId)
      : { bonus: 0, advantage: false, notes: [] };
  // The traits keyed to what a check is about (Favored Enemy, Natural
  // Explorer, Stonecunning, Artificer's Lore, Stone Camouflage, Supreme
  // Sneak): src/lib/srd/check-traits.ts. Peerless Skill's die rides a check
  // only.
  const checkKind = derivationKind === "skill_check" || derivationKind === "ability_check";
  const checkSkill = skillId;
  const checkDerived = sheet && checkKind ? computeSheetDerived(sheet) : null;
  const traitChecks =
    sheet && checkDerived
      ? traitCheckRiders(sheet, {
          ability: derivationAbility,
          skill: checkSkill,
          about: named(args.about),
          creature: named(args.creature),
          terrain: named(args.terrain),
          proficiencyBonus: checkDerived.proficiencyBonus,
          proficient: proficientIn(sheet, checkSkill),
          // The proficiency the skill already carries (expertise twice).
          applied: (checkSkill ? checkDerived.parts.skills[checkSkill] ?? [] : []).find((part) => /proficiency|expertise/.test(part.label))?.value ?? 0,
          movedLittle: context.movedLittle,
        })
      : { advantage: [], bonus: 0, notes: [] };
  const peerless = sheet && checkKind ? sheet.conditions.find((entry) => /^peerless skill \(d\d{1,2}\)$/i.test(entry.trim())) : undefined;
  // Inspiration the DM awarded, spent for advantage when the roll asks.
  if (args.useInspiration && derivationKind && sheet && !heldInspiration(sheet)) {
    return {
      error: `${sheet.name} holds no Inspiration to spend. The DM awards it with set_condition condition "inspiration"; roll without useInspiration.`,
      retry: true,
    };
  }
  const inspired = Boolean(args.useInspiration && derivationKind && sheet);
  const effectKind =
    derivationKind === "saving_throw"
      ? ("save" as const)
      : checkKind
        ? ("check" as const)
        : derivationKind === "initiative"
          ? ("initiative" as const)
          : null;
  // Authored subclass features on checks (Steady Eye, a spent Elegant
  // Maneuver or Vigilant Blessing): src/lib/srd/authored-effects.ts.
  const authoredRolls = sheet && effectKind
    ? authoredRollRiders(sheet, { kind: effectKind, ability: derivationAbility, skill: skillId, about: named(args.about) })
    : { advantage: [], spent: [] };
  // A held Bardic Inspiration die rides along on the next d20 the character
  // rolls and is spent by doing so; the caller clears the condition.
  const inspiration =
    sheet && derivationKind && derivationKind !== "initiative"
      ? findInspiration(sheet.conditions, sheet.conditionMeta as Record<string, { mote?: boolean }>)
      : null;
  // Mote of Potential: on an ability check the mote's die is rolled twice and
  // the higher kept (src/lib/dm/authored-mote.ts).
  const moteCheck = Boolean(inspiration?.mote) && checkKind;
  const peerlessDie = peerless ? `+1${/\((d\d{1,2})\)/i.exec(peerless)?.[1] ?? "d6"}` : "";
  return {
    advantageSources: [
      ...(traitSaves.length ? ["advantage" as const] : []),
      ...(feral ? ["advantage" as const] : []),
      ...(itemChecks.advantage ? ["advantage" as const] : []),
      ...(authoredRolls.advantage.length ? ["advantage" as const] : []),
      ...(traitChecks.advantage.length ? ["advantage" as const] : []),
      ...(inspired ? ["advantage" as const] : []),
    ],
    dice: `${inspiration ? (moteCheck ? `+2${inspiration.die}kh1` : `+1${inspiration.die}`) : ""}${peerlessDie}`,
    checkBonus: itemChecks.bonus + traitChecks.bonus,
    inspirationCondition: inspiration?.condition,
    peerless,
    authoredSpent: authoredRolls.spent,
    inspired,
    inspirationNotes: inspiration
      ? [`spends their ${inspiration.label}: +1${inspiration.die}${moteCheck ? " (Mote of Potential: rolled twice, the higher kept)" : ""}`]
      : [],
    notes: [
      ...traitSaves,
      ...(feral ? [feral] : []),
      ...itemChecks.notes,
      ...authoredRolls.advantage,
      ...traitChecks.advantage,
      ...traitChecks.notes,
      ...(peerless ? [`Peerless Skill: ${peerlessDie.slice(1)} on the check`] : []),
      ...(inspired ? ["spends their Inspiration: advantage"] : []),
    ],
  };
}
