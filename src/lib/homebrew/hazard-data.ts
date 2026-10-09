import { z } from "zod";
import { isValidExpression } from "@/lib/dice";
import { DISEASES } from "@/lib/srd/afflictions";
import type { Raw } from "@/lib/homebrew/coerce";

// A workshop hazard: a trap, a poison or a disease, as the numbers the
// engines run (src/lib/srd/trap-specs.ts TrapSpec for apply_hazard,
// src/lib/srd/afflictions.ts Poison and DiseaseSpec for the afflict tool).
// The SRD's own (the sample traps, the poisons table, the three diseases)
// are the same shapes, so "start from" one copies it whole. A number out of
// range is pulled into it; a value that is not a number, dice that cannot
// be rolled, or a kind with no block is refused with the field named.

const ability = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const dice = z
  .string()
  .trim()
  .max(40)
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => isValidExpression(value), "is not dice the table can roll");
const int = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : value),
    z.number().int().min(min).max(max),
  );
const word = (max = 40) => z.string().trim().min(1).max(max).transform((value) => value.toLowerCase());
const text = (max: number) => z.string().trim().max(max);
const part = z.object({ dice, type: word() });

export const trapSpecSchema = z.object({
  kind: z.enum(["mechanical", "magic"]).default("mechanical"),
  trigger: text(200).default(""),
  spot: z.object({ dc: int(1, 30), skill: z.enum(["perception", "investigation", "arcana"]) }).optional(),
  disarm: z.object({ dc: int(1, 30), how: text(200) }).optional(),
  attackBonus: int(-5, 20).optional(),
  fallFeet: int(0, 500).optional(),
  hit: z.array(part).max(4).optional(),
  save: z.object({ ability, dc: int(1, 30), halfOnSave: z.boolean() }).optional(),
  damage: part.optional(),
  condition: word().optional(),
  conditionsAlways: z.array(word()).max(4).optional(),
  rounds: int(1, 14_400).optional(),
  summary: text(600).default(""),
});

export const poisonSpecSchema = z.object({
  type: z.enum(["contact", "ingested", "inhaled", "injury"]),
  priceGp: int(0, 100_000).default(0),
  dc: int(1, 30),
  damage: dice.optional(),
  halfOnSave: z.boolean().optional(),
  conditions: z.array(word()).max(4).optional(),
  minutes: int(1, 525_600).optional(),
  hoursDice: dice.optional(),
  unconsciousIfFailBy: int(1, 20).optional(),
  wakesOnDamage: z.boolean().optional(),
  repeat: z
    .object({ every: z.enum(["turn_start", "turn_end", "day"]), damage: dice.optional(), successes: int(1, 20) })
    .optional(),
  atMidnight: z.boolean().optional(),
  summary: text(600).default(""),
});

export const diseaseSpecSchema = z.object({
  condition: word(),
  infect: z.object({ ability, dc: int(1, 30) }),
  onset: z.object({ dice, unit: z.enum(["hours", "days"]) }),
  exhaustion: int(0, 5).default(0),
  conditions: z.array(word()).max(4).optional(),
  rest: z
    .object({
      ability,
      dc: int(1, 30),
      onSuccess: z.enum(["improve", "recover"]),
      onFail: z.enum(["worsen", "nothing"]),
      successes: int(1, 10),
    })
    .optional(),
  runsAs: z.enum(Object.keys(DISEASES) as [keyof typeof DISEASES, ...Array<keyof typeof DISEASES>]).optional(),
  summary: text(600).default(""),
});

const SCHEMAS = { trap: trapSpecSchema, poison: poisonSpecSchema, disease: diseaseSpecSchema } as const;
export type HazardKindName = keyof typeof SCHEMAS;
export const HAZARD_KINDS = Object.keys(SCHEMAS) as HazardKindName[];

function firstIssue(error: z.ZodError, kind: string): string {
  const issue = error.issues[0];
  const path = issue?.path.length ? issue.path.join(".") : kind;
  return `The ${kind}'s ${path} ${issue?.message ?? "is not valid"}.`;
}

// The hazard block the engines run, or the reason it cannot be stored.
export function normalizeHazardData(source: Raw, data: Raw & { desc: string }): { data: Raw & { desc: string } } | { error: string } {
  const kind = String(source.hazardKind ?? "");
  if (!(kind in SCHEMAS)) {
    return { error: "A hazard is a trap, a poison or a disease." };
  }
  const hazardKind = kind as HazardKindName;
  const parsed = SCHEMAS[hazardKind].safeParse(source[hazardKind] ?? {});
  if (!parsed.success) {
    return { error: firstIssue(parsed.error, hazardKind) };
  }
  data.hazardKind = hazardKind;
  data[hazardKind] = parsed.data;
  return { data };
}
