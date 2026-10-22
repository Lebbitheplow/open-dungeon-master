// Issues #301 and #302 against a real database: a storyboard larger than
// the old arc caps imports whole, every card is kept as a prep card the
// storyteller can open and search, the arc's lines point back at their
// cards, the prompt's trace says which events it showed, and a second
// import updates the cards rather than numbering duplicates.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "odm-prep-cards-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// No model download: the local embedder is stubbed the way the workshop
// integration suite stubs it, so search falls to its lexical half.
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { insertBeat, listBeats, updateBeat } = await import("../src/lib/db/workshop-beats.ts");
const { checkBeat } = await import("../src/lib/workshop/board.ts");
const { planContentImport, runContentImport } = await import("../src/lib/db/content-import.ts");
const { listPrepCards } = await import("../src/lib/db/prep-cards.ts");
const { handleReadCard } = await import("../src/lib/dm/prep-card-tool.ts");
const { handleSearchLore } = await import("../src/lib/dm/lore-search.ts");
const { buildDmMessages } = await import("../src/lib/dm/prompt.ts");
const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { ARC_LIMITS } = await import("../src/lib/dm/arc-logic.ts");
getDatabase();

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const userId = randomUUID();
getDatabase()
  .prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`)
  .run(userId, `prep-${userId.slice(0, 8)}`, new Date().toISOString());
const workshop = createWorkshop(userId, { title: "The Drowned Coast", targetParty: { size: 4, level: 3 } });

// A board past the old caps: 50 scenes in a chain (beats) and 30 scenes on
// optional routes (moments), one of them long and many-lined.
const LONG_BODY = [
  "The keeper's cottage smells of fish oil and old rope. Ewan sits by the lamp with his back to the door.",
  "If the party mentions the cistern, he goes very still. [[Marla]] knows what he did; she has not said.",
  "Searching the cellar (DC 13 Investigation) finds the brother's boots, wrapped in sailcloth.",
  "",
  "If confronted, Ewan does not fight. He asks them to tell the village it was the sea.",
].join("\n");
assert.ok(LONG_BODY.length >= 300);
const chain = [];
for (let i = 1; i <= 50; i += 1) {
  const body = i === 12 ? LONG_BODY : `Scene ${i} of the chain. The road goes on.`;
  const created = insertBeat(workshop.id, checkBeat({ kind: "event", title: i === 12 ? "The keeper's confession" : `Chain scene ${i}`, body }).beat);
  chain.push(created);
}
insertBeat(workshop.id, checkBeat({ kind: "backstory", title: "What happened before", body: "The river took the lower village. The mill still turns." }).beat);
const routes = [];
for (let i = 1; i <= 30; i += 1) {
  const title = i === 20 ? "The lighthouse bargain" : `Route scene ${i}`;
  const body = i === 20 ? "At the Grey Lighthouse the keeper offers the party the lamp oil in exchange for silence about the cistern." : `A side scene, number ${i}.`;
  routes.push(insertBeat(workshop.id, checkBeat({ kind: "npc_moment", title, body }).beat));
}
// The chain: plain arrows in order. Each route scene hangs off the first
// chain card as an optional route.
for (let i = 0; i < chain.length; i += 1) {
  const edges = i + 1 < chain.length ? [chain[i + 1].id] : [];
  const routesOut = i === 0 ? routes.map((card) => card.id) : [];
  const card = listBeats(workshop.id).find((beat) => beat.id === chain[i].id);
  updateBeat(workshop.id, card.id, {
    ...card,
    edges: [...edges, ...routesOut].slice(0, 8),
    routes: Object.fromEntries(routesOut.slice(0, 7).map((id) => [id, { kind: "optional", label: "if they go looking" }])),
  });
}
// Eight arrows is the board's cap per card; spread the rest of the routes
// over the next chain cards.
let at = 1;
for (let r = 7; r < routes.length; r += 7) {
  const card = listBeats(workshop.id).find((beat) => beat.id === chain[at].id);
  const batch = routes.slice(r, r + 7).map((entry) => entry.id);
  updateBeat(workshop.id, card.id, {
    ...card,
    edges: [...card.edges, ...batch].slice(0, 8),
    routes: { ...(card.routes ?? {}), ...Object.fromEntries(batch.map((id) => [id, { kind: "optional", label: "if they go looking" }])) },
  });
  at += 1;
}

const campaign = createCampaign(userId, {
  title: "A table for the coast",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 3,
  difficulty: "normal",
});

test("the plan says every card is kept whole and nothing overflows the caps", () => {
  const plan = planContentImport(workshop.id, campaign.id, ["storyboard"]);
  assert.ok(plan.notes.some((note) => /kept whole as a prep card/.test(note.message)), plan.notes.map((note) => note.message).join("\n"));
  assert.ok(!plan.warnings.some((warning) => /cannot join it/.test(warning.message)), plan.warnings.map((warning) => warning.message).join("\n"));
  assert.ok(plan.board.beats === 50, `${plan.board.beats} beats planned`);
});

const outcome = runContentImport({ sourceId: workshop.id, campaignId: campaign.id, selection: ["storyboard"], houseRulesMode: "replace" });
assert.ok(!("error" in outcome), outcome.error);

test("an arc past the old caps keeps every beat and every moment", () => {
  const arc = getCampaignById(campaign.id).storyArc;
  assert.ok(arc, "no arc was written");
  assert.equal(arc.beats.length, 50, `${arc.beats.length} beats (the old cap was 40)`);
  assert.equal(arc.events.length, 30, `${arc.events.length} events (the old cap was 24)`);
  assert.ok(arc.beats.every((beat) => beat.cardId), "a beat lost its card reference");
  assert.ok(arc.events.every((event) => event.cardId), "an event lost its card reference");
});

test("every card is a prep card, whole, with what it became", () => {
  const cards = listPrepCards(campaign.id);
  assert.equal(cards.length, 81, `${cards.length} prep cards`);
  const keeper = cards.find((card) => card.title === "The keeper's confession");
  assert.equal(keeper.body, LONG_BODY, "the long card lost text or its line breaks");
  assert.equal(keeper.role, "beat");
  assert.equal(cards.find((card) => card.title === "The lighthouse bargain").role, "moment");
  assert.equal(cards.find((card) => card.title === "What happened before").role, "lore");
  assert.equal(cards.find((card) => card.title === "The lighthouse bargain").trigger.startsWith("Only if they go looking"), true);
});

test("read_card opens a card by beat number, event id and title", () => {
  const fresh = getCampaignById(campaign.id);
  const arc = fresh.storyArc;
  const beatNumber = arc.beats.findIndex((beat) => beat.text.startsWith("The keeper's confession")) + 1;
  assert.ok(beatNumber > 0);
  const byNumber = handleReadCard(fresh, JSON.stringify({ ref: String(beatNumber) }));
  assert.equal(byNumber.text, LONG_BODY);
  assert.match(byNumber.standing, new RegExp(`^main beat ${beatNumber} \\(`));
  const event = arc.events.find((entry) => entry.name === "The lighthouse bargain");
  const byEvent = handleReadCard(fresh, JSON.stringify({ ref: event.id }));
  assert.match(byEvent.text, /lamp oil/);
  assert.match(byEvent.standing, /^planned event \[ev\d+\] \(pending\)/);
  const byTitle = handleReadCard(fresh, JSON.stringify({ ref: "the LIGHTHOUSE bargain" }));
  assert.equal(byTitle.title, "The lighthouse bargain");
  assert.match(handleReadCard(fresh, JSON.stringify({ ref: "ev999" })).error, /No prep card answers/);
  assert.match(handleReadCard(fresh, "{}").error, /Say which card/);
});

test("the tool is offered only to a campaign with prep cards", () => {
  const names = (table) => dmTurnTools(table, false, false, false).map((tool) => tool.function.name);
  assert.ok(names(getCampaignById(campaign.id)).includes("read_card"));
  const bare = createCampaign(userId, { title: "Bare", description: "", theme: "", maxPlayers: 5, startingLevel: 1, difficulty: "normal" });
  assert.ok(!names(getCampaignById(bare.id)).includes("read_card"));
});

test("search_lore finds a held-back card by its passage, not its head", async () => {
  const result = await handleSearchLore(campaign.id, JSON.stringify({ query: "cistern boots sailcloth cellar" }));
  const hit = result.results.find((entry) => entry.source.startsWith("prep card"));
  assert.ok(hit, JSON.stringify(result.results.map((entry) => [entry.source, entry.ref])));
  assert.match(hit.ref, /The keeper's confession \(beat \d+, (pending|active); read_card \d+ for the whole card\)/);
  assert.match(hit.text, /boots, wrapped in sailcloth/, "the search showed the card's head, not the passage asked about");
});

test("the prompt shows the scene's event first and records what it held back", () => {
  const fresh = getCampaignById(campaign.id);
  const state = {
    campaign: fresh,
    members: [],
    sheets: [],
    recentRolls: [],
    storySummary: "",
    currentLocation: { name: "The Grey Lighthouse", layoutDescription: "", connections: [] },
    recentPlayerLine: "We climb to the keeper and ask about the cistern.",
  };
  buildDmMessages(state, []);
  const arc = state.contextTrace.arc;
  assert.ok(arc, "the trace has no arc section");
  const shown = arc.events.filter((pick) => pick.included);
  assert.equal(shown[0].name, "The lighthouse bargain", shown.map((pick) => pick.name).join(", "));
  assert.match(shown[0].reason, /matches the scene/);
  assert.ok(arc.events.some((pick) => !pick.included && /^held back/.test(pick.reason)));
  assert.equal(arc.beats.total, 50);
  assert.ok(arc.beats.shown < 50 && arc.beats.shown >= 9, `window showed ${arc.beats.shown}`);
});

test("a second import updates the cards in place and keeps the arc's references", () => {
  const card = listBeats(workshop.id).find((beat) => beat.title === "The keeper's confession");
  updateBeat(workshop.id, card.id, { ...card, body: `${LONG_BODY}\n\nAdded after the first import.` });
  const again = runContentImport({ sourceId: workshop.id, campaignId: campaign.id, selection: ["storyboard"], houseRulesMode: "replace" });
  assert.ok(!("error" in again), again.error);
  const cards = listPrepCards(campaign.id);
  assert.equal(cards.length, 81, `${cards.length} prep cards after the second import`);
  assert.match(cards.find((entry) => entry.title === "The keeper's confession").body, /Added after the first import\.$/);
  const arc = getCampaignById(campaign.id).storyArc;
  assert.equal(arc.beats.length, 50, "the second import changed the arc");
  assert.equal(arc.events.length, 30);
});

test("a board past the arc's event room is named in the plan and lands as unplaced cards", () => {
  // A second workshop whose routes alone exceed what the arc can still
  // hold: the plan names them, the import keeps them on the shelf.
  const table = createCampaign(userId, { title: "A crowded table", description: "", theme: "", maxPlayers: 5, startingLevel: 1, difficulty: "normal" });
  const first = runContentImport({ sourceId: workshop.id, campaignId: table.id, selection: ["storyboard"], houseRulesMode: "replace" });
  assert.ok(!("error" in first), first.error);
  const arc = getCampaignById(table.id).storyArc;
  // Fill the arc's pending events to the cap by hand, as a long campaign would.
  const { setStoryArc } = getDatabase() && globalThis.__odmCampaigns ? globalThis.__odmCampaigns : { setStoryArc: null };
  const filled = {
    ...arc,
    events: [
      ...arc.events,
      ...Array.from({ length: ARC_LIMITS.events - arc.events.length - 2 }, (_, i) => ({
        id: `ev${arc.events.length + i + 1}`,
        kind: "setpiece",
        name: `Filler ${i}`,
        detail: "Filler.",
        trigger: "",
        actHint: null,
        status: "pending",
      })),
    ],
  };
  getDatabase().prepare(`UPDATE campaigns SET story_arc_json = ? WHERE id = ?`).run(JSON.stringify(filled), table.id);
  void setStoryArc;
  const other = createWorkshop(userId, { title: "Chapter two", targetParty: { size: 4, level: 3 } });
  const a = insertBeat(other.id, checkBeat({ kind: "event", title: "Opening", body: "The chapter opens." }).beat);
  const b = insertBeat(other.id, checkBeat({ kind: "event", title: "Closing", body: "The chapter closes." }).beat);
  const sides = ["Side one", "Side two", "Side three", "Side four"].map((title) => insertBeat(other.id, checkBeat({ kind: "event", title, body: "A side scene." }).beat));
  updateBeat(other.id, a.id, {
    ...a,
    edges: [b.id, ...sides.map((side) => side.id)],
    routes: Object.fromEntries(sides.map((side) => [side.id, { kind: "optional", label: "maybe" }])),
  });
  const plan = planContentImport(other.id, table.id, ["storyboard"], { arcMode: "append" });
  const warning = plan.warnings.find((entry) => /cannot join it/.test(entry.message));
  assert.ok(warning, plan.warnings.map((entry) => entry.message).join("\n"));
  assert.match(warning.message, /room for 2 more planned events/);
  assert.match(warning.message, /"Side three", "Side four"/);
  const result = runContentImport({ sourceId: other.id, campaignId: table.id, selection: ["storyboard"], houseRulesMode: "replace", arcMode: "append" });
  assert.ok(!("error" in result), result.error);
  const after = getCampaignById(table.id).storyArc;
  assert.equal(after.events.length, ARC_LIMITS.events, "a pending event was evicted");
  const cards = listPrepCards(table.id);
  const unplaced = cards.filter((card) => card.role === "unplaced").map((card) => card.title).sort();
  assert.deepEqual(unplaced, ["Side four", "Side three"]);
  assert.ok(cards.some((card) => card.title === "Side one" && card.role === "moment"));
});

test("a campaign clone carries the prep cards with the arc", async () => {
  const { cloneCampaign } = await import("../src/lib/db/campaign-clone.ts");
  const outcome = cloneCampaign(userId, campaign.id, "The coast, again");
  assert.ok(!("error" in outcome), outcome.error);
  const copy = getCampaignById(outcome.campaign.id);
  assert.equal(copy.storyArc.beats.length, 50);
  assert.equal(listPrepCards(copy.id).length, 81, "the clone has no prep cards");
  const event = copy.storyArc.events.find((entry) => entry.name === "The lighthouse bargain");
  assert.match(handleReadCard(copy, JSON.stringify({ ref: event.id })).text, /lamp oil/);
});

console.log(`prep cards: ${passed} tests passed`);
removeTempDir(dir);
