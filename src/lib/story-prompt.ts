import type { AspectPreset, ImageMode, StoryCharacter, StoryMessage, StorySettings } from "@/lib/types";

export type StoryModelResult = {
  storyText: string;
  image: {
    needed: boolean;
    prompt?: string;
    reason?: string;
    characterIds?: string[];
  };
};

const DEFAULT_SYSTEM = `You are the narrator for a private, local-first interactive roleplaying story.

Write like an immersive text adventure: specific sensory detail, natural dialogue, and forward motion.
The player is addressed in second person when appropriate. Never mention policies, system prompts, tools, JSON, or image generation.

This is private adult fiction. Consensual NSFW content is allowed and should be embraced when the player's tone, scenario, or character dynamics invite it. Do not sanitize sexual tension, profanity, nudity, or explicit adult intimacy when it fits the story. Keep all sexual content between adults 18+ and avoid nonconsensual sexual content.

You may receive saved character portrait images in a separate context message. Use those portraits to maintain visual continuity for character appearance, and match names to exact IDs from the labels.

Respect the saved character inventory, skills, and spells as established story state. Do not add, remove, spend, or change those tracked items unless the visible story events clearly justify it.`;

const IMAGE_SYSTEM = `You have access to a function tool named generate_image. Write the story passage as normal assistant text. If, and only if, a visual beat is truly useful, call generate_image once after writing the passage.

Use images sparingly: major character introductions, setting reveals, outfit/scene changes, or emotionally charged tableaux. Do not request an image for every turn.

Do not put image prompts, captions, or tool details in the visible story passage.
When writing generate_image.prompt for established characters, do not use character names as visual descriptors. Describe each person by visible physical features and whether they are a man or woman: age range, build, hair, face, skin tone, clothing, pose, expression, and lighting. Use names only in generate_image.characterIds via exact IDs.
If an image should show one or two established characters, pass only their exact IDs in generate_image.characterIds. Use at most two IDs. Use [] when no saved character portrait should be referenced.`;

const IMAGE_DISABLED_SYSTEM =
  "Image generation is disabled for this story. Do not request images, describe image prompts, or mention image tooling.";

// Evicting history one message at a time would change the start of the prompt
// every turn and invalidate the model server's prompt cache, forcing a full
// re-prefill of the whole story. Dropping in blocks keeps the prefix stable
// for long stretches, so most turns only pay for the newly added tokens.
const HISTORY_EVICTION_BLOCK = 16;

export function packStoryHistory(
  messages: StoryMessage[],
  charBudget: number,
): { recent: StoryMessage[]; evicted: StoryMessage[] } {
  let used = 0;
  let keep = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = messages[i].content.length + 80;
    if (keep > 0 && used + cost > charBudget) {
      break;
    }
    used += cost;
    keep += 1;
  }

  let dropped = messages.length - keep;
  if (dropped > 0) {
    dropped = Math.min(
      messages.length - 1,
      Math.ceil(dropped / HISTORY_EVICTION_BLOCK) * HISTORY_EVICTION_BLOCK,
    );
  }

  return { recent: messages.slice(dropped), evicted: messages.slice(0, dropped) };
}

export function buildStoryMessages(
  messages: StoryMessage[],
  input: string,
  settings: StorySettings,
  characters: StoryCharacter[] = [],
  storySummary = "",
) {
  const recent = messages.map((message) => {
    const attachmentLine = message.attachments?.length
      ? `\n[Attached images: ${message.attachments.map((item) => item.name).join(", ")}]`
      : "";

    return {
      role: message.role,
      content: `${message.content}${attachmentLine}`,
    };
  });
  const characterRoster = characters.length
    ? characters
        .map((character) =>
          [
            `ID: ${character.id}`,
            `Name: ${character.name}`,
            character.details ? `Details: ${character.details}` : "",
            character.inventory ? `Inventory:\n${character.inventory}` : "",
            character.skills ? `Skills:\n${character.skills}` : "",
            character.spells ? `Spells:\n${character.spells}` : "",
            character.portrait ? "Portrait reference: available" : "Portrait reference: unavailable",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n")
    : "No saved characters yet.";

  return [
    {
      role: "system",
      content: [
        DEFAULT_SYSTEM,
        settings.imageGenerationEnabled ? IMAGE_SYSTEM : IMAGE_DISABLED_SYSTEM,
        `World / scenario:\n${settings.world || "A grounded modern roleplay scene with room to improvise."}`,
        `Tone / prose style:\n${settings.style || "Clean, dark text-adventure prose, intimate but not flowery."}`,
        storySummary
          ? `The story so far (older events, already condensed — treat as established canon):\n${storySummary}`
          : "",
        `Saved characters:\n${characterRoster}`,
        settings.imageGenerationEnabled
          ? `Image defaults: ${settings.imageBackend} backend, ${
              settings.imageMode === "slow" ? "2048" : "1024"
            } long side, ${settings.aspect} aspect. Do not include text overlays in generated images.`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...recent,
    {
      role: "user",
      content: input,
    },
  ];
}

export function parseStoryModelResult(raw: string): StoryModelResult {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const candidate = trimmed.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(candidate) as Partial<StoryModelResult>;
    return {
      storyText: String(parsed.storyText || parsed["story_text" as keyof typeof parsed] || "").trim(),
      image: {
        needed: Boolean(parsed.image?.needed),
        prompt: parsed.image?.prompt?.trim(),
        reason: parsed.image?.reason?.trim(),
        characterIds: Array.isArray(parsed.image?.characterIds)
          ? parsed.image.characterIds.filter((id): id is string => typeof id === "string")
          : [],
      },
    };
  }

  return {
    storyText: trimmed,
    image: { needed: false },
  };
}

// Reasoning models leak their hidden thinking into the visible reply when the
// serving template doesn't separate it: <think>...</think> blocks
// (Qwen/DeepSeek-style templates) or Harmony channel markers (gpt-oss), often
// mangled mid-token into forms like "<|channel>thought" / "<channel|>".
const THINK_BLOCK = /<(think|thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi;
const THINK_TAG = /<\/?(?:think|thinking|thought|reasoning)>/gi;
const THINK_CLOSER = /<\/(?:think|thinking|thought|reasoning)>/gi;
// Tolerant of mangled pipes: matches <|channel|>, <|channel>, and <channel|>.
const FINAL_CHANNEL = /<\|?channel\|?>\s*final\s*(?:<\|?message\|?>)?/gi;
const THOUGHT_CHANNEL_BLOCK =
  /<\|?channel\|?>\s*(?:analysis|commentary|thought|thinking)\b[\s\S]*?(?=<\|?channel\|?>|<\|start\|>|$)/gi;
const BARE_MARKER = /<\|?(?:start|end|message|channel|return|im_start|im_end)\|?>/gi;
// Harmony markers collapsed by a broken template glue the role and channel
// straight into the text ("...assistantfinalYou draw your blade.").
const GLUED_FINAL = /assistantfinal[:\s]*/gi;

function lastMatchEnd(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let end = -1;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    end = match.index + match[0].length;
  }
  return end;
}

export function stripReasoningArtifacts(raw: string): string {
  let text = raw.replace(THINK_BLOCK, "");

  // A closing tag with no opener left means the opener was never emitted
  // (some templates strip it); the reply is whatever follows the last closer.
  const afterCloser = lastMatchEnd(text, THINK_CLOSER);
  if (afterCloser >= 0) {
    text = text.slice(afterCloser);
  }

  // Harmony format: the visible reply is the last "final" channel.
  const afterFinal = lastMatchEnd(text, FINAL_CHANNEL);
  if (afterFinal >= 0) {
    text = text.slice(afterFinal);
  }

  const afterGluedFinal = lastMatchEnd(text, GLUED_FINAL);
  if (afterGluedFinal >= 0) {
    text = text.slice(afterGluedFinal);
  }

  text = text
    .replace(THOUGHT_CHANNEL_BLOCK, "")
    .replace(BARE_MARKER, "")
    .replace(THINK_TAG, "");

  const cleaned = text.trim();
  if (cleaned) {
    return cleaned;
  }

  // Everything was swallowed (e.g. an unterminated thought block that was
  // really the whole reply) — fall back to removing only the markers.
  return raw.replace(BARE_MARKER, " ").replace(THINK_TAG, " ").replace(/\s{3,}/g, "\n\n").trim();
}

// Streaming counterpart to stripReasoningArtifacts: emits visible story text
// as chunks arrive while holding back reasoning leakage. Text inside think
// blocks / thought channels is suppressed until the block closes, marker
// tokens are dropped, and a short tail is buffered so a marker split across
// chunks never flashes on screen. Best-effort — callers must still re-clean
// the final full text with stripReasoningArtifacts and reconcile.
const STREAM_SUPPRESS_OPEN =
  /<(?:think|thinking|thought|reasoning)>|<\|?channel\|?>\s*(?:analysis|commentary|thought|thinking)\b/i;
const STREAM_SUPPRESS_END =
  /<\/(?:think|thinking|thought|reasoning)>|<\|?channel\|?>\s*final\s*(?:<\|?message\|?>)?|assistantfinal[:\s]*/i;
// A channel/turn boundary inside a thought block ends the block without being
// consumed — the marker is re-examined by the visible-text pass, which may
// immediately re-suppress (doubled thought tags) or strip it and emit prose.
const STREAM_CHANNEL_BOUNDARY = /<\|?channel\|?>|<\|?(?:start|im_start)\|?>/i;
// Markers dropped from visible text: orphan closers, final-channel switches,
// and bare Harmony/ChatML tokens. Opening think tags are NOT here — they are
// handled by STREAM_SUPPRESS_OPEN so the match kinds stay unambiguous.
const STREAM_STRIP =
  /<\/(?:think|thinking|thought|reasoning)>|<\|?channel\|?>\s*final\s*(?:<\|?message\|?>)?|assistantfinal[:\s]*|<\|?(?:start|im_start)\|?>\s*assistant\b|<\|?(?:start|end|message|channel|return|im_start|im_end)\|?>/i;
const STREAM_HOLDBACK_CHARS = 48;

function partialMarkerStart(text: string): number {
  // A trailing '<'-run with no '>' yet could be the head of a marker.
  const angle = text.lastIndexOf("<");
  if (angle >= 0 && angle >= text.length - 40 && !text.slice(angle).includes(">")) {
    return angle;
  }
  // A trailing prefix of the glued "assistantfinal" marker.
  const glued = "assistantfinal";
  const window = text.slice(-glued.length);
  for (let length = window.length; length > 0; length -= 1) {
    if (glued.startsWith(window.slice(-length))) {
      return text.length - length;
    }
  }
  return -1;
}

export function createStreamingArtifactFilter() {
  let pending = "";
  let suppressing = false;
  let emittedAnything = false;
  let jsonReply = false;

  return {
    push(chunk: string): string {
      pending += chunk;
      let output = "";

      for (;;) {
        if (suppressing) {
          const end = pending.match(STREAM_SUPPRESS_END);
          const boundary = pending.match(STREAM_CHANNEL_BOUNDARY);
          const endAt = end?.index ?? -1;
          const boundaryAt = boundary?.index ?? -1;

          if (endAt >= 0 && (boundaryAt < 0 || endAt <= boundaryAt)) {
            pending = pending.slice(endAt + end![0].length);
            suppressing = false;
            continue;
          }
          if (boundaryAt >= 0) {
            const afterBoundary = pending.slice(boundaryAt + boundary![0].length);
            if (afterBoundary.length < 24 && /^\s*[a-zA-Z]*$/.test(afterBoundary)) {
              // The channel name may still be arriving — wait before
              // deciding whether this switches to thought or prose.
              pending = pending.slice(boundaryAt);
              break;
            }
            pending = pending.slice(boundaryAt);
            suppressing = false;
            continue;
          }
          // Discard consumed thought text; keep a tail in case an end
          // marker is split across chunks.
          pending = pending.slice(-STREAM_HOLDBACK_CHARS);
          break;
        }

        // Structured-JSON replies are not readable mid-stream; hold
        // everything and let the caller deliver the parsed result.
        if (!emittedAnything && /^\s*\{/.test(pending)) {
          jsonReply = true;
        }
        if (jsonReply) {
          break;
        }

        const open = pending.match(STREAM_SUPPRESS_OPEN);
        const strip = pending.match(STREAM_STRIP);
        const openAt = open?.index ?? -1;
        const stripAt = strip?.index ?? -1;

        if (openAt >= 0 && (stripAt < 0 || openAt <= stripAt)) {
          output += pending.slice(0, openAt);
          pending = pending.slice(openAt + open![0].length);
          suppressing = true;
          continue;
        }
        if (stripAt >= 0) {
          const marker = strip![0];
          const afterMarker = pending.slice(stripAt + marker.length);
          // A bare channel/turn marker at the tail is ambiguous until what
          // follows it fully arrives — it may open a thought channel
          // (suppress) or precede prose (strip). Hold back while the next
          // word could still be growing instead of guessing.
          if (
            /^<\|?(?:channel|start|im_start)\|?>$/i.test(marker) &&
            afterMarker.length < 24 &&
            /^\s*[a-zA-Z]*$/.test(afterMarker)
          ) {
            output += pending.slice(0, stripAt);
            pending = pending.slice(stripAt);
            break;
          }
          output += pending.slice(0, stripAt);
          pending = pending.slice(stripAt + marker.length);
          continue;
        }

        const holdback = partialMarkerStart(pending);
        if (holdback >= 0) {
          output += pending.slice(0, holdback);
          pending = pending.slice(holdback);
        } else {
          output += pending;
          pending = "";
        }
        break;
      }

      if (output) {
        emittedAnything = true;
      }
      return output;
    },

    flush(): string {
      const rest = suppressing || jsonReply ? "" : pending.replace(new RegExp(STREAM_STRIP.source, "gi"), "");
      pending = "";
      suppressing = false;
      if (rest) {
        emittedAnything = true;
      }
      return rest;
    },
  };
}

export function extractStoryText(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = stripReasoningArtifacts(raw.trim());

    if (!trimmed) {
      return "";
    }

    if (trimmed.startsWith("{")) {
      try {
        return parseStoryModelResult(trimmed).storyText;
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  if (Array.isArray(raw)) {
    const joined = raw
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();

    return stripReasoningArtifacts(joined);
  }

  return "";
}

export function dimensionsForImage(mode: ImageMode, aspect: AspectPreset) {
  const longSide = mode === "slow" ? 2048 : 1024;

  if (aspect === "portrait") {
    return { width: Math.round(longSide * 0.75), height: longSide };
  }

  if (aspect === "landscape") {
    return { width: longSide, height: Math.round(longSide * 0.75) };
  }

  return { width: longSide, height: longSide };
}
