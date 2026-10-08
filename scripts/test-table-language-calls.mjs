// The table language reaches every model call that writes for people, and
// none that only a machine reads. Prose calls are run against a fake model
// for an Italian and an English table and the system prompt they sent is
// read back; a source scan then holds every model call site in the code to
// a classification, so a call added later has to be put on one side.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-table-language-calls");
const italian = await openWorld({ gameSettings: { ttsEnabled: false, tableLanguage: "italian" } });
const english = await openWorld({ gameSettings: { ttsEnabled: false } });

const { languageDirective } = await import("../src/lib/dm/table-language-logic.ts");
const { suggestAdjudication, generateRollTable } = await import("../src/lib/dm/assist.ts");
const { suggestNpcField } = await import("../src/lib/dm/npc-suggest.ts");
const { describeOverworld } = await import("../src/lib/dm/overworld-describe.ts");
const { readClaims } = await import("../src/lib/dm/claims.ts");
const { guardOutcomes } = await import("../src/lib/dm/engine-boundary.ts");
const { forgeFromNotes, askTheWorld, draftEntry } = await import("../src/lib/dm/world-ai.ts");
const { createWorldEntity } = await import("../src/lib/db/world-forge.ts");

const DIRECTIVE = languageDirective("italian");
const system = (request) => request.messages[0].content;

// Runs `fn` for each table against its own fake model and returns the
// system prompts each sent.
async function prompts(fn) {
  const out = {};
  for (const [name, world] of [["italian", italian], ["english", english]]) {
    const model = await fakeModel();
    model.pointAt(world);
    model.script(Array.from({ length: 4 }, () => reply({ text: '{"name":"request_roll","args":{},"why":"x"}' })));
    await fn(world.campaign());
    out[name] = [...model.requests, ...model.readerRequests].map(system);
    model.close();
  }
  return out;
}

const entryRefs = new Map(
  [italian, english].map((world) => [world.campaignId, createWorldEntity(world.campaignId, { typeId: "t_location", name: "Porto Grigio" }).entity.ref]),
);

await test("Prose calls carry the directive at an Italian table and read exactly as before at an English one.", async () => {
  const calls = {
    "assist suggestion": (campaign) => suggestAdjudication(campaign, "I search the room for traps", { inEncounter: false }),
    "roll table": (campaign) => generateRollTable(campaign, { prompt: "incontri al porto", rows: 3 }),
    "npc suggestion": (campaign) => suggestNpcField(campaign, { field: "trait", name: "Bruno" }),
    "overworld description": (campaign) => describeOverworld(campaign, "Una valle di nebbie e torri."),
    "WorldForge forge": (campaign) => forgeFromNotes(campaign, "Bruno, il fabbro di Porto Grigio.", ""),
    "WorldForge ask": (campaign) => askTheWorld(campaign, "Chi governa Porto Grigio?"),
    "WorldForge draft": (campaign) => draftEntry(campaign, entryRefs.get(campaign.id), ""),
  };
  for (const [label, fn] of Object.entries(calls)) {
    const sent = await prompts(fn);
    assert.ok(sent.italian.length > 0, `${label}: no call was made`);
    for (const prompt of sent.italian) {
      assert.ok(prompt.endsWith(`\n\n${DIRECTIVE}`), `${label}: no directive at the Italian table`);
    }
    for (const prompt of sent.english) {
      assert.ok(!prompt.includes("TABLE LANGUAGE"), `${label}: a directive at the English table`);
    }
    assert.deepEqual(
      sent.italian.map((prompt) => prompt.slice(0, -`\n\n${DIRECTIVE}`.length)),
      sent.english,
      `${label}: the Italian prompt is not the English one plus the directive`,
    );
  }
});

await test("The claims reader, which only a machine reads, never carries the directive.", async () => {
  const sent = await prompts((campaign) =>
    readClaims(campaign, {
      label: "test",
      text: "Tirate per l'iniziativa!",
      kinds: ["fight_start"],
      outcomes: guardOutcomes([], null),
      sheets: [],
    }),
  );
  assert.equal(sent.italian.length, 1);
  assert.ok(!sent.italian[0].includes("TABLE LANGUAGE"));
});

// ---- every call site, classified ----

const root = path.resolve(import.meta.dirname, "..");
const CALL = /\b(?:requestUtilityMessage|requestDmMessage|arcModelCall)\(/g;

// Every file under src/ that makes a model call, and how many of its calls
// write for people (they must carry the directive, through withLanguage or
// the DM's own system prompt) and how many only a machine reads.
const CLASSIFIED = {
  // The DM turn and everything that replays its conversation: the system
  // prompt is buildDmSystem's, which carries the directive.
  "src/lib/dm/turn.ts": { prose: 3, machine: 0 },
  "src/lib/dm/continue-scene.ts": { prose: 1, machine: 0 },
  "src/lib/dm/renarrate.ts": { prose: 1, machine: 0 },
  "src/lib/dm/narration-guard.ts": { prose: 1, machine: 0 },
  // A delegated monster turn's narration (buildDmSystem) and its decision,
  // a JSON pick of action and target.
  "src/lib/dm/delegate.ts": { prose: 1, machine: 1 },
  // The saga, the arc passes (arcModelCall: its declaration, its one model
  // call and its seven callers) and the act recap; the beat judge answers
  // YES or NO.
  "src/lib/dm/arc.ts": { prose: 11, machine: 1 },
  "src/lib/dm/ask.ts": { prose: 2, machine: 0 },
  "src/lib/dm/assist.ts": { prose: 2, machine: 0 },
  "src/lib/dm/beats.ts": { prose: 1, machine: 0 },
  "src/lib/dm/chapter-close.ts": { prose: 1, machine: 0 },
  "src/lib/dm/compaction.ts": { prose: 2, machine: 0 },
  "src/lib/dm/lore-check.ts": { prose: 1, machine: 0 },
  "src/lib/dm/npc-suggest.ts": { prose: 1, machine: 0 },
  "src/lib/dm/overworld-describe.ts": { prose: 1, machine: 0 },
  "src/lib/dm/recap.ts": { prose: 1, machine: 0 },
  "src/lib/dm/setup.ts": { prose: 1, machine: 0 },
  "src/lib/dm/world-arc.ts": { prose: 1, machine: 0 },
  // WorldForge's forge, ask and draft, through one helper.
  "src/lib/dm/world-ai.ts": { prose: 1, machine: 0 },
  // The claims reader and the waypoint judge: a JSON claim list, a list of
  // step numbers.
  "src/lib/dm/claims.ts": { prose: 0, machine: 1 },
  "src/lib/dm/waypoint-tick.ts": { prose: 0, machine: 1 },
  // The rules desk has no campaign, so no table language.
  "src/lib/reference/desk.ts": { prose: 0, machine: 1 },
  // The routers themselves.
  "src/lib/dm/model.ts": { prose: 0, machine: 0, router: true },
};

await test("Every model call site in the code is classified, and every file with a prose call reaches the directive.", () => {
  const found = {};
  const src = path.join(root, "src");
  for (const file of fs.readdirSync(src, { recursive: true }).map((entry) => path.join(src, String(entry))).filter((entry) => /\.tsx?$/.test(entry))) {
    const source = fs.readFileSync(file, "utf8");
    const count = source.match(CALL)?.length ?? 0;
    if (count) {
      found[path.relative(root, file).split(path.sep).join("/")] = { count, source };
    }
  }
  for (const [file, { count, source }] of Object.entries(found)) {
    const entry = CLASSIFIED[file];
    assert.ok(entry, `${file} makes a model call nobody classified as prose or machine-read`);
    if (entry.router) {
      continue;
    }
    assert.equal(count, entry.prose + entry.machine, `${file} has ${count} model calls; classify the new one`);
    if (entry.prose) {
      assert.ok(
        /withLanguage\(|buildDmSystem\(|\.conversation\b/.test(source),
        `${file} writes for people but never reaches the table-language directive`,
      );
    }
  }
  for (const file of Object.keys(CLASSIFIED)) {
    assert.ok(found[file], `${file} is classified but makes no model call any more`);
  }
});

italian.close();
english.close();
finish();
