import type { Campaign } from "@/lib/db/campaigns";
import { listPrepCards } from "@/lib/db/prep-cards";
import { placementOf, renderPrepCard, resolvePrepRef } from "@/lib/dm/prep-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";

// read_card: the full authored text behind a line of the arc (issues #301
// and #302). The prompt carries a beat as one line and a planned event as a
// name, a trigger and a short detail; the storyboard card they came from can
// hold pages. The DM opens it when the scene is there, by the event's id,
// the beat's number, or the card's title.

export const readCardTool = {
  type: "function",
  function: {
    name: "read_card",
    description:
      "Read the full prep card behind a story beat or a planned event: everything the author wrote on the storyboard, kept whole. Give a planned event's id ([evN]), a main beat's number, or the card's title. DM-only; use it when the scene reaches that beat or event, before narrating it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ref: {
          type: "string",
          description: "An event id such as ev3, a beat number such as 7, or a card title.",
        },
      },
      required: ["ref"],
    },
  },
} as const;

export function handleReadCard(campaign: Campaign, rawArguments: string): ToolResult {
  let args: { ref?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments.", retry: true };
  }
  const ref = String(args.ref ?? "").trim();
  if (!ref) {
    return { error: "Say which card: an event id (ev3), a beat number (7), or a title.", retry: true };
  }
  const cards = listPrepCards(campaign.id);
  if (!cards.length) {
    return { error: "This campaign has no prep cards: its arc was written by the storyteller, not imported from a storyboard.", retry: true };
  }
  const card = resolvePrepRef(campaign.storyArc, cards, ref);
  if (!card) {
    return {
      error: `No prep card answers to "${ref}". Beats a model wrote have no card; a planned event's id is the [evN] in the arc; a title is a card's whole title: ${cards.map((entry) => entry.title).join(", ")}.`,
      retry: true,
    };
  }
  return renderPrepCard(card, placementOf(campaign.storyArc, card.cardId));
}
