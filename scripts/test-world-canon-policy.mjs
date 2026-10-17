// One canon policy for every AI path (audit finding WF-14). An alternate
// event used to reach play as plain history, Ask gave retired entries as if
// they held, events came in the order they were typed rather than by date,
// and a secret the party had learned simply vanished. Now the gameplay
// prompt, Ask and lore search say each non-canon status, leave retired out
// of play, order events by the world's own dates with the calendar's year,
// and treat a learned secret as established.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-canon-policy");
const { createWorldEntity, getWorldDoc, saveWorldDoc, worldView } = await import("../src/lib/db/world-forge.ts");
const { worldForPrompt } = await import("../src/lib/dm/world-prompt.ts");
const { worldDigest } = await import("../src/lib/worldforge/forge.ts");
const { handleSearchLore } = await import("../src/lib/dm/lore-search.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");

const world = await openWorld();
const id = createWorkshop(world.owner.id, { title: "The Saltmarch" }).id;
const mara = createWorldEntity(id, { typeId: "t_character", name: "Captain Mara", tagline: "Keeps the lighthouse." }).entity;
createWorldEntity(id, { typeId: "t_other", name: "The Unwritten Pact", text: "Not settled.", canon: "draft" });
const doc = getWorldDoc(id);
doc.calendars.push({ id: "cal_rt", name: "Reckoning of Tides", abbrev: "RT", epochOffset: 0, notes: "" });
const when = (yearNum) => ({ calendarId: "cal_rt", yearNum, year: "" });
// Typed in this order on purpose: not the order they happened.
doc.events.push(
  { id: "ev_flood", title: "The Second Flood", body: "The wall fails again.", era: "", when: when(90), refs: [mara.ref], canon: "alternate" },
  { id: "ev_wall", title: "The Wall Breaks", body: "A storm takes the eastern wall.", era: "", when: when(70), refs: [mara.ref], canon: "canon" },
  { id: "ev_treaty", title: "The Old Treaty", body: "Since torn up.", era: "", when: when(80), refs: [mara.ref], canon: "retired" },
  { id: "ev_pact", title: "The Lantern Pact", body: "Not yet agreed.", era: "", when: when(85), refs: [mara.ref], canon: "draft" },
);
doc.secrets.push(
  { id: "s_heir", title: "Mara is the heir", subject: mara.ref, notes: "Her mother held the wall.", knownBy: [], partyKnows: true },
  { id: "s_bell", title: "The bell is a warning", subject: mara.ref, notes: "", knownBy: [], partyKnows: false },
);
saveWorldDoc(id, doc);

await test("Play gets an entry's latest events by date, each non-canon one said as such, and never a retired one.", () => {
  const { block } = worldForPrompt(id, { text: "Captain Mara steps onto the quay." });
  const line = block.split("\n").find((entry) => entry.startsWith("- Captain Mara"));
  assert.ok(line, block);
  assert.match(line, /85 RT: The Lantern Pact \[draft: not settled/);
  assert.match(line, /90 RT: The Second Flood \[alternate: one telling, not what happened\]/);
  assert.ok(line.indexOf("The Lantern Pact") < line.indexOf("The Second Flood"), "events are not in the world's own order");
  assert.doesNotMatch(block, /The Old Treaty/, "a retired event reached play");
});

await test("A secret the party has learned is established knowledge; one it has not stays the DM's.", () => {
  const { block } = worldForPrompt(id, { text: "Captain Mara" });
  const learned = block.slice(block.indexOf("what the party has learned"));
  assert.ok(block.includes("what the party has learned"), block);
  assert.match(learned.split("From the world's WorldForge (DM-only")[0], /Mara is the heir/);
  const secret = block.slice(block.indexOf("DM-only"));
  assert.match(secret, /The bell is a warning/);
  assert.doesNotMatch(secret, /Mara is the heir/, "a learned secret is still fed as one to keep");
});

await test("Ask names every status, retired included, since the author is the one asking.", () => {
  const { doc: shown, entities } = worldView(id);
  const digest = worldDigest(shown, entities, "", 14_000);
  assert.match(digest, /## The Unwritten Pact \(Other\) \[draft: not settled/);
  assert.match(digest, /80 RT: The Old Treaty \[retired: no longer true in this world\]/);
  assert.match(digest, /90 RT: The Second Flood \[alternate/);
  assert.ok(digest.indexOf("70 RT: The Wall Breaks") < digest.indexOf("90 RT: The Second Flood"), "the timeline is not in date order");
});

await test("Lore search labels a timeline candidate's status and gives its calendar's year.", async () => {
  const result = JSON.stringify(await handleSearchLore(id, JSON.stringify({ query: "The Second Flood wall fails", category: "history" })));
  assert.match(result, /worldforge timeline \(alternate\)/);
  assert.match(result, /90 RT: The Second Flood/);
  assert.doesNotMatch(result, /The Old Treaty/);
});

world.close();
finish();
