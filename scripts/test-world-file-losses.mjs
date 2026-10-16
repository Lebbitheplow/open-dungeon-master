// A WorldForge file never loses text or pictures without saying so. Audit
// finding WF-06: a 20,000-character lore entry came back at 12,000, a
// newer file version was read as if it were known, and pictures left out of
// an export went unmentioned. Now an unknown version is refused before
// anything is written, the limits match the lore entry's own, and every
// loss is named by the reader, so an import can ask before it writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-file-losses");
const { readWorldForge, writeWorldForge, WORLDFORGE_VERSION } = await import("../src/lib/worldforge/format.ts");
const { importWorldForge, exportWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity } = await import("../src/lib/db/world-forge.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { emptyDoc } = await import("../src/lib/worldforge/model.ts");

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
const world = await openWorld();
const owner = { id: world.owner.id };
const shop = (title) => createWorkshop(owner.id, { title }).id;
const fresh = () => structuredClone(fixture);

await test("A file from a newer WorldForge is refused, and nothing is written.", () => {
  const id = shop("Newer file");
  const newer = { ...fresh(), version: WORLDFORGE_VERSION + 1 };
  const result = importWorldForge(id, owner, newer);
  assert.match(result.error ?? "", new RegExp(`format version ${WORLDFORGE_VERSION + 1}`));
  assert.equal(worldView(id).entities.length, 0);
  assert.match(readBundle(JSON.stringify(newer)).error ?? "", /format version/, "opening it as a new workshop is refused too");
});

await test("A 20,000-character lore entry makes the round trip through a file whole.", () => {
  const from = shop("Long lore");
  const body = "The tide remembers. ".repeat(1_000).trim().slice(0, 20_000);
  const made = createWorldEntity(from, { typeId: "t_other", name: "The Long Chronicle", text: body });
  assert.ok(made.entity, made.error);
  assert.equal(made.entity.text.length, body.length);
  const file = exportWorldForge(from);
  const read = readWorldForge(file);
  assert.deepEqual(read.losses, [], "the reader names a loss for a file ODM wrote itself");
  const into = shop("Long lore, again");
  importWorldForge(into, owner, file);
  const copy = worldView(into).entities.find((entity) => entity.name === "The Long Chronicle");
  assert.equal((copy.entry.article || copy.text).length, body.length, "the entry came back cut");
});

await test("Every loss is named: cut text, a repeated id, an entry with no name, a picture that is not one, rows over a cap.", () => {
  const lossy = fresh();
  lossy.entities[0].summary = "x".repeat(25_000);
  lossy.entities.push({ ...lossy.entities[1] });
  lossy.entities.push({ id: "e_nameless", name: "", type: "Character" });
  lossy.media = { ...lossy.media, entityImages: { ...lossy.media.entityImages, e_mira: "data:text/html;base64,PHA+aGk8L3A+" } };
  lossy.pins = Array.from({ length: 3_005 }, (_, index) => ({ id: `pin${index}`, mapId: "m1", x: 0.5, y: 0.5, name: `Pin ${index}` }));
  const read = readWorldForge(lossy);
  const said = read.losses.join("\n");
  assert.match(said, /Ivo Brannock: its text is cut to 20,000 characters/);
  assert.match(said, /1 entry repeats another's id/);
  assert.match(said, /1 entry has no name or no id/);
  assert.match(said, /Mira Fenn: its picture is not a PNG/);
  assert.match(said, /Only the first 3,000 of 3,005 pins come in/);
});

// The fixture's second picture is a script dressed as one, on purpose.
const whole = () => {
  const file = fresh();
  delete file.media.entityImages.e_mira;
  return file;
};

await test("A file that comes in whole names no loss, and says the party starts knowing no secret.", () => {
  assert.match(readWorldForge(fresh()).losses.join(" "), /Mira Fenn: its picture is not a PNG/, "the fixture's disguised script is named");
  const read = readWorldForge(whole());
  assert.deepEqual(read.losses, []);
  assert.ok(read.notes.some((note) => /knowing none of it/.test(note)));
  const result = importWorldForge(shop("Whole"), owner, whole());
  assert.deepEqual(result.losses, []);
  assert.ok(result.notes.length);
});

await test("Pictures an export had no room for are named in the file, and the next import says whose.", () => {
  const file = writeWorldForge({ worldName: "Crowded", premise: "", records: [], doc: emptyDoc(), beats: [], mapImages: {}, now: new Date().toISOString(), omitted: ["Ivo Brannock", "the Saltmarch map"] });
  const read = readWorldForge(file);
  assert.match(read.losses.join(" "), /without the pictures of Ivo Brannock, the Saltmarch map/);
});

world.close();
finish();
