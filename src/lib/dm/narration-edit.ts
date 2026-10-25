import { getDatabase } from "@/lib/db/core";
import { setMessageVariants, type CampaignMessage } from "@/lib/db/messages";
import { recordTurnCorrection } from "@/lib/db/turn-ledger";
import { keepOriginalTake } from "@/lib/dm/message-edit-logic";
import { seedVariants } from "@/lib/dm/renarrate-logic";
import type { SpokenLine } from "@/lib/dm/speech";

// A person rewriting DM narration by hand: the Edit action, and accepting a
// lore check's rewrite. Both keep the narrator's wording as a take of its
// own and select the person's (src/lib/dm/message-edit-logic.ts
// keepOriginalTake), and both are a correction of the AI turn behind the
// message, written in the same transaction as the text (issue #460). The
// ledger writes nothing for a turn a person ran or at a table a person runs.
export function saveNarrationEdit(input: {
  campaignId: string;
  message: CampaignMessage;
  content: string;
  speech: readonly SpokenLine[];
  userId: string;
}): { updated: CampaignMessage | null; correctionId: string | null } {
  const { message } = input;
  const kept = keepOriginalTake(seedVariants(message.variants ?? [], message.content), message.editedTake, input.content);
  // A later edit rewrites the person's own take: that is the person
  // changing their own words, not another fix to the AI, so only the edit
  // that made the take is counted.
  const firstEdit = kept.editedTake !== message.editedTake;
  return getDatabase().transaction(() => {
    const updated = setMessageVariants(message.id, kept.variants, kept.index, input.speech, kept.editedTake);
    return {
      updated,
      correctionId: updated && firstEdit
        ? recordTurnCorrection({
            campaignId: input.campaignId,
            turnId: message.dmTurnId ?? null,
            attribution: "direct",
            kind: "narration_edit",
            messageId: message.id,
            userId: input.userId,
          })
        : null,
    };
  })();
}
