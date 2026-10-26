// Which cards a player keeps in the visible Hand (issue 231). The Hand is
// still derived from the character and the live turn (hand.ts); a layout
// only decides where each card sits, the fan or the "more" sheet, and in what
// order. It never makes a card playable: a chosen card keeps the reason the
// rules stop it, and a card the character no longer holds is simply not there.
//
// Saved per campaign character on its sheet (character_sheets.hand_layout_json),
// so it follows the player to every device and lasts across fights.
// No runtime imports: the sheet store reads layouts through this module.
import type { HandCard } from "@/lib/battlemap/hand-core";

// What takes a seat: a card, or since issue 528 a group of them
// (hand-groups.ts), seated by its own id ("group:spells"). A group names its
// cards, so it reads as known while every card in it is.
export type Seat = {
  id: string;
  disabled: string | null;
  intent?: { card: string };
  cards?: ReadonlyArray<{ id: string }>;
};

export type HandLayout = {
  // The cards chosen for the fan, left to right, by card id (or a group's).
  // End turn is not among them: it always keeps the last seat.
  fan: string[];
  // Every card the hand held when it was arranged, so one gained since (a
  // level-up's spell, a new weapon) can be marked as new in "more".
  known: string[];
};

// Nine cards in the fan, End turn's seat among them.
export const HAND_FAN_CAP = 9;
export const END_TURN_ID = "basic:end-turn";
// The seats a player arranges: the fan's nine, less the one End turn keeps.
export const HAND_SEATS = HAND_FAN_CAP - 1;
const KNOWN_CAP = 240;
const ID_MAX = 160;

// Cards the moment deals that matter most while it lasts: Escape while held,
// Stand up while prone, a reaction an attack just offered. They take a seat
// ahead of the chosen ones and give it back when the moment passes.
export function isUrgentCard(card: Pick<HandCard, "id">): boolean {
  return card.id === "basic:escape" || card.id === "basic:stand-up" || card.id.startsWith("reaction:");
}

// A stored or sent layout, bounded: ids are short strings, none twice, End
// turn never chosen, no more than the seats in the fan. Anything else reads
// as no layout at all, which is the automatic hand.
export function normalizeHandLayout(raw: unknown): HandLayout | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as { fan?: unknown; known?: unknown };
  if (!Array.isArray(record.fan)) {
    return null;
  }
  const ids = (list: unknown[], cap: number) =>
    [...new Set(list.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= ID_MAX))]
      .filter((id) => id !== END_TURN_ID)
      .slice(0, cap);
  const fan = ids(record.fan, HAND_SEATS);
  const known = ids(Array.isArray(record.known) ? record.known : [], KNOWN_CAP);
  return { fan, known: [...new Set([...fan, ...known])].slice(0, KNOWN_CAP) };
}

export type HandArrangement<T extends Seat = HandCard> = {
  fan: T[];
  more: T[];
  // Chosen cards an urgent one has pushed out of the fan for now; the layout
  // still holds them, and they come back when the moment passes.
  displaced: T[];
  // What sits in "more" that the hand did not hold when it was arranged: a
  // card, or a group holding such a card.
  fresh: T[];
  // Every card or group gained since, by id, wherever it sits (a group's new
  // spell is marked inside the group).
  freshIds: string[];
  // Whether a saved layout placed the cards (false: the automatic split).
  arranged: boolean;
};

function isKnown(seat: Seat, known: Set<string>): boolean {
  return seat.cards ? seat.cards.every((card) => known.has(card.id)) : known.has(seat.id);
}

// The automatic split: nine in the fan, the rest behind the "more" spine in
// the same order. A playable card is never pushed behind the spine by an
// unplayable one.
export function splitHand<T extends Seat>(cards: T[], cap = HAND_FAN_CAP): { fan: T[]; more: T[] } {
  const end = cards.find((card) => card.id === END_TURN_ID);
  const rest = cards.filter((card) => card !== end);
  // End turn keeps the last seat even when the whole hand fits: the gear
  // cards and the groups are dealt after it.
  if (cards.length <= cap) return { fan: end ? [...rest, end] : cards, more: [] };
  // A bare fist gives its seat up too when there is steel to swing.
  const armed = rest.some((card) => card.intent?.card === "attack" && card.id !== "attack:unarmed strike");
  // Escape and Stand up are dealt only while something holds the character
  // or they lie prone, which is when they matter most: they keep a seat.
  const situational = (card: T) => card.id === "basic:escape" || card.id === "basic:stand-up";
  const rank = (card: T) =>
    card.disabled ? 2 : situational(card) ? -1 : armed && card.id === "attack:unarmed strike" ? 1 : 0;
  const ranked = [...rest].sort((a, b) => rank(a) - rank(b));
  const keep = new Set(ranked.slice(0, end ? cap - 1 : cap));
  const fan = rest.filter((card) => keep.has(card));
  if (end) fan.push(end);
  return { fan, more: rest.filter((card) => !keep.has(card)) };
}

// The hand as the player arranged it, or the automatic split when they have
// not. Urgent cards sit first; the chosen ones follow in the player's order
// and, when an urgent card needs a seat, the last of them waits in "more".
//
// `cards` are what the fan deals (a group stands for its cards); `members`
// are the cards inside the groups, which a player may still seat on their
// own as a favourite: a seated Fireball sits in the fan and stays inside
// Spells too.
export function arrangeHand<T extends Seat>(
  cards: T[],
  layout: HandLayout | null | undefined,
  cap = HAND_FAN_CAP,
  members: T[] = [],
): HandArrangement<T> {
  if (!layout) {
    return { ...splitHand(cards, cap), displaced: [], fresh: [], freshIds: [], arranged: false };
  }
  const end = cards.find((card) => card.id === END_TURN_ID) ?? null;
  const seats = end ? cap - 1 : cap;
  const byId = new Map([...members, ...cards].map((card) => [card.id, card]));
  const urgent = cards.filter((card) => card !== end && isUrgentCard(card)).slice(0, seats);
  const chosen = layout.fan
    .map((id) => byId.get(id))
    .filter((card): card is T => Boolean(card) && card !== end && !urgent.includes(card!));
  const free = Math.max(0, seats - urgent.length);
  const seated = [...urgent, ...chosen.slice(0, free)];
  const displaced = chosen.slice(free);
  const fan = end ? [...seated, end] : seated;
  const inFan = new Set(fan);
  const more = cards.filter((card) => !inFan.has(card));
  const known = new Set(layout.known);
  return {
    fan,
    more,
    displaced,
    fresh: more.filter((card) => !isKnown(card, known) && !isUrgentCard(card)),
    freshIds: [...new Set([...cards, ...members].filter((card) => !card.cards && !known.has(card.id) && !isUrgentCard(card)).map((card) => card.id))],
    arranged: true,
  };
}

// A card picked from "more" to play now takes a seat for the moment: an empty
// one if the fan has room, otherwise the last before End turn. Nothing is
// saved by it.
export function seatPicked<T extends { id: string }>(fan: T[], picked: T | null, cap = HAND_FAN_CAP): T[] {
  if (!picked || fan.includes(picked)) return fan;
  const endIndex = fan.findIndex((card) => card.id === END_TURN_ID);
  const before = endIndex === -1 ? fan : fan.slice(0, endIndex);
  const after = endIndex === -1 ? [] : fan.slice(endIndex);
  const room = fan.length < cap;
  return [...(room ? before : before.slice(0, -1)), picked, ...after];
}

// ---- changing a layout ----

// The layout a player starts arranging from: their saved one, or the fan the
// automatic split shows them now, so the first change moves one card and
// not the whole hand.
export function startingLayout<T extends Seat>(cards: T[], saved: HandLayout | null | undefined, members: T[] = []): HandLayout {
  const held = [...new Set([...cards, ...members].map((card) => card.id))];
  if (saved) {
    return { fan: [...saved.fan], known: [...new Set([...saved.known, ...held])] };
  }
  const { fan } = splitHand(cards);
  return {
    fan: fan.filter((card) => card.id !== END_TURN_ID && !isUrgentCard(card)).map((card) => card.id).slice(0, HAND_SEATS),
    known: held,
  };
}

export type LayoutChange = { layout: HandLayout } | { error: string };

// Seats a card. At capacity the change is refused in words, never made by
// pushing another card out: the player decides which one goes.
export function addToHand(layout: HandLayout, card: Pick<HandCard, "id" | "name">): LayoutChange {
  if (card.id === END_TURN_ID) {
    return { error: "End turn always keeps the last seat of your hand." };
  }
  if (layout.fan.includes(card.id)) {
    return { layout };
  }
  if (layout.fan.length >= HAND_SEATS) {
    return {
      error: `Your hand is full: all ${HAND_SEATS} seats are taken (End turn keeps the ninth). Move a card to More first, then add ${card.name}.`,
    };
  }
  return { layout: { ...layout, fan: [...layout.fan, card.id] } };
}

// Sends a card to "more". It stays playable from there.
export function removeFromHand(layout: HandLayout, cardId: string): HandLayout {
  return { ...layout, fan: layout.fan.filter((id) => id !== cardId) };
}

// Moves a chosen card one seat left or right.
export function moveInHand(layout: HandLayout, cardId: string, direction: -1 | 1): HandLayout {
  const index = layout.fan.indexOf(cardId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= layout.fan.length) {
    return layout;
  }
  const fan = [...layout.fan];
  [fan[index], fan[target]] = [fan[target], fan[index]];
  return { ...layout, fan };
}

// The cards the layout names that the hand does not hold now (a spell no
// longer prepared, a weapon sold). They keep no seat; the count says why the
// fan has room.
export function missingFromHand(layout: HandLayout, cards: Array<{ id: string }>): string[] {
  const held = new Set(cards.map((card) => card.id));
  return layout.fan.filter((id) => !held.has(id));
}
