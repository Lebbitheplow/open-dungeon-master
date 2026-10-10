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
  // them again (src/lib/dm/encounter-tools.ts). `wrapped`: that end_turn
  // began a new round, which the turn's table note says once the narration
  // is in.
  handoff?: { turnId: string; enemyIds: string[]; wrapped?: boolean };
  // The enemies that have taken a bonus action in `round` (Nimble Escape's
  // Disengage or Hide).
  bonus?: { round: number; ids: string[] };
  // The enemies a pass outside the model's own end_turn walked past that
  // nobody has yet played or waved through (src/lib/dm/enemies-due.ts).
  due?: string[];
  // A stretch with nobody able to act: the round it began, and whether the
  // table was told it ran too long to keep waking the DM
  // (src/lib/dm/encounter-tools.ts idledOut).
  idle?: { since: number; told?: boolean };
  // The enemies the pointer walked past last move: their turns, taken in
  // the DM turn since, end as the pointer moves again, with the saves their
  // conditions grant at the end of a turn (src/lib/dm/condition-tick.ts).
  walked?: string[];
  // The last save a legendary creature failed, for legendary_resist: what
  // it laid and what a success would have spared (src/lib/dm/forced-save.ts).
  failedSave?: FailedSave;
  // The legendary actions taken, by the turn each followed: one option per
  // creature at the end of another creature's turn (legendary-tools.ts).
  opportunities?: { key: string; ids: string[] };
  // The round whose initiative count 20 the pointer has just passed: the
  // lair acts then or not at all (lairCountPassed), and the option it took
  // last, which some blocks forbid two rounds in a row.
  lairDue?: number;
  lairLast?: string;
};

export type FailedSave = {
  enemyId: string;
  round: number;
  detail: string;
  conditions?: string[];
  spell?: string;
  source?: string;
  refund?: number;
  resisted?: boolean;
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
  const idle = (record.idle && typeof record.idle === "object" ? record.idle : null) as Record<string, unknown> | null;
  const failed = (record.failedSave && typeof record.failedSave === "object" ? record.failedSave : null) as Record<string, unknown> | null;
  const opportunities = (record.opportunities && typeof record.opportunities === "object" ? record.opportunities : null) as Record<string, unknown> | null;
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
      ? { handoff: { turnId: handoff.turnId, enemyIds: stringList(handoff.enemyIds), ...(handoff.wrapped === true ? { wrapped: true } : {}) } }
      : {}),
    ...(bonus ? { bonus: { round: Number(bonus.round) || 0, ids: stringList(bonus.ids) } } : {}),
    ...(stringList(record.due).length ? { due: stringList(record.due) } : {}),
    ...(idle ? { idle: { since: Number(idle.since) || 0, ...(idle.told === true ? { told: true } : {}) } } : {}),
    ...(stringList(record.walked).length ? { walked: stringList(record.walked) } : {}),
    ...(failed && typeof failed.enemyId === "string"
      ? {
          failedSave: {
            enemyId: failed.enemyId,
            round: Number(failed.round) || 0,
            detail: String(failed.detail ?? ""),
            ...(stringList(failed.conditions).length ? { conditions: stringList(failed.conditions) } : {}),
            ...(typeof failed.spell === "string" ? { spell: failed.spell } : {}),
            ...(typeof failed.source === "string" ? { source: failed.source } : {}),
            ...(Number(failed.refund) > 0 ? { refund: Number(failed.refund) } : {}),
            ...(failed.resisted === true ? { resisted: true } : {}),
          },
        }
      : {}),
    ...(opportunities && typeof opportunities.key === "string"
      ? { opportunities: { key: opportunities.key, ids: stringList(opportunities.ids) } }
      : {}),
    ...(Number(record.lairDue) > 0 ? { lairDue: Number(record.lairDue) } : {}),
    ...(typeof record.lairLast === "string" ? { lairLast: record.lairLast } : {}),
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

// Whether a failed save is worth a Legendary Resistance to the creature
// that would suffer it, as a DM running it would judge (SRD 5.1: the
// creature "can choose to succeed instead"): a condition that takes its
// turn, its movement, its senses or its will, or a spell's lasting hold.
// A rider that ends with its next turn (Vicious Mockery's disadvantage) or
// a fall to prone is not; damage alone is left to legendary_resist.
const WORTH_RESISTING = new Set([
  "blinded", "charmed", "deafened", "frightened", "incapacitated", "paralyzed", "petrified",
  "restrained", "stunned", "unconscious", "polymorphed", "banished", "slowed", "confused",
  "feebleminded", "imprisoned", "mazed", "dominated", "dancing", "turned", "cursed",
]);

export function bindsWorthResisting(conditions: string[], endsWithTurn = false): boolean {
  if (endsWithTurn) {
    return false;
  }
  return conditions.some((name) => {
    const lower = name.trim().toLowerCase();
    return WORTH_RESISTING.has(lower) || [...WORTH_RESISTING].some((word) => lower.startsWith(`${word} `));
  });
}

// Lair actions happen on initiative count 20, losing ties: once every
// combatant at 20 or above has had its turn, before anyone below. Whether a
// pointer move from `from` (exclusive; -1 is the top of round 1) to `to`
// (inclusive) passes that count, and on which side of the round's end:
// "before" the order wraps (the round that is ending) or "after" (the new
// one). When every combatant is at 20 or above, the count falls as the round
// ends.
export function lairCountPassed(order: Array<{ initiative?: number | null }>, from: number, to: number): "before" | "after" | null {
  if (!order.length) {
    return null;
  }
  const first = order.findIndex((entry) => (entry.initiative ?? 0) < 20);
  let wrapped = false;
  let index = from;
  for (let steps = 0; steps < order.length; steps += 1) {
    if (index + 1 >= order.length) {
      if (first === -1) {
        return "before";
      }
      wrapped = true;
    }
    index = (index + 1) % order.length;
    if (index === first) {
      return wrapped ? "after" : "before";
    }
    if (index === to) {
      return null;
    }
  }
  return null;
}

// The printed lair option a DM names: its number in the list, or the line
// whose words it carries. Null when none fits.
export function pickLairOption(options: string[], wanted: string): string | null {
  const text = wanted.trim().toLowerCase();
  const numbered = /^#?(\d{1,2})$/.exec(text);
  if (numbered) {
    return options[Number(numbered[1]) - 1] ?? null;
  }
  const words = (line: string) => new Set(line.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const asked = words(text);
  let best: { line: string; shared: number } | null = null;
  for (const line of options) {
    const lower = line.toLowerCase();
    if (lower.includes(text) || text.includes(lower.slice(0, 40))) {
      return line;
    }
    const shared = [...words(line)].filter((word) => asked.has(word)).length;
    if (shared >= 2 && (!best || shared > best.shared)) {
      best = { line, shared };
    }
  }
  return best?.line ?? null;
}

// How a printed lair option resolves through the engine: a save the server
// rolls for each creature it reaches (aoe_damage), with the DC, the ability
// and the dice the line prints. Null for an option with no save.
export function lairResolution(line: string): string | null {
  const save = /DC\s*(\d+)\s+(str|dex|con|int|wis|cha)[a-z]*\s+sav(?:e|ing throw)/i.exec(line);
  if (!save) {
    return null;
  }
  const damage = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\)?\s+([a-z]+)\s+damage/i.exec(line);
  const ability = save[2].slice(0, 3).toLowerCase();
  return `Resolve it now with aoe_damage: dc ${save[1]}, saveAbility "${ability}"${
    damage ? `, damage "${damage[1].replace(/\s+/g, "")}", type "${damage[2].toLowerCase()}"` : ""
  }, and the enemyIds and characterIds of the creatures it reaches; the server rolls every save. Lay what a failure brings as the line says.`;
}
