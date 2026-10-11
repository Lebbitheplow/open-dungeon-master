import type { Campaign } from "@/lib/db/campaigns";
import { requestUtilityMessage } from "@/lib/dm/model";
import { IMAGE_ENGLISH_SYSTEM, parseImageEnglish } from "@/lib/image-english-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

// Story text bound for an image prompt, in English
// (src/lib/image-english-logic.ts). Called inside each image job, never
// inside a transaction. An English table makes no call and gets its text
// back as it was. A failed or unreadable rewrite throws, so the job fails
// through its own failed path rather than sending text the image model
// cannot read; the error names no text (PRIVACY: these are story fields).
export async function toEnglishForImage<K extends string>(
  campaign: Pick<Campaign, "settings" | "gameSettings">,
  fields: Record<K, string>,
): Promise<Record<K, string>> {
  if (campaign.gameSettings.tableLanguage === "english") {
    return fields;
  }
  const keys = (Object.keys(fields) as K[]).filter((key) => fields[key].trim());
  if (!keys.length) {
    return fields;
  }
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: IMAGE_ENGLISH_SYSTEM },
      { role: "user", content: JSON.stringify(Object.fromEntries(keys.map((key) => [key, fields[key]]))) },
    ],
    { timeoutMs: arcTextTimeoutMs(), thinking: false },
  );
  if (error) {
    throw new Error("The English rewrite for the image prompt failed.");
  }
  const rewritten = parseImageEnglish(stripReasoningArtifacts(String(message?.content ?? "")), keys);
  if (!rewritten) {
    throw new Error("The English rewrite for the image prompt was unreadable.");
  }
  return { ...fields, ...rewritten };
}
