// The checks a blinded or deafened creature cannot make (SRD 5.1,
// Conditions): "A blinded creature can't see and automatically fails any
// ability check that requires sight." "A deafened creature can't hear and
// automatically fails any ability check that requires hearing." Which sense
// a check needs is named by its caller (a roll's `by`, src/lib/dm/
// roll-about.ts); a check that names none is left alone, since Perception
// can be made with any sense, and a model's request_roll that leaves it
// unnamed for a blinded or deafened roller is asked for it (the keys below,
// src/lib/srd/roll-keys.ts). Pure.

import type { CHECK_SENSES } from "@/lib/dm/roll-about";
import { keyFits, type RollKey } from "@/lib/srd/roll-keys";

export type Sense = (typeof CHECK_SENSES)[number];

// The senses the roller's conditions take, each as the check it fails.
export function lostSenses(conditions: string[]): Array<RollKey & { note: string }> {
  const has = (name: string) => conditions.some((entry) => entry.trim().toLowerCase() === name);
  return [
    ...(has("blinded") ? [{ roll: "check" as const, by: ["sight"], note: "blinded: automatically fails an ability check that requires sight" }] : []),
    ...(has("deafened") ? [{ roll: "check" as const, by: ["hearing"], note: "deafened: automatically fails an ability check that requires hearing" }] : []),
  ];
}

// The sentence for an automatic failure, or null when the conditions allow
// the check.
export function senseCheckFailure(conditions: string[], input: { by?: Sense }): string | null {
  return lostSenses(conditions).find((key) => keyFits(key, { roll: "check", by: input.by }))?.note ?? null;
}
