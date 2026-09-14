// Calendar events (docs/vtt-parity-implementation-plan.md 7.2): the clock
// crossing an event fires it once, a party event becomes a fact and a title
// card, a DM one a fact only the DM seat reads, and a repeating one comes
// round again.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-calendar-events-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { advanceClock, getClock, setCalendar } = await import("../src/lib/db/clock.ts");
const { insertCalendarEvent, listCalendarEvents, dueCalendarEvents, nextOccurrence, deleteCalendarEvent } = await import("../src/lib/db/calendar-events.ts");
const { listActiveFacts } = await import("../src/lib/db/facts.ts");
const { GENERIC_CALENDAR, MINUTES_PER_DAY, daysPerYear } = await import("../src/lib/dm/calendar.ts");
const { buildTimeline } = await import("../src/lib/dm/timeline-logic.ts");
const { subscribe } = await import("../src/lib/events.ts");

// The bus hands subscribers SSE text; read the type and the payload back.
function parseChunk(chunk) {
  const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
  const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? "{}";
  try {
    return { type, payload: JSON.parse(data) };
  } catch {
    return { type, payload: {} };
  }
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
setCalendar(campaign.id, GENERIC_CALENDAR);
const start = getClock(campaign.id).instant;
const fair = insertCalendarEvent({ campaignId: campaign.id, atInstant: start + 2 * MINUTES_PER_DAY, title: "The Harvest Fair", body: "Stalls fill the square.", visibility: "party" });
const secret = insertCalendarEvent({ campaignId: campaign.id, atInstant: start + 2 * MINUTES_PER_DAY, title: "The cult moves", visibility: "dm" });
const tithe = insertCalendarEvent({ campaignId: campaign.id, atInstant: start + MINUTES_PER_DAY, title: "Tithe day", repeat: "monthly" });

test("players read only what the party may see", () => {
  assert.equal(listCalendarEvents(campaign.id, true).length, 3);
  assert.deepEqual(listCalendarEvents(campaign.id, false).map((event) => event.title).sort(), ["The Harvest Fair", "Tithe day"]);
});

test("a repeating event comes round by the calendar", () => {
  const year = daysPerYear(GENERIC_CALENDAR) * MINUTES_PER_DAY;
  const yearly = { ...fair, repeat: "yearly" };
  assert.equal(nextOccurrence(yearly, GENERIC_CALENDAR, fair.atInstant + 1), fair.atInstant + year);
  assert.equal(nextOccurrence(tithe, GENERIC_CALENDAR, tithe.atInstant + 1), tithe.atInstant + 30 * MINUTES_PER_DAY);
  assert.equal(nextOccurrence(fair, GENERIC_CALENDAR, fair.atInstant + 1), fair.atInstant);
});

test("only events between the old and the new instant are due", () => {
  assert.deepEqual(dueCalendarEvents(campaign.id, GENERIC_CALENDAR, start, start + MINUTES_PER_DAY).map((due) => due.event.title), ["Tithe day"]);
  assert.equal(dueCalendarEvents(campaign.id, GENERIC_CALENDAR, start, start).length, 0);
});

test("the clock crossing an event fires it: a fact, a card, and never twice", () => {
  const seen = [];
  const stop = subscribe(campaign.id, (chunk) => seen.push(parseChunk(chunk)));
  advanceClock(campaign.id, 3, "days");
  stop();
  const facts = listActiveFacts(campaign.id);
  // Facts keep their subject lower-cased.
  const fairFact = facts.find((fact) => fact.subject === "the harvest fair");
  assert.ok(fairFact, "no fact for the fair");
  assert.equal(fairFact.knownBy, "party");
  assert.match(fairFact.fact, /Stalls fill the square/);
  assert.equal(facts.find((fact) => fact.subject === "the cult moves").knownBy, "dm");
  assert.ok(seen.some((event) => event.type === "title_card" && event.payload?.title === "The Harvest Fair"), "no title card");
  assert.ok(!seen.some((event) => event.type === "title_card" && event.payload?.title === "The cult moves"), "a DM event showed a card");
  const before = listActiveFacts(campaign.id).length;
  advanceClock(campaign.id, 1, "hours");
  assert.equal(listActiveFacts(campaign.id).length, before);
  assert.ok(listCalendarEvents(campaign.id, true).every((event) => event.firedAt >= 0));
});

test("a monthly event fires again a month on", () => {
  const before = listActiveFacts(campaign.id).filter((fact) => fact.subject === "tithe day").length;
  advanceClock(campaign.id, 30, "days");
  assert.equal(listActiveFacts(campaign.id).filter((fact) => fact.subject === "tithe day").length, before + 1);
});

test("the timeline shows fired events where they fired and DM ones to the DM alone", () => {
  const sources = {
    chapters: [],
    facts: [],
    sessions: [],
    arcs: [],
    events: [
      { id: "a", title: "The Harvest Fair", body: "", when: "day 3", firedSeq: 2, fired: true, visibility: "party" },
      { id: "b", title: "The cult moves", body: "", when: "day 3", firedSeq: 2, fired: true, visibility: "dm" },
      { id: "c", title: "Coronation", body: "", when: "day 40", firedSeq: 0, fired: false, visibility: "party" },
    ],
    now: { seq: 5, clockLabel: "day 4" },
  };
  const player = buildTimeline(sources, false).map((row) => row.id);
  assert.deepEqual(player, ["event-a", "now", "event-c"]);
  const rows = buildTimeline(sources, true);
  assert.ok(rows.find((row) => row.id === "event-b")?.secret);
});

test("deleting takes an event off the calendar", () => {
  assert.equal(deleteCalendarEvent(campaign.id, secret.id), true);
  assert.equal(deleteCalendarEvent(campaign.id, "nope"), false);
  assert.equal(listCalendarEvents(campaign.id, true).length, 2);
});

console.log(`calendar-events: ${passed} tests passed`);
fs.rmSync(dir, { recursive: true, force: true });
