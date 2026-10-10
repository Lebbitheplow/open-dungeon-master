import type { OrderEntry } from "@/lib/db/encounters";
import { compareNames } from "@/lib/language/text-logic";

// Pure combat bookkeeping, kept database-free like mutation-math.ts so
// scripts/test-encounter-logic.mjs can exercise every branch.

// Sorts combatants into initiative order, descending. Ties break PCs first,
// then by name, so the order is deterministic across rebuilds.
// Thief's Reflexes (Thief 17): a second turn in the first round, at the
// thief's initiative minus 10, unless the thief is surprised.
export function withReflexTurns<T extends { characterId: string; initiative: number }>(
  pcs: T[],
  hasReflexes: (characterId: string) => boolean,
  surprised: string[],
): Array<T & { reflex?: boolean }> {
  return [
    ...pcs,
    ...pcs
      .filter((pc) => hasReflexes(pc.characterId) && !surprised.includes(pc.characterId))
      .map((pc) => ({ ...pc, initiative: pc.initiative - 10, reflex: true })),
  ];
}

// The order once round 1 is over: the reflex turns go, and the pointer keeps
// its place (on the entry before a removed one, so the next step still
// reaches the one after it).
export function withoutReflexTurns(order: OrderEntry[], turnIndex: number): { order: OrderEntry[]; turnIndex: number } | null {
  if (!order.some((entry) => entry.kind === "pc" && entry.reflex)) {
    return null;
  }
  const kept = order.filter((entry) => !(entry.kind === "pc" && entry.reflex));
  const before = order.slice(0, turnIndex + 1).filter((entry) => !(entry.kind === "pc" && entry.reflex)).length;
  const index = before - 1;
  return { order: kept, turnIndex: index < 0 ? kept.length - 1 : index };
}

export function buildOrder(
  pcs: Array<{ characterId: string; userId: string; name: string; initiative: number; reflex?: boolean }>,
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
    return compareNames(a.name, b.name);
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
    // The pointer rests only on player characters. Enemies act inside the DM
    // turn, and an NPC slot a human DM added is theirs to narrate whenever
    // they like, so both are walked past.
    if (entry.kind !== "pc") {
      if (entry.kind === "enemy") {
        enemiesPassed.push(entry.enemyId);
      }
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
//
// A creature it cannot see (hidden, invisible) is picked only when nobody it
// can see is left: it would have to guess where they are (SRD 5.1).
export function pickEnemyTarget(
  attackerPosition: { x: number; y: number } | null,
  candidates: Array<{ characterId: string; ac: number; position: { x: number; y: number } | null; unseen?: boolean }>,
): string | null {
  if (!candidates.length) {
    return null;
  }
  const seen = candidates.filter((candidate) => !candidate.unseen);
  const scored = (seen.length ? seen : candidates).map((candidate) => ({
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

// Damage the engine rolled lands in full: no cap on one blow (a 250-point
// Disintegrate is 250). What a caller may SEND is bounded by its tool's own
// schema, not here.
export function enemyDamageMath(
  currentHp: number,
  amount: number,
): { currentHp: number; dropped: boolean } {
  const applied = Math.max(Math.floor(amount), 1);
  const next = Math.max(0, currentHp - applied);
  return { currentHp: next, dropped: currentHp > 0 && next === 0 };
}

// "1d8+3" -> "1d8+1d8+3": doubles every dice term for a critical hit while
// leaving flat modifiers alone.
// `extraDice` adds that many more copies of the FIRST damage die on top of
// the doubling, for Brutal Critical and the half-orc's Savage Attacks.
export function critDamageExpression(
  expression: string,
  extraDice = 0,
  // Optional 5e variant rules. powerfulCritical: the extra critical dice are
  // dealt as their maximum instead of rolled. multiplyNumeric: the flat
  // modifiers double along with the dice.
  options: { powerfulCritical?: boolean; multiplyNumeric?: boolean } = {},
): string {
  const compact = expression.replace(/\s+/g, "");
  const terms = compact.match(/[+-]?[^+-]+/g);
  if (!terms) {
    return compact;
  }
  const { powerfulCritical = false, multiplyNumeric = false } = options;
  // Maximum a "NdM" body can roll; anything else passes through unchanged.
  const maxOfDice = (body: string): string => {
    const match = /^(\d+)d(\d+)$/i.exec(body);
    return match ? String(Number(match[1]) * Number(match[2])) : body;
  };
  const doubled: string[] = [];
  let firstDie: string | null = null;
  for (const term of terms) {
    const sign = term.startsWith("-") ? "-" : "+";
    const body = term.replace(/^[+-]/, "");
    doubled.push(sign + body);
    if (/\d+d\d+/i.test(body)) {
      // The critical copy of this die: rolled, or maximized as a flat total
      // under Powerful Critical.
      doubled.push(sign + (powerfulCritical ? maxOfDice(body) : body));
      if (firstDie === null && sign === "+") {
        // One die of that size, however many the weapon rolls.
        firstDie = body.replace(/^\d+/, "1");
      }
    } else if (multiplyNumeric && /^\d+$/.test(body)) {
      // Critical Damage Modifiers: the flat modifier doubles with the dice.
      doubled.push(sign + body);
    }
  }
  for (let index = 0; index < extraDice && firstDie; index += 1) {
    doubled.push(`+${powerfulCritical ? maxOfDice(firstDie) : firstDie}`);
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

// "Hunter 2" is a Hunter: the name without the number the engine (or the
// model, or a DM) put on the end of it.
function unnumbered(name: string): { base: string; number: number | null } {
  const match = /^(.*\S)\s+#?(\d{1,3})$/.exec(name.trim());
  return match ? { base: match[1], number: Number(match[2]) } : { base: name.trim(), number: null };
}

// Names for combatants joining ones already there (issue 98). Creatures of
// one kind are numbered as one run however they arrived: two Hunters and a
// third who comes later are Hunter 1, 2 and 3, not "Hunter 1", "Hunter 2"
// and a plain "Hunter". numberDuplicates alone only sees names that match to
// the letter at that moment, which is how the plain one got through.
//
// `names` are the arrivals', in order. `renames` are the ones already there
// that have to change to keep the run whole: a lone "Hunter" becomes
// "Hunter 1" when a second walks in. A number once given is never given
// again, the dead included, so "Hunter 2" always means the same creature. A
// name with a number of its own and nobody like it ("Unit 7") is left alone.
export function nameArrivals(
  existing: string[],
  wanted: string[],
): { names: string[]; renames: Array<{ index: number; name: string }> } {
  const groups = new Map<string, { base: string; existing: number[]; wanted: number[] }>();
  const groupOf = (name: string) => {
    const { base } = unnumbered(name);
    const key = base.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { base, existing: [], wanted: [] };
      groups.set(key, group);
    }
    return group;
  };
  existing.forEach((name, index) => groupOf(name).existing.push(index));
  wanted.forEach((name, index) => groupOf(name).wanted.push(index));

  const names = wanted.map((name) => name.trim());
  const renames: Array<{ index: number; name: string }> = [];
  for (const group of groups.values()) {
    if (!group.wanted.length || group.existing.length + group.wanted.length < 2) {
      continue;
    }
    const taken = new Set<number>();
    for (const index of group.existing) {
      const { number } = unnumbered(existing[index]);
      if (number !== null) {
        taken.add(number);
      }
    }
    let next = 1;
    const take = () => {
      while (taken.has(next)) {
        next += 1;
      }
      taken.add(next);
      return next;
    };
    // Whoever was here first without a number is counted first.
    for (const index of group.existing) {
      if (unnumbered(existing[index]).number === null) {
        renames.push({ index, name: `${group.base} ${take()}` });
      }
    }
    for (const index of group.wanted) {
      names[index] = `${group.base} ${take()}`;
    }
  }
  return { names, renames };
}
