import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

const { loadSetupComfyModels, PicturesStep } = await import("../src/app/setup/MediaSteps.tsx");

test("a changed address stops showing models from the opening scan while the new address is checked", () => {
  const html = renderToStaticMarkup(React.createElement(PicturesStep, {
    draft: { pictures: "comfyui", comfy: { url: "http://localhost:8288", checkpoint: "old.safetensors", preset: "checkpoint" } },
    update: () => {},
    scan: { comfyui: { url: "http://127.0.0.1:8188", checkpoints: ["old.safetensors"], models: [], hardware: null } },
    scanning: false,
    storyIsOpenAi: false,
    agentPaints: false,
    agentVerified: false,
    agentLabel: "",
    onAgentVerified: () => {},
    openaiKeySaved: false,
  }));
  assert.match(html, /Checking installed models/);
  assert.doesNotMatch(html, /old\.safetensors/);
});

test("setup lists models from the entered ComfyUI address and keeps the matching opening scan", async () => {
  const scan = { url: "http://127.0.0.1:8188", checkpoints: ["old.safetensors"], models: [], hardware: null };
  const zTurbo = {
    id: "z_turbo", files: { unet: "z_image_turbo.safetensors", clip: "qwen_3_4b.safetensors", vae: "ae.safetensors" },
    missing: [], downloadGb: 0, verified: null, needGb: null, fits: null,
  };
  const strix = { id: "strix-halo", label: "AMD Strix Halo" };
  const requests = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    requests.push({ url, init });
    const address = JSON.parse(init.body).url;
    return Response.json(address.endsWith(":8288")
      ? { ok: true, checkpoints: ["new.safetensors"], models: [zTurbo, { id: 7 }], hardware: strix, device: null }
      : { ok: false, error: "Could not reach ComfyUI.", checkpoints: [], models: [] });
  });

  try {
    const signal = new AbortController().signal;
    assert.deepEqual(await loadSetupComfyModels("http://127.0.0.1:8188/", scan, signal), {
      ...scan, url: "http://127.0.0.1:8188/", error: null,
    });
    assert.equal(requests.length, 0, "the unchanged address keeps the opening scan");

    assert.deepEqual(await loadSetupComfyModels("http://localhost:8288", scan, signal), {
      url: "http://localhost:8288", checkpoints: ["new.safetensors"], models: [zTurbo], hardware: strix, error: null,
    });
    assert.deepEqual(requests.map(({ url, init }) => [url, init.method, JSON.parse(init.body).url, init.signal]), [
      ["/api/comfy", "POST", "http://localhost:8288", signal],
    ]);

    assert.deepEqual(await loadSetupComfyModels("http://localhost:8388", scan, signal), {
      url: "http://localhost:8388", checkpoints: [], models: [], hardware: null, error: "Could not reach ComfyUI.",
    });
  } finally {
    fetchSpy.mockRestore();
  }
});
