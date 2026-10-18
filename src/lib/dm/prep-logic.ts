// Prep cards: the storyboard, kept whole in the campaign (issues #301 and
// #302). Pure: how a reference the DM gives ("ev3", "7", a title) finds a
// card through the arc, and how a card reads back. The rim is
// src/lib/db/prep-cards.ts; the tool is src/lib/dm/prep-card-tool.ts.

import type { StoryArc } from "./arc-logic.ts";
import { textKey } from "../language/text-logic.ts";

export const PREP_ROLES = ["beat", "moment", "lore", "quest", "fight", "secret", "unplaced"] as const;
export type PrepRole = (typeof PREP_ROLES)[number];

export type PrepCard = {
  id: string;
  campaignId: string;
  // The id the card had on its board: stable across imports of the board.
  cardId: string;
  sourceId: string;
  sourceTitle: string;
  kind: string;
  title: string;
  body: string;
  cues: string;
  trigger: string;
  role: PrepRole;
  createdAt: string;
  updatedAt: string;
};

export const PREP_ROLE_LABELS: Record<PrepRole, string> = {
  beat: "a main beat of the arc",
  moment: "a planned event the arc offers",
  lore: "a lore entry",
  quest: "a quest",
  fight: "a prepared fight",
  secret: "a DM-only note",
  unplaced: "kept on the shelf: the arc had no room for it as a planned event",
};

export function normalizePrepRole(raw: unknown): PrepRole {
  return (PREP_ROLES as readonly string[]).includes(raw as string) ? (raw as PrepRole) : "unplaced";
}

// Where a card stands in the arc now, if it is in it: the beat's number and
// status, or the event's id and status.
export type PrepPlacement =
  | { kind: "beat"; number: number; status: string; text: string }
  | { kind: "event"; id: string; status: string; name: string }
  | null;

export function placementOf(arc: StoryArc | null, cardId: string): PrepPlacement {
  if (!arc) {
    return null;
  }
  const beatIndex = arc.beats.findIndex((beat) => beat.cardId === cardId);
  if (beatIndex >= 0) {
    const beat = arc.beats[beatIndex];
    return { kind: "beat", number: beatIndex + 1, status: beat.status, text: beat.text };
  }
  const event = arc.events.find((entry) => entry.cardId === cardId);
  if (event) {
    return { kind: "event", id: event.id, status: event.status, name: event.name };
  }
  return null;
}

// "ev3" finds the event's card, "7" the seventh beat's, anything else a card
// by title (exact first, then a title that contains the words). Null when
// nothing matches; the caller says so.
export function resolvePrepRef(arc: StoryArc | null, cards: PrepCard[], ref: string): PrepCard | null {
  const wanted = ref.trim();
  if (!wanted) {
    return null;
  }
  const byCardId = (cardId: string | undefined) => (cardId ? cards.find((card) => card.cardId === cardId) ?? null : null);
  const event = /^ev\d+$/i.test(wanted) ? arc?.events.find((entry) => entry.id.toLowerCase() === wanted.toLowerCase()) : undefined;
  if (event) {
    return byCardId(event.cardId);
  }
  if (/^\d+$/.test(wanted)) {
    const beat = arc?.beats[Number(wanted) - 1];
    return beat ? byCardId(beat.cardId) : null;
  }
  const lower = textKey(wanted);
  return (
    cards.find((card) => textKey(card.title) === lower) ??
    cards.find((card) => card.cardId === wanted) ??
    cards.find((card) => textKey(card.title).includes(lower)) ??
    null
  );
}

// The card as the DM reads it: whole, line breaks kept, with where it
// stands in the arc. Secret to the table like the arc itself.
export function renderPrepCard(card: PrepCard, placement: PrepPlacement): Record<string, unknown> {
  const standing =
    placement?.kind === "beat"
      ? `main beat ${placement.number} (${placement.status})`
      : placement?.kind === "event"
        ? `planned event [${placement.id}] (${placement.status})`
        : PREP_ROLE_LABELS[card.role];
  return {
    card: card.cardId,
    title: card.title,
    kind: card.kind,
    standing,
    ...(card.trigger ? { when: card.trigger } : {}),
    ...(card.cues ? { involves: card.cues } : {}),
    text: card.body,
    ...(card.sourceTitle ? { from: card.sourceTitle } : {}),
    note: "DM-only prep. An opportunity, not a script: play it when the fiction reaches it, adapt it, or let it go; never reveal or quote it.",
  };
}
