import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { ClockTurn } from "@/lib/db/clock-moves";
import { quietTick } from "@/lib/sheet-audit-logic";

// What the event log lists and which turns it offers to revert. Pure, so a
// suite reads it without a browser (scripts/test-event-log-logic.mjs). The
// clock turns (src/lib/db/clock-moves.ts) come from the campaign snapshot
// and the clock_changed event; an older host sends none, and the log keeps
// its old rule.

export type FeedItem =
  | { type: "audit"; seq: number; entry: AuditEntry }
  // A run of changes that only counted time down, from one turn.
  | { type: "ticks"; seq: number; turnId: string; entries: AuditEntry[] }
  | { type: "time"; seq: number; move: ClockTurn }
  | { type: "milestone"; seq: number; event: CharacterEvent };

// Rows the trail keeps for the engine's own reading, which change no sheet:
// the moment of a death (src/lib/dm/revival.ts), which a revival spell
// times its window from. The death itself is its death_state row.
export const BOOKKEEPING_KINDS: ReadonlySet<string> = new Set(["death_moment"]);

// Newest first: the sheet changes, the milestones and the time the turns
// moved on, with each run of one turn's quiet ticks (src/lib/
// sheet-audit-logic.ts) folded into one item: the turn's revert puts them
// back, but none is news.
export function buildFeed(auditLog: AuditEntry[], characterEvents: CharacterEvent[], clockTurns: ClockTurn[] = []): FeedItem[] {
  const items: FeedItem[] = [
    ...auditLog.filter((entry) => !BOOKKEEPING_KINDS.has(entry.kind)).map((entry) => ({ type: "audit" as const, seq: entry.seq, entry })),
    ...characterEvents.map((event) => ({ type: "milestone" as const, seq: event.seq, event })),
    ...clockTurns.map((move) => ({ type: "time" as const, seq: move.seq, move })),
  ].sort((a, b) => b.seq - a.seq);
  const feed: FeedItem[] = [];
  for (const item of items) {
    if (item.type !== "audit" || !quietTick(item.entry)) {
      feed.push(item);
      continue;
    }
    const turnId = item.entry.turnId ?? "";
    const last = feed.at(-1);
    if (last?.type === "ticks" && last.turnId === turnId) {
      last.entries.push(item.entry);
      continue;
    }
    feed.push({ type: "ticks", seq: item.seq, turnId, entries: [item.entry] });
  }
  return feed;
}

// The turn an item belongs to, if any.
export function turnOfItem(item: FeedItem): string | null {
  if (item.type === "audit") {
    return item.entry.turnId ?? null;
  }
  if (item.type === "ticks") {
    return item.turnId || null;
  }
  return item.type === "time" ? item.move.turnId : null;
}

// The turns the log offers "Revert this turn" for, with how many live sheet
// changes each would undo: two or more, as before; or any number (none
// included) when the turn moved the clock and the time is not back yet,
// since an undo of one change never moves the clock (issue #622).
export function revertableTurns(auditLog: AuditEntry[], clockTurns: ClockTurn[] = []): Map<string, number> {
  const live = new Map<string, number>();
  for (const entry of auditLog) {
    if (entry.turnId && entry.undoable && !entry.revertedAt && entry.kind !== "undo") {
      live.set(entry.turnId, (live.get(entry.turnId) ?? 0) + 1);
    }
  }
  const timed = new Set(clockTurns.map((move) => move.turnId));
  const turns = new Map<string, number>();
  for (const [turnId, count] of live) {
    if (count >= 2 || timed.has(turnId)) {
      turns.set(turnId, count);
    }
  }
  for (const turnId of timed) {
    if (!turns.has(turnId)) {
      turns.set(turnId, 0);
    }
  }
  return turns;
}

// ---- what each change says ----
//
// One sentence per audit row, in plain words, from what the row stores.
// Every kind the server writes is named here (scripts/test-event-log-logic.mjs
// scans src for them and fails on one that is not): a lead deciding what to
// revert used to read raw ids such as "Corra Venn: death_state" (issue #622).
// Each reads what it can and says less, never "undefined", when a field is
// missing (an older row, another writer's shape).

type Delta = Record<string, unknown>;

const word = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const amount = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const words = (value: unknown): string[] => (Array.isArray(value) ? value.map(word).filter((entry): entry is string => entry !== null) : []);
const times = (qty: number | null) => (qty !== null && qty > 1 ? ` x${qty}` : "");
const gold = (copper: number) => `${Math.round(copper) / 100} gold`;

function deathState(name: string, delta: Delta): string {
  const revived = word(delta.revived);
  if (revived) {
    return `${name} is brought back by ${revived}`;
  }
  const track = delta.deathSaves as { successes?: unknown; failures?: unknown; stable?: unknown; dead?: unknown } | null | undefined;
  if (!track || typeof track !== "object") {
    const hp = amount(delta.currentHp);
    if (hp !== null && hp > 0) {
      return `${name} is back on their feet at ${hp} HP`;
    }
    return "deathSaves" in delta ? `${name} is no longer dying` : `${name}'s death saves change`;
  }
  if (track.dead === true) {
    return `${name} dies`;
  }
  if (track.stable === true) {
    return `${name} is stable`;
  }
  const successes = amount(track.successes) ?? 0;
  const failures = amount(track.failures) ?? 0;
  if (!successes && !failures) {
    return `${name} is dying`;
  }
  return `${name}'s death saves: ${successes} success${successes === 1 ? "" : "es"}, ${failures} failure${failures === 1 ? "" : "s"}`;
}

// The sentence for a kind the server writes, or null for one it does not
// know (a row from an older or newer version).
export function describeKnownEntry(entry: { kind: string; delta: Delta }, name: string): string | null {
  const delta = entry.delta ?? {};
  const item = word(delta.name) ?? word(delta.item) ?? "an item";
  const qty = amount(delta.qty);
  switch (entry.kind) {
    case "apply_damage": {
      // Wild Shape: the blow landed on the beast form, not the druid.
      const form = word(delta.form);
      if (form) {
        const carryover = amount(delta.carryover) ?? 0;
        return delta.reverted
          ? `${name}'s ${form} form breaks${carryover > 0 ? `, ${carryover} damage carrying through` : ""}`
          : `${name}'s ${form} form takes ${amount(delta.amount) ?? "some"} damage${amount(delta.beastHp) !== null ? ` (${amount(delta.beastHp)} beast HP)` : ""}`;
      }
      if (delta.relentlessEndurance) return `${name} holds on at 1 HP (Relentless Endurance)`;
      if (delta.relentlessRage) return `${name} holds on at 1 HP (Relentless Rage)`;
      if (delta.deathWard) return `${name} holds on at 1 HP (Death Ward)`;
      const type = word(delta.type);
      const hp = amount(delta.currentHp);
      return `${name} takes ${amount(delta.amount) ?? "some"} damage${type ? ` (${type})` : ""}${hp !== null ? ` (${hp} HP)` : ""}`;
    }
    case "heal": {
      const form = word(delta.form);
      const healed = amount(delta.amount);
      if (form) {
        return `${name}'s ${form} form heals ${healed ?? "some"}${amount(delta.beastHp) !== null ? ` (${amount(delta.beastHp)} beast HP)` : ""}`;
      }
      const hp = amount(delta.newHp);
      return healed !== null ? `${name} heals ${healed}${hp !== null ? ` (${hp} HP)` : ""}` : `${name} is healed`;
    }
    case "grant_temp_hp": {
      const temp = amount(delta.tempHp);
      return temp !== null ? `${name} gains ${temp} temporary HP` : `${name} gains temporary HP`;
    }
    case "award_xp": {
      const xp = amount(delta.amount);
      const total = amount(delta.newXp);
      return xp !== null ? `${name} gains ${xp} XP${total !== null ? ` (${total} total)` : ""}` : `${name} gains XP`;
    }
    case "modify_gold": {
      const change = amount(delta.delta);
      const purse = amount(delta.gold);
      if (change === null) return `${name}'s purse changes`;
      return `${name} ${change >= 0 ? "gains" : "loses"} ${Math.abs(change)} gold${purse !== null ? ` (${purse} gp)` : ""}`;
    }
    case "grant_item":
      return `${name} receives ${item}${times(qty)}`;
    case "remove_item":
      return `${name} loses ${item}${times(amount(delta.removed))}`;
    case "reveal_item": {
      const from = word(delta.from);
      const to = word(delta.to);
      return from && to ? `${name}'s ${from} turns out to be ${to}` : `${name} learns what an item they carry is`;
    }
    // A pact's gift or its price (src/lib/dm/pact-fire.ts).
    case "item": {
      const added = word(delta.added);
      const removed = word(delta.removed);
      return added ? `${name} receives ${added}` : removed ? `${name} gives up ${removed}` : `${name}'s pack changes`;
    }
    case "trade": {
      const partner = word(delta.with);
      return partner ? `${name} trades with ${partner}` : `${name} trades`;
    }
    case "purchase": {
      const selling = delta.action === "sell";
      const count = qty ?? 1;
      const eachCp = amount(delta.priceCp);
      const eachGold = amount(delta.price);
      const price = eachCp !== null ? ` for ${gold(eachCp * count)}` : eachGold !== null ? ` for ${eachGold * count} gold` : "";
      return `${name} ${selling ? "sells" : "buys"} ${item}${times(qty)}${price}`;
    }
    case "gear": {
      if (typeof delta.equipped !== "boolean") return `${name} changes what they wear`;
      return `${name} ${delta.equipped ? "puts on" : "takes off"} ${item}`;
    }
    case "hand_item": {
      const to = word(delta.to);
      const from = word(delta.from);
      return to ? `${name} hands ${item}${times(qty)} to ${to}` : from ? `${name} receives ${item}${times(qty)} from ${from}` : `${name} hands over ${item}`;
    }
    case "drop_item":
      return `${name} drops ${item}${times(amount(delta.dropped))}`;
    case "pick_up_item":
      return `${name} picks up ${item}${times(amount(delta.taken))}`;
    case "use_item":
      return word(delta.item) ? `${name} uses ${word(delta.item)}` : `${name} spends charges from an item`;
    case "dawn_recharge":
      return `${name}'s items regain charges at dawn`;
    case "set_condition": {
      if (delta.inspiration) return `${name} gains Inspiration`;
      const condition = word(delta.condition);
      return condition ? `${name} is ${condition}` : `${name} gains a condition`;
    }
    case "clear_condition": {
      const level = amount(delta.level);
      if (word(delta.condition) === "exhaustion" && level !== null) {
        return `${name}'s exhaustion falls to level ${level}`;
      }
      const ended = word(delta.condition) ?? (words(delta.ended).join(" or ") || null);
      return ended ? `${name} is no longer ${ended}` : `${name} is rid of a condition`;
    }
    case "exhaustion": {
      const level = amount(delta.exhaustion);
      return level !== null ? `${name} is at exhaustion level ${level}` : `${name}'s exhaustion changes`;
    }
    // What passing time did on its own (issue #622): written down so a turn's
    // revert can put it back with the hours.
    case "wild_shape":
      return `${name} returns to their own form`;
    case "condition_clock": {
      const ended = words(delta.ended);
      return ended.length ? `${name} is no longer ${ended.join(" or ")}` : `Time runs on ${name}'s conditions`;
    }
    case "concentration_clock":
      return `Time runs on ${name}'s ${word(delta.spell) ?? "spell"}`;
    case "concentration": {
      const spell = word(delta.concentratingOn);
      return spell ? `${name} concentrates on ${spell}` : `${name} stops concentrating`;
    }
    case "supplies": {
      const level = amount(delta.exhaustion);
      return level !== null ? `${name} goes short of food or water (exhaustion ${level})` : `${name} eats and drinks from the pack`;
    }
    case "training":
      return word(delta.subject) ? `${name} learns ${word(delta.subject)}` : `${name} finishes their training`;
    case "use_spell_slot": {
      const level = amount(delta.level);
      return level !== null ? `${name} expends a level ${level} spell slot` : `${name} expends a spell slot`;
    }
    case "use_resource": {
      const resource = word(delta.resource) ?? "a feature";
      const from = word(delta.from);
      if (from) return `${name} receives ${resource} from ${from}`;
      const spent = amount(delta.spent) ?? 1;
      return `${name} spends ${spent > 1 ? `${spent} uses of ` : ""}${resource}`;
    }
    case "learn_spell": {
      const spell = word(delta.spell) ?? "a spell";
      return delta.action === "remove" ? `${name} loses the spell ${spell}` : `${name} learns the spell ${spell}`;
    }
    case "divine_intervention":
      return `${name}'s deity intervenes`;
    // The dying engine (src/lib/dm/death.ts), a revival spell (heal-spell.ts).
    case "death_state":
      return deathState(name, delta);
    case "death_moment":
      return `The moment ${name} died is written down`;
    case "stabilize": {
      const healer = word(delta.healer);
      const woke = amount(delta.currentHp) === 1;
      return `${healer ? `${healer} stabilizes ${name}` : `${name} is stabilized`}${woke ? `, who regains 1 HP` : ""}`;
    }
    case "rest_long":
      return `${name} finishes a long rest`;
    case "rest_short":
      return delta.hitDice ? `${name} spends hit dice on a short rest` : `${name} recovers on a short rest`;
    case "attune":
      return `${name} attunes to an item over a rest`;
    case "update_sheet": {
      const changed = Object.keys(delta);
      return `The GM rewrites ${name}'s sheet${changed.length ? ` (${changed.join(", ")})` : ""}`;
    }
    case "undo":
      return `Party lead undid a change to ${name}`;
    case "lead_edit": {
      const changed = Object.keys(delta).filter((key) => key !== "reason");
      return `Party lead corrected ${name}${changed.length ? ` (${changed.join(", ")})` : ""}`;
    }
    case "player_adjust": {
      const changed = Object.keys(delta);
      return `${name}'s player adjusted their counters${changed.length ? ` (${changed.join(", ")})` : ""}`;
    }
    default:
      return null;
  }
}

// The row as the event log reads it: a kind no version of this server knows
// still reads as words.
export function describeAuditEntry(entry: { kind: string; delta: Delta }, name: string): string {
  return describeKnownEntry(entry, name) ?? `${name}: ${entry.kind.replace(/_/g, " ")}`;
}
