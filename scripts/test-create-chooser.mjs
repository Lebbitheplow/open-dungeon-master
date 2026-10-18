// The workshop's Create chooser (audit finding WF-08). WorldForge pulls
// entries out of notes, and a World type called Monster or Item adds no
// stat block, so Create starts from what the author wants and sends them to
// the tool that makes it. Each way in reaches a real tool whose panel
// answers it, NPC and player-character choices reach their own editors and
// stores, drafting is offered only where a model is, an untyped lore entry
// no longer reads as an Artifact, and a monster made in the Bestiary can be
// given a World entry that puts that exact monster into a fight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-create-chooser");
const { CREATE_CHOICES, offeredWays, stepUnavailable } = await import("../src/lib/workshop/create-choices.ts");
const { isSystemId } = await import("../src/app/workshop/[workshopId]/systems.ts");
const { typeFor, defaultTypes } = await import("../src/lib/worldforge/model.ts");
const { worldView } = await import("../src/lib/db/world-forge.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { createHomebrew } = await import("../src/lib/db/homebrew.ts");
const { getEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { resolveMonster } = await import("../src/lib/bestiary/index.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// The panels that answer a tool's "open your editor" request.
const PANELS = {
  world: ["src/app/workshop/world/WikiView.tsx", "src/app/workshop/world/WorldForgePanel.tsx"],
  cast: ["src/app/campaigns/[campaignId]/DmNpcForgePanel.tsx"],
  bestiary: ["src/app/campaigns/[campaignId]/DmBestiaryPanel.tsx"],
  homebrew: ["src/app/workshop/homebrew/HomebrewPanel.tsx"],
  maps: ["src/app/campaigns/[campaignId]/DmMapLibraryPanel.tsx"],
  encounters: ["src/app/campaigns/[campaignId]/DmEncounterPrepPanel.tsx"],
  tables: ["src/app/campaigns/[campaignId]/DmTablesPanel.tsx"],
};
const choice = (id) => CREATE_CHOICES.find((entry) => entry.id === id);
const steps = () => CREATE_CHOICES.flatMap((entry) => entry.steps.map((step) => ({ choice: entry.id, ...step })));

await test("Create offers every output the plan names, each saying where it lands.", () => {
  const wanted = ["outline", "npc", "pc", "creature", "item", "spell", "option", "place", "region", "map", "encounter", "table", "illustration"];
  assert.deepEqual(CREATE_CHOICES.map((entry) => entry.id).sort(), [...wanted].sort());
  for (const entry of CREATE_CHOICES) {
    assert.ok(entry.lands && entry.blurb && entry.steps.length, `${entry.id} says nothing about where it goes`);
  }
});

await test("Every way in reaches a real tool or page, and the tool's panel answers the editor it asks for.", () => {
  for (const step of steps()) {
    assert.ok(step.href || step.system, `${step.choice}: "${step.label}" goes nowhere`);
    if (step.href) assert.match(step.href, /^\/[a-z]/, `${step.choice}: "${step.label}" leaves the app`);
    if (step.system) assert.ok(isSystemId(step.system), `${step.choice}: ${step.system} is not a workshop tool`);
    if (step.view) assert.ok(source("src/app/workshop/world/WorldForgePanel.tsx").includes(`value: "${step.view}"`), `${step.choice}: WorldForge has no ${step.view} view`);
    if (!step.prepare) continue;
    const [name, detail] = step.prepare.split(":");
    const panels = PANELS[step.system] ?? [];
    assert.ok(panels.length, `${step.choice}: nothing in ${step.system} answers "${step.prepare}"`);
    const text = panels.map(source).join("\n");
    assert.ok(text.includes(`"${name}"`), `${step.choice}: ${step.system}'s panel does not answer "${name}"`);
    if (detail) assert.ok(text.includes(`split(":")`), `${step.choice}: ${step.system}'s panel ignores the "${detail}" in "${step.prepare}"`);
  }
});

await test("NPC and player-character choices lead to their own editors and stores; playable things never stop at WorldForge.", () => {
  assert.deepEqual(choice("npc").steps.map((step) => [step.system, step.prepare]), [["cast", "open-npc-editor"]]);
  const pc = choice("pc").steps;
  assert.ok(pc.some((step) => step.href?.startsWith("/characters/new")), "a player character does not reach the character builder");
  // The door says it is a player character, so the builder does not ask.
  assert.ok(pc.some((step) => step.href === "/characters/new?as=pc"), "the player-character door leaves the role to the builder");
  assert.ok(pc.some((step) => step.system === "party"), "a player character cannot become this party's pregen");
  assert.ok(pc.every((step) => step.system !== "cast"), "a player character was sent to the NPC Cast");
  assert.deepEqual(choice("creature").steps.map((step) => [step.system, step.prepare]), [["bestiary", "open-monster-build"]]);
  assert.equal(choice("item").steps[0].prepare, "open-homebrew-editor:item");
  assert.equal(choice("spell").steps[0].prepare, "open-homebrew-editor:spell");
  for (const entry of CREATE_CHOICES.filter((candidate) => candidate.group === "playable")) {
    assert.ok(entry.steps.every((step) => step.system !== "world"), `${entry.id} stops at WorldForge, which makes no playable thing`);
  }
  assert.deepEqual(choice("place").steps.map((step) => step.prepare), ["open-world-entry:location"]);
});

await test("Extracting from notes is its own way in, and drafting is offered only where the server has the model.", () => {
  const forge = choice("outline").steps.find((step) => step.ways.includes("extract"));
  assert.equal(forge.view, "forge");
  assert.ok(!forge.ways.includes("draft"), "extracting from notes is presented as drafting");
  const none = { story: false, images: false };
  const all = { story: true, images: true };
  assert.equal(stepUnavailable(forge, none), true, "Forge is offered with no model to read the notes");
  assert.equal(stepUnavailable(forge, all), false);
  const npc = choice("npc").steps[0];
  assert.deepEqual(offeredWays(npc, none), ["blank"]);
  assert.deepEqual(offeredWays(npc, all), ["blank", "draft"]);
  const portrait = choice("illustration").steps.find((step) => step.drafts === "images");
  assert.deepEqual(offeredWays(portrait, { story: true, images: false }), ["upload"]);
});

await test("An untyped lore entry reads as the plain Other type, not as an Artifact.", () => {
  const types = defaultTypes();
  assert.equal(typeFor({ types }, "lore", "").name, "Other");
  assert.equal(typeFor({ types }, "lore", "t_deity").name, "Deity", "a typed entry lost its type");
  assert.equal(typeFor({ types }, "npc", "").name, "Character");
  // A world whose author removed Other falls back to a lore type it has.
  assert.equal(typeFor({ types: types.filter((type) => type.id !== "t_other") }, "lore", "").shelf, "lore");
});

const world = await openWorld();
const author = world.addUser("creator");
const stranger = world.addUser("outsider");
const shop = createWorkshop(author.id, { title: "Made from Create" }).id;
const entity = (ref) => worldView(shop).entities.find((entry) => entry.ref === ref);
const bindingsRoute = await world.route("campaigns/[campaignId]/world/bindings");
const encounterRoute = await world.route("campaigns/[campaignId]/world/entities/[ref]/encounter");
const giveEntry = async (body, as = author) => {
  world.signIn({ id: as.id });
  const response = await bindingsRoute.POST(new Request("http://test/", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ campaignId: shop }) });
  return { status: response.status, json: await response.json() };
};

await test("A lore entry made in the Lore tool shows in WorldForge as Other, not Artifact.", () => {
  const lore = insertLoreEntry({ campaignId: shop, category: "other", title: "The Salt Tithe", body: "Every boat pays.", tags: [], visibility: "party" });
  const shown = worldView(shop).entities.find((entry) => entry.ref === `lore:${lore.id}`);
  const { doc } = worldView(shop);
  assert.equal(typeFor(doc, shown.shelf, shown.entry.typeId).name, "Other");
});

await test("A monster from the Bestiary gets a World entry linked to it, once, and that entry puts this exact monster into a fight.", async () => {
  const drake = createHomebrewMonster(author.id, draftFromCr("Ash Mire Drake", 4), "It nests in the peat.");
  const made = await giveEntry({ kind: "monster", ref: `homebrew:${drake.id}` });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const article = entity(made.json.entity.ref);
  assert.equal(article.shelf, "lore");
  assert.equal(article.name, "Ash Mire Drake");
  assert.deepEqual(article.bound.map((record) => [record.kind, record.ownId, record.found]), [["monster", drake.id, true]]);
  assert.equal(typeFor(worldView(shop).doc, "lore", article.entry.typeId).name, "Other", "a creature was filed as an Artifact");
  const again = await giveEntry({ kind: "monster", ref: `homebrew:${drake.id}` });
  assert.equal(again.json.entity.ref, article.ref, "a second entry was made for the same monster");

  world.signIn({ id: author.id });
  const response = await encounterRoute.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ monster: `homebrew:${drake.id}` }) }), {
    params: Promise.resolve({ campaignId: shop, ref: article.ref }),
  });
  const fight = await response.json();
  assert.equal(response.status, 201, JSON.stringify(fight));
  const [row] = getEncounterTemplate(fight.templateId).enemies;
  assert.equal(resolveMonster(row.monster, getCampaignById(shop).gameSettings, { userIds: [author.id] })?.slug, `homebrew:${drake.id}`);
});

await test("An item's entry files under Artifact; a record this table cannot use, or a stranger's call, is refused.", async () => {
  const lantern = createHomebrew(author.id, { kind: "item", name: "Peat Lantern", data: {} });
  const made = await giveEntry({ kind: "item", ref: `homebrew:${lantern.id}` });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal(typeFor(worldView(shop).doc, "lore", entity(made.json.entity.ref).entry.typeId).name, "Artifact");
  const before = worldView(shop).entities.length;
  const ooze = createHomebrewMonster(stranger.id, draftFromCr("Someone Else's Ooze", 1), "");
  assert.equal((await giveEntry({ kind: "monster", ref: `homebrew:${ooze.id}` })).status, 400);
  assert.equal((await giveEntry({ kind: "spell", ref: "fireball" })).status, 400);
  assert.notEqual((await giveEntry({ kind: "item", ref: `homebrew:${lantern.id}` }, stranger)).status, 200);
  assert.equal(worldView(shop).entities.length, before, "a refused call still wrote an entry");
});

world.close();
finish();
