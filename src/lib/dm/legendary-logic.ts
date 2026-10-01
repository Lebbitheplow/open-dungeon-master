import { groupTraits } from "@/lib/bestiary/block-sections";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { normalizeAbilityLedgers, type AbilityLedger } from "@/lib/dm/monster-abilities";

// Legendary and lair actions and legendary resistance (docs/vtt-parity-
// implementation-plan.md 4.1): what a stat block says a creature may do
// out of turn, and the pools the fight keeps for it. Pure; the tools and
// the tracker read it.

export type LegendaryAction = { name: string; cost: number; text: string };

export type LegendaryProfile = {
  actionsPerRound: number;
  resistances: number;
  actions: LegendaryAction[];
  lairActions: string[];
};

// Per enemy, what is left: actions refill at the top of its own turn,
// resistances last the fight.
export type LegendaryPool = { actions: number; resistances: number };
// What the fight remembers about a round beyond the pools, carried in the
// same stored object because it is the encounter's per-enemy, per-round
// record. Optional: a fight saved before it existed reads as nobody having
// acted.
//   acted.ids   the enemies that have taken their action in acted.round
//   acted.owed  enemies owed one action more: the round a surprised party
//               lost to them (src/lib/dm/can-act.ts canEnemyAct)
export type RoundLedger = { round: number; ids: string[]; owed?: string[] };
export type LegendaryState = {
  pools: Record<string, LegendaryPool>;
  lair: boolean;
  lairUsedRound: number;
  acted?: RoundLedger;
  // Enemies whose next enemy_attack is the one attack a legendary action
  // bought: one swing, not the Multiattack. Optional, like everything below.
  strikes?: string[];
  // What each enemy has spent of its limited abilities this fight: recharge
  // abilities waiting on their d6, uses a day, spell slots
  // (src/lib/dm/monster-abilities.ts).
  abilities?: Record<string, AbilityLedger>;
  // The enemies a model's end_turn handed it to act, with the DM turn that
  // got them, so the finalize step neither moves the pointer twice nor acts
  // them again (src/lib/dm/encounter-tools.ts).
  handoff?: { turnId: string; enemyIds: string[] };
  // The enemies that have taken a bonus action in `round` (Nimble Escape's
  // Disengage or Hide).
  bonus?: { round: number; ids: string[] };
};

function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

export function emptyLegendaryState(): LegendaryState {
  return { pools: {}, lair: false, lairUsedRound: 0 };
}

export function normalizeLegendaryState(raw: unknown): LegendaryState {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pools: Record<string, LegendaryPool> = {};
  const rawPools = (record.pools && typeof record.pools === "object" ? record.pools : {}) as Record<string, unknown>;
  for (const [id, pool] of Object.entries(rawPools)) {
    const entry = (pool && typeof pool === "object" ? pool : {}) as Record<string, unknown>;
    pools[id] = { actions: Math.max(0, Number(entry.actions) || 0), resistances: Math.max(0, Number(entry.resistances) || 0) };
  }
  const acted = (record.acted && typeof record.acted === "object" ? record.acted : null) as Record<string, unknown> | null;
  const abilities = normalizeAbilityLedgers(record.abilities);
  const handoff = (record.handoff && typeof record.handoff === "object" ? record.handoff : null) as Record<string, unknown> | null;
  const bonus = (record.bonus && typeof record.bonus === "object" ? record.bonus : null) as Record<string, unknown> | null;
  return {
    pools,
    lair: record.lair === true,
    lairUsedRound: Math.max(0, Number(record.lairUsedRound) || 0),
    ...(acted
      ? {
          acted: {
            round: Number(acted.round) || 0,
            ids: stringList(acted.ids),
            ...(stringList(acted.owed).length ? { owed: stringList(acted.owed) } : {}),
          },
        }
      : {}),
    ...(stringList(record.strikes).length ? { strikes: stringList(record.strikes) } : {}),
    ...(Object.keys(abilities).length ? { abilities } : {}),
    ...(handoff && typeof handoff.turnId === "string"
      ? { handoff: { turnId: handoff.turnId, enemyIds: stringList(handoff.enemyIds) } }
      : {}),
    ...(bonus ? { bonus: { round: Number(bonus.round) || 0, ids: stringList(bonus.ids) } } : {}),
  };
}

const COST = /\(costs?\s+(\d)\s+actions?\)/i;
const NAME_SPLIT = /^([^.:(]{2,60}?)(?:\s*\(costs?[^)]*\))?\s*[.:]\s*([\s\S]*)$/i;

// One tagged line ("Legendary action: Wing Attack (Costs 2 Actions). The
// dragon beats...") as a row with its cost.
export function parseLegendaryLine(text: string): LegendaryAction {
  const costMatch = COST.exec(text);
  const cost = costMatch ? Math.max(1, Math.min(3, Number(costMatch[1]))) : 1;
  const split = NAME_SPLIT.exec(text.trim());
  if (split) {
    return { name: split[1].trim(), cost, text: split[2].trim() };
  }
  return { name: text.trim().slice(0, 60), cost, text: "" };
}

// The profile a stat block implies: legendary lines become actions, a
// "Legendary Resistance (3/Day)" trait becomes the counter, lair lines
// become lair actions. A block with none of them has no profile.
export function legendaryProfile(stats: Pick<EnemyStats, "traits">): LegendaryProfile | null {
  const groups = groupTraits(stats.traits ?? []);
  const actions = (groups.find((group) => group.section === "legendary")?.lines ?? []).map(parseLegendaryLine);
  const lairActions = groups.find((group) => group.section === "lair")?.lines ?? [];
  let resistances = 0;
  let actionsPerRound = 3;
  for (const line of stats.traits ?? []) {
    const resist = /legendary resistance\s*\((\d)\s*\/\s*day\)/i.exec(line);
    if (resist) {
      resistances = Number(resist[1]);
    }
    const perRound = /can take (\d) legendary actions/i.exec(line);
    if (perRound) {
      actionsPerRound = Number(perRound[1]);
    }
  }
  if (!actions.length && !resistances && !lairActions.length) {
    return null;
  }
  return { actionsPerRound: actions.length ? actionsPerRound : 0, resistances, actions, lairActions };
}

export function freshPool(profile: LegendaryProfile): LegendaryPool {
  return { actions: profile.actionsPerRound, resistances: profile.resistances };
}

// The pool the enemy starts its own turn with: actions refill, the
// resistances left are kept.
export function refillActions(pool: LegendaryPool | undefined, profile: LegendaryProfile): LegendaryPool {
  return { actions: profile.actionsPerRound, resistances: pool ? pool.resistances : profile.resistances };
}

export type SpendOutcome = { ok: true; pool: LegendaryPool; action: LegendaryAction } | { ok: false; error: string };

export function spendLegendaryAction(
  pool: LegendaryPool,
  profile: LegendaryProfile,
  actionName: string,
): SpendOutcome {
  const wanted = actionName.trim().toLowerCase();
  const action =
    profile.actions.find((entry) => entry.name.toLowerCase() === wanted) ??
    profile.actions.find((entry) => entry.name.toLowerCase().startsWith(wanted) || wanted.startsWith(entry.name.toLowerCase()));
  if (!action) {
    return { ok: false, error: `No legendary action called "${actionName}". It has: ${profile.actions.map((entry) => entry.name).join(", ")}.` };
  }
  if (pool.actions < action.cost) {
    return { ok: false, error: `${action.name} costs ${action.cost}; only ${pool.actions} legendary action${pool.actions === 1 ? "" : "s"} left this round.` };
  }
  return { ok: true, pool: { ...pool, actions: pool.actions - action.cost }, action };
}

export function spendResistance(pool: LegendaryPool): LegendaryPool | null {
  return pool.resistances > 0 ? { ...pool, resistances: pool.resistances - 1 } : null;
}
