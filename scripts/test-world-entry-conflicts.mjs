// Two authors editing one WorldForge entry. Each editor sends only the
// fields it changed, with the value each had when it opened. Different
// fields both survive; the same field changed two ways is reported with
// nothing written, and the second author can then keep theirs or take the
// other. Callers that send no base (painting a picture, imports) write as
// before. Audit finding WF-02.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-entry-conflicts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { applyWorldImport } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity } = await import("../src/lib/db/world-forge.ts");
const { changesSince, editableOf, mergeAgainst } = await import("../src/lib/worldforge/entry-merge.ts");

const raw = fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8");
const world = await openWorld();
const read = readBundle(raw);
const { workshopId } = importWorkshopBundle(world.owner.id, read.bundle);
applyWorldImport(workshopId, { id: world.owner.id }, read.worldForge);

const view = () => worldView(workshopId);
const find = (ref) => view().entities.find((entry) => entry.ref === ref);
const deity = view().doc.types.find((type) => type.name === "Deity");
const valueFor = (def, n) => (def.kind === "select" ? def.options[n % def.options.length] : def.kind === "number" ? n + 1 : `value ${n}`);

// What an editor holds when it opens the entry.
const open = (ref) => {
  const values = editableOf(view().doc, find(ref));
  return { opened: values, mine: structuredClone(values) };
};
const save = (ref, editor) => {
  const { patch, base } = changesSince(editor.opened, editor.mine);
  return updateWorldEntity(workshopId, ref, { ...patch, base });
};

const made = createWorldEntity(workshopId, { typeId: deity.id, name: "The Lamplighter", text: "Keeper of harbour lights." });
assert.ok(made.entity, made.error);
const ref = made.entity.ref;

await test("Two authors changing different fields both keep their changes.", () => {
  const ana = open(ref);
  const ben = open(ref);
  ana.mine.name = "The Lamplighter of Gullhaven";
  ben.mine.notes = "Ask the players about lighthouses.";
  ben.mine.canon = "draft";
  assert.ok(save(ref, ana).entity);
  const second = save(ref, ben);
  assert.ok(!second.conflicts, second.error);
  const now = find(ref);
  assert.equal(now.name, "The Lamplighter of Gullhaven");
  assert.equal(now.entry.notes, "Ask the players about lighthouses.");
  assert.equal(now.entry.canon, "draft");
});

await test("Two authors filling different type fields both keep theirs.", () => {
  assert.ok(deity.fields.length >= 2, "the fixture's Deity type needs two fields");
  const [one, two] = deity.fields;
  const ana = open(ref);
  const ben = open(ref);
  ana.mine.fields[one.id] = valueFor(one, 1);
  ben.mine.fields[two.id] = valueFor(two, 2);
  assert.ok(save(ref, ana).entity);
  assert.ok(save(ref, ben).entity);
  const fields = find(ref).entry.fields;
  assert.equal(fields[one.id], valueFor(one, 1));
  assert.equal(fields[two.id], valueFor(two, 2));
});

await test("The same field changed two ways is reported, and nothing from that save is written.", () => {
  const ana = open(ref);
  const ben = open(ref);
  ana.mine.text = "Ana's account.";
  ben.mine.text = "Ben's account.";
  ben.mine.hiddenTruth = "Ben's secret.";
  assert.ok(save(ref, ana).entity);
  const clash = save(ref, ben);
  assert.equal(clash.status, 409);
  assert.deepEqual(clash.conflicts.map((conflict) => conflict.key), ["text"]);
  assert.equal(clash.conflicts[0].theirs, "Ana's account.");
  assert.equal(clash.entity.text, "Ana's account.", "the conflict carries the entry as it is now");
  const now = find(ref);
  assert.equal(now.text, "Ana's account.");
  assert.notEqual(now.entry.hiddenTruth, "Ben's secret.", "a clashing save writes none of its fields");
});

await test("After a clash the second author can keep theirs: saving against the new base writes it.", () => {
  const ben = open(ref);
  ben.mine.text = "Ben's account, kept on purpose.";
  assert.ok(save(ref, ben).entity);
  assert.equal(find(ref).text, "Ben's account, kept on purpose.");
});

await test("A type field changed two ways is reported by its name.", () => {
  const [one] = deity.fields;
  const ana = open(ref);
  const ben = open(ref);
  ana.mine.fields[one.id] = valueFor(one, 3);
  ben.mine.fields[one.id] = valueFor(one, 4);
  if (valueFor(one, 3) === valueFor(one, 4)) return;
  assert.ok(save(ref, ana).entity);
  const clash = save(ref, ben);
  assert.equal(clash.status, 409);
  assert.equal(clash.conflicts[0].key, `fields.${one.id}`);
  assert.equal(clash.conflicts[0].label, one.name);
});

await test("Both authors making the same change is not a clash.", () => {
  const ana = open(ref);
  const ben = open(ref);
  ana.mine.tags = ["light", "harbour"];
  ben.mine.tags = ["light", "harbour"];
  assert.ok(save(ref, ana).entity);
  assert.ok(save(ref, ben).entity);
});

await test("A picture painted while the editor is open survives a save that did not touch the picture.", () => {
  const ana = open(ref);
  // The paint job lands with no base, as world-ai.ts sends it.
  const painted = "/uploads/painted-lamplighter.png";
  const late = updateWorldEntity(workshopId, ref, { portrait: painted });
  assert.ok(late.entity, late.error);
  assert.equal(find(ref).portrait, painted);
  ana.mine.notes = "Saved after the paint job.";
  assert.ok(save(ref, ana).entity);
  assert.equal(find(ref).portrait, painted, "the editor's stale picture was not sent");
});

await test("An editor that changed nothing writes nothing and does not clash.", () => {
  const ana = open(ref);
  updateWorldEntity(workshopId, ref, { notes: "Changed by someone else." });
  const result = save(ref, ana);
  assert.ok(result.entity, result.error);
  assert.equal(find(ref).entry.notes, "Changed by someone else.");
});

await test("The merge itself: a key sent without a base is written as sent.", () => {
  const current = editableOf(view().doc, find(ref));
  const merged = mergeAgainst(view().doc, current, { name: "Anything" }, {});
  assert.deepEqual(merged, { patch: { name: "Anything" } });
});

finish();
