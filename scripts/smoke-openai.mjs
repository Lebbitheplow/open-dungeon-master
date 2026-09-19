// A short live campaign against a real OpenAI key, for the BYOK path only.
//
// Not part of `npm test`: it spends money and needs a key. Everything runs
// in-process against a throwaway database, the same way the offline tests do,
// so it drives the real DM turn machine (src/lib/dm/turn.ts) rather than a
// mock of it. The campaign is deliberately tiny — the point is to prove the
// integration, not to score the model.
//
// Deliberately, NO image key is configured anywhere: the pictures have to
// come out of the key the campaign gave its OpenAI text model, which is the
// whole BYOK claim (src/lib/openai-images.ts).
//
// Usage:
//   OPENAI_API_KEY=sk-... node scripts/smoke-openai.mjs
//   ODM_TEXT_MODEL=gpt-5.4-mini ODM_IMAGE_MODEL=gpt-image-1-mini ... (optional)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const KEY = process.env.OPENAI_API_KEY?.trim();
if (!KEY) {
  console.error("Set OPENAI_API_KEY to the key under test.");
  process.exit(1);
}
const TEXT_MODEL = process.env.ODM_TEXT_MODEL || "gpt-5.4-mini";
const IMAGE_MODEL = process.env.ODM_IMAGE_MODEL || "gpt-image-1-mini";
const BASE_URL = process.env.ODM_TEXT_BASE_URL || "https://api.openai.com/v1";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-openai-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// The image model is the only image-side setting; the key must be borrowed.
process.env.OPENAI_IMAGE_MODEL = IMAGE_MODEL;
delete process.env.OPENAI_IMAGE_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_COMPAT_API_KEY;

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, listSheets } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { startDmTurn, resumeDmTurn } = await import("../src/lib/dm/turn.ts");
const { runStorySetup } = await import("../src/lib/dm/setup.ts");
const { listOpenPendingRolls, resolvePendingRoll, listPendingForTurn, getLatestDmTurnId, getDmTurn } =
  await import("../src/lib/db/dm-turns.ts");
const { insertRoll, listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { getActiveEncounter, listEnemies } = await import("../src/lib/db/encounters.ts");
const { listQuests } = await import("../src/lib/db/quests.ts");
const { listActiveFacts } = await import("../src/lib/db/facts.ts");
const { listNpcs } = await import("../src/lib/db/npcs.ts");
const { listLocations } = await import("../src/lib/db/locations.ts");
const { handleGenerateImage } = await import("../src/lib/dm/images.ts");
const { imageProducerReady } = await import("../src/lib/image-generate.ts");
const { maskStorySettings } = await import("../src/lib/db/settings.ts");
const { enqueueMediaJob } = await import("../src/lib/media-queue.ts");
const { storyContextTokens } = await import("../src/lib/model-client.ts");
const { describeEndpoint } = await import("../src/lib/dm/sampling-logic.ts");
const { getLatestDmMessage } = await import("../src/lib/db/messages.ts");
const { generateStoryArc } = await import("../src/lib/dm/arc.ts");
const { requestCustomMessage } = await import("../src/lib/model-client.ts");

const findings = [];
const note = (line) => {
  console.log(line);
  findings.push(line);
};

// ---- count what the key is actually spending -------------------------------
// The DM path streams without usage accounting, so the tokens are counted here
// by wrapping fetch. Cheap, and it is the only honest way to report the bill.
let calls = 0;
let images = 0;
let promptChars = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (url.includes("/chat/completions")) {
    calls += 1;
    promptChars += (init?.body ?? "").length;
  }
  if (url.includes("/images/generations")) images += 1;
  return realFetch(input, init);
};

// ---- the table -------------------------------------------------------------
const lead = createUser("kaleb", "x");
const campaign = createCampaign(lead.id, {
  title: "The Salt Road",
  description: "A one-scene caravan job that goes wrong at the ford.",
  theme: "low fantasy, coastal trade road",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: {},
});

updateStorySettings(campaign.id, {
  textProvider: "custom",
  customBaseUrl: BASE_URL,
  customModel: TEXT_MODEL,
  customApiKey: KEY,
  // No ComfyUI anywhere in this run.
  imageBackend: "openai",
  imageMode: "fast",
  aspect: "landscape",
  imageGenerationEnabled: true,
  autoImages: false,
});
setCampaignStatus(campaign.id, "active");

const sheet = (name, cls, abilities, extra = {}) =>
  createSheetSchema.parse({
    name,
    race: "human",
    class: cls,
    abilities,
    maxHp: 24,
    ac: 15,
    hitDice: { die: "d8", total: 3, spent: 0 },
    proficiencies: {
      saves: ["dex", "int"],
      skills: ["perception", "investigation", "athletics"],
      languages: ["common"],
      tools: [],
      armor: [],
      weapons: ["shortsword"],
    },
    equipment: [{ name: "Shortsword", qty: 1 }, { name: "Rope", qty: 1 }],
    gold: 12,
    ...extra,
  });

const avery = createSheet(
  campaign.id,
  lead.id,
  3,
  sheet("Avery", "rogue", { str: 10, dex: 17, con: 13, int: 12, wis: 12, cha: 11 }),
);
const other = createUser("bram", "x");
const bram = createSheet(
  campaign.id,
  other.id,
  3,
  sheet("Bram", "fighter", { str: 16, dex: 12, con: 15, int: 9, wis: 11, cha: 10 }),
);

const caps = describeEndpoint(BASE_URL);
note(
  `backend: kind=${caps.kind} localSamplers=${caps.allowLocalOnlySamplers} templateKwargs=${caps.allowTemplateKwargs} cap=${caps.maxTokensField} presence0=${caps.sendZeroPresencePenalty}`,
);
note(`context window the prompt is built against: ${storyContextTokens(getCampaignById(campaign.id).settings)} tokens`);
assert.equal(
  imageProducerReady(getCampaignById(campaign.id).settings),
  true,
  "the OpenAI image backend did not pick up the campaign's OpenAI text key",
);
assert.equal(
  maskStorySettings(getCampaignById(campaign.id).settings).imagesReady,
  true,
  "the settings panel would still warn that images cannot render",
);
note("images: the campaign's OpenAI text key is accepted as the image key (no image key configured)");

// ---- helpers ---------------------------------------------------------------
function say(character, userId, content) {
  const seq = allocateSeq(campaign.id);
  return insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "player",
    userId,
    characterId: character.id,
    content,
  });
}

function dmText() {
  return listRecentMessages(campaign.id, 50)
    .filter((message) => message.authorType === "dm")
    .map((message) => message.content)
    .join("\n\n");
}

function lastDm() {
  const dm = listRecentMessages(campaign.id, 50).filter((message) => message.authorType === "dm");
  return dm[dm.length - 1]?.content ?? "";
}

// Answer every parked roll with the server's dice, exactly as the digital
// fallback in the pending-rolls route does, then let the turn resume.
async function settleRolls(label) {
  let settled = 0;
  for (let round = 0; round < 4; round += 1) {
    const open = listOpenPendingRolls(campaign.id);
    if (!open.length) break;
    let turnId = "";
    for (const pending of open) {
      const outcome = rollExpression(pending.expression);
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: pending.characterId,
        requestedBy: "player",
        kind: pending.kind,
        detail: pending.detail,
        advantage: pending.advantage,
        dc: pending.dc,
        result: outcome,
      });
      resolvePendingRoll(pending.id, "fallback", roll.id);
      turnId = pending.turnId;
      settled += 1;
      note(
        `  roll [${label}]: ${pending.kind} ${pending.detail || ""} ${pending.expression} -> ${roll.total}${pending.dc !== null ? ` vs DC ${pending.dc} (${roll.total >= pending.dc ? "hit" : "miss"})` : ""}`,
      );
    }
    if (turnId && !listPendingForTurn(turnId).some((entry) => entry.status === "pending")) {
      await resumeDmTurn(campaign.id, turnId);
    }
  }
  return settled;
}

// Every tool the model actually called this turn, read back off the stored
// conversation rather than guessed from the prose.
const toolsUsed = new Set();
function turnTools() {
  const turnId = getLatestDmTurnId(campaign.id);
  const stored = turnId ? getDmTurn(turnId) : null;
  const names = [];
  for (const message of stored?.conversation ?? []) {
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      const name = call?.function?.name;
      if (name) {
        names.push(name);
        toolsUsed.add(name);
      }
    }
  }
  return names;
}

async function turn(label) {
  const before = listRecentMessages(campaign.id, 200).length;
  const rollsBefore = listRecentRolls(campaign.id, 200).length;
  await startDmTurn(campaign.id);
  await settleRolls(label);
  const after = listRecentMessages(campaign.id, 200).length;
  // listRecentRolls comes back oldest first, so the new ones are the tail.
  const fresh = listRecentRolls(campaign.id, 200).slice(rollsBefore);
  const text = lastDm();
  note(`\n[${label}] +${after - before} messages, ${fresh.length} dice rolls, ${calls} model calls so far`);
  note(`  tools: ${turnTools().join(", ") || "(none)"}`);
  for (const roll of fresh) {
    note(
      `  roll: ${roll.kind} ${roll.detail || ""} -> ${roll.total}${roll.dc !== null && roll.dc !== undefined ? ` vs DC ${roll.dc}` : ""}`,
    );
  }
  note(`  DM: ${text.replace(/\s+/g, " ").slice(0, 400)}`);
  assert.ok(text.trim().length > 40, `[${label}] the DM wrote nothing`);
  return text;
}

// ---- the campaign ----------------------------------------------------------
note("\n=== setup: premise, opening scene, secret outline ===");
await runStorySetup(campaign.id);
const seeded = getCampaignById(campaign.id);
assert.ok(seeded.dmOutline, "story setup produced no secret outline");
note(`  outline: ${seeded.dmOutline.replace(/\s+/g, " ").slice(0, 260)}`);

note("\n=== story arc: the spine the DM steers by ===");
await generateStoryArc(campaign.id);
const arced = getCampaignById(campaign.id);
assert.ok(arced.storyArc, "the arc planner produced nothing");
note(
  `  antagonist: ${arced.storyArc.antagonist} | ${arced.storyArc.beats.length} beats across ${arced.storyArc.acts} act(s) | ${arced.storyArc.subArcs.length} sub-arcs`,
);
note(`  premise: ${arced.storyArc.premise.replace(/\s+/g, " ").slice(0, 200)}`);
for (const beat of arced.storyArc.beats.slice(0, 3)) {
  note(`    act ${beat.act} [${beat.status}] ${beat.text.replace(/\s+/g, " ").slice(0, 120)}`);
}
note(`  quests seeded from the arc: ${listQuests(campaign.id).map((q) => `${q.title} [${q.status}]`).join("; ") || "none"}`);

note("\n=== turn 1: kickoff narration ===");
say(avery, lead.id, "I check the ford for tracks before we bring the wagons across.");
await turn("kickoff");

note("\n=== turn 2: a skill check the DM has to ask for ===");
say(
  avery,
  lead.id,
  "I crouch at the waterline and search the mud for boot prints, then tell Bram what I find.",
);
await turn("check");
assert.ok(
  listRecentRolls(campaign.id, 50).length > 0,
  "no dice were rolled for an explicit search",
);

note("\n=== turn 3: combat ===");
say(bram, other.id, "Bandits break from the reeds. I draw my sword and charge the nearest one.");
await turn("combat");
const encounter = getActiveEncounter(campaign.id);
if (encounter) {
  const enemies = listEnemies(encounter.id);
  note(
    `  encounter ${encounter.kind} round ${encounter.round}: ${enemies.map((e) => `${e.displayName} ${e.currentHp}/${e.maxHp} ac${e.ac}`).join(", ")}`,
  );
  note(`  initiative: ${encounter.order.map((entry) => `${entry.name}(${entry.initiative})`).join(" > ")}`);
} else {
  note("  no encounter started (the model narrated the fight instead)");
}

note("\n=== turn 4: an enemy turn and a character-state change ===");
say(
  avery,
  lead.id,
  "I splash across the shallows to close the distance, then stab the nearest cutthroat with my shortsword.",
);
await turn("enemy-turn");
for (const entry of listSheets(campaign.id)) {
  const fresh = getSheetById(entry.id);
  note(`  ${fresh.name}: ${fresh.currentHp}/${fresh.maxHp} hp, ${fresh.gold} gp, ${fresh.conditions.join(",") || "no conditions"}`);
}

note("\n=== turn 5: a job offered and taken (quest + NPC + story progression) ===");
say(
  bram,
  other.id,
  "Once the last bandit is down I haul the caravan master over and ask what is really in that coffer, and whether the job pays extra to see it through to the tide-ruin.",
);
await turn("quest");

note("\n=== scene image, on the borrowed key ===");
const dmMessage = getLatestDmMessage(campaign.id);
assert.ok(dmMessage, "no DM passage to hang a picture on");
const asked = handleGenerateImage(
  getCampaignById(campaign.id),
  JSON.stringify({
    prompt: "A muddy river ford at dusk, overturned trade wagon, reeds, cold grey light",
    reason: "the scene at the ford",
  }),
);
assert.equal(asked.ok, true, `generate_image refused: ${JSON.stringify(asked)}`);
// The image lane is serial, so a job queued behind it lands only once the
// picture is done (or has failed).
await enqueueMediaJob("smoke drain", async () => {});
const withImage = listRecentMessages(campaign.id, 200).find((m) => m.id === asked.illustrating);
assert.ok(withImage?.generatedImage?.url, "the OpenAI image never landed on the passage");
const file = path.join(process.cwd(), "public", withImage.generatedImage.url.replace(/^\//, ""));
const bytes = fs.statSync(file).size;
assert.ok(bytes > 10_000, `the written image is ${bytes} bytes`);
note(
  `  ${withImage.generatedImage.url} ${withImage.generatedImage.width}x${withImage.generatedImage.height} ${(bytes / 1024).toFixed(0)} KB in ${withImage.generatedImage.elapsedSeconds}s via ${withImage.generatedImage.backend}/${IMAGE_MODEL}`,
);

// ---- what the story actually recorded --------------------------------------
note("\n=== game state the model wrote ===");
const places = listLocations(campaign.id);
note(`  locations: ${places.map((l) => `${l.name}${l.mapImage ? " [map rendered]" : ""}`).join(", ") || "none"}`);
note(`  quests: ${listQuests(campaign.id).map((q) => `${q.title} [${q.status}]`).join("; ") || "none"}`);
note(`  facts: ${listActiveFacts(campaign.id).length} recorded`);
note(`  npcs: ${listNpcs(campaign.id).map((n) => n.name).join(", ") || "none"}`);
note(`  dice rolled: ${listRecentRolls(campaign.id, 200).length}`);
note(`  transcript: ${listRecentMessages(campaign.id, 400).length} messages, ${dmText().length} chars of narration`);
note(`  tools the model called: ${[...toolsUsed].sort().join(", ")}`);
const lastTurn = getDmTurn(getLatestDmTurnId(campaign.id));
note(`  context trace on the last turn: ${JSON.stringify(lastTurn?.contextTrace ?? null).slice(0, 400)}`);

// A reasoning model rejects temperature outright. ODM is supposed to read the
// field out of the 400, drop it, and retry rather than lose the turn
// (unsupportedParamFromError in src/lib/dm/sampling-logic.ts). Nothing else in
// this run exercises it, because gpt-5.4-mini accepts the default samplers.
note("\n=== strict-model fallback: a reasoning model that refuses temperature ===");
const strict = await requestCustomMessage(
  BASE_URL,
  process.env.ODM_STRICT_MODEL || "gpt-5.5",
  KEY,
  [
    { role: "system", content: "You are a D&D 5e Dungeon Master. Use the tool for dice." },
    { role: "user", content: "Avery picks the crypt lock. One sentence, then ask for the roll." },
  ],
  {
    tools: [
      {
        type: "function",
        function: {
          name: "request_roll",
          description: "Ask a player to roll dice.",
          parameters: {
            type: "object",
            properties: { character: { type: "string" }, skill: { type: "string" }, dc: { type: "integer" } },
            required: ["character", "skill", "dc"],
          },
        },
      },
    ],
    toolChoice: "auto",
    onDelta: () => {},
  },
);
assert.ok(!strict.error, `the strict-model retry did not recover: ${JSON.stringify(strict.error)}`);
note(
  `  recovered: ${String(strict.message?.content ?? "").replace(/\s+/g, " ").slice(0, 160)} | tool_calls=${JSON.stringify(strict.message?.tool_calls ?? null).slice(0, 120)}`,
);

note(`\nmodel calls: ${calls}, image calls: ${images}, prompt bytes sent: ${(promptChars / 1024).toFixed(0)} KB`);
note(`text model: ${TEXT_MODEL}  image model: ${IMAGE_MODEL}`);

removeTempDir(dir);
console.log("\nPASS: the OpenAI BYOK path ran a campaign end to end.");
