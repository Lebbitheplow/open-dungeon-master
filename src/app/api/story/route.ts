import { z } from "zod";
import {
  MAX_IMAGE_REFERENCES,
  generateImageTool,
  parseGenerateImageToolCall,
} from "@/lib/image-tool";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  addMessage,
  getStorySummary,
  listCharacters,
  setStorySummary,
  updateChatTitleFromInput,
} from "@/lib/db";
import {
  localContextTokens,
  requestCustomMessage,
  requestLocalMessage,
  type ChatMessage,
  type ImageContentPart,
  type StreamDeltaHandler,
  type TextContentPart,
  type UpstreamChatMessage,
  type UpstreamResult,
} from "@/lib/model-client";
import {
  buildStoryMessages,
  createStreamingArtifactFilter,
  extractStoryText,
  packStoryHistory,
} from "@/lib/story-prompt";
import { DEFAULT_LOCAL_TEXT_MODEL, LOCAL_TEXT_MODEL_IDS } from "@/lib/text-models";
import { PROSE_SIZE_VALUES } from "@/lib/types";
import type { Attachment, StoryCharacter, StoryMessage } from "@/lib/types";

export const runtime = "nodejs";

// Rough chars-per-token for English prose, used to budget story history.
const HISTORY_CHARS_PER_TOKEN = 3.6;
// Tokens held back for the system prompt, character portraits, and the reply.
const HISTORY_RESERVE_TOKENS = 8_192;
// Stay comfortably under the context window so a turn can never max it out.
const CONTEXT_SAFETY_MARGIN = 0.9;
const MIN_HISTORY_CHAR_BUDGET = 48_000;
// History budget for remote/custom backends, whose context window we can't
// introspect. ~43K tokens; long stories still compact via the rolling summary.
const REMOTE_HISTORY_CHAR_BUDGET = 172_800;
const supportedVisionTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type OpenRouterMessage = ChatMessage;

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  url: z.string(),
  dataUrl: z.string().optional(),
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
  attachments: z.array(attachmentSchema).optional(),
});

const requestSchema = z.object({
  chatId: z.string().optional(),
  userMessageId: z.string().optional(),
  // turn     — a normal player action; the input is persisted as a user message.
  // kickoff  — write the opening passage from a directive (not persisted).
  // continue — advance the story with no player action (not persisted).
  // retry    — regenerate the latest passage; input is the prior player action,
  //            already saved, so it is not persisted again.
  // opening — the player wrote the first passage themselves; store it verbatim
  //           as the opening narration, with no model call.
  mode: z.enum(["turn", "kickoff", "continue", "retry", "opening"]).default("turn"),
  // When true the narration is delivered as NDJSON events (delta/done/error)
  // instead of a single JSON body. Opening mode and request-level failures
  // still answer with plain JSON.
  stream: z.boolean().default(false),
  input: z.string().min(1),
  messages: z.array(messageSchema).default([]),
  attachments: z.array(attachmentSchema).default([]),
  settings: z.object({
    world: z.string().default(""),
    style: z.string().default(""),
    textProvider: z.enum(["local", "custom"]).default("local"),
    localTextModel: z.enum(LOCAL_TEXT_MODEL_IDS).default(DEFAULT_LOCAL_TEXT_MODEL),
    customBaseUrl: z.string().trim().max(500).default(""),
    customModel: z.string().trim().max(200).default(""),
    customApiKey: z.string().trim().max(400).default(""),
    imageMode: z.enum(["fast", "slow"]).default("slow"),
    imageBackend: z.enum(["mflux-hs", "sdnq-hs", "comfyui"]).default("mflux-hs"),
    comfyUrl: z.string().trim().max(500).default(""),
    comfyCheckpoint: z.string().trim().max(300).default(""),
    aspect: z.enum(["square", "portrait", "landscape"]).default("square"),
    imageGenerationEnabled: z.boolean().default(true),
    autoImages: z.boolean().default(true),
    proseSize: z.enum(PROSE_SIZE_VALUES).default("medium"),
  }),
});

function mimeFromAttachment(attachment: Attachment) {
  if (supportedVisionTypes.has(attachment.type)) {
    return attachment.type;
  }

  const extension = attachment.url.split(".").pop()?.toLowerCase();
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "gif") {
    return "image/gif";
  }

  return null;
}

function localImageDataUrl(attachment: Attachment) {
  if (attachment.dataUrl?.startsWith("data:image/")) {
    return attachment.dataUrl;
  }

  const mime = mimeFromAttachment(attachment);
  if (!mime || !attachment.url.startsWith("/")) {
    return null;
  }

  const publicDir = path.join(process.cwd(), "public");
  const localPath = path.resolve(publicDir, attachment.url.replace(/^\/+/, ""));

  if (!localPath.startsWith(`${publicDir}${path.sep}`) || !existsSync(localPath)) {
    return null;
  }

  const encoded = readFileSync(localPath).toString("base64");
  return `data:${mime};base64,${encoded}`;
}

function buildCharacterVisionMessage(characters: StoryCharacter[]): OpenRouterMessage | null {
  const parts: Array<TextContentPart | ImageContentPart> = [
    {
      type: "text",
      text:
        "Saved character portrait references for visual continuity. Each portrait is labeled with the character's name and exact ID. Use these images to understand what the characters look like, and use exact IDs when calling generate_image.characterIds.",
    },
  ];

  let attachedCount = 0;
  for (const character of characters) {
    if (!character.portrait) {
      continue;
    }

    const dataUrl = localImageDataUrl(character.portrait);
    if (!dataUrl) {
      continue;
    }

    attachedCount += 1;
    parts.push({
      type: "text",
      text: [
        `Character portrait ${attachedCount}: ${character.name}`,
        `ID: ${character.id}`,
        character.details ? `Details: ${character.details}` : "",
        `The next image is ${character.name}.`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    parts.push({
      type: "image_url",
      image_url: {
        url: dataUrl,
      },
    });
  }

  if (attachedCount === 0) {
    return null;
  }

  return {
    role: "user",
    content: parts,
  };
}


const SUMMARIZER_SYSTEM = `You maintain the canonical "story so far" memory for an ongoing interactive roleplay. Merge the existing summary with the new passages into one updated summary.

Preserve, with priority: active plot threads and their current state; characters (names, roles, relationships, distinctive physical details); promises, debts, secrets, injuries, and items that could matter later; locations and the order of major events; choices the player made that shaped the story.

Write compact prose in past tense, no headings or lists, at most 500 words. Output only the updated summary.`;

type StoryRequestSettings = z.infer<typeof requestSchema>["settings"];

// Single place that picks the upstream provider for a turn.
function requestStoryMessage(
  settings: StoryRequestSettings,
  messages: OpenRouterMessage[],
  includeImageTool: boolean,
  onDelta?: StreamDeltaHandler,
): Promise<UpstreamResult> {
  const options = {
    tools: includeImageTool ? [generateImageTool] : undefined,
    onDelta,
  };
  if (settings.textProvider === "local") {
    return requestLocalMessage(settings.localTextModel, messages, options);
  }
  return requestCustomMessage(
    settings.customBaseUrl,
    settings.customModel,
    settings.customApiKey,
    messages,
    options,
  );
}

// Codex-style compaction adapted for stories: passages that scroll out of the
// context window are folded into a rolling summary instead of being forgotten.
// Best-effort — a failed summary never blocks the player's turn.
async function summarizeEvictedPassages(
  settings: StoryRequestSettings,
  existingSummary: string,
  passages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string | null> {
  const transcript = passages
    .map((message) => `${message.role === "user" ? "Player" : "Narrator"}: ${message.content}`)
    .join("\n\n");
  const messages: OpenRouterMessage[] = [
    { role: "system", content: SUMMARIZER_SYSTEM },
    {
      role: "user",
      content: `Existing summary:\n${existingSummary || "(none yet)"}\n\nNew passages to fold in:\n${transcript}`,
    },
  ];

  const { message, error } = await requestStoryMessage(settings, messages, false);

  if (error) {
    return null;
  }

  const summary = extractStoryText(message?.content);
  return summary ? summary.slice(0, 8_000) : null;
}

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const characters = body.chatId ? listCharacters(body.chatId) : [];
  const knownCharacterIds = new Set(characters.map((character) => character.id));
  const userMessage: StoryMessage = {
    id: body.userMessageId || crypto.randomUUID(),
    role: "user",
    content: body.input,
    createdAt: new Date().toISOString(),
    attachments: body.attachments,
  };

  if (body.chatId && body.mode === "turn") {
    addMessage(body.chatId, userMessage);
    updateChatTitleFromInput(body.chatId, body.input);
  }

  // Player-authored opening: persist the text as the first narration passage
  // and return it, with no model call.
  if (body.mode === "opening") {
    const openingMessage: StoryMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: body.input,
      createdAt: new Date().toISOString(),
    };
    if (body.chatId) {
      addMessage(body.chatId, openingMessage);
    }
    return Response.json({ id: openingMessage.id, content: openingMessage.content });
  }

  const provider = body.settings.textProvider;
  const historyCharBudget =
    provider === "local"
      ? Math.max(
          MIN_HISTORY_CHAR_BUDGET,
          Math.round(
            (localContextTokens(body.settings.localTextModel) - HISTORY_RESERVE_TOKENS) *
              CONTEXT_SAFETY_MARGIN *
              HISTORY_CHARS_PER_TOKEN,
          ),
        )
      : REMOTE_HISTORY_CHAR_BUDGET;

  const { recent, evicted } = packStoryHistory(body.messages, historyCharBudget);
  let storySummary = "";

  if (body.chatId) {
    const stored = getStorySummary(body.chatId);
    storySummary = stored.summary;

    if (evicted.length > stored.coveredCount) {
      const folded = await summarizeEvictedPassages(
        body.settings,
        stored.summary,
        evicted.slice(stored.coveredCount),
      );
      if (folded) {
        storySummary = folded;
        setStorySummary(body.chatId, folded, evicted.length);
      }
    }
  }

  const storyMessages = buildStoryMessages(
    [
      ...recent,
      ...(body.attachments.length
        ? [
            {
              id: "pending-attachments",
              role: "user" as const,
              content: "The player included visual references for this turn.",
              createdAt: new Date().toISOString(),
              attachments: body.attachments,
            },
          ]
        : []),
    ],
    body.input,
    body.settings,
    characters,
    storySummary,
  ) as OpenRouterMessage[];
  const characterVisionMessage = buildCharacterVisionMessage(characters);
  const messages = characterVisionMessage
    ? [storyMessages[0], characterVisionMessage, ...storyMessages.slice(1)]
    : storyMessages;
  const includeImageTool = body.settings.imageGenerationEnabled && body.settings.autoImages;

  // Shared tail of a narration turn: extract, validate, persist.
  const finalizeTurn = (
    message: UpstreamChatMessage | undefined,
  ):
    | { failure: { error: string; detail?: unknown }; assistantMessage?: undefined }
    | { assistantMessage: StoryMessage; failure?: undefined } => {
    const storyText = extractStoryText(message?.content);
    const imageToolArgs = parseGenerateImageToolCall(message?.tool_calls);

    if (!storyText && !imageToolArgs) {
      return {
        failure: {
          error: `${provider === "local" ? "The local model" : "The backend"} returned no story content.`,
          detail: message,
        },
      };
    }

    const characterIds =
      imageToolArgs?.characterIds
        ?.filter((id) => knownCharacterIds.has(id))
        .slice(0, MAX_IMAGE_REFERENCES) || [];
    const assistantMessage: StoryMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: storyText || "The moment hangs there, waiting for what you do next.",
      createdAt: new Date().toISOString(),
      imageRequest:
        includeImageTool && imageToolArgs?.prompt
          ? {
              needed: true,
              prompt: imageToolArgs.prompt,
              mode: body.settings.imageMode,
              backend: body.settings.imageBackend,
              aspect: body.settings.aspect,
              reason: imageToolArgs.reason,
              characterIds,
            }
          : { needed: false },
    };

    if (body.chatId) {
      addMessage(body.chatId, assistantMessage);
    }

    return { assistantMessage };
  };

  if (body.stream) {
    // NDJSON events: {type:"delta"} chunks of visible story text as the model
    // writes, then one {type:"done"} carrying the sanitized persisted message
    // the client reconciles to, or {type:"error"}.
    const encoder = new TextEncoder();
    const filter = createStreamingArtifactFilter();
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Record<string, unknown>) => {
          if (cancelled) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            cancelled = true;
          }
        };

        void (async () => {
          try {
            const { message, error } = await requestStoryMessage(
              body.settings,
              messages,
              includeImageTool,
              (text) => {
                const visible = filter.push(text);
                if (visible) {
                  send({ type: "delta", text: visible });
                }
              },
            );

            if (error) {
              const payload = (await error.json().catch(() => null)) as {
                error?: string;
                detail?: unknown;
              } | null;
              send({
                type: "error",
                error: payload?.error || "Story request failed.",
                ...(payload?.detail !== undefined ? { detail: payload.detail } : {}),
              });
              return;
            }

            const trailing = filter.flush();
            if (trailing) {
              send({ type: "delta", text: trailing });
            }

            const result = finalizeTurn(message);
            if (result.failure) {
              send({ type: "error", ...result.failure });
              return;
            }

            send({
              type: "done",
              id: result.assistantMessage.id,
              content: result.assistantMessage.content,
              imageRequest: result.assistantMessage.imageRequest,
            });
          } catch (streamFailure) {
            send({
              type: "error",
              error:
                streamFailure instanceof Error ? streamFailure.message : "Story request failed.",
            });
          } finally {
            if (!cancelled) {
              try {
                controller.close();
              } catch {
                // The client went away first; nothing left to close cleanly.
              }
            }
          }
        })();
      },
      cancel() {
        cancelled = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const { message, error } = await requestStoryMessage(body.settings, messages, includeImageTool);

  if (error) {
    return error;
  }

  const result = finalizeTurn(message);
  if (result.failure) {
    return Response.json(result.failure, { status: 502 });
  }

  return Response.json({
    id: result.assistantMessage.id,
    content: result.assistantMessage.content,
    imageRequest: result.assistantMessage.imageRequest,
  });
}
