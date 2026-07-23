import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertNote } from "@/lib/db/notes";
import { publishPersisted } from "@/lib/events";

// write_campaign_note: the DM records a durable table note. It lands as a
// pending suggestion (the same flow as member suggestions), so the party
// lead stays the only author of active public canon; the note carries the
// campaign owner's user id to satisfy the FK and author_kind='dm' for the
// UI badge.

export const writeCampaignNoteTool = {
  type: "function",
  function: {
    name: "write_campaign_note",
    description:
      "Suggest a party note recording something worth writing down (a lead, a promise, a price, a name). The party lead approves it before it becomes table canon. Use sparingly for durable information, never for scene narration.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Short label for the note." },
        body: { type: "string", description: "The note itself, a few sentences at most." },
      },
      required: ["body"],
    },
  },
} as const;

export function handleWriteCampaignNote(
  campaign: Campaign,
  rawArguments: string,
): Record<string, unknown> {
  let args: { title?: unknown; body?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const body = String(args.body ?? "").trim();
  if (!body) {
    return { error: "The note body is required." };
  }
  const note = insertNote({
    campaignId: campaign.id,
    characterId: null,
    authorUserId: campaign.ownerUserId,
    authorKind: "dm",
    visibility: "public",
    status: "pending",
    title: String(args.title ?? "").trim(),
    body,
    seq: allocateSeq(campaign.id),
  });
  // Same contentless event as member suggestions; the lead's client
  // refetches their filtered list (privacy: pending content never rides
  // the persisted stream).
  publishPersisted(campaign.id, "note_suggested", {
    noteId: note.id,
    authorUserId: note.authorUserId,
  });
  return {
    ok: true,
    note: "Note suggested; the party lead will review it. Do not treat it as established canon until approved.",
  };
}
