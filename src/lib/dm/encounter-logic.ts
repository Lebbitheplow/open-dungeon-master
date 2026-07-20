import type { OrderEntry } from "@/lib/db/encounters";

// Pure combat bookkeeping, kept database-free like mutation-math.ts so
// scripts/test-encounter-logic.mjs can exercise every branch.

// Sorts combatants into initiative order, descending. Ties break PCs first,
// then by name, so the order is deterministic across rebuilds.
export function buildOrder(
  pcs: Array<{ characterId: string; userId: string; name: string; initiative: number }>,
  enemies: Array<{ enemyId: string; name: string; initiative: number }>,
): OrderEntry[] {
  const entries: OrderEntry[] = [
    ...pcs.map((pc) => ({ kind: "pc" as const, ...pc })),
    ...enemies.map((enemy) => ({ kind: "enemy" as const, ...enemy })),
  ];
  return entries.sort((a, b) => {
    if (b.initiative !== a.initiative) {
      return b.initiative - a.initiative;
    }
    if (a.kind !== b.kind) {
      return a.kind === "pc" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

// Steps the turn pointer forward from fromIndex, skipping dead combatants
// and collecting the enemies passed over, until it lands on the next living
// PC. Enemies act inside the DM turn (via enemy_attack), so the pointer only
// ever rests on PCs. Downed PCs are skipped too, but their ids come back in
// pcsPassed so the caller can roll their death saves. wrapped is true when
// the order looped past the top (a new round). Returns null when no living
// PC exists.
export function advanceOrder(
  order: OrderEntry[],
  fromIndex: number,
  isAlive: (entry: OrderEntry) => boolean,
): { turnIndex: number; enemiesPassed: string[]; pcsPassed: string[]; wrapped: boolean } | null {
  if (!order.length || !order.some((entry) => entry.kind === "pc" && isAlive(entry))) {
    return null;
  }
  const enemiesPassed: string[] = [];
  const pcsPassed: string[] = [];
  let wrapped = false;
  let index = fromIndex;
  for (let steps = 0; steps < order.length + 1; steps += 1) {
    index += 1;
    if (index >= order.length) {
      index = 0;
      wrapped = true;
    }
    const entry = order[index];
    if (!isAlive(entry)) {
      if (entry.kind === "pc") {
        pcsPassed.push(entry.characterId);
      }
      continue;
    }
    if (entry.kind === "enemy") {
      enemiesPassed.push(entry.enemyId);
      continue;
    }
    return { turnIndex: index, enemiesPassed, pcsPassed, wrapped };
  }
  return null;
}

// Inserts new initiative entries into an existing sorted order without
// moving the pointer off the current combatant. Each entry slots by
// descending initiative (after existing equal counts); insertions at or
// before the pointer bump turnIndex, so reinforcements landing "above" the
// current turn act when their count comes up next round.
export function spliceIntoOrder(
  order: OrderEntry[],
  turnIndex: number,
  entries: OrderEntry[],
): { order: OrderEntry[]; turnIndex: number } {
  const nextOrder = [...order];
  let pointer = turnIndex;
  const sorted = [...entries].sort((a, b) => b.initiative - a.initiative);
  for (const entry of sorted) {
    let at = nextOrder.length;
    for (let index = 0; index < nextOrder.length; index += 1) {
      if (nextOrder[index].initiative < entry.initiative) {
        at = index;
        break;
      }
    }
    nextOrder.splice(at, 0, entry);
    if (at <= pointer) {
      pointer += 1;
    }
  }
  return { order: nextOrder, turnIndex: pointer };
}

// Target choice for the enemy auto-act fallback: the nearest living PC by
// Chebyshev distance on the battle map, tie-break lowest AC, falling back to
// the lowest-AC candidate when positions are unknown. Pure so the test
// suite covers it; candidates are pre-filtered to living PCs.
export function pickEnemyTarget(
  attackerPosition: { x: number; y: number } | null,
  candidates: Array<{ characterId: string; ac: number; position: { x: number; y: number } | null }>,
): string | null {
  if (!candidates.length) {
    return null;
  }
  const scored = candidates.map((candidate) => ({
    characterId: candidate.characterId,
    ac: candidate.ac,
    distance:
      attackerPosition && candidate.position
        ? Math.max(
            Math.abs(attackerPosition.x - candidate.position.x),
            Math.abs(attackerPosition.y - candidate.position.y),
          )
        : Number.MAX_SAFE_INTEGER,
  }));
  scored.sort((a, b) => a.distance - b.distance || a.ac - b.ac);
  return scored[0].characterId;
}

export type EncounterOutcome =
  | "victory"
  | "enemies_fled"
  | "party_fled"
  | "party_defeated"
  | "truce";

// Forgiving outcome resolution for end_encounter: the model's wording
// drifts ("peace", "the bandits surrender", "retreat"), and a rejected call
// used to leave the fight stuck open while the narration declared it over.
// Unknown or missing outcomes infer from the enemy roster instead of
// erroring: everyone dead = victory, everyone gone = enemies_fled,
// otherwise a truce.
export function coerceEncounterOutcome(
  raw: string | undefined,
  enemyStatuses: string[],
): { outcome: EncounterOutcome; inferred: boolean } {
  const wanted = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const exact: EncounterOutcome[] = [
    "victory",
    "enemies_fled",
    "party_fled",
    "party_defeated",
    "truce",
  ];
  if ((exact as string[]).includes(wanted)) {
    return { outcome: wanted as EncounterOutcome, inferred: false };
  }
  const synonyms: Array<[RegExp, EncounterOutcome]> = [
    [/party.*(flee|fled|retreat|escape|run)/, "party_fled"],
    [/(party|hero|character).*(defeat|down|dead|fall)|tpk/, "party_defeated"],
    [/win|won|victor|slain|kill|defeat/, "victory"],
    [/flee|fled|retreat|escape|rout|scatter|drive.*off|run/, "enemies_fled"],
    [/truce|parley|surrender|peace|yield|stand.*down|negotiat|talk|spare/, "truce"],
  ];
  for (const [pattern, outcome] of synonyms) {
    if (wanted && pattern.test(wanted)) {
      return { outcome, inferred: false };
    }
  }
  const living = enemyStatuses.filter((status) => status === "alive").length;
  const dead = enemyStatuses.filter((status) => status === "dead").length;
  if (living === 0 && dead > 0) {
    return { outcome: "victory", inferred: true };
  }
  if (living === 0) {
    return { outcome: "enemies_fled", inferred: true };
  }
  return { outcome: "truce", inferred: true };
}

export function enemyDamageMath(
  currentHp: number,
  amount: number,
): { currentHp: number; dropped: boolean } {
  const applied = Math.min(Math.max(Math.floor(amount), 1), 200);
  const next = Math.max(0, currentHp - applied);
  return { currentHp: next, dropped: currentHp > 0 && next === 0 };
}

// "1d8+3" -> "1d8+1d8+3": doubles every dice term for a critical hit while
// leaving flat modifiers alone.
// `extraDice` adds that many more copies of the FIRST damage die on top of
// the doubling, for Brutal Critical and the half-orc's Savage Attacks.
export function critDamageExpression(expression: string, extraDice = 0): string {
  const compact = expression.replace(/\s+/g, "");
  const terms = compact.match(/[+-]?[^+-]+/g);
  if (!terms) {
    return compact;
  }
  const doubled: string[] = [];
  let firstDie: string | null = null;
  for (const term of terms) {
    const sign = term.startsWith("-") ? "-" : "+";
    const body = term.replace(/^[+-]/, "");
    doubled.push(sign + body);
    if (/\d+d\d+/i.test(body)) {
      doubled.push(sign + body);
      if (firstDie === null && sign === "+") {
        // One die of that size, however many the weapon rolls.
        firstDie = body.replace(/^\d+/, "1");
      }
    }
  }
  for (let index = 0; index < extraDice && firstDie; index += 1) {
    doubled.push(`+${firstDie}`);
  }
  return doubled.join("").replace(/^\+/, "");
}

// ["Wolf", "Wolf", "Bear"] -> ["Wolf 1", "Wolf 2", "Bear"].
export function numberDuplicates(names: string[]): string[] {
  const totals = new Map<string, number>();
  for (const name of names) {
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((totals.get(name) ?? 0) <= 1) {
      return name;
    }
    const next = (seen.get(name) ?? 0) + 1;
    seen.set(name, next);
    return `${name} ${next}`;
  });
}
