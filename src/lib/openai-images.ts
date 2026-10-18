import { mkdirSync, writeFileSync } from "node:fs";
import { isPrivateBackendHost } from "@/lib/backend-host";
import path from "node:path";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import { endpointKind } from "@/lib/dm/sampling-logic";
import { sniffImage } from "@/lib/image-format";
import { scheduleImageVariants } from "@/lib/image-variants";
import { serverEnv } from "@/lib/server-env";
import type { AspectPreset, GeneratedImage, ImageMode, StorySettings } from "@/lib/types";
import { recordMediaFile } from "@/lib/media-access";
import { FIRST_SIZES, pickImageSize, readSupportedSizes, type ImageSize } from "@/lib/openai-image-size-logic";
import { asciiSlugOf } from "@/lib/language/text-logic";

// OpenAI Images backend: the paid escape hatch for a server (or an app-only
// host) whose hardware cannot run a local image model. The key is the server
// owner's or the table's, lives in the admin config, the campaign's Text
// Model panel, or the environment, and every request originates server-side,
// so campaign members never see it.
//
// The base URL is configurable for OpenAI-compatible image proxies, and
// defaults to api.openai.com. The model has no default: it is the admin's
// pick from what the server lists (Admin > Images), so no retired model is
// ever asked for by name.

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const GENERATE_TIMEOUT_MS = 4 * 60 * 1000;

// The story backend's key, but only when that backend IS OpenAI. Images are a
// different API on the same account, so a table already paying OpenAI for its
// DM should not have to paste the key twice; the host gate is what makes that
// safe, since a llama.cpp, LM Studio or OpenRouter key must never be posted
// to api.openai.com. Campaign settings first, then the server-wide backend.
export type TextBackendKey = Pick<StorySettings, "customBaseUrl" | "customApiKey">;

function borrowedTextKey(story?: TextBackendKey): string {
  const text = getGlobalConfig().text;
  const candidates: Array<[string, string]> = [
    [story?.customBaseUrl ?? "", story?.customApiKey ?? ""],
    [
      text.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL"),
      text.customApiKey || serverEnv("OPENAI_COMPAT_API_KEY"),
    ],
  ];
  for (const [baseUrl, apiKey] of candidates) {
    // endpointKind reads the whole host, and a blank URL is never "openai",
    // so an unconfigured field cannot lend anything.
    if (endpointKind(baseUrl) === "openai" && apiKey.trim()) {
      return apiKey.trim();
    }
  }
  return "";
}

function resolveConfig(story?: TextBackendKey) {
  const images = getGlobalConfig().images;
  return {
    baseUrl: configValue(images.openaiBaseUrl, "OPENAI_IMAGE_BASE_URL", DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    ),
    model: configValue(images.openaiModel, "OPENAI_IMAGE_MODEL"),
    // OPENAI_API_KEY before the borrowed text key because it is the name
    // every other tool trains people to set, and an image-specific setting
    // is a deliberate choice that must beat an inferred one.
    apiKey:
      images.openaiApiKey.trim() ||
      serverEnv("OPENAI_IMAGE_API_KEY") ||
      serverEnv("OPENAI_API_KEY") ||
      borrowedTextKey(story),
  };
}

// Whether the "openai" picture backend bills the host: a key to a public
// host. A local server speaking the images API is the host's own
// (src/lib/shared-host.ts).
export function openAiImagesPaid(story?: TextBackendKey): boolean {
  const config = resolveConfig(story);
  return config.apiKey !== "" && !isPrivateBackendHost(config.baseUrl);
}

// The same key, lent to speech-to-text: when a server has no Whisper of its
// own, dictation can go to OpenAI's transcription API on the key the images
// and the story already use (on a device world, the one saved in the app),
// with the transcription model picked in Admin > Speech. No campaign in
// play, so only the server-wide sources count.
export function openAiSpeechConfig(): { baseUrl: string; apiKey: string; model: string } {
  const { baseUrl, apiKey } = resolveConfig();
  return { baseUrl, apiKey, model: configValue(getGlobalConfig().speech.sttOpenaiModel, "STT_OPENAI_MODEL") };
}

// Whether picking the "openai" backend can actually produce anything: a key
// and a model, the admin's pick or OPENAI_IMAGE_MODEL, since none is named
// in code and generateOpenAiImage refuses without one. Every readiness
// check asks this (the enqueue gates, /api/capabilities, the campaign's
// imagesReady, the stranded-campaign rescue), so a backend selected without
// either degrades to "request recorded" like the FLUX backends do, instead
// of promising pictures that all fail.
export function openAiImagesConfigured(story?: TextBackendKey): boolean {
  const config = resolveConfig(story);
  return config.apiKey !== "" && config.model !== "";
}

// A key with no model: the one gap an admin closes by picking from the
// server's list, so the panels say that rather than "no key".
export function openAiImagesNeedModel(story?: TextBackendKey): boolean {
  const config = resolveConfig(story);
  return config.apiKey !== "" && config.model === "";
}

// The sizes a server listed for a model when it refused one, kept for the
// life of the process (src/lib/openai-image-size-logic.ts), so the refusal
// is paid once per model, not on every picture.
const learnedSizes = new Map<string, ImageSize[]>();

function sizeFor(aspect: AspectPreset, sizesKey: string): ImageSize | null {
  const listed = learnedSizes.get(sizesKey);
  return listed ? pickImageSize(aspect, listed) : FIRST_SIZES[aspect];
}


export async function generateOpenAiImage(
  options: {
    prompt: string;
    mode: ImageMode;
    aspect: AspectPreset;
    hasReferences?: boolean;
  },
  story?: TextBackendKey,
): Promise<GeneratedImage> {
  const { baseUrl, model, apiKey } = resolveConfig(story);
  if (!apiKey) {
    throw new Error(
      "The OpenAI image backend has no API key. Add one in Admin > Image generation, or point this story's Text Model at OpenAI so its key covers pictures too.",
    );
  }
  if (!model) {
    throw new Error("The OpenAI image backend has no model picked. Choose one from the server's list in Admin > Image generation.");
  }

  const startedAt = Date.now();
  const sizesKey = `${baseUrl}::${model}`;
  let chosen = sizeFor(options.aspect, sizesKey);
  if (!chosen) {
    throw new Error(`OpenAI image generation failed: ${model} offers no ${options.aspect} or square size.`);
  }
  const body: Record<string, unknown> = {
    model,
    prompt: options.prompt,
    size: chosen.size,
    n: 1,
    // The app's fast/slow dial maps onto the quality tiers; "high" is
    // several times the price of "medium", which is exactly what the slow
    // switch is for.
    quality: options.mode === "slow" ? "high" : "medium",
    // WebP straight from the API, a fifth the bytes of the PNG it defaults
    // to. A compatible proxy that rejects the fields gets one more try
    // without (below).
    output_format: "webp",
    output_compression: 85,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  let payload: {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string; param?: string; metadata?: { provider_name?: string } };
  };
  const post = async (request: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const answer = (await response.json().catch(() => ({}))) as typeof payload;
    return { ok: response.ok, status: response.status, answer, request };
  };
  // Whether a refusal names a body field, in its words or its `param`.
  const refused = (answer: typeof payload, field: RegExp) => field.test(answer.error?.message ?? "") || field.test(answer.error?.param ?? "");
  try {
    let result = await post(body);
    if (!result.ok && "output_format" in body && refused(result.answer, /output_(format|compression)/i)) {
      // The PNG path, for an endpoint that does not know the WebP fields.
      const plain = { ...body };
      delete plain.output_format;
      delete plain.output_compression;
      result = await post(plain);
    }
    // A model that takes other quality tiers than these (a dall-e model
    // behind a compatible proxy answers "standard" and "hd") is asked once
    // more without the field, at its own default.
    if (!result.ok && "quality" in result.request && refused(result.answer, /\bquality\b/i)) {
      const plain = { ...result.request };
      delete plain.quality;
      result = await post(plain);
    }
    // A refused size names the sizes the model takes: one is picked from
    // that list for this shape, remembered, and asked for once more, without
    // whatever the tries above dropped.
    const listed = result.ok ? null : readSupportedSizes(result.answer.error?.message ?? "");
    if (listed) {
      learnedSizes.set(sizesKey, listed);
      const picked = pickImageSize(options.aspect, listed);
      if (picked && picked.size !== chosen.size) {
        chosen = picked;
        result = await post({ ...result.request, size: picked.size });
      }
    }
    // A refusal that names no field and lists no sizes (Google behind
    // OpenRouter answers a size its model does not take with "Request
    // contains an invalid argument.", recorded 2026-10-16) is asked once
    // more at the square size, the one that model took. A square that
    // paints is remembered as the one size the model takes, so later
    // pictures skip the refused shape; a square refused too leaves the first
    // answer to be reported.
    if (!result.ok && result.status === 400 && !listed && !result.answer.error?.param && !learnedSizes.has(sizesKey) && chosen.width !== chosen.height) {
      const square = FIRST_SIZES.square;
      const retried = await post({ ...result.request, size: square.size });
      if (retried.ok) {
        learnedSizes.set(sizesKey, [square]);
        chosen = square;
        result = retried;
      }
    }
    payload = result.answer;
    if (!result.ok) {
      // The upstream message names the real problem (bad key, no billing,
      // moderation refusal) far better than a status code would. A router
      // passing on another provider's refusal says whose it was.
      const detail = payload.error?.message || `the API answered ${result.status}`;
      const provider = payload.error?.metadata?.provider_name;
      throw new Error(`OpenAI image generation failed${provider ? ` (${provider} refused the request)` : ""}: ${detail}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI image generation timed out.");
    }
    if (error instanceof Error && error.message.startsWith("OpenAI image")) {
      throw error;
    }
    throw new Error(`Could not reach the OpenAI image API at ${baseUrl}.`);
  } finally {
    clearTimeout(timer);
  }

  const entry = payload.data?.[0];
  let bytes: Buffer | null = entry?.b64_json ? Buffer.from(entry.b64_json, "base64") : null;
  if (!bytes && entry?.url) {
    bytes = await downloadPicture(entry.url);
  }
  if (!bytes?.length) {
    throw new Error("The OpenAI image API finished without returning an image.");
  }
  // Whatever came back is about to be saved where every table can load it,
  // so it has to be a picture: an endpoint that answers with a web page or
  // another file gets an error, not a place in public/generated.
  if (!sniffImage(bytes)) {
    throw new Error("The OpenAI image API returned something that is not a PNG, JPEG or WebP picture.");
  }

  const generatedDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "generated");
  mkdirSync(generatedDir, { recursive: true });
  // Named by what came back, not what was asked for: a proxy may answer
  // a WebP request with PNG, and the file must open under its own name.
  const extension = sniffImage(bytes)?.ext ?? "png";
  const filename = `${[Date.now(), "openai", asciiSlugOf(options.prompt).slice(0, 50)].filter((part) => part !== "").join("-")}.${extension}`;
  const saved = path.join(/*turbopackIgnore: true*/ generatedDir, filename);
  writeFileSync(saved, bytes);
  scheduleImageVariants(saved);

  recordMediaFile(`/generated/${filename}`);
  return {
    id: crypto.randomUUID(),
    url: `/generated/${filename}`,
    prompt: options.prompt,
    mode: options.mode,
    backend: "openai",
    aspect: options.aspect,
    width: chosen.width,
    height: chosen.height,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    warnings: options.hasReferences
      ? ["Character reference images are not used by the OpenAI backend."]
      : undefined,
  };
}

// Far past any picture these models return (a 1536px PNG is a few MB), and
// small enough that an endpoint cannot fill the server's memory or disk
// through the address it hands back.
const MAX_PICTURE_BYTES = 32 * 1024 * 1024;

// The picture behind the address an endpoint answered with (some compatible
// proxies answer that way), read under a ceiling instead of buffered
// whole. Where the address points is the endpoint's business: the admin
// chose the backend, and it may live anywhere they can reach.
async function downloadPicture(url: string): Promise<Buffer | null> {
  const download = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!download.ok || !download.body) {
    return null;
  }
  const tooLarge = new Error("The OpenAI image API pointed at a file too large to be a picture.");
  if (Number(download.headers.get("content-length") ?? 0) > MAX_PICTURE_BYTES) {
    await download.body.cancel();
    throw tooLarge;
  }
  const reader = download.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_PICTURE_BYTES) {
      await reader.cancel();
      throw tooLarge;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
