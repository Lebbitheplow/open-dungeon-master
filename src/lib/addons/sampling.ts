import { requestUtilityMessage } from "@/lib/dm/model";
import { arcTextTimeoutMs, type ChatMessage, type ImageContentPart, type TextContentPart } from "@/lib/model-client";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import type { StorySettings } from "@/lib/types";
import { runInUsageScope, type UsageScope } from "@/lib/usage/scope";

// An addon asking this server's model for text: MCP's sampling/createMessage,
// answered by the same utility path the DM's own bookkeeping uses, so the
// admin's model choice, the paid-host rules and the Usage ledger all apply.
// The PDF importer is the case in mind: it reads pages itself and asks the
// storyteller to turn a stat block's prose into fields, without needing a
// key of its own.
//
// Text and pictures (a scanned page, a map, a portrait to describe). Audio
// is refused by name rather than dropped, so the addon knows its prompt did
// not arrive whole. A model that cannot see pictures is asked again with the
// text alone (src/lib/model-client.ts), as the DM's own portraits are.

export const MAX_SAMPLING_CHARS = 200_000;
export const MAX_SAMPLING_IMAGES = 8;
// The same ceiling a picture uploaded by hand has, in base64 characters.
const MAX_IMAGE_BASE64_CHARS = Math.ceil((8 * 1024 * 1024 * 4) / 3) + 4;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type SamplingContext = {
  scope: UsageScope;
  // The table's own model when the work is for a campaign or workshop; the
  // server's default otherwise.
  settings?: StorySettings;
};

type SamplingMessage = { role?: unknown; content?: unknown };

type Read = { text: string; images: ImageContentPart[] };

function partsOf(content: unknown): Read {
  const parts = Array.isArray(content) ? content : [content];
  const text: string[] = [];
  const images: ImageContentPart[] = [];
  for (const part of parts) {
    const record = part && typeof part === "object" ? (part as Record<string, unknown>) : {};
    if (record.type === "text" && typeof record.text === "string") {
      text.push(record.text);
    } else if (record.type === "image") {
      const mime = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
      const data = typeof record.data === "string" ? record.data : "";
      if (!IMAGE_TYPES.has(mime)) throw new Error(`A picture in a sampling request is PNG, JPEG or WebP; one was ${mime || "unnamed"}.`);
      if (!data || data.length > MAX_IMAGE_BASE64_CHARS || !/^[A-Za-z0-9+/=]+$/.test(data)) {
        throw new Error("A picture in a sampling request is base64 data of up to 8 MB.");
      }
      images.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data}` } });
    } else {
      throw new Error(`This server answers sampling with text and pictures; a ${String(record.type ?? "blank")} block was sent.`);
    }
  }
  return { text: text.join("\n"), images };
}

export function samplingMessages(params: Record<string, unknown>): ChatMessage[] {
  const raw = Array.isArray(params.messages) ? (params.messages as SamplingMessage[]) : [];
  if (!raw.length) throw new Error("A sampling request needs at least one message.");
  const messages: ChatMessage[] = [];
  if (typeof params.systemPrompt === "string" && params.systemPrompt.trim()) {
    messages.push({ role: "system", content: params.systemPrompt });
  }
  let size = 0;
  let pictures = 0;
  for (const message of raw.slice(0, 100)) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const { text, images } = partsOf(message.content);
    size += text.length;
    pictures += images.length;
    if (images.length && role === "user") {
      const content: Array<TextContentPart | ImageContentPart> = text ? [{ type: "text", text }, ...images] : images;
      messages.push({ role, content });
    } else if (images.length) {
      throw new Error("Pictures go in the user's messages of a sampling request.");
    } else {
      messages.push({ role, content: text });
    }
  }
  if (size > MAX_SAMPLING_CHARS) {
    throw new Error(`A sampling request may hold ${MAX_SAMPLING_CHARS} characters; this one held ${size}. Send the work in smaller pieces.`);
  }
  if (pictures > MAX_SAMPLING_IMAGES) {
    throw new Error(`A sampling request may hold ${MAX_SAMPLING_IMAGES} pictures; this one held ${pictures}. Send them a few at a time.`);
  }
  return messages;
}

export async function answerSampling(params: Record<string, unknown>, context: SamplingContext): Promise<Record<string, unknown>> {
  const messages = samplingMessages(params);
  const temperature = typeof params.temperature === "number" ? Math.min(2, Math.max(0, params.temperature)) : undefined;
  const settings = context.settings ?? configuredDefaultStorySettings();
  const result = await runInUsageScope(context.scope, () =>
    requestUtilityMessage(settings, messages, { temperature, timeoutMs: arcTextTimeoutMs(), thinking: false, meta: { task: "addon_sampling" } }),
  );
  if (result.error) {
    const body = (await result.error.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "The storyteller model did not answer.");
  }
  const text = stripReasoningArtifacts(String(result.message?.content ?? ""));
  return {
    role: "assistant",
    content: { type: "text", text },
    model: result.usage?.model || "storyteller",
    stopReason: result.finishReason === "length" ? "maxTokens" : "endTurn",
  };
}
