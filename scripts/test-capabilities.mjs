// Capability gating: what counts as a configured backend, where the liveness
// probes go, and how long a probe result may be reused.
//
// These decisions feed /api/capabilities, which the campaign creator trusts
// to decide whether an AI DM can exist at all. Getting "configured" wrong in
// either direction is bad: too strict hides a working backend, too loose
// recreates the bug where every new campaign failed on its first turn.
//
// src/lib/capabilities.ts reads the DB config through app-config, so the pure
// helpers are re-implemented here the way the other suites do it, and the
// source is checked to make sure the two have not drifted.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src/lib/capabilities.ts"), "utf8");

const PROBE_CACHE_MS = 30_000;

function probeCacheFresh(probedAt, now) {
  return now - probedAt < PROBE_CACHE_MS;
}

// Mirrors storyConfigured in src/lib/capabilities.ts.
function storyConfigured({ textProvider, localTextModel = "", customBaseUrl = "", customModel = "" }) {
  if (textProvider === "none") {
    return false;
  }
  if (textProvider === "local") {
    return Boolean(localTextModel.trim());
  }
  return Boolean(customBaseUrl.trim() && customModel.trim());
}

function utilityConfigured({ utilityModel = "" }) {
  return Boolean(utilityModel.trim());
}

// Mirrors imagesConfigured / imagesProbeUrl in src/lib/capabilities.ts.
function imagesConfigured(backend, hasOpenaiKey, explicitUrl, defaultReachable) {
  if (backend === "openai") {
    return hasOpenaiKey;
  }
  return Boolean(explicitUrl.trim()) || defaultReachable;
}

function imagesProbeUrl(backend, comfyBaseUrl, fluxWorkerUrl) {
  if (backend === "comfyui") {
    return `${comfyBaseUrl.replace(/\/+$/, "")}/system_stats`;
  }
  if (backend === "mflux-hs" || backend === "sdnq-hs") {
    return `${fluxWorkerUrl.replace(/\/+$/, "")}/health`;
  }
  return "";
}

function speechConfigured(explicitUrl, defaultReachable) {
  return Boolean(explicitUrl.trim()) || defaultReachable;
}

function storyProbeUrl({ textProvider, customBaseUrl = "" }, ollamaBaseUrl) {
  if (textProvider === "none") {
    return "";
  }
  if (textProvider === "local") {
    return `${ollamaBaseUrl.replace(/\/+$/, "")}/api/tags`;
  }
  const base = customBaseUrl.trim().replace(/\/+$/, "");
  if (!base) {
    return "";
  }
  return /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
}

function ttsProbeUrl(kokoroBaseUrl) {
  return `${kokoroBaseUrl.replace(/\/+$/, "")}/health`;
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

// "none" is the admin's positive statement that no AI DM exists. It must win
// over any leftover URL or model, or the statement means nothing.
check("provider none is never configured", () => {
  assert.equal(storyConfigured({ textProvider: "none" }), false);
  assert.equal(
    storyConfigured({
      textProvider: "none",
      customBaseUrl: "http://127.0.0.1:8001/v1",
      customModel: "qwen3.6-35b",
      localTextModel: "gemma4:31b-it-qat",
    }),
    false,
  );
});

check("a local provider needs a model name", () => {
  assert.equal(storyConfigured({ textProvider: "local", localTextModel: "gemma4:31b-it-qat" }), true);
  assert.equal(storyConfigured({ textProvider: "local", localTextModel: "" }), false);
  assert.equal(storyConfigured({ textProvider: "local", localTextModel: "   " }), false);
});

check("a custom provider needs both a URL and a model", () => {
  assert.equal(
    storyConfigured({
      textProvider: "custom",
      customBaseUrl: "http://127.0.0.1:8001/v1",
      customModel: "qwen3.6-35b",
    }),
    true,
  );
  assert.equal(
    storyConfigured({ textProvider: "custom", customBaseUrl: "", customModel: "qwen3.6-35b" }),
    false,
  );
  assert.equal(
    storyConfigured({
      textProvider: "custom",
      customBaseUrl: "http://127.0.0.1:8001/v1",
      customModel: "",
    }),
    false,
  );
});

// The shipped default (llama-server preset on :8001) counts as configured:
// whether anything is listening there is the reachable probe's question, and
// conflating the two is exactly the ambiguity "none" was added to end.
check("the shipped default is configured but not necessarily reachable", () => {
  assert.equal(
    storyConfigured({
      textProvider: "custom",
      customBaseUrl: "http://127.0.0.1:8001/v1",
      customModel: "qwen3.6-35b",
    }),
    true,
  );
});

check("an empty utility model means the utility lane is off", () => {
  assert.equal(utilityConfigured({ utilityModel: "" }), false);
  assert.equal(utilityConfigured({ utilityModel: "  " }), false);
  assert.equal(utilityConfigured({ utilityModel: "gemma4:e4b-it-qat" }), true);
});

// Self-hosted image backends resolve to a default URL even when nothing was
// configured, so only the key-gated OpenAI backend can be positively absent.
// A fresh install defaults to ComfyUI with nothing listening on :8188. That
// must read as "no image AI", or every upload-or-paint control keeps offering
// a paint button that fails, and every new character reports a failed portrait.
check("openai images need a key; self-hosted backends need a URL or a live default", () => {
  assert.equal(imagesConfigured("openai", false, "", true), false);
  assert.equal(imagesConfigured("openai", true, "", false), true);
  for (const backend of ["comfyui", "mflux-hs", "sdnq-hs"]) {
    assert.equal(imagesConfigured(backend, false, "", false), false, `${backend} bare default`);
    assert.equal(imagesConfigured(backend, false, "", true), true, `${backend} live default`);
    assert.equal(
      imagesConfigured(backend, false, "http://gpu-box:8188", false),
      true,
      `${backend} explicit URL counts even when down`,
    );
    assert.equal(imagesConfigured(backend, false, "   ", false), false, `${backend} blank URL`);
  }
});

check("the image probe hits ComfyUI's system_stats or the FLUX worker's health", () => {
  assert.equal(
    imagesProbeUrl("comfyui", "http://127.0.0.1:8188/", ""),
    "http://127.0.0.1:8188/system_stats",
  );
  assert.equal(imagesProbeUrl("mflux-hs", "", "http://127.0.0.1:7869"), "http://127.0.0.1:7869/health");
  assert.equal(imagesProbeUrl("sdnq-hs", "", "http://127.0.0.1:7869/"), "http://127.0.0.1:7869/health");
  assert.equal(imagesProbeUrl("openai", "http://127.0.0.1:8188", "http://127.0.0.1:7869"), "");
});

// The enqueue sites must ask before they promise a picture; otherwise a
// no-AI host records a failed portrait for every character it creates.
check("portrait renders are gated on imagesAvailable", () => {
  const portrait = readFileSync(path.join(root, "src/lib/portrait.ts"), "utf8");
  assert.match(portrait, /import \{ imagesAvailable \} from "@\/lib\/capabilities"/);
  assert.equal((portrait.match(/whenImagesAvailable\(/g) || []).length >= 4, true);
  assert.match(source, /export async function imagesAvailable\(\)/);
});

check("speech is configured by an explicit URL or a live default", () => {
  assert.equal(speechConfigured("http://127.0.0.1:8880", false), true);
  assert.equal(speechConfigured("", true), true);
  assert.equal(speechConfigured("", false), false);
  assert.equal(speechConfigured("   ", false), false);
});

// The story probe must accept whatever URL shape the owner pasted, the same
// forgiveness customChatEndpoint extends to /chat/completions.
check("story probe URLs land on the models listing", () => {
  assert.equal(
    storyProbeUrl({ textProvider: "custom", customBaseUrl: "http://127.0.0.1:8001/v1" }, ""),
    "http://127.0.0.1:8001/v1/models",
  );
  assert.equal(
    storyProbeUrl({ textProvider: "custom", customBaseUrl: "http://127.0.0.1:8080" }, ""),
    "http://127.0.0.1:8080/v1/models",
  );
  assert.equal(
    storyProbeUrl({ textProvider: "custom", customBaseUrl: "http://127.0.0.1:8080/" }, ""),
    "http://127.0.0.1:8080/v1/models",
  );
});

check("the local provider probes Ollama's native tag list", () => {
  assert.equal(
    storyProbeUrl({ textProvider: "local" }, "http://127.0.0.1:11434"),
    "http://127.0.0.1:11434/api/tags",
  );
  assert.equal(
    storyProbeUrl({ textProvider: "local" }, "http://127.0.0.1:11434/"),
    "http://127.0.0.1:11434/api/tags",
  );
});

check("nothing is probed when there is nothing to probe", () => {
  assert.equal(storyProbeUrl({ textProvider: "none" }, "http://127.0.0.1:11434"), "");
  assert.equal(storyProbeUrl({ textProvider: "custom", customBaseUrl: "" }, ""), "");
});

check("the tts probe hits Kokoro's health endpoint", () => {
  assert.equal(ttsProbeUrl("http://127.0.0.1:8880"), "http://127.0.0.1:8880/health");
  assert.equal(ttsProbeUrl("http://127.0.0.1:8880/"), "http://127.0.0.1:8880/health");
});

// The cache window is what makes the endpoint pollable: a dead backend costs
// one timeout per window, not one per poll.
check("probe results are reused inside the cache window and not after", () => {
  const at = 1_000_000;
  assert.equal(probeCacheFresh(at, at), true);
  assert.equal(probeCacheFresh(at, at + PROBE_CACHE_MS - 1), true);
  assert.equal(probeCacheFresh(at, at + PROBE_CACHE_MS), false);
  assert.equal(probeCacheFresh(at, at + PROBE_CACHE_MS + 1), false);
});

// Drift checks: the mirrored helpers above are only trustworthy while the
// real module still makes the same decisions.
check("capabilities.ts still matches the mirrored constants", () => {
  assert.match(source, /PROBE_CACHE_MS = 30_000/);
  assert.match(source, /PROBE_TIMEOUT_MS = 2_500/);
  assert.match(source, /AbortSignal\.timeout\(PROBE_TIMEOUT_MS\)/);
  // Probe state lives on globalThis so dev HMR reloads keep the cache.
  assert.match(source, /globalThis\.__odmCapabilityProbes/);
});

check("the DM path refuses plainly when the provider is none", () => {
  const modelClient = readFileSync(path.join(root, "src/lib/model-client.ts"), "utf8");
  assert.match(modelClient, /This world has no AI storyteller configured\./);
  // Under "none" the 8001 default must not reappear as a fallback, or "no AI"
  // becomes indistinguishable from "configured but down" again.
  const runtimeDefaults = readFileSync(path.join(root, "src/lib/runtime-defaults.ts"), "utf8");
  assert.match(runtimeDefaults, /textProvider === "none" \? ""/);
});

check("the admin config accepts the none provider", () => {
  const globalConfig = readFileSync(path.join(root, "src/lib/schemas/global-config.ts"), "utf8");
  assert.match(globalConfig, /z\.enum\(\["", "local", "custom", "none"\]\)/);
  const adminRoute = readFileSync(path.join(root, "src/app/api/admin/settings/route.ts"), "utf8");
  assert.match(adminRoute, /z\.enum\(\["", "local", "custom", "none"\]\)/);
});

if (failures) {
  console.error(`\n${failures} capability check(s) failed.`);
  process.exit(1);
}
console.log("capability checks passed.");
