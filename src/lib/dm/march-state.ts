// What the campaign clock keeps for the road and for the pauses between
// scenes: the pace the party marches at, the days each character has gone
// short of food and water, how much water can be found, a short rest whose hit
// dice are still being chosen, and the damage named objects have taken. Split
// from calendar.ts (normalizeClock spreads normalizeMarch in), as
// between-state.ts is. Every field is optional and bounded; a clock written
// before them reads as nobody on the march and nothing struck.

export type MarchState = {
  // The pace the party is marching at, set by travel and cleared when they
  // stop (a rest, pass_time). check_notice reads it: a fast pace is -5 to
  // passive Perception (SRD 5.1, Travel Pace). Absent: not on the march.
  travelPace?: "fast" | "normal" | "slow";
  // Days each character has gone short of food and of water, by
  // characterId, for the `supplies` variant rule (src/lib/dm/supplies.ts).
  // Absent on a clock written before it, which reads as fed and watered.
  supplies?: Record<string, { food: number; water: number }>;
  // How much water the party can find each day under the `supplies` variant,
  // when the DM says it is scarce: "half" is a DC 15 CON save a day, "none"
  // a level of exhaustion whatever they carry. Absent: enough (a waterskin
  // is refilled on the way).
  waterRation?: "half" | "none";
  // The short rest a party has just finished, while its players choose how
  // many hit dice to spend (SRD 5.1: the player decides, one die at a time).
  // `ids` are the characters still choosing, `sung` those whose Song of Rest
  // die is spent. Closed the moment the clock moves again.
  shortRest?: { ids: string[]; sung: string[] };
  // Damage each named object has taken, by its name in lower case, so a
  // door struck twice remembers the first blow (src/lib/dm/object-damage.ts).
  objects?: Record<string, number>;
};

function normalizeSupplies(raw: unknown): MarchState["supplies"] {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const entries = Object.entries(raw as Record<string, { food?: unknown; water?: unknown }>)
    .filter(([id]) => id.length <= 80)
    .slice(0, 50)
    .map(([id, days]): [string, { food: number; water: number }] => [
      id,
      {
        food: Math.min(365, Math.max(0, Math.round(Number(days?.food) || 0))),
        water: Math.min(365, Math.max(0, Math.round(Number(days?.water) || 0))),
      },
    ]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function normalizeMarch(record: Record<string, unknown>): MarchState {
  const travelPace = ["fast", "normal", "slow"].includes(String(record.travelPace))
    ? (record.travelPace as MarchState["travelPace"])
    : undefined;
  const supplies = normalizeSupplies(record.supplies);
  const waterRation = record.waterRation === "half" || record.waterRation === "none" ? record.waterRation : undefined;
  const objectsRaw = record.objects && typeof record.objects === "object" ? Object.entries(record.objects as Record<string, unknown>) : [];
  const objectEntries = objectsRaw
    .filter(([name, taken]) => name.length <= 60 && Number.isFinite(Number(taken)))
    .slice(-40)
    .map(([name, taken]): [string, number] => [name, Math.max(0, Math.min(10000, Math.round(Number(taken))))]);
  const objects = objectEntries.length ? Object.fromEntries(objectEntries) : undefined;
  const restRaw = record.shortRest as { ids?: unknown; sung?: unknown } | undefined;
  const ids = (list: unknown) =>
    Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && id.length <= 80).slice(0, 20) : [];
  const shortRest = restRaw && ids(restRaw.ids).length ? { ids: ids(restRaw.ids), sung: ids(restRaw.sung) } : undefined;
  return {
    ...(travelPace ? { travelPace } : {}),
    ...(supplies ? { supplies } : {}),
    ...(waterRation ? { waterRation } : {}),
    ...(shortRest ? { shortRest } : {}),
    ...(objects ? { objects } : {}),
  };
}
