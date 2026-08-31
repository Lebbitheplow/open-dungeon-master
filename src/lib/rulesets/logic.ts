// A table's ruleset as one object, and what applying it to a campaign does.
//
// The request behind this (docs/workshop-plan.md section 2) was "all tools
// assume the ruleset is being enforced". That could not be true while a
// ruleset was three unrelated things with no name: the variant flags inside
// game settings, the house-rules prose on the campaign row, and the user's
// homebrew. This module is the name.
//
// The hard constraint, inherited from docs/worlds.md: a ruleset TOGGLES and
// ADDS. It never renames. Character sheets store spells, items and features
// by name, so anything that rewrote a canonical name at storage time would
// silently break findSpellByName, use_spell_slot and FEATURE_EFFECTS.
//
// No I/O, so scripts/test-rulesets.mjs drives it directly through the alias
// loader. The two "@/" imports are both to alias-free pure modules.

import { chunkHouseRules } from "@/lib/dm/rules-logic";
import type { GameSettings } from "@/lib/schemas/game-settings";

export type VariantRules = GameSettings["variantRules"];

export type Ruleset = {
  id: string;
  userId: string;
  name: string;
  description: string;
  variantRules: VariantRules;
  houseRulesText: string;
  // Which of the user's homebrew entries this ruleset says belong at the
  // table. Homebrew is already visible in every picker regardless; this is
  // the ruleset's claim about which of it is CANON here, which is what lets
  // a prepared monster referencing an entry outside the list be flagged.
  homebrewIds: string[];
  createdAt: string;
  updatedAt: string;
};

// The eight variant toggles, in the order a person reads them, with the
// sentence each one is actually worth. Shared by the library editor, the
// apply preview and anything that has to say what a ruleset does.
export const VARIANT_RULE_LABELS: Record<keyof Omit<VariantRules, "restVariant">, string> = {
  flanking: "Flanking grants advantage",
  criticalFumbles: "Natural 1 fumbles",
  encumbrance: "Encumbrance is weighed",
  lingeringInjuries: "Lingering injuries",
  powerfulCritical: "Powerful Critical (extra crit dice are maximized)",
  criticalDamageMods: "Critical Damage Mods (modifiers double on a crit)",
  ammunition: "Ammunition is counted",
};

export const REST_VARIANT_LABELS: Record<VariantRules["restVariant"], string> = {
  standard: "Standard rests",
  gritty: "Gritty realism (long rest is a week)",
  heroic: "Heroic (short rest is a breather)",
};

// The toggle keys, derived from the labels so a rule added to the schema
// without a label is a type error rather than a silently invisible switch.
export const VARIANT_RULE_KEYS = Object.keys(VARIANT_RULE_LABELS) as Array<
  keyof typeof VARIANT_RULE_LABELS
>;

// What this ruleset turns on, in words. An empty list means the plain rules,
// which is worth saying out loud rather than rendering as blank space.
export function activeVariantRules(rules: VariantRules): string[] {
  const active = VARIANT_RULE_KEYS.filter((key) => rules[key]).map(
    (key) => VARIANT_RULE_LABELS[key],
  );
  if (rules.restVariant !== "standard") {
    active.push(REST_VARIANT_LABELS[rules.restVariant]);
  }
  return active;
}

export function describeRuleset(ruleset: Pick<Ruleset, "variantRules" | "houseRulesText">): string {
  const active = activeVariantRules(ruleset.variantRules);
  const parts: string[] = [];
  parts.push(active.length ? `${active.length} variant rule${active.length === 1 ? "" : "s"}` : "the plain rules");
  const rulings = countHouseRulings(ruleset.houseRulesText);
  if (rulings) {
    parts.push(`${rulings} house ruling${rulings === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

// How many sections of house rules this text holds, counted by running the
// SAME chunker the engine runs (src/lib/dm/rules-logic.ts). Re-deriving
// "what looks like a heading" here would eventually disagree with it, and a
// count that disagrees with the retrieval it describes is worse than none:
// the chunker takes markdown headings as well as short colon-terminated
// lines, and applies length and punctuation rules this file should not know.
//
// Text with no headings at all is one ruling, not zero. Somebody wrote it.
export function countHouseRulings(text: string): number {
  if (!text.trim()) {
    return 0;
  }
  const chunks = chunkHouseRules(text);
  const headings = new Set(chunks.map((chunk) => chunk.heading).filter(Boolean));
  return headings.size || (chunks.length ? 1 : 0);
}

// ---- applying a ruleset ----

export type RulesetChange =
  | { kind: "variant"; label: string; from: boolean | string; to: boolean | string }
  | { kind: "houseRules"; from: number; to: number; replaces: boolean };

// What applying this ruleset to a campaign would change, so the DM sees it
// before they press the button rather than after. The whole point of an
// import preview is that a ruleset can quietly turn encumbrance on for a
// table that never asked for it.
export function rulesetChanges(
  ruleset: Pick<Ruleset, "variantRules" | "houseRulesText">,
  current: { variantRules: VariantRules; houseRulesText: string },
): RulesetChange[] {
  const changes: RulesetChange[] = [];
  for (const key of VARIANT_RULE_KEYS) {
    if (ruleset.variantRules[key] !== current.variantRules[key]) {
      changes.push({
        kind: "variant",
        label: VARIANT_RULE_LABELS[key],
        from: current.variantRules[key],
        to: ruleset.variantRules[key],
      });
    }
  }
  if (ruleset.variantRules.restVariant !== current.variantRules.restVariant) {
    changes.push({
      kind: "variant",
      label: "Rest pace",
      from: REST_VARIANT_LABELS[current.variantRules.restVariant],
      to: REST_VARIANT_LABELS[ruleset.variantRules.restVariant],
    });
  }
  const from = countHouseRulings(current.houseRulesText);
  const to = countHouseRulings(ruleset.houseRulesText);
  if (ruleset.houseRulesText.trim() !== current.houseRulesText.trim()) {
    changes.push({
      kind: "houseRules",
      from,
      to,
      // Replacing prose a table already wrote is the destructive case, and
      // the only one worth a warning.
      replaces: Boolean(current.houseRulesText.trim()),
    });
  }
  return changes;
}

// The house-rules text an apply should write. Appending rather than
// replacing is offered because the common case at campaign creation is an
// empty campaign, and the common case later is a table that already wrote
// something down and does not want it thrown away.
export function mergeHouseRules(
  incoming: string,
  current: string,
  mode: "replace" | "append",
): string {
  if (mode === "replace" || !current.trim()) {
    return incoming;
  }
  if (!incoming.trim()) {
    return current;
  }
  return `${current.trimEnd()}\n\n${incoming.trim()}`;
}
