// What a lasting companion holds to (issue 503 Phase 1), the pure half: the
// fixed list of values, what a companion starts with from its class and its
// alignment, and what a deed does to someone who holds them. The ladder a
// broken red line moves lives beside it (conscience-logic.ts); the rows and
// the tool live in src/lib/db/companion-conscience.ts and
// src/lib/dm/conscience.ts.
//
// A value is a conviction from a fixed list, held either as something the
// companion cares about (honouring it warms them, breaking it costs) or as a
// red line (breaking it is a step toward leaving, whatever the meter says).
// The last two values are why this is not a morality meter: a ruthless
// companion approves of the cruelty a kind one cannot stand.
//
// Pure, with relative imports only, so scripts/test-conscience.mjs loads it
// directly.

import { z } from "zod";
import { textKey } from "../language/text-logic.ts";

export const COMPANION_VALUES = [
  "protects_innocent",
  "keeps_oaths",
  "respects_law",
  "reveres_dead",
  "hates_tyranny",
  "faction_loyalty",
  "ruthless",
  "mercenary",
] as const;
export type CompanionValueId = (typeof COMPANION_VALUES)[number];

export const VALUE_STRENGTHS = ["cares", "red_line"] as const;
export type ValueStrength = (typeof VALUE_STRENGTHS)[number];

// One value held. `faction` names the faction a faction_loyalty is to, and
// is "" for every other value.
export type CompanionValue = { value: CompanionValueId; strength: ValueStrength; faction: string };

export const MAX_VALUES = 3;

export const VALUE_LABEL: Record<CompanionValueId, string> = {
  protects_innocent: "protects the innocent",
  keeps_oaths: "keeps oaths",
  respects_law: "respects the law",
  reveres_dead: "reveres the dead",
  hates_tyranny: "hates tyranny",
  faction_loyalty: "loyal to a faction",
  ruthless: "ruthless",
  mercenary: "mercenary",
};

export function valueLabel(held: CompanionValue): string {
  const label = held.value === "faction_loyalty" && held.faction ? `loyal to ${held.faction}` : VALUE_LABEL[held.value];
  return held.strength === "red_line" ? `${label} (red line)` : label;
}

// ---- deeds ----

// The morally weighty acts relationship_beat records with witnesses and a
// severity, and the only beats it takes in a fight, where most of them
// happen. The first four were beats already; the rest came with issue 503.
export const DEED_KINDS = [
  "mercy",
  "cruelty",
  "betrayal",
  "broke_word",
  "murder_helpless",
  "torture",
  "theft_from_poor",
  "necromancy",
  "desecration",
  "slaving",
] as const;
export type DeedKind = (typeof DEED_KINDS)[number];

export function isDeedKind(beat: string): beat is DeedKind {
  return (DEED_KINDS as readonly string[]).includes(beat);
}

export const DEED_SEVERITIES = ["minor", "serious", "atrocity"] as const;
export type DeedSeverity = (typeof DEED_SEVERITIES)[number];

// How far a deed's weight carries: a minor one half, an atrocity double.
export const SEVERITY_FACTOR: Record<DeedSeverity, number> = { minor: 0.5, serious: 1, atrocity: 2 };

// A mercy is never an atrocity: the worst of a kindness is a great one.
export function deedSeverity(beat: string, raw: string | undefined): DeedSeverity {
  const severity = (DEED_SEVERITIES as readonly string[]).includes(raw ?? "") ? (raw as DeedSeverity) : "serious";
  return beat === "mercy" && severity === "atrocity" ? "serious" : severity;
}

// The values each beat honours and breaks. Deeds and the social beats that
// plainly honour one (keeping your word, standing up for someone, profit)
// are here; a beat that is not is weighed by personality alone. Faction
// loyalty is honoured or broken only through the faction a deed names.
const BEAT_VALUES: Record<string, { honours: CompanionValueId[]; breaks: CompanionValueId[] }> = {
  mercy: { honours: ["protects_innocent"], breaks: ["ruthless"] },
  cruelty: { honours: ["ruthless"], breaks: ["protects_innocent"] },
  betrayal: { honours: [], breaks: ["keeps_oaths"] },
  broke_word: { honours: [], breaks: ["keeps_oaths"] },
  murder_helpless: { honours: ["ruthless"], breaks: ["protects_innocent", "respects_law"] },
  torture: { honours: ["ruthless"], breaks: ["protects_innocent", "hates_tyranny"] },
  theft_from_poor: { honours: [], breaks: ["protects_innocent", "respects_law"] },
  necromancy: { honours: [], breaks: ["reveres_dead"] },
  desecration: { honours: [], breaks: ["reveres_dead"] },
  slaving: { honours: [], breaks: ["hates_tyranny", "protects_innocent", "respects_law"] },
  kept_word: { honours: ["keeps_oaths"], breaks: [] },
  defended: { honours: ["protects_innocent"], breaks: [] },
  greed: { honours: ["mercenary"], breaks: [] },
};

// The deeds that harm someone, which break a faction loyalty to the faction
// they were done to; a mercy shown to that faction's people honours it.
const HARMFUL = new Set<string>(DEED_KINDS.filter((kind) => kind !== "mercy"));

// Approval each value moves, before severity: a red line counts for more
// either way. Honouring one outweighs the cost a harmful deed has with
// everyone else, so a ruthless companion approves of the cruelty a kind one
// cannot stand; breaking one adds to a cost already paid, and the ladder
// (not the meter) is what a red line is really for.
const HONOUR_SWING: Record<ValueStrength, number> = { cares: 6, red_line: 12 };
const BREAK_SWING: Record<ValueStrength, number> = { cares: 4, red_line: 8 };

export type DeedVerdict = {
  // Approval on top of the personality weighting, severity applied.
  approval: number;
  honoured: CompanionValue[];
  broken: CompanionValue[];
  // What it does to the ladder (conscience-logic.ts): an atrocity against a
  // red line takes the witness to the breaking point, a serious breach of
  // one (or an atrocity against something they care about) steps it down a
  // rung, and a deed that honours what they hold steps it back up.
  ladder: "atrocity" | "breach" | "honour" | null;
};

export function deedVerdict(
  values: readonly CompanionValue[],
  beat: string,
  severity: DeedSeverity,
  faction = "",
): DeedVerdict {
  const map = BEAT_VALUES[beat] ?? { honours: [], breaks: [] };
  const named = textKey(faction);
  const touches = (held: CompanionValue, list: CompanionValueId[], forFaction: boolean) =>
    held.value === "faction_loyalty" ? forFaction && named !== "" && textKey(held.faction) === named : list.includes(held.value);
  const honoured = values.filter((held) => touches(held, map.honours, beat === "mercy"));
  const broken = values.filter((held) => touches(held, map.breaks, HARMFUL.has(beat)));
  const factor = SEVERITY_FACTOR[severity];
  const approval = Math.round(
    (honoured.reduce((sum, held) => sum + HONOUR_SWING[held.strength], 0) -
      broken.reduce((sum, held) => sum + BREAK_SWING[held.strength], 0)) *
      factor,
  );
  const redLine = broken.some((held) => held.strength === "red_line");
  const ladder = broken.length
    ? redLine && severity === "atrocity"
      ? "atrocity"
      : (redLine && severity !== "minor") || severity === "atrocity"
        ? "breach"
        : null
    : honoured.length
      ? "honour"
      : null;
  return { approval, honoured, broken, ladder };
}

// ---- who a companion starts as ----

export const ALIGNMENT_CODES = ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"] as const;
export type AlignmentCode = (typeof ALIGNMENT_CODES)[number];

// A sheet's alignment is one of the builder's codes (usePickerGroups.ts
// ALIGNMENTS); anything else is no alignment.
export function alignmentCode(raw: string | undefined | null): AlignmentCode | null {
  const code = (raw ?? "").trim();
  return (ALIGNMENT_CODES as readonly string[]).includes(code) ? (code as AlignmentCode) : null;
}

const held = (value: CompanionValueId, strength: ValueStrength = "cares"): CompanionValue => ({ value, strength, faction: "" });

const GOOD: ReadonlySet<AlignmentCode> = new Set(["LG", "NG", "CG"]);
const EVIL: ReadonlySet<AlignmentCode> = new Set(["LE", "NE", "CE"]);

// What each SRD class starts out holding, before alignment says more. A
// class nobody listed keeps its word.
const CLASS_VALUES: Record<string, CompanionValue[]> = {
  paladin: [held("protects_innocent", "red_line"), held("keeps_oaths", "red_line")],
  cleric: [held("reveres_dead", "red_line"), held("protects_innocent")],
  druid: [held("reveres_dead"), held("protects_innocent")],
  monk: [held("protects_innocent"), held("keeps_oaths")],
  ranger: [held("protects_innocent")],
  fighter: [held("keeps_oaths")],
  barbarian: [held("hates_tyranny")],
  bard: [held("hates_tyranny")],
  sorcerer: [held("hates_tyranny")],
  wizard: [held("respects_law")],
  rogue: [held("mercenary")],
  warlock: [held("mercenary")],
};

function withValue(values: CompanionValue[], next: CompanionValue): CompanionValue[] {
  const existing = values.find((entry) => entry.value === next.value);
  if (!existing) {
    return [...values, next];
  }
  // A value already held is only ever strengthened by alignment.
  return values.map((entry) => (entry === existing && next.strength === "red_line" ? { ...entry, strength: "red_line" } : entry));
}

// Red lines first, then what they care about, at most three: the order the
// prompt and the sheet read them in.
export function orderedValues(values: readonly CompanionValue[]): CompanionValue[] {
  const seen = new Set<string>();
  return [...values]
    .sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "red_line" ? -1 : 1))
    .filter((entry) => {
      const key = `${entry.value}:${textKey(entry.faction)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_VALUES);
}

// The values a companion starts with: its class's, then what its alignment
// adds when the story gave one. Deterministic, no model call. A lawful good
// paladin starts with protecting the innocent and keeping oaths, both red
// lines; an evil one keeps its oaths and is ruthless.
export function defaultValues(classId: string, alignment: string | null | undefined): CompanionValue[] {
  let values = [...(CLASS_VALUES[textKey(classId)] ?? [held("keeps_oaths")])];
  const code = alignmentCode(alignment);
  if (code) {
    const good = GOOD.has(code);
    const evil = EVIL.has(code);
    if (evil) {
      values = values.filter((entry) => entry.value !== "protects_innocent" && entry.value !== "reveres_dead");
    }
    if (code === "LG" || code === "NG") {
      values = withValue(values, held("protects_innocent", "red_line"));
    } else if (good) {
      values = withValue(values, held("protects_innocent"));
    }
    if (code === "LG") {
      values = withValue(values, held("keeps_oaths"));
    } else if (code === "LN") {
      values = withValue(values, held("respects_law", "red_line"));
    } else if (code === "LE") {
      values = withValue(values, held("respects_law"));
    }
    if (code === "CG" || code === "CN") {
      values = withValue(values, held("hates_tyranny"));
    }
    if (code === "CE") {
      values = withValue(values, held("ruthless", "red_line"));
    } else if (code === "NE") {
      values = withValue(values, held("mercenary"));
      values = withValue(values, held("ruthless"));
    } else if (code === "LE") {
      values = withValue(values, held("ruthless"));
    }
  }
  return orderedValues(values);
}

// ---- storage ----

export function parseValues(raw: string): CompanionValue[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeValues(parsed) : [];
  } catch {
    return [];
  }
}

// Whatever arrives (a stored row, the DM's add_companion), as values the
// rules can read: known values only, a faction loyalty only with its
// faction named, at most three.
export function normalizeValues(raw: readonly unknown[]): CompanionValue[] {
  const values: CompanionValue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const value = String(record.value ?? "");
    if (!(COMPANION_VALUES as readonly string[]).includes(value)) {
      continue;
    }
    const faction = typeof record.faction === "string" ? record.faction.trim().slice(0, 80) : "";
    if (value === "faction_loyalty" && !faction) {
      continue;
    }
    values.push({
      value: value as CompanionValueId,
      strength: record.strength === "red_line" ? "red_line" : "cares",
      faction: value === "faction_loyalty" ? faction : "",
    });
  }
  return orderedValues(values);
}

// add_companion's values argument, as the model is offered it and as the
// handler reads it.
export const VALUES_PARAMETER = {
  type: "array",
  maxItems: MAX_VALUES,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      value: { type: "string", enum: [...COMPANION_VALUES] },
      strength: { type: "string", enum: [...VALUE_STRENGTHS] },
      faction: { type: "string", description: "For faction_loyalty." },
    },
    required: ["value", "strength"],
  },
  description: "Rarely needed: replaces what class and alignment give a party member to hold to. red_line: a line they will not see crossed.",
} as const;

export const valuesArgSchema = z
  .array(
    z.object({
      value: z.enum(COMPANION_VALUES),
      strength: z.enum(VALUE_STRENGTHS),
      faction: z.string().trim().max(80).optional(),
    }),
  )
  .min(1)
  .max(MAX_VALUES);
