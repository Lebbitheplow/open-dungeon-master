// The model registry (src/lib/model-registry): the catalog read from
// models.dev, cached beside the database and refreshed in the background;
// which catalog row a configured id is; what the table needs of a model;
// the live listings from Ollama and an OpenAI-compatible server; the merge
// of listing, catalog and test results that keeps a chosen model on the
// list; and the settings paths that once rejected any Ollama tag but the
// documented ones.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-model-registry-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.HARNESS_FAKE = "";

register("./lib/register-alias.mjs", import.meta.url);

const logic = await import("../src/lib/model-registry/catalog-logic.ts");
const store = await import("../src/lib/model-registry/catalog.ts");
const readers = await import("../src/lib/model-registry/discovery-logic.ts");
const probes = await import("../src/lib/model-registry/probes.ts");
const blanks = await import("../src/app/admin/model-blanks.ts");
const { modelChoices } = await import("../src/lib/model-registry/registry.ts");
const { forgetOllamaInfoForTests, forgetSoleModelsForTests, soleListedModel } = await import("../src/lib/model-registry/discovery.ts");
const hardware = await import("../src/lib/model-registry/hardware.ts");
const textModels = await import("../src/lib/text-models.ts");
const { normalizeSettings } = await import("../src/lib/db/settings.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { storyContextTokens, localContextTokens } = await import("../src/lib/model-client.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// A models.dev answer, in its own shape, small enough to read by eye.
const MODELS_DEV = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-5.6": {
        id: "gpt-5.6",
        name: "GPT-5.6",
        family: "gpt-sol",
        tool_call: true,
        reasoning: true,
        structured_output: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_050_000, output: 128_000 },
        cost: { input: 4, output: 20 },
        release_date: "2026-07-09",
      },
      "gpt-4": { id: "gpt-4", name: "GPT-4", tool_call: true, status: "deprecated", modalities: { input: ["text"], output: ["text"] }, limit: { context: 8192 } },
      "gpt-image-2": { id: "gpt-image-2", name: "GPT Image 2", tool_call: false, modalities: { input: ["text", "image"], output: ["text", "image"] }, limit: { context: 0 } },
      "gpt-image-1": { id: "gpt-image-1", name: "GPT Image 1", status: "deprecated", modalities: { input: ["text"], output: ["image"] }, limit: {} },
    },
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    api: "https://openrouter.ai/api/v1",
    models: {
      "google/gemini-3.5-flash": { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 1_000_000 }, cost: { input: 0.3, output: 2.5 } },
      "sao10k/l3-lunaris-8b": { id: "sao10k/l3-lunaris-8b", name: "Lunaris", tool_call: false, modalities: { input: ["text"], output: ["text"] }, limit: { context: 8192 } },
    },
  },
  deepinfra: {
    id: "deepinfra",
    name: "DeepInfra",
    api: "https://api.deepinfra.com/v1/openai",
    models: {
      "google/gemma-4-31B-it": { id: "google/gemma-4-31B-it", name: "Gemma 4 31B", tool_call: true, open_weights: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 262_144 } },
      "Qwen/Qwen3.6-35B-A3B": { id: "Qwen/Qwen3.6-35B-A3B", name: "Qwen3.6 35B A3B", tool_call: true, open_weights: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 262_144 } },
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-opus-5-5": { id: "claude-opus-5-5", name: "Claude Opus 5.5", tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 1_000_000 }, cost: { input: 5, output: 25 } },
      "claude-opus-4-5": { id: "claude-opus-4-5", name: "Claude Opus 4.5", tool_call: true, status: "deprecated", modalities: { input: ["text"], output: ["text"] }, limit: { context: 200_000 }, cost: { input: 5, output: 25 } },
      "claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5", tool_call: true, reasoning: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 1_000_000 }, cost: { input: 2, output: 10 }, release_date: "2026-05-01" },
    },
  },
  // Things that are not providers or models at all.
  __proto__: { models: { polluted: { id: "polluted" } } },
  junk: "not a provider",
  empty: { models: 42 },
};

const providers = logic.readCatalogProviders(MODELS_DEV);

try {
  await test("models.dev's shape is read field by field, and junk is left out", () => {
    assert.deepEqual(Object.keys(providers).sort(), ["anthropic", "deepinfra", "openai", "openrouter"]);
    assert.equal(logic.catalogModelCount(providers), 11);
    const gpt = providers.openai.models["gpt-5.6"];
    assert.equal(gpt.contextTokens, 1_050_000);
    assert.equal(gpt.toolCall, true);
    assert.equal(gpt.reasoning, true);
    assert.deepEqual(gpt.input, ["text", "image"]);
    assert.deepEqual(gpt.cost, { input: 4, output: 20 });
    assert.equal(gpt.released, "2026-07-09");
    assert.equal(providers.openai.models["gpt-4"].status, "deprecated");
    assert.equal(providers.openai.models["gpt-image-1"].cost, null);
    assert.equal(Object.prototype.hasOwnProperty.call(providers, "__proto__"), false);
    assert.equal("polluted" in ({}), false, "nothing reached Object.prototype");
    // The compact shape this module writes reads back to the same rows.
    const again = logic.readStoredCatalog(JSON.parse(JSON.stringify({ fetchedAt: "2026-10-12T00:00:00.000Z", providers })));
    assert.deepEqual(again.providers, providers);
    assert.equal(again.fetchedAt, "2026-10-12T00:00:00.000Z");
    assert.equal(logic.readStoredCatalog({ providers: {} }), null);
    assert.equal(logic.readStoredCatalog("nope"), null);
  });

  await test("a base URL names its provider; a private address names none", () => {
    assert.equal(logic.providerForBaseUrl("https://api.openai.com/v1"), "openai");
    assert.equal(logic.providerForBaseUrl("https://openrouter.ai/api/v1"), "openrouter");
    assert.equal(logic.providerForBaseUrl("https://api.deepinfra.com/v1/openai", providers), "deepinfra");
    assert.equal(logic.providerForBaseUrl("http://127.0.0.1:8001/v1", providers), "");
    assert.equal(logic.providerForBaseUrl("http://box:1234/v1", providers), "");
    assert.equal(logic.providerForBaseUrl("", providers), "");
  });

  await test("a configured id finds its row: exactly, by tail, or loosely across providers", () => {
    assert.equal(logic.findCatalogModel(providers, "gpt-5.6", "openai")?.name, "GPT-5.6");
    assert.equal(logic.findCatalogModel(providers, "GPT-5.6")?.provider, "openai", "case does not matter");
    assert.equal(logic.findCatalogModel(providers, "ft:gpt-5.6:acme::abc")?.id, "gpt-5.6", "a fine-tune is its base");
    assert.equal(logic.findCatalogModel(providers, "google/gemini-3.5-flash", "openrouter")?.contextTokens, 1_000_000);
    assert.equal(logic.findCatalogModel(providers, "gemini-3.5-flash")?.provider, "openrouter", "the tail of a vendor/model id");
    assert.equal(logic.findCatalogModel(providers, "gemma4:31b-it-qat")?.id, "google/gemma-4-31B-it", "an Ollama tag finds the same weights");
    assert.equal(logic.findCatalogModel(providers, "qwen3.6:35b-a3b-q8_0")?.id, "Qwen/Qwen3.6-35B-A3B", "a quantised GGUF too");
    assert.equal(logic.findCatalogModel(providers, "Qwen3.6-35B-A3B-Q4_K_M.gguf")?.id, "Qwen/Qwen3.6-35B-A3B");
    assert.equal(logic.findCatalogModel(providers, "qwen3.6-35b")?.id, "Qwen/Qwen3.6-35B-A3B", "a served alias that is the catalog name cut short");
    assert.equal(logic.findCatalogModel(providers, "gemma4-31b")?.id, "google/gemma-4-31B-it");
    assert.equal(logic.findCatalogModel(providers, "gemma"), null, "a bare family names no size");
    assert.equal(logic.findCatalogModel(providers, "my-own-finetune"), null, "an unknown id is allowed, just unknown");
    assert.equal(logic.findCatalogModel(providers, ""), null);
    assert.equal(logic.looseModelKey("gemma4:31b-it-qat"), logic.looseModelKey("google/gemma-4-31B-it"));
  });

  await test("the table's needs: text out and tool calls for the story, pictures out for images", () => {
    const story = (id, hint) => logic.assessModel({ role: "story", id, catalog: logic.findCatalogModel(providers, id, hint), listed: true });
    assert.equal(story("gpt-5.6", "openai").fit, "ok");
    assert.match(story("gpt-5.6", "openai").summary, /1\.1M context · tool calls · reasoning · sees pictures · \$4 in \/ \$20 out per M tokens/);
    const old = story("gpt-4", "openai");
    assert.equal(old.fit, "unfit", "an 8K window cannot hold the DM's instructions");
    assert.match(old.warnings[0], /Deprecated/);
    assert.match(old.warnings[1], /8K window is too small to narrate.*16K tokens to narrate and 24K to run fights/);
    const picture = story("gpt-image-1", "openai");
    assert.equal(picture.fit, "unfit");
    assert.match(picture.warnings.join(" "), /Does not write text/);
    const noTools = story("sao10k/l3-lunaris-8b", "openrouter");
    assert.equal(noTools.fit, "unfit");
    assert.match(noTools.warnings[0], /Takes no tool calls/);
    const utility = logic.assessModel({ role: "utility", id: "sao10k/l3-lunaris-8b", catalog: providers.openrouter.models["sao10k/l3-lunaris-8b"], listed: true });
    assert.equal(utility.fit, "warn", "the utility role only warns about tools");
    const local = logic.assessModel({ role: "story", id: "gpt-4", catalog: providers.openai.models["gpt-4"], listed: true, local: true });
    assert.equal(local.fit, "warn", "a local row is a loose match for the weights, so a short window only warns");
    assert.equal(local.warnings.length, 1, "weights on the admin's disk are nobody's to retire");
    assert.match(local.warnings[0], /^An 8K window is too small to narrate/);
    assert.equal(local.summary, "8K context · tool calls", "and carry no hosting price");
    const doubt = logic.assessModel({ role: "story", id: "x", catalog: providers.openrouter.models["sao10k/l3-lunaris-8b"], listed: true, local: true });
    assert.equal(doubt.fit, "warn", "a loosely matched row without tools is a doubt for local weights");
    const said = logic.assessModel({ role: "story", id: "x", catalog: providers.openrouter.models["sao10k/l3-lunaris-8b"], listed: true, local: true, tools: true });
    assert.equal(said.warnings.some((line) => /tool calls/.test(line)), false, "unless the server says it does (the 8K window still warns)");
    assert.equal(logic.assessModel({ role: "story", id: "x", catalog: providers.openai.models["gpt-5.6"], listed: true, tools: false }).fit, "unfit", "and the server's no outranks the catalog's yes");
    const unknown = logic.assessModel({ role: "story", id: "my-own-finetune", catalog: null, listed: true });
    assert.equal(unknown.fit, "unknown");
    assert.deepEqual(unknown.warnings, []);
    const unlisted = logic.assessModel({ role: "story", id: "gpt-5.6", catalog: providers.openai.models["gpt-5.6"], listed: false });
    assert.equal(unlisted.fit, "warn");
    assert.match(unlisted.warnings[0], /Not listed by the server/);
    const image = (id) => logic.assessModel({ role: "image", id, catalog: logic.findCatalogModel(providers, id, "openai"), listed: null });
    assert.equal(image("gpt-image-2").fit, "ok");
    assert.equal(image("gpt-5.6").fit, "unfit");
    assert.equal(image("gpt-image-1").fit, "warn", "deprecated, but it paints");
    assert.equal(image("flux-dev-local").fit, "unknown", "the name says it paints");
    assert.equal(image("whatever").fit, "warn");
  });

  // ---- the store: snapshot, cache file, refresh, offline ----

  const catalogFile = path.join(dir, "model-catalog.json");
  assert.equal(store.catalogPath(), catalogFile, "the cache sits beside the database");

  const realFetch = globalThis.fetch;
  let answers = [];
  let asked = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === store.MODELS_DEV_URL) {
      asked += 1;
      const next = answers.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "number") return new Response("no", { status: next });
      return new Response(JSON.stringify(next ?? {}), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, init);
  };

  // A live answer big enough to be believed.
  const bigAnswer = () => {
    const out = JSON.parse(JSON.stringify(MODELS_DEV));
    out.filler = { id: "filler", name: "Filler", models: {} };
    for (let i = 0; i < store.MIN_LIVE_MODELS; i += 1) {
      out.filler.models[`filler-${i}`] = { id: `filler-${i}`, tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 4096 } };
    }
    return out;
  };

  await test("with no cache and no network the bundled snapshot serves, and a refresh is scheduled once", async () => {
    store.resetModelCatalogForTests();
    answers = [new Error("offline")];
    const held = store.modelCatalog();
    assert.equal(held.source, "snapshot");
    assert.ok(logic.catalogModelCount(held.providers) > 300, "the snapshot carries the providers ODM reaches");
    assert.ok(held.providers.openai && held.providers.openrouter && held.providers.anthropic);
    assert.ok(logic.findCatalogModel(held.providers, "claude-fable-5-1", "anthropic"), "the snapshot knows this model");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(asked, 1, "the stale snapshot asked models.dev once");
    store.modelCatalog();
    store.modelCatalog();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(asked, 1, "a failed ask is not repeated on the next reads");
    assert.equal(store.catalogStatus().source, "snapshot");
    assert.match(store.catalogStatus().error, /offline/);
    assert.equal(fs.existsSync(catalogFile), false, "nothing was written");
  });

  await test("a refresh fetches models.dev, writes the cache file, and the rows take over", async () => {
    answers = [bigAnswer()];
    const result = await store.refreshModelCatalog();
    assert.equal(result.ok, true, result.error);
    assert.equal(result.catalog.source, "live");
    assert.ok(fs.existsSync(catalogFile));
    const written = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    assert.ok(written.fetchedAt && written.providers.openai.models["gpt-5.6"]);
    assert.equal(Object.keys(written).sort().join(","), "fetchedAt,providers", "the cache holds the catalog and nothing else");
    assert.equal(store.modelCatalog().source, "live");
    assert.equal(logic.catalogModelCount(store.modelCatalog().providers), 11 + store.MIN_LIVE_MODELS);
    assert.equal(store.catalogStatus().error, "");
  });

  await test("a fresh process reads the cache and does not ask again until it is a day old", async () => {
    store.resetModelCatalogForTests();
    const before = asked;
    const held = store.modelCatalog();
    assert.equal(held.source, "cache");
    assert.equal(logic.findCatalogModel(held.providers, "gpt-5.6", "openai")?.contextTokens, 1_050_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(asked, before, "a fresh cache is not refreshed");
    assert.equal(store.catalogStale({ source: "cache", fetchedAt: new Date(Date.now() - 2 * store.CATALOG_REFRESH_MS).toISOString() }), true);
    assert.equal(store.catalogStale({ source: "cache", fetchedAt: new Date().toISOString() }), false);
    assert.equal(store.catalogStale({ source: "snapshot", fetchedAt: "2099-01-01" }), true, "the snapshot is always worth refreshing");
  });

  await test("a broken, short or oversized live answer never replaces the catalog held", async () => {
    const held = store.modelCatalog();
    answers = [{ openai: { models: { only: { id: "only" } } } }];
    let result = await store.refreshModelCatalog();
    assert.equal(result.ok, false);
    assert.match(result.error, /listed only 1 models/);
    assert.equal(store.modelCatalog(), held);
    answers = [503];
    result = await store.refreshModelCatalog();
    assert.match(result.error, /answered 503/);
    assert.equal(store.modelCatalog(), held);
    const written = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    assert.ok(written.providers.openai.models["gpt-5.6"], "the cache file kept the good copy");
  });

  await test("a corrupt cache file is ignored for the snapshot, and ODM_MODEL_CATALOG=off never asks", async () => {
    fs.writeFileSync(catalogFile, "{ not json");
    store.resetModelCatalogForTests();
    process.env.ODM_MODEL_CATALOG = "off";
    const before = asked;
    assert.equal(store.modelCatalog().source, "snapshot");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(asked, before);
    assert.equal(store.catalogStatus().refreshEnabled, false);
    delete process.env.ODM_MODEL_CATALOG;
    fs.unlinkSync(catalogFile);
    store.resetModelCatalogForTests();
    answers = [];
  });

  await test("two refreshes at once are one fetch", async () => {
    answers = [bigAnswer()];
    const before = asked;
    const [a, b] = await Promise.all([store.refreshModelCatalog(), store.refreshModelCatalog()]);
    assert.equal(asked, before + 1);
    assert.equal(a.ok && b.ok, true);
  });

  // ---- the readers for live listings ----

  const OLLAMA_TAGS = {
    models: [
      { name: "gemma4:31b-it-qat", size: 19.2 * 1024 ** 3, details: { family: "gemma4", parameter_size: "31B", quantization_level: "Q4_0" }, modified_at: "2026-10-01T00:00:00Z" },
      { name: "qwen3.6:35b-a3b-q8_0", size: 37 * 1024 ** 3, details: { family: "qwen3", parameter_size: "35B", quantization_level: "Q8_0" } },
      { name: "nomic-embed-text:latest", size: 0.27 * 1024 ** 3, details: { family: "nomic-bert" } },
      { name: "titan:999b", size: 999 * 1024 ** 3, details: { family: "titan", parameter_size: "999B", quantization_level: "Q4_0" } },
      { name: "gemma4:31b-it-qat", size: 1 },
      { nope: true },
    ],
  };
  const OLLAMA_SHOW = {
    capabilities: ["completion", "tools", "thinking"],
    model_info: { "general.architecture": "gemma4", "gemma4.context_length": 262144, "gemma4.embedding_length": 5376 },
  };

  await test("Ollama's tags and show answers are read, and embedding models are kept off the list", () => {
    const tags = readers.readOllamaTags(OLLAMA_TAGS);
    assert.deepEqual(tags.map((model) => model.id), ["gemma4:31b-it-qat", "qwen3.6:35b-a3b-q8_0", "nomic-embed-text:latest", "titan:999b"]);
    assert.equal(tags[0].sizeGb, 19.2);
    assert.equal(tags[0].quantization, "Q4_0");
    assert.equal(readers.isOllamaChatModel(tags[2]), false);
    assert.equal(readers.isOllamaChatModel(tags[0]), true);
    const info = readers.readOllamaShow(OLLAMA_SHOW);
    assert.equal(info.contextTokens, 262144);
    assert.deepEqual(info.capabilities, ["completion", "tools", "thinking"]);
    assert.equal(readers.isOllamaChatModel(tags[0], { contextTokens: 0, capabilities: ["embedding"] }), false);
    assert.deepEqual(readers.readOllamaTags(null), []);
    assert.equal(readers.readOllamaShow("x"), null);
  });

  await test("an images API's list keeps the picture models: the catalog's word first, then the name", () => {
    const paints = (id) => (id === "gpt-image-2" ? true : id === "gpt-5.6" ? false : null);
    const list = readers.readImageModelList({ data: [{ id: "gpt-5.6" }, { id: "gpt-image-2" }, { id: "dall-e-3" }, { id: "whisper-1" }, { id: "gpt-image-2" }] }, paints, logic.isImageModelId);
    assert.deepEqual(list, ["gpt-image-2", "dall-e-3"]);
  });

  // ---- live listings against real HTTP servers ----

  const ollama = http.createServer((request, response) => {
    if (request.url === "/api/tags") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(OLLAMA_TAGS));
      return;
    }
    if (request.url === "/api/show" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        // The Qwen build was made without tool calls; Ollama says so.
        const { model } = JSON.parse(body);
        response.end(
          JSON.stringify(
            model.startsWith("gemma4")
              ? OLLAMA_SHOW
              : model.startsWith("nomic")
                ? { capabilities: ["embedding"], model_info: {} }
                : { capabilities: ["completion"], model_info: { "qwen3.context_length": 40960 } },
          ),
        );
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  const ollamaUrl = `http://127.0.0.1:${ollama.address().port}`;

  const compat = http.createServer((request, response) => {
    if (request.url === "/v1/models") {
      if (request.headers.authorization !== "Bearer sk-test") {
        response.statusCode = 401;
        response.end("{}");
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "gpt-5.6", owned_by: "openai" }, { id: "gpt-4", owned_by: "openai" }, { id: "gpt-image-2" }, { id: "whisper-1" }] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => compat.listen(0, "127.0.0.1", resolve));
  const compatUrl = `http://127.0.0.1:${compat.address().port}/v1`;

  await test("the local provider lists what Ollama has, with the catalog's word on each, and learns the chosen model's window", async () => {
    forgetOllamaInfoForTests();
    // A 64 GB machine with no GPU, whatever runs the test: a 16 GB CI runner
    // would find the 19 GB gemma too big, and a local ComfyUI would add a GPU.
    globalThis.__odmMachine = { ramGb: 64, gpu: null, unified: false, checkedAt: Date.now() };
    const choices = await modelChoices({ role: "story", provider: "local", baseUrl: ollamaUrl, selected: "gemma4:31b-it-qat" });
    assert.equal(choices.reachable, true);
    assert.deepEqual(choices.models.map((model) => model.id), ["gemma4:31b-it-qat", "qwen3.6:35b-a3b-q8_0", "titan:999b"]);
    assert.ok(choices.hardware && /GB memory/.test(choices.hardware.summary), "the machine is described");
    const titan = choices.models[2];
    assert.equal(titan.verdict.fit, "unfit");
    assert.match(titan.verdict.warnings.join(" "), /Too big for this machine: 999 GB of weights/);
    const gemma = choices.models[0];
    assert.equal(gemma.selected, true);
    assert.equal(gemma.listed, true);
    assert.equal(gemma.contextTokens, 262144);
    assert.equal(gemma.note, "31B · Q4_0 · 19.2 GB");
    assert.ok(gemma.catalog, "the catalog found the same weights under DeepInfra's name");
    assert.equal(gemma.verdict.fit, "ok");
    assert.equal(textModels.knownLocalContextWindow("gemma4:31b-it-qat"), 262144, "learned from Ollama's /api/show");
    const qwen = choices.models[1];
    assert.equal(qwen.catalog?.id, "Qwen/Qwen3.6-35B-A3B");
    assert.equal(qwen.contextTokens, 40960, "Ollama's own window outranks the catalog's for the same weights");
    assert.equal(qwen.verdict.fit, "unfit", "and Ollama's word on tool calls outranks the catalog's");
    assert.match(qwen.verdict.warnings[0], /by the server's own account/);
    assert.equal(textModels.knownLocalContextWindow("qwen3.6:35b-a3b-q8_0"), 40960, "learned for the prompt budget");
    assert.equal(choices.catalog.source, "live");
  });

  await test("Ollama tags match without regard to case, as Ollama itself resolves them", async () => {
    const choices = await modelChoices({ role: "story", provider: "local", baseUrl: ollamaUrl, selected: "Gemma4:31B-IT-QAT" });
    assert.equal(choices.models.length, 3, "nothing was added for the chosen model");
    assert.equal(choices.models[0].selected, true);
    assert.equal(choices.models[0].listed, true);
  });

  await test("a chosen model Ollama no longer lists stays chosen, flagged, never swapped", async () => {
    const choices = await modelChoices({ role: "story", provider: "local", baseUrl: ollamaUrl, selected: "llama9:70b" });
    assert.equal(choices.models[0].id, "llama9:70b");
    assert.equal(choices.models[0].selected, true);
    assert.equal(choices.models[0].listed, false);
    assert.match(choices.models[0].verdict.warnings[0], /Not listed by the server/);
    assert.equal(choices.models.length, 4);
  });

  await test("an unreachable Ollama still answers with the chosen model, unflagged, and says what is wrong", async () => {
    const choices = await modelChoices({ role: "story", provider: "local", baseUrl: "http://127.0.0.1:9", selected: "gemma4:31b-it-qat" });
    assert.equal(choices.reachable, false);
    assert.match(choices.error, /Nothing answered/);
    assert.equal(choices.models.length, 1);
    assert.equal(choices.models[0].id, "gemma4:31b-it-qat");
    assert.equal(choices.models[0].listed, null, "nobody could say whether it is listed");
    assert.equal(choices.models[0].verdict.fit, "ok");
  });

  await test("a custom server's list is merged with the catalog, and a key is needed where it is needed", async () => {
    const refused = await modelChoices({ role: "story", provider: "custom", baseUrl: compatUrl, apiKey: "", selected: "gpt-5.6" });
    assert.equal(refused.reachable, false);
    assert.equal(refused.needsKey, true);
    assert.equal(refused.models[0].id, "gpt-5.6");
    const choices = await modelChoices({ role: "story", provider: "custom", baseUrl: compatUrl, apiKey: "sk-test", selected: "gpt-4" });
    assert.equal(choices.reachable, true);
    assert.deepEqual(choices.models.map((model) => model.id), ["gpt-5.6", "gpt-4"], "the images and speech rows were left out");
    const old = choices.models[1];
    assert.equal(old.selected, true);
    assert.equal(old.verdict.fit, "unfit", "its 8K window cannot narrate");
    assert.match(old.verdict.warnings[0], /Deprecated/);
    assert.equal(choices.models[0].catalog?.name, "GPT-5.6", "a private address still finds the row by id");
  });

  await test("the images role lists the picture models of an OpenAI-compatible images API", async () => {
    const choices = await modelChoices({ role: "image", provider: "images", baseUrl: compatUrl, apiKey: "sk-test", selected: "gpt-image-1" });
    assert.equal(choices.reachable, true);
    assert.deepEqual(choices.models.map((model) => model.id), ["gpt-image-1", "gpt-image-2"]);
    assert.equal(choices.models[0].listed, false);
    assert.equal(choices.models[0].verdict.fit, "warn");
    assert.equal(choices.models[1].verdict.fit, "ok");
    assert.equal(choices.recommended, "gpt-image-2", "the form preselects the current picture model, not the deprecated one saved");
    const story = await modelChoices({ role: "story", provider: "custom", baseUrl: compatUrl, apiKey: "sk-test", selected: "" });
    assert.equal(story.recommended, "", "the storyteller's fields preselect nothing");
  });

  await test("every picker's blank entry says what it runs, or None with what that means", () => {
    const listing = (ids) => ({ reachable: true, models: ids.map((id) => ({ id, label: id, listed: true })) });
    assert.equal(blanks.BLANK.whisper(listing(["large-v3"])), "large-v3 (the server's only model)");
    assert.equal(blanks.BLANK.whisper(listing(["large-v3", "small"])), "None (no Whisper dictation)");
    assert.equal(blanks.BLANK.story(null), "Not chosen (the server's only model, once it answers)", "before the server answers, nobody knows");
    assert.equal(blanks.BLANK.story({ reachable: false, models: [] }), "Not chosen (the server's only model, once it answers)");
    assert.equal(blanks.BLANK.story({ reachable: true, models: [{ id: "saved", label: "saved", listed: false }, { id: "only", label: "only", listed: true }] }), "only (the server's only model)", "a saved model the server dropped is not counted");
    assert.equal(blanks.fromEnv("large-v3", "STT_MODEL"), "large-v3 (from STT_MODEL)");
    for (const [field, label] of Object.entries(blanks.BLANK)) {
      const text = typeof label === "function" ? label(listing(["a", "b"])) : label;
      assert.match(text, /^(None \(no [^()]+\)|Not chosen \([^()]+\))$/, `${field}: "${text}"`);
    }
  });

  await test("the speech roles list every model a speech server serves, and preselect only an obvious one", async () => {
    const dictation = await modelChoices({ role: "dictation", provider: "speech", baseUrl: compatUrl, apiKey: "sk-test", selected: "" });
    assert.equal(dictation.reachable, true);
    assert.deepEqual(dictation.models.map((model) => model.id), ["gpt-5.6", "gpt-4", "gpt-image-2", "whisper-1"], "nothing is left out of the list");
    assert.equal(dictation.recommended, "whisper-1");
    const narration = await modelChoices({ role: "narration", provider: "speech", baseUrl: compatUrl, apiKey: "sk-test", selected: "" });
    assert.equal(narration.recommended, "", "no model there reads as a narration model");
    assert.equal(narration.models.find((model) => model.id === "gpt-5.6")?.verdict.fit, "ok", "a speech pick is never judged as a storyteller");
    const speaches = http.createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "Systran/faster-distil-whisper-large-v3" }, { id: "speaches-ai/Kokoro-82M-v1.0-ONNX" }, { id: "hexgrad/piper-voice" }] }));
    });
    await new Promise((resolve) => speaches.listen(0, "127.0.0.1", resolve));
    const speachesUrl = `http://127.0.0.1:${speaches.address().port}/v1`;
    const whisper = await modelChoices({ role: "dictation", provider: "speech", baseUrl: speachesUrl, selected: "" });
    assert.equal(whisper.recommended, "Systran/faster-distil-whisper-large-v3");
    const voices = await modelChoices({ role: "narration", provider: "speech", baseUrl: speachesUrl, selected: "" });
    assert.equal(voices.recommended, "", "two narration models: the admin chooses");
    const loaded = http.createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "large-v3" }] }));
    });
    await new Promise((resolve) => loaded.listen(0, "127.0.0.1", resolve));
    const one = await modelChoices({ role: "dictation", provider: "speech", baseUrl: `http://127.0.0.1:${loaded.address().port}/v1`, selected: "" });
    assert.equal(one.recommended, "large-v3", "a server's only model is the pick, whatever its name");
    loaded.close();
    const down = await modelChoices({ role: "dictation", provider: "speech", baseUrl: "http://127.0.0.1:9/v1", selected: "large-v3" });
    assert.equal(down.reachable, false);
    assert.deepEqual(down.models.map((model) => model.id), ["large-v3"], "the saved model stays on the list");
    speaches.close();
  });

  const single = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(request.url === "/v1/models" ? JSON.stringify({ data: [{ id: "the-only-one", owned_by: "llamacpp" }, { id: "bge-embed" }] }) : "{}");
  });
  await new Promise((resolve) => single.listen(0, "127.0.0.1", resolve));
  const singleUrl = `http://127.0.0.1:${single.address().port}/v1`;

  await test("a blank model runs the one chat model a server lists, and nothing when it lists several or none", async () => {
    forgetSoleModelsForTests();
    assert.equal(await soleListedModel({ provider: "custom", baseUrl: singleUrl }), "the-only-one", "the embedding row does not count");
    assert.equal(await soleListedModel({ provider: "custom", baseUrl: compatUrl, apiKey: "sk-test" }), "", "two chat models: somebody has to choose");
    assert.equal(await soleListedModel({ provider: "custom", baseUrl: "http://127.0.0.1:9/v1" }), "");
    assert.equal(await soleListedModel({ provider: "local", baseUrl: ollamaUrl }), "", "three chat models on this Ollama");
    const { requestCustomMessage } = await import("../src/lib/model-client.ts");
    const refused = await requestCustomMessage(compatUrl, "", "sk-test", [{ role: "user", content: "hi" }], {});
    assert.equal(refused.error?.status, 400);
    assert.match((await refused.error.json()).error, /lists more than one/);
    // A blank model against a server that is down used to read as "lists
    // more than one"; nothing was listed, so the table hears what happened.
    const down = await requestCustomMessage("http://127.0.0.1:9/v1", "", "", [{ role: "user", content: "hi" }], {});
    assert.equal(down.error?.status, 502);
    assert.match((await down.error.json()).error, /Could not reach the backend at http:\/\/127\.0\.0\.1:9\/v1 to list its models/);
  });

  await test("the wizard's list is kept to the models that can narrate, led by the catalog's pick, with no name in code", () => {
    const listed = (ids) => ids.map((id) => ({ id, label: id }));
    const fit = store.fitListedModels("https://api.openai.com/v1", listed(["gpt-image-1", "gpt-5.6", "gpt-4", "my-finetune"]));
    assert.deepEqual(fit.map((model) => model.id), ["gpt-5.6", "my-finetune"], "the picture model and the 8K one are out; the unknown one stays");
    assert.equal(fit[0].context, 1_050_000);
    const served = store.fitListedModels("https://api.openai.com/v1", [{ id: "gpt-4", label: "gpt-4", context: 32_768 }]);
    assert.deepEqual(served.map((model) => model.id), ["gpt-4"], "a window the server reports outranks the catalog's");
    assert.equal(served[0].label, "gpt-4 (deprecated)");
    assert.equal(store.recommendListed("https://api.openai.com/v1", fit), "gpt-5.6", "current, tools, reasoning, newest");
    assert.equal(store.recommendListed("https://openrouter.ai/api/v1", listed(["sao10k/l3-lunaris-8b", "google/gemini-3.5-flash"])), "google/gemini-3.5-flash");
    assert.equal(store.recommendListed("http://127.0.0.1:8001/v1", listed(["alpha-local", "beta-local"])), "alpha-local", "nothing known: the server's order");
    assert.equal(store.recommendListed("http://127.0.0.1:8001/v1", []), "");
    const pictures = listed(["gpt-5.6", "gpt-image-1", "gpt-image-2"]);
    assert.equal(store.recommendListed("https://api.openai.com/v1", pictures, "image"), "gpt-image-2", "the picture role: paints, and current");
    assert.equal(store.recommendListed("https://api.openai.com/v1", pictures), "gpt-5.6", "the story role is unchanged");
  });

  await test("this machine's memory decides whether local weights fit", () => {
    assert.deepEqual(hardware.readGpuStats({ devices: [{ name: "cuda:0 AMD Radeon 8060S Graphics : native", vram_total: 120 * 1024 ** 3 }] }), { name: "AMD Radeon 8060S Graphics", vramGb: 120 });
    assert.equal(hardware.readGpuStats({}), null);
    const halo = { ramGb: 125, gpu: { name: "AMD Radeon 8060S Graphics", vramGb: 120 }, unified: hardware.unifiedMemory({ name: "AMD Radeon 8060S Graphics", vramGb: 120 }, 125) };
    assert.equal(halo.unified, true);
    assert.equal(hardware.memoryBudgetGb(halo), 125, "one pool, counted once");
    const card = { ramGb: 32, gpu: { name: "NVIDIA GeForce RTX 4090", vramGb: 24 }, unified: hardware.unifiedMemory({ name: "NVIDIA GeForce RTX 4090", vramGb: 24 }, 32) };
    assert.equal(card.unified, false);
    assert.equal(hardware.memoryBudgetGb(card), 56, "the card plus what the runtime offloads to RAM");
    assert.equal(hardware.fitsMachine(36, card), true);
    assert.equal(hardware.fitsMachine(60, card), false);
    assert.equal(hardware.fitsMachine(0, card), null);
    assert.equal(hardware.fitsMachine(10, { ramGb: 0, gpu: null, unified: false }), null, "unknown memory judges nothing");
    assert.match(hardware.describeMachine(halo), /AMD Radeon 8060S Graphics, 125 GB memory shared/);
    assert.match(hardware.describeMachine({ ramGb: 16, gpu: null, unified: false }), /^16 GB memory$/);
    const verdict = logic.assessModel({ role: "story", id: "x", catalog: null, listed: true, local: true, memory: { sizeGb: 60, budgetGb: 56 } });
    assert.equal(verdict.fit, "unfit");
  });

  await test("the agent program's own list is the harness answer; its vendor's rows say the rest", async () => {
    const none = await modelChoices({ role: "story", provider: "harness", selected: "opus" });
    assert.equal(none.reachable, null);
    assert.equal(none.models[0].id, "opus");
    const enriched = store.enrichHarnessModels("claude", [{ id: "claude-opus-4-5", label: "Claude Opus 4.5" }, { id: "opus", label: "Opus (latest)", contextTokens: 1_000_000 }, { id: "claude-sonnet-5", label: "Sonnet 5" }]);
    assert.equal(enriched[0].contextTokens, 200_000);
    assert.equal(enriched[0].deprecated, true);
    assert.equal(enriched[1].contextTokens, 1_000_000, "what the program said stands");
    assert.equal(enriched[1].deprecated, undefined);
    assert.equal(enriched[2].cheap, true, "the cheapest by the catalog's price is the light one, no name decides it");
    assert.equal(enriched[0].cheap, undefined);
    const said = store.enrichHarnessModels("claude", [{ id: "claude-opus-5-5", label: "Opus", cheap: true }, { id: "claude-sonnet-5", label: "Sonnet" }]);
    assert.equal(said[1].cheap, undefined, "a program that said which is light is believed");
    // Claude Code names its models by alias ("opus"); its initialize answer
    // says which model each stands for, and that is what the catalog is asked.
    const aliases = store.enrichHarnessModels("claude", [
      { id: "opus", label: "Opus 5.5", fast: true, catalogId: "claude-opus-5-5" },
      { id: "sonnet", label: "Sonnet 5", catalogId: "claude-sonnet-5" },
    ]);
    assert.deepEqual(aliases.filter((model) => model.cheap).map((model) => model.id), ["sonnet"], "an alias is judged by the model it stands for");
    assert.deepEqual(aliases.map((model) => model.contextTokens), [1_000_000, 1_000_000], "and gets that model's window");
    assert.equal(store.enrichHarnessModels("claude", [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }]).some((model) => model.cheap), false, "a bare alias is not found, so no name decides");
    assert.equal(store.harnessCatalogProvider("opencode", "openai/gpt-5.6"), "openai");
    assert.equal(store.harnessCatalogProvider("codex"), "openai");
  });

  // ---- the admin's own test results ----

  await test("a backend test is remembered per host and model, without its key, and shows on the list", async () => {
    const record = probes.recordModelProbe(compatUrl, "gpt-5.6", { ok: true, route: "responses", stages: { streaming: { ok: true }, toolCall: { ok: true }, toolContinuation: { ok: true } } });
    assert.equal(record.host, `127.0.0.1:${compat.address().port}`);
    assert.equal(JSON.stringify(probes.modelProbes()).includes("sk-test"), false);
    const again = probes.recordModelProbe(compatUrl, "gpt-5.6", { ok: false, stages: { streaming: { ok: true } } });
    assert.equal(probes.modelProbes().length, 1, "the newest result per host and model wins");
    assert.equal(again.stages.toolCall, false);
    const choices = await modelChoices({ role: "story", provider: "custom", baseUrl: compatUrl, apiKey: "sk-test", selected: "gpt-5.6" });
    assert.equal(choices.models[0].tested?.ok, false);
    const many = Array.from({ length: 70 }, (_, i) => probes.probeRecord("http://h:1/v1", `m${i}`, { ok: true }));
    assert.equal(probes.mergeProbeRecords(many, probes.probeRecord("http://h:1/v1", "last", { ok: true })).length, probes.MAX_PROBE_RECORDS);
  });

  // ---- backward compatibility of the settings paths ----

  await test("no model is named in code: the shipped defaults are blank until the admin or the server's list fills them", async () => {
    const { DEFAULT_STORY_SETTINGS } = await import("../src/lib/defaults.ts");
    assert.equal(DEFAULT_STORY_SETTINGS.localTextModel, "");
    assert.equal(DEFAULT_STORY_SETTINGS.customModel, "");
    assert.equal(normalizeSettings({}).customModel, "");
    assert.equal(normalizeSettings({ textProvider: "local" }).localTextModel, "");
  });

  await test("any Ollama tag is a valid local model, and a campaign's choice is kept as it was saved", () => {
    assert.equal(textModels.isLocalTextModelId("gemma4:31b-it-qat"), true);
    assert.equal(textModels.isLocalTextModelId("qwen3.6:35b-a3b-q8_0"), true, "a tag pulled after the app shipped");
    assert.equal(textModels.isLocalTextModelId("hf.co/unsloth/gemma-4-31b-it-GGUF:Q4_K_M"), true);
    assert.equal(textModels.isLocalTextModelId(""), false);
    assert.equal(textModels.isLocalTextModelId("two words"), false);
    assert.equal(textModels.isLocalTextModelId(42), false);
    const kept = normalizeSettings({ textProvider: "local", localTextModel: "qwen3.6:35b-a3b-q8_0" });
    assert.equal(kept.localTextModel, "qwen3.6:35b-a3b-q8_0", "once reset to the default; now kept");
    assert.equal(normalizeSettings({ textProvider: "local", localTextModel: "gemma4:12b-it-qat" }).localTextModel, "gemma4:12b-it-qat");
    assert.equal(normalizeSettings({ textProvider: "local", localTextModel: "  " }).localTextModel, "", "blank stays blank: the server's list fills it");
    assert.equal(normalizeSettings({ textProvider: "local", localTextModel: 7 }).localTextModel, "");
    assert.equal(textModels.localModelContextWindow("gemma4:31b-it-qat"), 262_144, "what Ollama said of it earlier in this process");
    assert.equal(textModels.localModelContextWindow("never-heard-of"), textModels.DEFAULT_LOCAL_CONTEXT_TOKENS);
  });

  await test("the admin's default local model may be any tag too", () => {
    saveGlobalConfig({ text: { provider: "local", localTextModel: "qwen3.6:35b-a3b-q8_0" } });
    assert.equal(normalizeSettings({}).localTextModel, "qwen3.6:35b-a3b-q8_0");
    saveGlobalConfig({ text: { provider: "", localTextModel: "" } });
  });

  await test("a local request with no model set runs Ollama's only chat model, and says so when there are several", async () => {
    const { requestLocalMessage } = await import("../src/lib/model-client.ts");
    process.env.OLLAMA_BASE_URL = ollamaUrl;
    const refused = await requestLocalMessage("", [{ role: "user", content: "hi" }], {});
    assert.equal(refused.error?.status, 400);
    assert.match((await refused.error.json()).error, /lists more than one/);
    delete process.env.OLLAMA_BASE_URL;
  });

  await test("OpenAI's windows come from the catalog, capped at the floor; the retired small models keep their size", () => {
    const openai = (model) => storyContextTokens({ textProvider: "custom", localTextModel: "", customBaseUrl: "https://api.openai.com/v1", customModel: model });
    assert.equal(openai("gpt-5.6"), 128_000, "1.05M in the catalog, billed by the token: the floor is the ceiling");
    assert.equal(openai("gpt-4"), 8_192);
    assert.equal(openai("ft:gpt-4:acme::abc"), 8_192, "a fine-tune is its base");
    assert.equal(openai("gpt-7-omni"), 128_000, "never heard of: the floor, not a guess");
  });

  await test("context windows: a hosted provider's from the catalog (capped), a local model's from Ollama or the catalog", () => {
    assert.equal(storyContextTokens({ textProvider: "custom", localTextModel: "", customBaseUrl: "https://openrouter.ai/api/v1", customModel: "google/gemini-3.5-flash" }), 128_000, "OpenRouter's 1M window, capped where OpenAI's is");
    assert.equal(storyContextTokens({ textProvider: "custom", localTextModel: "", customBaseUrl: "https://openrouter.ai/api/v1", customModel: "sao10k/l3-lunaris-8b" }), 8_192);
    assert.equal(storyContextTokens({ textProvider: "custom", localTextModel: "", customBaseUrl: "https://openrouter.ai/api/v1", customModel: "nobody/knows" }), 16_384, "an unknown model keeps the conservative default");
    assert.equal(storyContextTokens({ textProvider: "custom", localTextModel: "", customBaseUrl: "http://127.0.0.1:8001/v1", customModel: "gpt-5.6" }), 16_384, "a private server is not the catalog's provider; its /props decides");
    // Where a local window comes from, whatever the platform: Windows caps an
    // unset LOCAL_TEXT_CONTEXT at 64K (model-client.ts), so set it past every
    // window here.
    process.env.LOCAL_TEXT_CONTEXT = "1048576";
    assert.equal(localContextTokens("qwen3.6:35b-a3b-q8_0"), 40_960, "what Ollama said of it earlier in this process");
    assert.equal(localContextTokens("gemma-4-31b-it-GGUF"), 262_144, "the catalog's window for weights nobody has asked Ollama about");
    assert.equal(localContextTokens("gemma4:31b-it-qat"), 262_144, "learned from Ollama, no table needed");
    textModels.rememberLocalContextWindow("my-merge:latest", 65_536);
    assert.equal(localContextTokens("my-merge:latest"), 65_536, "what Ollama said of it");
    assert.equal(localContextTokens("never-heard-of"), 131_072);
    delete process.env.LOCAL_TEXT_CONTEXT;
  });

  ollama.close();
  compat.close();
  single.close();
  globalThis.fetch = realFetch;
  console.log(`model-registry: ${passed} tests passed`);
} finally {
  removeTempDir(dir);
}
