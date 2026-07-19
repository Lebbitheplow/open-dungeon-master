import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { insertWhisper, type WhisperRecipient } from "@/lib/db/dm-whispers";
import { publishEphemeral } from "@/lib/events";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Executes one send_whisper tool call: a private note from the DM to the
// players of the named characters, and the DM's reply channel for private
// player-to-DM messages (which reach it through GAME STATE, never as a
// tracked conversation). Recipients learn about it via the contentless
// "whisper_activity" ephemeral event and fetch their own rows; the content
// never enters the shared event stream.

export const WHISPER_CAP_PER_TURN = 5;

// characterIds tolerates a comma-joined string and a singular characterId:
// weak tool calling (and bracket-text salvage) sends both shapes.
const whisperArgsSchema = z.object({
  characterIds: z
    .union([z.array(z.string().max(120)).min(1).max(10), z.string().min(1).max(600)])
    .optional(),
  characterId: z.string().max(120).optional(),
  message: z.string().trim().min(1).max(1000),
});

export function handleSendWhisper(
  campaign: Campaign,
  turnId: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof whisperArgsSchema>;
  try {
    args = whisperArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "send_whisper needs characterIds (from GAME STATE) and a message." };
  }
  const refs = [
    ...(Array.isArray(args.characterIds)
      ? args.characterIds
      : (args.characterIds ?? "").split(",")),
    ...(args.characterId ? [args.characterId] : []),
  ]
    .map((ref) => ref.trim())
    .filter(Boolean);
  const resolved = new Map<string, CharacterSheet>();
  for (const ref of refs) {
    const sheet = resolveSheetRef(ref, sheets, sheetsById);
    if (sheet) {
      resolved.set(sheet.id, sheet);
    }
  }
  if (!resolved.size) {
    return { error: "No valid characterIds; use exact characterIds from GAME STATE." };
  }
  const recipients: WhisperRecipient[] = [...resolved.values()].map((sheet) => ({
    userId: sheet.userId,
    characterId: sheet.id,
    characterName: sheet.name,
  }));
  insertWhisper(campaign.id, turnId, recipients, args.message);
  publishEphemeral(campaign.id, "whisper_activity", {});
  return {
    ok: true,
    whisperedTo: recipients.map((recipient) => recipient.characterName),
    note: "Delivered privately. Continue the shared scene without revealing it.",
  };
}
