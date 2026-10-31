// The card scorer (issue 570): how often does a real model resolve what the
// player asked for? Fixed scenarios with seeded dice (scripts/lib/card-
// scenarios.mjs), each one card from the Hand at a staged table, scored on
// the tool calls the DM turn made and never on its prose
// (src/lib/dm/card-score-logic.ts). NOT part of npm test: it spends a few
// dozen to a few hundred calls on the model named.
//
// The reference model is the one the README documents as the default for a
// local table (qwen3.6-35b on llama.cpp); a before/after number for a change
// to the prompt, the tools or the Hand is taken on it, and on any other model
// the change is about.
//
//   OPENAI_COMPAT_API_KEY=... node scripts/score-cards.mjs --model qwen3.6-35b --out /tmp/cards
//   node scripts/score-cards.mjs --model qwen3.6-35b --only spell- --runs 2 --label before
//   node scripts/score-cards.mjs --compare /tmp/cards/before.json /tmp/cards/after.json
//   node scripts/score-cards.mjs --list
//
// The same scorer over an instance's own saved turns (counts only, no story
// text, nothing a table could not share):
//
//   DB_ENCRYPTION_KEY=... node scripts/score-cards.mjs --saved /path/to/odm.sqlite
//
// A worktree has no data/ of its own: point CONTENT_DB_PATH at a content
// pack, or the Hand deals the bundled SRD spells only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: process.env.OPENAI_COMPAT_BASE_URL || "http://127.0.0.1:8001/v1" },
    model: { type: "string", default: "" },
    key: { type: "string", default: process.env.OPENAI_COMPAT_API_KEY || process.env.LLAMA_API_KEY || "" },
    runs: { type: "string", default: "1" },
    only: { type: "string", default: "" },
    seed: { type: "string", default: "570" },
    label: { type: "string", default: "" },
    out: { type: "string", default: "" },
    context: { type: "string", default: "" },
    compare: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    saved: { type: "string", default: "" },
    verbose: { type: "boolean", default: false },
  },
});

const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const SUMMARY_ROWS = [
  ["scenarios", "Cards played"],
  ["verdict.resolved", "Resolved by the right call"],
  ["verdict.refused", "Answered with a rules refusal"],
  ["verdict.missed", "Missed: nothing carried the card out"],
  ["path.engine", "… resolved by the engine before the model"],
  ["path.model", "… resolved by the model on its own"],
  ["path.correction", "… resolved only after the correction"],
  ["near", "How the near misses fell short"],
  ["narratedWhenMissed", "Missed cards the story told anyway"],
  ["modelCalls", "Model calls"],
  ["meanSeconds", "Mean seconds per card"],
  ["stageErrors", "Scenarios that could not be staged"],
  ["errors", "Turns that threw or halted"],
];

function pick(summary, key) {
  return key.split(".").reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), summary);
}

function formatValue(value) {
  if (value === undefined) return "–";
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, count]) => count);
    return entries.length ? entries.map(([key, count]) => `${key} ${count}`).join(", ") : "none";
  }
  return String(value);
}

if (args.list) {
  const { SCENARIOS } = await import("./lib/card-scenarios.mjs");
  for (const scenario of SCENARIOS) {
    console.log(`${scenario.id.padEnd(34)} ${scenario.group.padEnd(9)} ${scenario.actor.padEnd(10)} ${scenario.card}${scenario.outOfFight ? "  (out of a fight)" : ""}`);
  }
  process.exit(0);
}

if (args.compare) {
  const reports = positionals.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  if (!reports.length) {
    console.error("--compare needs report files");
    process.exit(2);
  }
  const header = ["", ...reports.map((report) => `${report.label} (${report.version})`)];
  console.log(`| ${header.join(" | ")} |`);
  console.log(`|${header.map(() => "---").join("|")}|`);
  for (const [key, title] of SUMMARY_ROWS) {
    console.log(`| ${title} | ${reports.map((report) => formatValue(pick(report.summary, key))).join(" | ")} |`);
  }
  // Per scenario, so a change that fixed one card and broke another shows.
  const ids = [...new Set(reports.flatMap((report) => (report.scenarios ?? []).map((entry) => entry.id)))];
  if (ids.length) {
    console.log("");
    console.log(`| scenario | ${reports.map((report) => report.label).join(" | ")} |`);
    console.log(`|---|${reports.map(() => "---").join("|")}|`);
    for (const id of ids) {
      const cells = reports.map((report) => {
        const entries = (report.scenarios ?? []).filter((entry) => entry.id === id);
        return entries.length ? entries.map((entry) => `${entry.verdict}/${entry.path}`).join(", ") : "–";
      });
      console.log(`| ${id} | ${cells.join(" | ")} |`);
    }
  }
  process.exit(0);
}

// ---- an instance's saved turns ------------------------------------------------
// Opens a copy of the database named (never the live file: the server holds
// it), finds every player message that carried a card, pairs it with the DM
// turn that answered it, and scores the pair. Prints counts only.
if (args.saved) {
  if (!process.env.DB_ENCRYPTION_KEY) {
    console.error("--saved needs the instance's DB_ENCRYPTION_KEY in the environment");
    process.exit(2);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-score-saved-"));
  const copy = path.join(dir, "saved.sqlite");
  fs.copyFileSync(args.saved, copy);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(`${args.saved}${suffix}`)) fs.copyFileSync(`${args.saved}${suffix}`, `${copy}${suffix}`);
  }
  process.env.SQLITE_DB_PATH = copy;
  const { register } = await import("node:module");
  register("./lib/register-alias.mjs", import.meta.url);
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const { getDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { parseMessageIntent } = await import("../src/lib/dm/intent-logic.ts");
  const { scoreCard, tallyScores } = await import("../src/lib/dm/card-score-logic.ts");
  const { spellMechanicsFor } = await import("../src/lib/content/index.ts");
  const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
  const { spellAuthorsFor } = await import("../src/lib/dm/spell-authors.ts");
  const { getSheetById } = await import("../src/lib/db/sheets.ts");
  const db = getDatabase();
  const played = db
    .prepare(
      `SELECT id, campaign_id, seq, character_id, intent_json FROM campaign_messages
       WHERE author_type = 'player' AND intent_json IS NOT NULL ORDER BY campaign_id, seq`,
    )
    .all();
  const answering = db.prepare(
    `SELECT dm_turn_id FROM campaign_messages
     WHERE campaign_id = ? AND seq > ? AND dm_turn_id IS NOT NULL ORDER BY seq LIMIT 1`,
  );
  // So a count of zero cards can be read: how much play the file holds.
  const playerMessages = db.prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE author_type = 'player'`).get().n;
  const dmTurns = db.prepare(`SELECT COUNT(*) AS n FROM dm_turns`).get().n;
  const scores = [];
  const byCard = {};
  let unanswered = 0;
  let allCards = 0;
  for (const row of played) {
    const intent = parseMessageIntent(JSON.parse(row.intent_json));
    if (!intent) continue;
    allCards += 1;
    const next = answering.get(row.campaign_id, row.seq);
    const turn = next?.dm_turn_id ? getDmTurn(next.dm_turn_id) : null;
    if (!turn) {
      unanswered += 1;
      continue;
    }
    const campaign = getCampaignById(row.campaign_id);
    const sheet = row.character_id ? getSheetById(row.character_id) : null;
    const spell = intent.card === "spell" || intent.card === "reaction" ? intent.spell : undefined;
    const resolution = spell && campaign ? (spellMechanicsFor({ spell, userIds: spellAuthorsFor(campaign) })?.mech.resolution ?? null) : null;
    const score = scoreCard({ intent, characterId: row.character_id, name: sheet?.name ?? "The player", resolution }, turn.conversation, { callIndex: turn.callIndex });
    scores.push(score);
    const kind = intent.card === "basic" ? `basic:${intent.action ?? "?"}` : intent.card === "gear" ? `gear:${intent.action ?? "?"}` : intent.card;
    const bucket = (byCard[kind] ??= { cards: 0, resolved: 0, refused: 0, missed: 0, engine: 0, model: 0, correction: 0 });
    bucket.cards += 1;
    bucket[score.verdict] += 1;
    if (score.path !== "none") bucket[score.path] += 1;
  }
  const near = {};
  for (const score of scores) for (const reason of score.near) near[reason] = (near[reason] ?? 0) + 1;
  const report = {
    kind: "saved-turns",
    version: VERSION,
    finishedAt: new Date().toISOString(),
    summary: {
      playerMessages,
      dmTurns,
      cards: allCards,
      scored: scores.length,
      unanswered,
      ...tallyScores(scores),
      near,
      // Cards the engine's corrective message chased, and how many of those
      // it recovered.
      corrected: scores.filter((score) => score.corrected).length,
      correctedAndResolved: scores.filter((score) => score.corrected && score.verdict !== "missed").length,
    },
    byCard,
  };
  console.log(JSON.stringify(report, null, 2));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

// ---- the live run -------------------------------------------------------------
if (!args.model) {
  console.error("--model is required (or --list, --compare, --saved)");
  process.exit(2);
}
if (args.context) process.env.OPENAI_COMPAT_CONTEXT = args.context;
const RUNS = Math.max(1, Number.parseInt(args.runs, 10) || 1);
const LABEL = args.label || args.model;
const SEED = Number.parseInt(args.seed, 10) || 570;

// The enforcement world points the database at a scratch directory as it
// loads, so it comes first.
const { SCENARIOS } = await import("./lib/card-scenarios.mjs");
const { liveBackend, playScenario, summarize, StageError } = await import("./lib/card-score.mjs");
const { storyContextTokens } = await import("../src/lib/model-client.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

const chosen = args.only ? SCENARIOS.filter((scenario) => scenario.id.includes(args.only) || scenario.group === args.only) : SCENARIOS;
if (!chosen.length) {
  console.error(`--only ${args.only} matches no scenario; see --list`);
  process.exit(2);
}
const backend = liveBackend({ url: args.url, model: args.model, key: args.key });
const contentDb = process.env.CONTENT_DB_PATH || path.join(process.cwd(), "data", "content", "open5e.sqlite");
console.log(`score-cards ${VERSION}: ${LABEL} | ${args.url} | ${chosen.length} scenario(s) x ${RUNS} run(s) | seed ${SEED}`);
if (!fs.existsSync(contentDb)) {
  console.log(`  warning: no content pack at ${contentDb}; the Hand deals the bundled SRD spells only (set CONTENT_DB_PATH)`);
}

// Quiet the turn loop's own lines; the per-card line below is the record.
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
const quiet = (line) => /^\[dm|^\[harness|^\[tts|^\[queue|^\[warmup|^\[claims/.test(line);
console.log = (...parts) => {
  const line = parts.map(String).join(" ");
  if (!quiet(line) && args.verbose) realLog(line);
};
console.warn = (...parts) => {
  const line = parts.map(String).join(" ");
  if (!quiet(line) && args.verbose) realWarn(line);
};
console.error = (...parts) => {
  if (args.verbose) realError(...parts);
};
const say = (line = "") => realLog(line);

const results = [];
const stageErrors = [];
let contextTokens = null;
for (let run = 1; run <= RUNS; run += 1) {
  for (const [index, scenario] of chosen.entries()) {
    let result;
    try {
      result = await playScenario(scenario, { backend, seed: SEED + index * 1000 + run });
    } catch (error) {
      if (error instanceof StageError) {
        stageErrors.push({ id: scenario.id, run, message: error.message });
        say(`  run ${run} ${scenario.id.padEnd(34)} STAGE  ${error.message}`);
        continue;
      }
      throw error;
    }
    results.push({ ...result, run });
    const flags = [
      result.error ? `ERROR:${result.error.slice(0, 80)}` : "",
      result.score.verdict === "missed" && result.narrated ? "narrated-anyway" : "",
      result.score.near.length ? `near:${result.score.near.join("+")}` : "",
    ].filter(Boolean);
    say(
      `  run ${run} ${scenario.id.padEnd(34)} ${`${result.score.verdict}/${result.score.path}`.padEnd(20)} ${String(result.seconds).padStart(6)}s ${result.score.modelCalls} calls  tools: ${result.score.calls.join(", ") || "(none)"}${flags.length ? `  [${flags.join("; ")}]` : ""}`,
    );
    if (args.verbose && result.narration) {
      say(`           ${result.narration.replace(/\s+/g, " ").slice(0, 300)}`);
    }
    contextTokens ??= storyContextTokens(getCampaignById(result.campaignId ?? "")?.settings ?? {});
  }
}

const summary = await summarize(results, stageErrors);
say("");
for (const [key, title] of SUMMARY_ROWS) say(`${title}: ${formatValue(pick(summary, key))}`);
say("");
say("By group:");
for (const [group, counts] of Object.entries(summary.groups)) {
  say(`  ${group.padEnd(9)} ${counts.resolved + counts.refused}/${counts.scenarios} resolved (engine ${counts.engine}, model ${counts.model}, after correction ${counts.correction})`);
}
if (args.out) {
  fs.mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, `${LABEL.replace(/[^\w.-]+/g, "_")}.json`);
  const report = {
    label: LABEL,
    version: VERSION,
    model: args.model,
    url: args.url,
    seed: SEED,
    runs: RUNS,
    finishedAt: new Date().toISOString(),
    summary,
    stageErrors,
    scenarios: results.map((result) => ({
      id: result.id,
      run: result.run,
      group: result.group,
      card: result.card,
      verdict: result.score.verdict,
      path: result.score.path,
      near: result.score.near,
      calls: result.score.calls,
      modelCalls: result.score.modelCalls,
      corrected: result.score.corrected,
      narrated: result.narrated,
      seconds: result.seconds,
      error: result.error,
      ...(args.verbose ? { narration: result.narration } : {}),
    })),
  };
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  say(`report: ${file}`);
}
console.log = realLog;
console.warn = realWarn;
console.error = realError;
process.exit(0);
