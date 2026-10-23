// What a reimport kept, on the entry (M6 journey 7, audit WF-03/WF-04): a
// value both the campaign and the source changed stays as the campaign has
// it, and the entry now keeps the import's version beside it until the
// author chooses (src/lib/worldforge/import-kept.ts). "Use the import's
// version" takes it and keeps the campaign's to restore; "Keep mine"
// clears the notice; a later reimport that agrees clears it too. The
// record is the DM's: the route answers story authority alone.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-reimport-kept");
const { importWorldForge, keptNotes } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity, getWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");

const world = await openWorld();
const owner = world.owner;
const stranger = world.addUser("stranger");
const shop = (title) => createWorkshop(owner.id, { title }).id;
const named = (campaignId, name) => worldView(campaignId).entities.find((entity) => entity.name === name);
const keptRoute = await world.route("campaigns/[campaignId]/world/entities/[ref]/kept");
const importRoute = await world.route("campaigns/[campaignId]/import");
const player = world.addUser("player");
world.addHero({ user: player });

async function standingFor(campaignId, as = owner) {
  world.signIn({ id: as.id });
  const response = await importRoute.GET(new Request("http://local/?kept=1"), { params: Promise.resolve({ campaignId }) });
  return { status: response.status, body: await response.json() };
}

async function choose(campaignId, ref, key, choice, as = owner) {
  world.signIn({ id: as.id });
  const response = await keptRoute.POST(
    new Request("http://local/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, choice }) }),
    { params: Promise.resolve({ campaignId, ref: encodeURIComponent(ref) }) },
  );
  return { status: response.status, body: await response.json() };
}

// A workshop's Captain Rell, brought into a campaign; the campaign changes
// his article, then the workshop changes it too and brings him in again.
function clashed(title, campaign = shop(`${title} campaign`)) {
  const source = shop(`${title} source`);
  const made = createWorldEntity(source, { typeId: "t_character", name: "Captain Rell", article: "Rell keeps the lighthouse.", hiddenTruth: "He lit the false light." });
  assert.ok(made.entity, made.error);
  const copy = () => {
    const outcome = runContentImport({ sourceId: source, campaignId: campaign, selection: ["npcs", "locations", "lore", "world"], houseRulesMode: "replace" });
    assert.ok(!("error" in outcome), outcome.error);
    return outcome;
  };
  copy();
  const here = named(campaign, "Captain Rell");
  assert.deepEqual(here.kept, [], "a first import has nothing to keep");
  updateWorldEntity(campaign, here.ref, { article: "Rell keeps the lighthouse and owes the party." });
  updateWorldEntity(source, made.entity.ref, { article: "Rell keeps the lighthouse and drinks.", hiddenTruth: "He sold the lamp oil." });
  const outcome = copy();
  return { source, campaign, sourceRef: made.entity.ref, ref: here.ref, copy, outcome };
}

const RELL = "Captain Rell: kept your article over the import's.";

await test("A reimport that keeps the campaign's article records the import's version on the entry, and nothing for what it took.", () => {
  const { campaign } = clashed("Recorded");
  const rell = named(campaign, "Captain Rell");
  assert.equal(rell.entry.article, "Rell keeps the lighthouse and owes the party.", "the campaign's article stands");
  assert.equal(rell.entry.hiddenTruth, "He sold the lamp oil.", "the change only the source made applies");
  assert.deepEqual(rell.kept, [{ key: "article", label: "Article", theirs: "Rell keeps the lighthouse and drinks.", taken: false }]);
  // It lives on the document's origins, which no answer carries.
  assert.equal(worldView(campaign).doc.origins, undefined);
  assert.ok(getWorldDoc(campaign).origins[`entries/${rell.ref}`].kept.article);
});

await test("Only story authority reaches the choice: a stranger is refused and the record stays.", async () => {
  const { campaign, ref } = clashed("Refused");
  const answer = await choose(campaign, ref, "article", "use", stranger);
  assert.ok([403, 404].includes(answer.status), String(answer.status));
  assert.equal(named(campaign, "Captain Rell").entry.article, "Rell keeps the lighthouse and owes the party.");
  assert.equal(named(campaign, "Captain Rell").kept.length, 1);
});

await test("Use the import's version takes it and keeps the campaign's; Restore mine puts it back; Keep the import's clears it.", async () => {
  const { campaign, ref } = clashed("Taken");
  const used = await choose(campaign, ref, "article", "use");
  assert.equal(used.status, 200, JSON.stringify(used.body));
  assert.equal(used.body.entity.entry.article, "Rell keeps the lighthouse and drinks.");
  assert.deepEqual(used.body.entity.kept, [{ key: "article", label: "Article", theirs: "Rell keeps the lighthouse and drinks.", mine: "Rell keeps the lighthouse and owes the party.", taken: true }]);
  assert.equal((await choose(campaign, ref, "article", "use")).status, 409, "taking it twice is refused");
  const restored = await choose(campaign, ref, "article", "restore");
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.entity.entry.article, "Rell keeps the lighthouse and owes the party.");
  assert.deepEqual(restored.body.entity.kept, [{ key: "article", label: "Article", theirs: "Rell keeps the lighthouse and drinks.", taken: false }], "back to kept, the choice offered again");
  await choose(campaign, ref, "article", "use");
  const settled = await choose(campaign, ref, "article", "dismiss");
  assert.equal(settled.body.entity.entry.article, "Rell keeps the lighthouse and drinks.");
  assert.deepEqual(settled.body.entity.kept, []);
});

await test("Saving the import's version from the form marks it taken, and saving the campaign's back marks it kept.", () => {
  const { campaign, ref } = clashed("Form");
  const taken = updateWorldEntity(campaign, ref, { article: "Rell keeps the lighthouse and drinks.", base: { article: "Rell keeps the lighthouse and owes the party." } });
  assert.ok(taken.entity, taken.error);
  assert.equal(taken.entity.kept[0].taken, true);
  assert.equal(taken.entity.kept[0].mine, "Rell keeps the lighthouse and owes the party.");
  const back = updateWorldEntity(campaign, ref, { article: "Rell keeps the lighthouse and owes the party." });
  assert.equal(back.entity.kept[0].taken, false);
  // Another field written leaves the record alone.
  const other = updateWorldEntity(campaign, ref, { notes: "Ask him about the oil." });
  assert.deepEqual(other.entity.kept.map((item) => item.key), ["article"]);
});

await test("Keep mine clears the notice; the same source again does not bring it back, a new change at the source does.", async () => {
  const { campaign, ref, source, sourceRef, copy } = clashed("Mine");
  const kept = await choose(campaign, ref, "article", "dismiss");
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.entity.entry.article, "Rell keeps the lighthouse and owes the party.");
  assert.deepEqual(kept.body.entity.kept, []);
  assert.equal((await choose(campaign, ref, "article", "dismiss")).status, 404, "nothing left to choose");
  copy();
  assert.deepEqual(named(campaign, "Captain Rell").kept, [], "an unchanged source is not a new clash");
  updateWorldEntity(source, sourceRef, { article: "Rell keeps the lighthouse and sings." });
  copy();
  assert.deepEqual(named(campaign, "Captain Rell").kept.map((item) => item.theirs), ["Rell keeps the lighthouse and sings."]);
  assert.equal(named(campaign, "Captain Rell").entry.article, "Rell keeps the lighthouse and owes the party.");
});

await test("A later reimport that agrees clears the record, and one that changes again replaces it.", () => {
  const { campaign, source, sourceRef, copy } = clashed("Agrees");
  updateWorldEntity(source, sourceRef, { article: "Rell keeps the lighthouse and gambles." });
  copy();
  assert.deepEqual(named(campaign, "Captain Rell").kept.map((item) => item.theirs), ["Rell keeps the lighthouse and gambles."], "the newer import's version replaces the older");
  updateWorldEntity(source, sourceRef, { article: "Rell keeps the lighthouse and owes the party." });
  copy();
  const rell = named(campaign, "Captain Rell");
  assert.deepEqual(rell.kept, [], "the source now agrees with the campaign");
  assert.equal(rell.entry.article, "Rell keeps the lighthouse and owes the party.");
});

await test("A type field kept by a reimport is named by its field and taken back into the field.", async () => {
  const source = shop("Field source");
  const made = createWorldEntity(source, { typeId: "t_character", name: "Mother Ash", fields: { f_species: "Human" } }).entity;
  const campaign = shop("Field campaign");
  const copy = () => runContentImport({ sourceId: source, campaignId: campaign, selection: ["npcs", "locations", "lore", "world"], houseRulesMode: "replace" });
  copy();
  const here = named(campaign, "Mother Ash");
  updateWorldEntity(campaign, here.ref, { fields: { f_species: "Elf" } });
  updateWorldEntity(source, made.ref, { fields: { f_species: "Dwarf" } });
  copy();
  assert.deepEqual(named(campaign, "Mother Ash").kept, [{ key: "fields.f_species", label: "Species", theirs: "Dwarf", taken: false }]);
  const used = await choose(campaign, here.ref, "fields.f_species", "use");
  assert.equal(used.body.entity.entry.fields.f_species, "Dwarf");
  assert.equal(used.body.entity.kept[0].mine, "Elf");
});

await test("A WorldForge file brought in again records what it kept the same way.", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
  const id = shop("From a file");
  const first = importWorldForge(id, { id: owner.id }, structuredClone(fixture));
  assert.ok(!("error" in first), first.error);
  const ivo = named(id, "Ivo Brannock");
  updateWorldEntity(id, ivo.ref, { notes: "Mine: ask about the sluice." });
  const changed = structuredClone(fixture);
  changed.entities.find((entity) => entity.id === "e_ivo").notes = "The file's own notes.";
  const again = importWorldForge(id, { id: owner.id }, changed);
  assert.ok(!("error" in again), again.error);
  const after = named(id, "Ivo Brannock");
  assert.equal(after.entry.notes, "Mine: ask about the sluice.");
  assert.deepEqual(after.kept.map((item) => [item.key, item.theirs]), [["notes", "The file's own notes."]]);
});

await test("Bring in prep's note reads the stored record: said again by a later import and after a reload, until the author settles it.", async () => {
  const { campaign, ref, copy, outcome } = clashed("Note");
  assert.deepEqual(outcome.worldConflicts, [RELL], "the clashing import says it once");
  assert.deepEqual(copy().worldConflicts, [RELL], "a later import of the same source says it again while it stands");
  assert.deepEqual(keptNotes(campaign), [RELL], "and it is there to read without an import");
  const read = await standingFor(campaign);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual(read.body.kept, [RELL]);
  // Taken: no longer said. Restored: said again. Kept: gone for good.
  // (An import while the import's version is in use agrees with it, and
  // clears the record: the "agrees" check above.)
  await choose(campaign, ref, "article", "use");
  assert.deepEqual(keptNotes(campaign), []);
  await choose(campaign, ref, "article", "restore");
  assert.deepEqual(keptNotes(campaign), [RELL]);
  await choose(campaign, ref, "article", "dismiss");
  assert.deepEqual(keptNotes(campaign), []);
  assert.equal(copy().worldConflicts, undefined, "an import after Keep mine is quiet");
  assert.deepEqual((await standingFor(campaign)).body.kept, []);
});

await test("Only the person steering the story reads what earlier imports kept: a seated player is refused.", async () => {
  clashed("At the table", world.campaignId);
  assert.deepEqual((await standingFor(world.campaignId)).body.kept, [RELL]);
  const asked = await standingFor(world.campaignId, player);
  assert.equal(asked.status, 403, JSON.stringify(asked.body));
  assert.equal(asked.body.kept, undefined);
});

world.close();
finish();
