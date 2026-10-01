// The checks a blinded or deafened creature cannot make (SRD 5.1,
// Conditions): "A blinded creature can't see and automatically fails any
// ability check that requires sight." "A deafened creature can't hear and
// automatically fails any ability check that requires hearing." Which sense
// a check needs is read from what it is for ("spot the tracks", "listen at
// the door") or named outright; a check that names neither is left alone,
// since Perception can be made with any sense. Pure.

export type Sense = "sight" | "hearing";

const HEARING = /\b(hear|hears|heard|hearing|listen|listens|listening|sound|sounds|noise|noises|whisper|whispers|voice|voices|footsteps?|eavesdrop\w*|by ear)\b/i;
const SIGHT = /\b(see|sees|seen|seeing|sight|spot|spots|spotting|look|looks|looking|watch|watches|watching|read|reads|reading|glimpse|glance|peer|peers|scan|scans|visual\w*|colou?rs?|by sight)\b/i;

// The sense a check needs: the one it names, else the one its reason reads
// as, else none.
export function senseOfCheck(input: { by?: Sense | null; reason?: string | null }): Sense | null {
  if (input.by) {
    return input.by;
  }
  const reason = input.reason ?? "";
  const hears = HEARING.test(reason);
  const sees = SIGHT.test(reason);
  return hears && !sees ? "hearing" : sees && !hears ? "sight" : null;
}

// The sentence for an automatic failure, or null when the conditions allow
// the check.
export function senseCheckFailure(conditions: string[], input: { by?: Sense | null; reason?: string | null }): string | null {
  const sense = senseOfCheck(input);
  const has = (name: string) => conditions.some((entry) => entry.trim().toLowerCase() === name);
  if (sense === "sight" && has("blinded")) {
    return "blinded: automatically fails an ability check that requires sight";
  }
  if (sense === "hearing" && has("deafened")) {
    return "deafened: automatically fails an ability check that requires hearing";
  }
  return null;
}
