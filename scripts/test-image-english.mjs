// Image prompts in English at any table (src/lib/image-english.ts): at a
// table playing in another language, the story text an image job sends is
// first rewritten by one utility call inside the job; an English table makes
// no call and sends its text as it was. A failed or unreadable rewrite fails
// the job through its failed status and never reaches the image backend, and
// the log names no text. One local server stands in for both the text model
// and ComfyUI.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-image-english-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.DM_THINKING = "0";

register("./lib/register-alias.mjs", import.meta.url);

const { parseImageEnglish } = await import("../src/lib/image-english-logic.ts");
const { toEnglishForImage } = await import("../src/lib/image-english.ts");
const { enqueueLocationMap } = await import("../src/lib/dm/maps.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { paintEntry } = await import("../src/lib/dm/world-ai.ts");
const { createWorldEntity } = await import("../src/lib/db/world-forge.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// ---- the reply ----

await test("a reply is read once: fences are tolerated, a missing or empty key is unreadable", () => {
  assert.deepEqual(parseImageEnglish('```json\n{"name":"The Crypt of Vael"}\n```', ["name"]), { name: "The Crypt of Vael" });
  assert.deepEqual(
    parseImageEnglish('Sure: {"name":"The Crypt","layout":"A flooded crypt."}', ["name", "layout"]),
    { name: "The Crypt", layout: "A flooded crypt." },
  );
  assert.equal(parseImageEnglish('{"name":"The Crypt"}', ["name", "layout"]), null);
  assert.equal(parseImageEnglish('{"name":"  "}', ["name"]), null);
  assert.equal(parseImageEnglish("no json here", ["name"]), null);
  assert.equal(parseImageEnglish('{"name": 3}', ["name"]), null);
});

// ---- the stand-in servers ----

// What the text model answers next: a reply body, or a status to fail with.
let answer = { content: "{}" };
const chatRequests = [];
const comfyPrompts = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.url?.endsWith("/chat/completions")) {
      chatRequests.push(JSON.parse(body));
      if (answer.status) {
        res.writeHead(answer.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "down" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer.content } }] }));
      return;
    }
    // ComfyUI: the prompt is recorded and the render refused, which is all
    // this test needs to know about what reached it.
    if (req.url === "/prompt") {
      comfyPrompts.push(body);
    }
    res.writeHead(500);
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// An admin's table runs on its own addresses; a player's would follow the
// server's.
const owner = createUser(`owner-${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
function table(language) {
  const campaign = createCampaign(owner.id, {
    title: "Cripta", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
    gameSettings: { tableLanguage: language },
  });
  updateStorySettings(campaign.id, {
    textProvider: "custom", customBaseUrl: `${base}/v1`, customModel: "fake",
    imageBackend: "comfyui", comfyUrl: base, imageGenerationEnabled: true,
  });
  return getCampaignById(campaign.id);
}

// Every console.error line while `fn` runs.
async function errorsDuring(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...parts) => lines.push(parts.map(String).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

// ---- the rewrite ----

const PLACE = { name: "La Cripta di Vael", layout: "Una cripta allagata, illuminata da torce." };

await test("an English table makes no call and gets its text back as it was", async () => {
  const before = chatRequests.length;
  assert.deepEqual(await toEnglishForImage(table("english"), PLACE), PLACE);
  assert.equal(chatRequests.length, before);
});

await test("another table sends the non-empty fields once, under the image instructions, and gets English back", async () => {
  const before = chatRequests.length;
  answer = { content: '{"name":"The Crypt of Vael","layout":"A flooded crypt, lit by torches."}' };
  const english = await toEnglishForImage(table("italian"), { ...PLACE, extra: "  " });
  assert.deepEqual(english, { name: "The Crypt of Vael", layout: "A flooded crypt, lit by torches.", extra: "  " });
  assert.equal(chatRequests.length, before + 1);
  const [system, user] = chatRequests.at(-1).messages;
  assert.match(system.content, /image generator that reads only English/);
  assert.deepEqual(JSON.parse(user.content), PLACE);
});

await test("a failed or unreadable rewrite throws without naming the text", async () => {
  answer = { status: 500 };
  await assert.rejects(toEnglishForImage(table("italian"), PLACE), (error) => !error.message.includes("Vael"));
  answer = { content: "Mi dispiace." };
  await assert.rejects(toEnglishForImage(table("italian"), PLACE), (error) => !error.message.includes("Vael"));
});

// ---- inside a job ----

async function mapJob(language) {
  const campaign = table(language);
  const location = upsertCurrentLocation({ campaignId: campaign.id, name: PLACE.name, layoutDescription: PLACE.layout });
  const events = [];
  const unsubscribe = subscribe(campaign.id, (chunk) => events.push(chunk));
  const { lines } = await errorsDuring(() => enqueueLocationMap(campaign, location.id));
  unsubscribe();
  return { failed: events.some((chunk) => chunk.includes('"state":"failed"')), lines };
}

await test("a location map at another table is drawn from the English rewrite", async () => {
  answer = { content: '{"name":"The Crypt of Vael","layout":"A flooded crypt, lit by torches."}' };
  const before = comfyPrompts.length;
  await mapJob("italian");
  assert.equal(comfyPrompts.length, before + 1);
  assert.match(comfyPrompts.at(-1), /A flooded crypt, lit by torches/);
  assert.ok(!comfyPrompts.at(-1).includes("allagata"));
});

await test("a failed rewrite fails the map job and nothing reaches the image backend or the log", async () => {
  answer = { status: 500 };
  const before = comfyPrompts.length;
  const { failed, lines } = await mapJob("italian");
  assert.ok(failed, "the table was not told the map failed");
  assert.equal(comfyPrompts.length, before);
  assert.ok(lines.length > 0);
  assert.ok(!lines.some((line) => line.includes("Vael") || line.includes("allagata")), "story text reached the log");
});

await test("an English table's map prompt carries its own words, with no call", async () => {
  const chats = chatRequests.length;
  const before = comfyPrompts.length;
  await mapJob("english");
  assert.equal(chatRequests.length, chats);
  assert.equal(comfyPrompts.length, before + 1);
  assert.match(comfyPrompts.at(-1), /Una cripta allagata/);
});

// ---- WorldForge's paint ----

// Paint renders on the server's own image backend, queued after a check
// that one exists, so the test waits for what reaches the stand-ins.
saveGlobalConfig({ images: { comfyUrl: base } });
async function until(done) {
  for (let waited = 0; !done(); waited += 20) {
    assert.ok(waited < 5_000, "the paint job never ran");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function paintJob(language) {
  const campaign = table(language);
  const { entity } = createWorldEntity(campaign.id, { typeId: "t_location", name: PLACE.name, article: PLACE.layout });
  const before = comfyPrompts.length;
  const lines = [];
  const original = console.error;
  console.error = (...parts) => lines.push(parts.map(String).join(" "));
  try {
    assert.equal(paintEntry(campaign, entity.ref), true);
    await until(() => comfyPrompts.length > before || lines.some((line) => line.includes("[worldforge]")));
  } finally {
    console.error = original;
  }
  return { prompts: comfyPrompts.slice(before), lines };
}

await test("a WorldForge picture at another table is painted from the English rewrite", async () => {
  answer = { content: '{"type":"Location","about":"A flooded crypt, lit by torches."}' };
  const { prompts } = await paintJob("italian");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /A flooded crypt, lit by torches/);
  assert.ok(!prompts[0].includes("allagata"));
});

await test("a failed rewrite paints nothing and logs no story text", async () => {
  answer = { status: 500 };
  const { prompts, lines } = await paintJob("italian");
  assert.equal(prompts.length, 0);
  assert.ok(lines.some((line) => line.includes("[worldforge] picture failed")));
  assert.ok(!lines.some((line) => line.includes("allagata")), "story text reached the log");
});

// ---- every image call site ----

// Every place that calls the image backend, held to a classification: a
// call built from story text rewrites it first; any other names why it
// needs no rewrite. A call added later has to be put on one side.
const IMAGE_CALLS = {
  "src/lib/dm/images.ts": { story: 1, fixed: 0 },
  "src/lib/dm/maps.ts": { story: 1, fixed: 0 },
  "src/lib/campaign-cover.ts": { story: 1, fixed: 0 },
  "src/lib/dm/world-ai.ts": { story: 1, fixed: 0 },
  // A companion's and an NPC's portrait; a library character's has no
  // campaign, so no table language.
  "src/lib/portrait.ts": { story: 2, fixed: 1 },
  // The agent program's test picture: a fixed English prompt.
  "src/lib/harness/picture-test.ts": { story: 0, fixed: 1 },
};

await test("every image call site is classified, and each built from story text rewrites it first", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const src = path.join(root, "src");
  const found = {};
  for (const file of fs.readdirSync(src, { recursive: true }).map((entry) => path.join(src, String(entry))).filter((entry) => /\.tsx?$/.test(entry))) {
    const source = fs.readFileSync(file, "utf8");
    const calls = source.match(/\bgenerateStoryImage\(/g)?.length ?? 0;
    const name = path.relative(root, file).split(path.sep).join("/");
    if (calls && name !== "src/lib/image-generate.ts") {
      found[name] = { calls, rewrites: source.match(/\btoEnglishForImage\(/g)?.length ?? 0 };
    }
  }
  for (const [file, { calls, rewrites }] of Object.entries(found)) {
    const entry = IMAGE_CALLS[file];
    assert.ok(entry, `${file} calls the image backend; classify it`);
    assert.equal(calls, entry.story + entry.fixed, `${file} has ${calls} image calls; classify the new one`);
    assert.ok(rewrites >= entry.story, `${file} builds an image from story text without rewriting it into English`);
  }
  for (const file of Object.keys(IMAGE_CALLS)) {
    assert.ok(found[file], `${file} is classified but calls no image backend any more`);
  }
});

server.close();
removeTempDir(dir);
console.log(`test-image-english: ${passed} passed`);
