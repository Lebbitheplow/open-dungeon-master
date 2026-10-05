// Character voices end to end (issue 97): a passage is rendered with the
// narrator's voice for the prose and each speaker's own for their lines,
// speakers without one are cast when the table asks for that, and the table
// is offered the audio as soon as its first clip exists. Runs against a
// stand-in speech server whose "audio" is the voice and words it was sent.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-tts-voices-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
for (const key of ["KOKORO_URL", "TTS_PROVIDER", "TTS_BASE_URL", "TTS_MODEL", "TTS_API_KEY", "TTS_VOICE", "TTS_CONCURRENCY"]) {
  delete process.env[key];
}
const previousCwd = process.cwd();
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { enqueueNarrationAudio, narrationAudioPath, listNarrationAudio } = await import("../src/lib/tts.ts");
const { voiceRoster, setRosterVoice, castUnvoiced } = await import("../src/lib/tts-roster.ts");
const { listCampaignVoices } = await import("../src/lib/db/voices.ts");
const { voiceGender } = await import("../src/lib/tts-cast.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { upsertNpc, listNpcs } = await import("../src/lib/db/npcs.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const VOICES = ["af_heart", "af_bella", "bf_emma", "am_michael", "am_fenrir", "bm_george"];
const asked = [];
const server = http.createServer((request, response) => {
  if (request.url === "/v1/audio/voices") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ voices: VOICES }));
    return;
  }
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const sent = JSON.parse(body);
    asked.push(sent);
    response.writeHead(200, { "Content-Type": "audio/mpeg" });
    response.end(`[${sent.voice}@${sent.speed ?? 1}:${sent.input}]`);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
saveGlobalConfig({ speech: { ttsProvider: "kokoro", kokoroUrl: `http://127.0.0.1:${server.address().port}`, ttsModel: "", ttsApiKey: "", ttsVoice: "" } });

const owner = createUser("voices-host", "x", { isAdmin: true });
const CAMP = createCampaign(owner.id, { title: "Voices", description: "", theme: "high-fantasy", maxPlayers: 4, startingLevel: 1, difficulty: "normal" }).id;
upsertNpc({ campaignId: CAMP, name: "Captain Marla Venn", attitude: "friendly", trait: "A weathered woman who has buried too many of her guard." });
upsertNpc({ campaignId: CAMP, name: "Old Pike", attitude: "indifferent", trait: "A tired old man who drinks alone." });

const events = [];
const unsubscribe = subscribe(CAMP, (chunk) => {
  const type = /^event: (.+)$/m.exec(chunk)?.[1];
  const data = /^data: (.+)$/m.exec(chunk)?.[1];
  events.push({ type, payload: data ? JSON.parse(data) : null });
});
const saved = (messageId) => fs.readFileSync(narrationAudioPath(CAMP, messageId), "utf8");
const entry = (name) => voiceRoster(CAMP).find((candidate) => candidate.name === name);

await test("the roster is the cast, and nobody has a voice until one is chosen", () => {
  const roster = voiceRoster(CAMP);
  assert.deepEqual(roster.map((member) => [member.kind, member.name, member.voice]), [
    ["npc", "Captain Marla Venn", null],
    ["npc", "Old Pike", null],
  ]);
  assert.equal(entry("Captain Marla Venn").gender, "f");
  assert.equal(entry("Old Pike").gender, "m");
});

await test("without a chosen voice the narrator reads everything, as before", async () => {
  await enqueueNarrationAudio(CAMP, "m-plain", '"Hold the gate," says Marla.', { ttsVoice: "af_heart" });
  assert.equal(saved("m-plain"), '[af_heart@1:"Hold the gate," says Marla.]');
});

await test("a chosen voice reads its speaker's lines, found by a short name", async () => {
  assert.ok(setRosterVoice(CAMP, entry("Captain Marla Venn"), { voiceId: "bf_emma", speed: 1.1 }));
  assert.equal(listNpcs(CAMP).find((npc) => npc.name === "Captain Marla Venn").voice.voiceId, "bf_emma", "an NPC's voice stays on the NPC");
  events.length = 0;
  await enqueueNarrationAudio(CAMP, "m-voiced", 'The gate shudders. "Hold the gate," says Marla, "or we all die here." Pike spits.', {
    ttsVoice: "af_heart",
    ttsSpeed: 0.9,
  });
  assert.equal(
    saved("m-voiced"),
    "[af_heart@0.9:The gate shudders.][bf_emma@1.1:Hold the gate,][af_heart@0.9:says Marla,][bf_emma@1.1:or we all die here.][af_heart@0.9:Pike spits.]",
  );
});

await test("the table is offered the passage before it is finished, at the address it keeps", async () => {
  const stream = events.findIndex((event) => event.type === "tts_stream");
  const ready = events.findIndex((event) => event.type === "tts_ready");
  assert.ok(stream !== -1 && ready > stream, "tts_stream comes first");
  assert.equal(events[stream].payload.url, `${events[ready].payload.url}&live=1`);
  assert.match(events[ready].payload.url, /^\/generated-audio\/.+\/m-voiced\.mp3\?v=\d+$/);
  assert.match(listNarrationAudio(CAMP)["m-voiced"], /m-voiced\.mp3\?v=\d+$/);
});

await test("with casting on, a speaker without a voice is given one that suits and keeps it", async () => {
  await enqueueNarrationAudio(CAMP, "m-cast", '"Not my fight," Pike mutters. He drinks.', { ttsVoice: "af_heart", ttsAutoCast: true });
  const pike = entry("Old Pike").voice;
  assert.ok(pike, "Pike was cast");
  assert.equal(voiceGender(pike.voiceId), "m");
  assert.notEqual(pike.voiceId, "af_heart", "never the narrator's own voice");
  assert.ok(saved("m-cast").startsWith(`[${pike.voiceId}@1:Not my fight,]`));
  await enqueueNarrationAudio(CAMP, "m-cast-2", '"Still not my fight," says Pike.', { ttsVoice: "af_heart", ttsAutoCast: true });
  assert.equal(entry("Old Pike").voice.voiceId, pike.voiceId, "and is the same voice next time");
});

await test("a monster is voiced by what it is, and a passage spoken as it is all in that voice", async () => {
  assert.ok(setRosterVoice(CAMP, { key: "monster:goblin", name: "Goblin" }, { voiceId: "am_fenrir", speed: 1.3 }));
  assert.deepEqual(listCampaignVoices(CAMP).map((voice) => voice.key), ["monster:goblin"]);
  assert.equal(entry("Goblin").kind, "monster", "a monster with a voice stays on the roster after its fight");
  await enqueueNarrationAudio(CAMP, "m-goblin", "Shinies. Give.", { ttsVoice: "af_heart" }, { kind: "monster", id: "e2", name: "Goblin 2" });
  assert.equal(saved("m-goblin"), "[am_fenrir@1.3:Shinies. Give.]");
  setRosterVoice(CAMP, { key: "monster:goblin", name: "Goblin" }, null);
  assert.equal(entry("Goblin"), undefined);
});

await test("casting the whole table gives everyone left a different voice", async () => {
  upsertNpc({ campaignId: CAMP, name: "Brother Aldous", attitude: "friendly", trait: "A soft-spoken priest." });
  upsertNpc({ campaignId: CAMP, name: "Wren", attitude: "friendly", trait: "A quick girl with a knife." });
  const cast = await castUnvoiced(CAMP, voiceRoster(CAMP), "af_heart");
  assert.equal(cast, 2);
  const voices = voiceRoster(CAMP).map((member) => member.voice?.voiceId);
  assert.ok(voices.every(Boolean));
  assert.equal(new Set(voices).size, voices.length, "four speakers, four voices");
  assert.equal(voiceGender(entry("Wren").voice.voiceId), "f");
  assert.equal(await castUnvoiced(CAMP, voiceRoster(CAMP), "af_heart"), 0, "and nobody already cast is recast");
});

await test("a long passage asks for a short first clip and loses nothing", async () => {
  asked.length = 0;
  const long = "The rain comes down on the slate roofs of the lower town and does not stop. ".repeat(30).trim();
  await enqueueNarrationAudio(CAMP, "m-long", long, { ttsVoice: "af_heart" });
  assert.ok(asked.length >= 3);
  assert.ok(asked.some((request) => request.input.length <= 320));
  assert.equal(saved("m-long").replace(/\]\[af_heart@1:/g, " ").replace(/^\[af_heart@1:|\]$/g, ""), long, "in order, nothing lost");
});

unsubscribe?.();
await new Promise((resolve) => server.close(resolve));
process.chdir(previousCwd);
removeTempDir(dir);
console.log(`\n${passed} character voice checks passed`);
