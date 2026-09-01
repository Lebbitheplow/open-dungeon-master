import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import { serverEnv } from "@/lib/server-env";
import type { AspectPreset, GeneratedImage, ImageMode } from "@/lib/types";

// OpenAI Images backend: the paid escape hatch for a server (or an app-only
// host) whose hardware cannot run a local image model. The key is the server
// owner's, lives in the admin config or the environment, and every request
// originates server-side, so campaign members never see it.
//
// The base URL is configurable for OpenAI-compatible image proxies, but the
// defaults are api.openai.com and gpt-image-1.

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-1";
const GENERATE_TIMEOUT_MS = 4 * 60 * 1000;

function resolveConfig() {
  const images = getGlobalConfig().images;
  return {
    baseUrl: configValue(images.openaiBaseUrl, "OPENAI_IMAGE_BASE_URL", DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    ),
    model: configValue(images.openaiModel, "OPENAI_IMAGE_MODEL", DEFAULT_MODEL),
    // OPENAI_API_KEY as the last fallback because it is the name every other
    // tool trains people to set.
    apiKey:
      images.openaiApiKey.trim() ||
      serverEnv("OPENAI_IMAGE_API_KEY") ||
      serverEnv("OPENAI_API_KEY"),
  };
}

// Whether picking the "openai" backend can actually produce anything. The
// dispatcher checks this before enqueueing, so a backend selected without a
// key degrades to "request recorded" like the FLUX backends do.
export function openAiImagesConfigured(): boolean {
  return resolveConfig().apiKey !== "";
}

// gpt-image-1 sizes; dall-e-3 uses its own pair for the non-square shapes.
function sizeFor(model: string, aspect: AspectPreset): { size: string; width: number; height: number } {
  const dalle = model.startsWith("dall-e");
  if (aspect === "portrait") {
    return dalle
      ? { size: "1024x1792", width: 1024, height: 1792 }
      : { size: "1024x1536", width: 1024, height: 1536 };
  }
  if (aspect === "landscape") {
    return dalle
      ? { size: "1792x1024", width: 1792, height: 1024 }
      : { size: "1536x1024", width: 1536, height: 1024 };
  }
  return { size: "1024x1024", width: 1024, height: 1024 };
}

function promptSlug(prompt: string) {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "image"
  );
}

export async function generateOpenAiImage(options: {
  prompt: string;
  mode: ImageMode;
  aspect: AspectPreset;
  hasReferences?: boolean;
}): Promise<GeneratedImage> {
  const { baseUrl, model, apiKey } = resolveConfig();
  if (!apiKey) {
    throw new Error(
      "The OpenAI image backend has no API key. Add one in Admin > Image generation.",
    );
  }

  const startedAt = Date.now();
  const { size, width, height } = sizeFor(model, options.aspect);
  const body: Record<string, unknown> = { model, prompt: options.prompt, size, n: 1 };
  if (model.startsWith("dall-e")) {
    // dall-e-3 defaults to returning a URL and its own quality names.
    body.response_format = "b64_json";
    body.quality = options.mode === "slow" ? "hd" : "standard";
  } else {
    // The app's fast/slow dial maps onto gpt-image quality tiers; "high" is
    // several times the price of "medium", which is exactly what the slow
    // switch is for.
    body.quality = options.mode === "slow" ? "high" : "medium";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  let payload: {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    payload = (await response.json().catch(() => ({}))) as typeof payload;
    if (!response.ok) {
      // The upstream message names the real problem (bad key, no billing,
      // moderation refusal) far better than a status code would.
      const detail = payload.error?.message || `the API answered ${response.status}`;
      throw new Error(`OpenAI image generation failed: ${detail}`);
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
    const download = await fetch(entry.url, { signal: AbortSignal.timeout(60_000) });
    if (download.ok) {
      bytes = Buffer.from(await download.arrayBuffer());
    }
  }
  if (!bytes?.length) {
    throw new Error("The OpenAI image API finished without returning an image.");
  }

  const generatedDir = path.join(process.cwd(), "public", "generated");
  mkdirSync(generatedDir, { recursive: true });
  const filename = `${Date.now()}-openai-${promptSlug(options.prompt)}.png`;
  writeFileSync(path.join(generatedDir, filename), bytes);

  return {
    id: crypto.randomUUID(),
    url: `/generated/${filename}`,
    prompt: options.prompt,
    mode: options.mode,
    backend: "openai",
    aspect: options.aspect,
    width,
    height,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    warnings: options.hasReferences
      ? ["Character reference images are not used by the OpenAI backend."]
      : undefined,
  };
}
