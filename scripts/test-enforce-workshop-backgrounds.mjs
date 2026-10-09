// A background written in the workshop, or copied there from a published
// one, is that background at character creation: the builder offers its
// skills, tools, languages, kit and coin, and the server holds a character
// to them (SRD 5.1, Backgrounds). Before, a workshop background kept only
// prose, and a copy of the Criminal read "Deception, Stealth" as one skill
// and its 15 gp as a kit line, so the character it made was refused or
// short.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-workshop-backgrounds");
const { world, atTable } = await openCreation();
const builder = await openBuilder();
const { bundledBackgroundRows } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { mergedBackgroundOptions } = await import("../src/lib/characters/options.ts");
const { backgroundGrantsFor } = await import("../src/lib/characters/catalog.ts");
const homebrew = await world.route("homebrew");

// "Start from" the builder's Criminal, renamed and saved by the table's DM.
async function brewCopy(id, name) {
  const [row] = bundledBackgroundRows(id, []).filter((entry) => entry.slug === id);
  assert.ok(row, `the bundled ${id} is not offered to start from`);
  const { data } = draftFromCatalog("background", row);
  world.signIn(world.owner);
  const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "background", name, data }) }));
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  const slug = `homebrew:${body.entry.id}`;
  const [option] = mergedBackgroundOptions([{ slug, name, source: "homebrew", documentSlug: "homebrew", data: body.entry.data }]).filter((entry) => entry.id === slug);
  return option;
}

const fence = await brewCopy("criminal", "Fence");

function buildFence(fields = {}) {
  return builder.build({
    race: "dragonborn",
    class: "wizard",
    background: fence,
    scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    chosenSkills: ["arcana", "history"],
    cantrips: ["Light", "Mage Hand", "Fire Bolt"],
    spells: ["Sleep", "Shield", "Identify", "Detect Magic", "Feather Fall", "Charm Person"],
    bookPrepared: ["Sleep", "Shield", "Identify"],
    racialAncestry: "red",
    ...fields,
  });
}

await test("A workshop copy of the Criminal grants the Criminal's skills, tools and coin, and the server reads it the same.", async () => {
  assert.deepEqual(fence.skills, ["deception", "stealth"]);
  assert.equal(fence.purse, 15);
  const served = backgroundGrantsFor(fence.id, world.owner.id);
  assert.deepEqual(served?.skills, ["deception", "stealth"], "the server reads the copy differently");
  const built = buildFence();
  assert.equal(built.blocker, null, built.blocker?.message);
  const { status, sheet, error } = await atTable(built.sheet);
  assert.equal(status, 201, error);
  for (const skill of ["deception", "stealth"]) {
    assert.ok(sheet.proficiencies.skills.includes(skill), `the character lacks ${skill}: ${sheet.proficiencies.skills}`);
  }
  assert.ok(sheet.proficiencies.tools.some((tool) => /thieves/i.test(tool)), `tools: ${sheet.proficiencies.tools}`);
  assert.ok(sheet.features.some((feature) => feature.name.startsWith("Criminal Contact")), "the copy's feature was not granted");
});

await test("The server writes the workshop background's skills itself, and refuses a skill it does not grant.", async () => {
  const built = buildFence();
  const without = built.sheet.proficiencies.skills.filter((skill) => skill !== "stealth");
  const short = await atTable({ ...built.sheet, proficiencies: { ...built.sheet.proficiencies, skills: without } });
  assert.equal(short.status, 201, short.error);
  assert.ok(short.sheet.proficiencies.skills.includes("stealth"), "the background's Stealth was not written");
  const forged = await atTable({ ...built.sheet, proficiencies: { ...built.sheet.proficiencies, skills: [...without, "persuasion"] } });
  assert.equal(forged.status, 400, "a skill neither the class nor the background grants was accepted");
  assert.match(forged.error ?? "", /persuasion/i);
});

await test("A workshop background is its author's: another DM's table does not offer it.", async () => {
  const stranger = world.addUser("another-dm");
  assert.equal(backgroundGrantsFor(fence.id, stranger.id), null);
});

finish();
