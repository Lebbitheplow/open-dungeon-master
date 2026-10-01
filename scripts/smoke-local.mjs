// A live smoke test of the DM turn loop against a real local model.
//
// Plays a short scripted campaign (the smoke-openai.mjs story: a ford, a
// skill check, bandits, an attack, a job offer) through the real turn machine
// on a throwaway database, several times over, and reports per turn what the
// model actually did: how many calls it took, which tools it called, whether
// the table ended on the empty-turn line (and why), whether the tool-leak
// rescue fired and recovered, and whether the narration carries anything a
// player should never read (tool JSON, tool names, system notes, template
// tokens, grid coordinates, degenerate text). Checks are soft: a weak turn is
// recorded, not fatal, so one run measures the whole campaign.
//
// Not part of `npm test`: it needs a running model and takes minutes per run.
// Unlike smoke-openai.mjs it spends nothing and checks behaviour, not a bill.
//
// Usage:
//   node scripts/smoke-local.mjs --url http://127.0.0.1:8000/v1 --model gpt-oss-120b [--runs 6]
//   node scripts/smoke-local.mjs --provider local --model gemma4:31b-it-qat [--runs 6]
//       (Ollama native API at OLLAMA_BASE_URL; LOCAL_TEXT_CONTEXT caps num_ctx)
//   options: --turns N (how many of the five turns to play, default 5)
//            --label NAME  --out DIR (writes <label>.json)
//            --context N (the window the prompt packs against; custom provider)
//            --key KEY (the custom provider's API key, default OPENAI_COMPAT_API_KEY;
//            the server only sends that env key to OPENAI_COMPAT_BASE_URL itself)
//   node scripts/smoke-local.mjs --compare a.json b.json [...]   side-by-side summary
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { parseArgs } from "node:util";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    provider: { type: "string", default: "custom" },
    url: { type: "string", default: process.env.OPENAI_COMPAT_BASE_URL || "http://127.0.0.1:8001/v1" },
    model: { type: "string", default: "" },
    runs: { type: "string", default: "1" },
    turns: { type: "string", default: "5" },
    label: { type: "string", default: "" },
    out: { type: "string", default: "" },
    context: { type: "string", default: "" },
    key: { type: "string", default: process.env.OPENAI_COMPAT_API_KEY || "" },
    compare: { type: "boolean", default: false },
  },
});

// ---- report comparison -------------------------------------------------------
const METRICS = [
  ["turns", "Turns"],
  ["empty", "Turns ending on the empty-turn line"],
  ["emptyCauses", "… by cause"],
  ["emptyRetries", "Empty replies asked again"],
  ["rescueOk", "Tool-leak rescues that recovered"],
  ["rescueEmpty", "Tool-leak rescues that came back empty"],
  ["artifacts", "Turns whose narration shows an artifact"],
  ["artifactKinds", "… by kind"],
  ["softFails", "Scripted expectations missed"],
  ["calls", "Model calls"],
  ["meanSeconds", "Mean seconds per turn"],
];

function formatValue(value) {
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? entries.map(([key, count]) => `${key} ${count}`).join(", ") : "none";
  }
  return String(value);
}

if (args.compare) {
  const reports = positionals.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  assert.ok(reports.length > 0, "--compare needs report files");
  const header = ["", ...reports.map((report) => `${report.label} (${report.version})`)];
  console.log(`| ${header.join(" | ")} |`);
  console.log(`|${header.map(() => "---").join("|")}|`);
  for (const [key, title] of METRICS) {
    console.log(`| ${title} | ${reports.map((report) => formatValue(report.summary[key])).join(" | ")} |`);
  }
  process.exit(0);
}

assert.ok(args.model, "--model is required");
const PROVIDER = args.provider;
assert.ok(PROVIDER === "custom" || PROVIDER === "local", "--provider is custom or local");
const RUNS = Math.max(1, Number.parseInt(args.runs, 10) || 1);
const MAX_TURNS = Math.min(5, Math.max(1, Number.parseInt(args.turns, 10) || 5));
const LABEL = args.label || args.model;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-smoke-local-"));
process.env.SQLITE_DB_PATH = path.join(dir, "smoke.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
if (args.context) process.env.OPENAI_COMPAT_CONTEXT = args.context;
// The per-call record comes from the turn loop's own debug lines.
process.env.DM_DEBUG = "1";

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, listSheets } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { startDmTurn, resumeDmTurn, MAX_MODEL_CALLS } = await import("../src/lib/dm/turn.ts");
const { runStorySetup } = await import("../src/lib/dm/setup.ts");
const { generateStoryArc } = await import("../src/lib/dm/arc.ts");
const { listOpenPendingRolls, resolvePendingRoll, listPendingForTurn, getLatestDmTurnId, getDmTurn } =
  await import("../src/lib/db/dm-turns.ts");
const { insertRoll, listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { getActiveEncounter, listEnemies } = await import("../src/lib/db/encounters.ts");
const { listQuests } = await import("../src/lib/db/quests.ts");
const { listActiveFacts } = await import("../src/lib/db/facts.ts");
const { listNpcs } = await import("../src/lib/db/npcs.ts");
const { EMPTY_TURN_LINE } = await import("../src/lib/dm/empty-turn.ts");
const { DM_HALTED_PREFIX } = await import("../src/lib/campaign-types.ts");
const { storyContextTokens } = await import("../src/lib/model-client.ts");
const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// ---- capture the turn loop's debug lines ------------------------------------
// [dm-debug] call N: content=<json> tool_calls=<json, truncated>
// [dm-debug] tool-leak rescue: content=<json> error=<bool>
let captured = [];
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
const keep = (line) => captured.push(line);
console.log = (...parts) => {
  const line = parts.map(String).join(" ");
  if (line.startsWith("[dm-debug]") || line.startsWith("[dm]")) keep(line);
};
console.warn = (...parts) => keep(parts.map(String).join(" "));
// Background media jobs (narration audio, pictures) are off; anything else
// the app reports on stderr is kept for the record but not printed.
console.error = (...parts) => keep(`[stderr] ${parts.map(String).join(" ")}`);
const say = (line = "") => realLog(line);

function parseCall(line) {
  const match = /^\[dm-debug\] call (\d+): content=("(?:[^"\\]|\\.)*") tool_calls=(.*)$/s.exec(line);
  if (!match) return null;
  let content = "";
  try {
    content = JSON.parse(match[2]);
  } catch {
    content = match[2];
  }
  const tools = [...match[3].matchAll(/"name":"([a-z_]+)"/g)].map((found) => found[1]);
  return { index: Number(match[1]), content, tools };
}

function parseRescue(line) {
  const match = /^\[dm-debug\] tool-leak rescue: content=("(?:[^"\\]|\\.)*") error=(true|false)/s.exec(line);
  if (!match) return null;
  let content = "";
  try {
    content = JSON.parse(match[1]);
  } catch {
    content = match[1];
  }
  return { content, error: match[2] === "true", ok: match[2] === "false" && content.trim().length > 0 };
}

// ---- what a player must never read -------------------------------------------
const EMPTY_PREFIXES = [EMPTY_TURN_LINE, "The DM had no answer", "The DM could not"];
const isEmptyTurn = (text) => EMPTY_PREFIXES.some((prefix) => text.startsWith(prefix));
const ROLL_MARKER = /\[roll:[0-9a-f-]{36}\]\s*/g;

// Each finding keeps the text it matched, so a report can be checked by eye.
function artifactsIn(narration, toolNames) {
  const found = [];
  const snippet = (index) => narration.slice(Math.max(0, index - 30), index + 90).replace(/\s+/g, " ");
  const check = (kind, pattern) => {
    const match = pattern.exec(narration);
    if (match) found.push({ kind, match: snippet(match.index) });
  };
  check("json", /\{\s*"[A-Za-z_]+"\s*:/);
  const names = [...toolNames].filter((name) => name.includes("_"));
  if (names.length) check("tool-name", new RegExp(`\\b(?:${names.join("|")})\\b`));
  check("system-note", /\[System\]|Tools are closed|Narrate the moment/);
  check("template-token", /<\|[a-z_]+\|>|to=functions\.|\bassistant(?:commentary|analysis|final)\b/);
  check("fake-roll-marker", /\[roll:(?![0-9a-f-]{36}\])/);
  check("grid-coordinates", /\btiles?\s*\(\s*\d+\s*,\s*\d+\s*\)|\(\s*\d+\s*,\s*\d+\s*\)\s*(?:tile|square|on the (?:grid|map))/i);
  // Zero-width and bidi marks are what a degenerating model sprays; U+202F
  // (narrow no-break space, as in "30 ft") and U+00A0 are ordinary typography.
  const invisible = /[\u200b-\u200f\u202a-\u202e\u2060\u00ad]/g;
  const visible = narration.replace(/\s/g, "");
  const letters = (narration.match(/\p{L}/gu) ?? []).length;
  const marks = narration.match(invisible) ?? [];
  if (marks.length >= 5 || (visible.length > 120 && letters / visible.length < 0.5)) {
    const at = marks.length ? narration.search(invisible) : 0;
    found.push({ kind: "degenerate-text", match: snippet(at) });
  }
  return found;
}

// Why a turn ended on the empty-turn line, read from its last model call.
function emptyCause(calls, rescues) {
  const last = calls[calls.length - 1];
  if (!last) return "no-call";
  if (rescues.length) return "rescue-empty";
  if (!String(last.content).trim() && !last.tools.length) return "reply-empty";
  if (last.tools.length && last.index === MAX_MODEL_CALLS - 1) return "final-call-tool";
  if (last.tools.length === 1 && last.tools[0] === "request_player_input") return "question-only";
  if (last.tools.length) return "tool-only";
  return "text-filtered";
}

// ---- one campaign -------------------------------------------------------------
const TURNS = [
  {
    label: "kickoff",
    who: "avery",
    text: "I check the ford for tracks before we bring the wagons across.",
  },
  {
    label: "check",
    who: "avery",
    text: "I crouch at the waterline and search the mud for boot prints, then tell Bram what I find.",
    expect: (turn) => (turn.rolls > 0 ? null : "no dice were rolled for an explicit search"),
  },
  {
    label: "combat",
    who: "bram",
    text: "Bandits break from the reeds. I draw my sword and charge the nearest one.",
    expect: (turn) => (turn.encounter ? null : "no encounter started (the fight was narrated instead)"),
  },
  {
    label: "enemy-turn",
    who: "avery",
    text: "I splash across the shallows to close the distance, then stab the nearest cutthroat with my shortsword.",
  },
  {
    label: "quest",
    who: "bram",
    text: "Once the last bandit is down I haul the caravan master over and ask what is really in that coffer, and whether the job pays extra to see it through to the tide-ruin.",
  },
];

function sheet(name, cls, abilities) {
  return createSheetSchema.parse({
    name,
    race: "human",
    class: cls,
    abilities,
    maxHp: 24,
    ac: 15,
    hitDice: { die: "d8", total: 3, spent: 0 },
    proficiencies: {
      saves: ["dex", "int"],
      skills: ["perception", "investigation", "athletics", "survival"],
      languages: ["common"],
      tools: [],
      armor: [],
      weapons: ["shortsword"],
    },
    equipment: [{ name: "Shortsword", qty: 1 }, { name: "Rope", qty: 1 }],
    gold: 12,
  });
}

// Answer every parked roll with the server's dice, as the pending-rolls
// route's digital fallback does, then let the turn resume.
async function settleRolls(campaignId) {
  for (let round = 0; round < 4; round += 1) {
    const open = listOpenPendingRolls(campaignId);
    if (!open.length) return;
    let turnId = "";
    for (const pending of open) {
      const roll = insertRoll({
        campaignId,
        characterId: pending.characterId,
        requestedBy: "player",
        kind: pending.kind,
        detail: pending.detail,
        advantage: pending.advantage,
        dc: pending.dc,
        result: rollExpression(pending.expression),
      });
      resolvePendingRoll(pending.id, "fallback", roll.id);
      turnId = pending.turnId;
    }
    if (turnId && !listPendingForTurn(turnId).some((entry) => entry.status === "pending")) {
      await resumeDmTurn(campaignId, turnId);
    }
  }
}

let lastSettings = null;
async function playRun(runNumber) {
  const lead = createUser(`lead${runNumber}${randomBytes(2).toString("hex")}`, "x");
  const other = createUser(`bram${runNumber}${randomBytes(2).toString("hex")}`, "x");
  const campaign = createCampaign(lead.id, {
    title: "The Salt Road",
    description: "A one-scene caravan job that goes wrong at the ford.",
    theme: "low fantasy, coastal trade road",
    maxPlayers: 4,
    startingLevel: 3,
    difficulty: "normal",
    // Nothing outside the text model: no narration audio.
    gameSettings: { ttsEnabled: false },
  });
  updateStorySettings(campaign.id, {
    textProvider: PROVIDER,
    ...(PROVIDER === "custom"
      ? { customBaseUrl: args.url, customModel: args.model, customApiKey: args.key }
      : { localTextModel: args.model }),
    imageGenerationEnabled: false,
    autoImages: false,
  });
  const settings = getCampaignById(campaign.id).settings;
  lastSettings = settings;
  const resolvedModel = PROVIDER === "custom" ? settings.customModel : settings.localTextModel;
  assert.equal(resolvedModel, args.model, `the campaign runs ${resolvedModel}, not ${args.model}`);
  setCampaignStatus(campaign.id, "active");
  const players = {
    avery: { user: lead, sheet: createSheet(campaign.id, lead.id, 3, sheet("Avery", "rogue", { str: 10, dex: 17, con: 13, int: 12, wis: 12, cha: 11 })) },
    bram: { user: other, sheet: createSheet(campaign.id, other.id, 3, sheet("Bram", "fighter", { str: 16, dex: 12, con: 15, int: 9, wis: 11, cha: 10 })) },
  };

  captured = [];
  const setupStarted = Date.now();
  await runStorySetup(campaign.id);
  await generateStoryArc(campaign.id);
  const setupSeconds = Math.round((Date.now() - setupStarted) / 1000);
  const arc = getCampaignById(campaign.id).storyArc;

  const turns = [];
  for (const script of TURNS.slice(0, MAX_TURNS)) {
    const player = players[script.who];
    const playerSeq = allocateSeq(campaign.id);
    insertCampaignMessage({
      campaignId: campaign.id,
      seq: playerSeq,
      authorType: "player",
      userId: player.user.id,
      characterId: player.sheet.id,
      content: script.text,
    });
    captured = [];
    const rollsBefore = listRecentRolls(campaign.id, 500).length;
    const started = Date.now();
    let thrown = null;
    try {
      await startDmTurn(campaign.id);
      await settleRolls(campaign.id);
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    const lines = captured;
    const calls = lines.map(parseCall).filter(Boolean);
    const rescues = lines.map(parseRescue).filter(Boolean);
    // Only what this turn wrote: a turn that halted writes a system notice
    // and no narration, and must not be scored on the turn before it.
    const written = listRecentMessages(campaign.id, 400).filter((message) => message.seq > playerSeq);
    const dm = written.filter((message) => message.authorType === "dm");
    const halted = written.find((message) => message.authorType === "system" && message.content.startsWith(DM_HALTED_PREFIX));
    const narration = String(dm[dm.length - 1]?.content ?? "").replace(ROLL_MARKER, "").trim();
    const stored = getDmTurn(getLatestDmTurnId(campaign.id));
    const toolNames = new Set(calls.flatMap((call) => call.tools));
    for (const message of stored?.conversation ?? []) {
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        if (call?.function?.name) toolNames.add(call.function.name);
      }
    }
    const empty = !halted && isEmptyTurn(narration);
    const turn = {
      label: script.label,
      seconds,
      calls: calls.length,
      // The turn loop asks an empty reply again under the same call index.
      emptyRetries: calls.filter((call, index) => index > 0 && call.index === calls[index - 1].index).length,
      tools: calls.flatMap((call) => call.tools),
      rolls: listRecentRolls(campaign.id, 500).length - rollsBefore,
      encounter: Boolean(getActiveEncounter(campaign.id)),
      empty,
      cause: empty ? emptyCause(calls, rescues) : null,
      rescues: rescues.map((rescue) => (rescue.ok ? "ok" : "empty")),
      artifacts: empty ? [] : artifactsIn(narration, toolNames),
      narration,
      callLog: calls.map((call) => ({ index: call.index, content: String(call.content).slice(0, 300), tools: call.tools })),
    };
    turn.error = thrown ?? (halted ? halted.content.slice(DM_HALTED_PREFIX.length) : null);
    turn.softFail = turn.error
      ? `the turn ${thrown ? "threw" : "halted"}: ${turn.error}`
      : script.expect
        ? script.expect(turn)
        : null;
    turns.push(turn);

    const flags = [
      turn.empty ? `EMPTY:${turn.cause}` : "",
      ...Array(turn.emptyRetries).fill("empty-retry"),
      ...turn.rescues.map((rescue) => `leak-rescue:${rescue}`),
      ...turn.artifacts.map((artifact) => `ARTIFACT:${artifact.kind}`),
      turn.softFail ? `MISSED:${turn.softFail}` : "",
    ].filter(Boolean);
    say(`  run ${runNumber} ${turn.label.padEnd(10)} ${String(seconds).padStart(4)}s ${turn.calls} calls  tools: ${turn.tools.join(", ") || "(none)"}${flags.length ? `  [${flags.join("; ")}]` : ""}`);
  }

  const encounter = getActiveEncounter(campaign.id);
  return {
    run: runNumber,
    setupSeconds,
    arc: arc ? { antagonist: arc.antagonist, beats: arc.beats.length } : null,
    turns,
    state: {
      encounter: encounter
        ? { round: encounter.round, enemies: listEnemies(encounter.id).map((enemy) => `${enemy.displayName} ${enemy.currentHp}/${enemy.maxHp}`) }
        : null,
      sheets: listSheets(campaign.id).map((entry) => {
        const fresh = getSheetById(entry.id);
        return `${fresh.name} ${fresh.currentHp}/${fresh.maxHp}`;
      }),
      quests: listQuests(campaign.id).length,
      facts: listActiveFacts(campaign.id).length,
      npcs: listNpcs(campaign.id).map((npc) => npc.name),
      rolls: listRecentRolls(campaign.id, 500).length,
    },
  };
}

// ---- the runs -------------------------------------------------------------------
say(`smoke-local ${VERSION}: ${LABEL} | provider ${PROVIDER} | ${PROVIDER === "custom" ? args.url : process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"} | ${RUNS} run(s) x ${MAX_TURNS} turn(s)`);
const runs = [];
for (let run = 1; run <= RUNS; run += 1) {
  runs.push(await playRun(run));
}
// The window the DM prompt was packed against, as the turn loop resolved it.
const context = storyContextTokens(lastSettings);

const turns = runs.flatMap((run) => run.turns);
const tally = (values) => values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
const summary = {
  turns: turns.length,
  empty: turns.filter((turn) => turn.empty).length,
  emptyCauses: tally(turns.filter((turn) => turn.empty).map((turn) => turn.cause)),
  emptyRetries: turns.reduce((sum, turn) => sum + turn.emptyRetries, 0),
  rescueOk: turns.flatMap((turn) => turn.rescues).filter((rescue) => rescue === "ok").length,
  rescueEmpty: turns.flatMap((turn) => turn.rescues).filter((rescue) => rescue === "empty").length,
  artifacts: turns.filter((turn) => turn.artifacts.length).length,
  artifactKinds: tally(turns.flatMap((turn) => turn.artifacts.map((artifact) => artifact.kind))),
  softFails: turns.filter((turn) => turn.softFail).length,
  calls: turns.reduce((sum, turn) => sum + turn.calls, 0),
  meanSeconds: Math.round(turns.reduce((sum, turn) => sum + turn.seconds, 0) / Math.max(1, turns.length)),
};
const report = {
  label: LABEL,
  version: VERSION,
  provider: PROVIDER,
  model: args.model,
  url: PROVIDER === "custom" ? args.url : process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  contextTokens: context,
  finishedAt: new Date().toISOString(),
  summary,
  runs,
};

say("");
for (const [key, title] of METRICS) say(`${title}: ${formatValue(summary[key])}`);
if (args.out) {
  fs.mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, `${LABEL.replace(/[^\w.-]+/g, "_")}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  say(`report: ${file}`);
}
console.log = realLog;
console.warn = realWarn;
console.error = realError;
removeTempDir(dir);
