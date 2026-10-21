// "Draft a world from this idea" (plan M5 item 1, audit WF-08), against a
// stand-in model on a local port: no real provider is called. The outline
// is a review and writes nothing; only the rows the author ticks are made;
// a creature goes through the Bestiary's builder and checkMonsterDraft and
// an item through Homebrew's create schema, published-name check and
// normalizeHomebrewData, so a block the validator refuses is a failure
// with its reason and nothing stored; a failed asset is retried alone and
// made once; a reserved creature (a beholder, a mind flayer) never comes
// out of a generic prompt; Draft asks each kind of entry for what that
// kind needs; and a server with no text model still offers making by hand
// or by copy, and says where drafting is switched on.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openWorld, hasPack } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-outline");
const { readOutlineReply, outlineCounts, nearestCr, OUTLINE_CAPS, OUTLINE_ITEM_KINDS } = await import("../src/lib/worldforge/outline.ts");
const { draftKind, DRAFT_ASKS } = await import("../src/lib/worldforge/adapters.ts");
const { reservedCreature } = await import("../src/lib/bestiary/reserved-creatures.ts");
const { replyJson } = await import("../src/lib/worldforge/forge.ts");
const { ITEM_KINDS } = await import("../src/lib/homebrew/item-data.ts");
const { draftEntry } = await import("../src/lib/dm/world-ai.ts");
const { worldView } = await import("../src/lib/db/world-forge.ts");
const { importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { listHomebrewMonsters } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { listHomebrew } = await import("../src/lib/db/homebrew.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getCampaignById, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { CREATE_CHOICES, ENABLE_DRAFTING, missingModels, offeredWays, stepUnavailable } = await import("../src/lib/workshop/create-choices.ts");

// ---- the stand-in model ----

const OUTLINE = {
  premise: "The sea took the low kingdom. The tide-priests ration what dry land is left.",
  people: [
    { name: "Abbess Corra Vane", summary: "First of the tide-priests. She keeps the ledger of dry land.", hiddenTruth: "She sells dry berths to the smugglers." },
    { name: "Tamsin Reed", summary: "A bone-diver who knows every sunk street." },
    { name: "Mira Fenn", summary: "Already known to the world." },
  ],
  places: [
    { name: "The Last Steeple", summary: "A bell tower standing out of the water, the priests' seat." },
    { name: "Gullhaven", summary: "Named again by the model." },
  ],
  factions: [{ name: "The Tide Priesthood", summary: "They decide who may stand on dry stone." }],
  lore: [
    { name: "The Drowning", type: "Event of note", summary: "The night the sea came in." },
    { name: "Saint Marrow", type: "Deity", summary: "The drowned saint of the deep." },
  ],
  creatures: [
    { name: "Silt Stalker", summary: "A long-limbed hunter of the drowned streets.", basis: "", cr: 3 },
    { name: "The Watcher in the Well", summary: "A floating orb with many eye stalks, like a beholder.", basis: "Beholder", cr: 13 },
    { name: "Reef Owlbear", summary: "An owlbear gone to the shallows.", basis: "Owlbear", cr: 3 },
  ],
  items: [
    { name: "Tide Hook", summary: "A bone gaff the divers fight with.", kind: "weapon" },
    { name: "Longsword", summary: "A plain blade.", kind: "weapon" },
  ],
  links: [
    { from: "Abbess Corra Vane", to: "The Tide Priesthood", label: "member of" },
    { from: "Abbess Corra Vane", to: "The Last Steeple", label: "lives in" },
    { from: "Silt Stalker", to: "The Last Steeple", label: "guards" },
    { from: "Tamsin Reed", to: "Mira Fenn", label: "friend of" },
    { from: "Tamsin Reed", to: "Nobody At All", label: "rival of" },
    { from: "Tamsin Reed", to: "The Tide Priesthood", label: "despises" },
  ],
};

const GOOD_CREATURE = {
  basis: "",
  size: "Large",
  type: "monstrosity",
  cr: 3,
  speed: "30 ft., swim 40 ft.",
  attacksPerTurn: 2,
  attacks: [{ name: "Claw", toHit: 5, damage: "2d6+3", type: "slashing" }],
  traits: ["Silt Sight. It sees through murky water as if it were clear."],
  desc: "A pale, long-limbed thing that wades the drowned streets at low tide.",
};
const BAD_CREATURE = { ...GOOD_CREATURE, attacks: [{ name: "Claw", toHit: 5, damage: "lots of it", type: "slashing" }] };
const GOOD_ITEM = { itemKind: "weapon", rarity: "uncommon", cost: "40 gp", weight: 3, desc: "A bone gaff. It hooks a foe as well as a boat.", weapon: { category: "martial", kind: "melee", damage: "1d8 piercing", properties: ["reach"] } };
const BAD_ITEM = { ...GOOD_ITEM, weapon: { ...GOOD_ITEM.weapon, damage: "1d20 piercing" } };

const model = { creature: GOOD_CREATURE, item: GOOD_ITEM, down: false };
const requests = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const system = String(body.messages?.[0]?.content ?? "");
    requests.push({ system, user: String(body.messages?.at(-1)?.content ?? "") });
    if (model.down) {
      res.writeHead(500).end("down");
      return;
    }
    const content = system.includes("You sketch a tabletop world")
      ? `Here is an outline:\n\`\`\`json\n${JSON.stringify(OUTLINE)}\n\`\`\``
      : system.includes("You design one creature")
        ? JSON.stringify(model.creature)
        : system.includes("You design one item")
          ? JSON.stringify(model.item)
          : "The abbess keeps the ledger by lamplight.";
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const world = await openWorld();
// An admin's workshop keeps its own model address (see test-workshop-worldforge-ai).
const author = createUser(`outliner${Date.now().toString(36)}`, "x", { isAdmin: true });
const workshop = createWorkshop(author.id, { title: "The Drowned Kingdom" });
importWorldForge(workshop.id, { id: author.id, isAdmin: true }, JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8")));
updateStorySettings(workshop.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "stand-in", utilityModel: "" });
const outlineRoute = await world.route("campaigns/[campaignId]/world/outline");
const aiRoute = await world.route("campaigns/[campaignId]/world/ai");
const call = async (route, body, as = author) => {
  world.signIn({ id: as.id });
  const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ campaignId: workshop.id }) });
  return { status: response.status, json: await response.json() };
};
const entities = () => worldView(workshop.id).entities;
const entity = (name) => entities().find((entry) => entry.name === name);
const shelves = () => ({ world: entities().length, monsters: listHomebrewMonsters(author.id).length, items: listHomebrew(author.id, "item").length, links: worldView(workshop.id).doc.links.length });

// ---- the outline, read ----

await test("An outline is read strictly: lore types, names the world has, reserved creatures, published names and link words.", () => {
  const { doc } = worldView(workshop.id);
  const named = entities().map((entry) => ({ ref: entry.ref, name: entry.name, aliases: entry.aliases }));
  const outline = readOutlineReply(replyJson(`Sure:\n\`\`\`json\n${JSON.stringify(OUTLINE)}\n\`\`\``), doc, named);
  const row = (name) => outline.entries.find((entry) => entry.name === name) ?? outline.assets.find((entry) => entry.name === name);
  assert.equal(row("Abbess Corra Vane").shelf, "npc");
  assert.equal(row("Abbess Corra Vane").hiddenTruth, "She sells dry berths to the smugglers.");
  assert.equal(row("The Drowning").typeId, "t_other", "a lore type the world lacks did not fall to Other");
  assert.equal(row("Saint Marrow").typeId, "t_deity");
  assert.equal(row("Mira Fenn").existing, entity("Mira Fenn").ref, "a name the world has was not shown as there");
  assert.equal(row("Gullhaven").existing, entity("Gullhaven").ref);
  assert.equal(row("The Watcher in the Well"), undefined, "a beholder by another name came through");
  assert.ok(outline.left.some((line) => line.includes("The Watcher in the Well") && line.includes("beholder")), outline.left.join(" | "));
  assert.equal(row("Reef Owlbear").basis, "Owlbear");
  assert.equal(row("Tide Hook").itemKind, "weapon");
  assert.deepEqual(outlineCounts(outline), { people: 3, places: 2, factions: 1, lore: 2, creatures: 2, items: 2 });
  // The link to a name nobody has, and the word WorldForge does not use, are gone.
  assert.deepEqual(outline.links.map((link) => link.label).sort(), ["friend of", "guards", "lives in", "member of"]);
  assert.equal(outline.links.find((link) => link.label === "friend of").to, entity("Mira Fenn").ref);
  assert.equal(outline.links.find((link) => link.label === "guards").from, row("Silt Stalker").key);
});

await test("An outline holds at most its caps, and says so.", () => {
  const many = { people: Array.from({ length: 9 }, (_, at) => ({ name: `Person ${at}` })), creatures: Array.from({ length: 5 }, (_, at) => ({ name: `Beast ${at}`, cr: 1 })) };
  const outline = readOutlineReply(many, { types: worldView(workshop.id).doc.types }, []);
  assert.equal(outline.entries.length, OUTLINE_CAPS.npc);
  assert.equal(outline.assets.length, OUTLINE_CAPS.creature);
  assert.equal(outline.left.length, 2, outline.left.join(" | "));
  assert.equal(nearestCr("1/4"), 0.25);
  assert.equal(nearestCr(2.6), 3);
  assert.deepEqual([...OUTLINE_ITEM_KINDS], [...ITEM_KINDS], "the outline's item kinds drifted from Homebrew's");
});

await test("Reserved creatures are found as whole names, any case, and never in a plain word.", () => {
  assert.equal(reservedCreature("A Mind Flayer scholar"), "mind flayer");
  assert.equal(reservedCreature("", "BEHOLDER"), "beholder");
  assert.equal(reservedCreature("Yuan-ti Pureblood"), "yuan-ti");
  assert.equal(reservedCreature("An aboleth in flooded ruins"), "");
  assert.equal(reservedCreature("Beholders' Hill"), "", "a word containing a name is not that name");
});

// ---- the review writes nothing ----

let outline;
await test("Drafting an outline through the route answers the outline and changes nothing.", async () => {
  const before = shelves();
  const answer = await call(outlineRoute, { step: "outline", idea: "A drowned kingdom where the tide-priests ration dry land." });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  outline = answer.json.outline;
  assert.ok(outline.entries.length >= 5 && outline.assets.length === 4, JSON.stringify(outline));
  assert.deepEqual(shelves(), before, "the outline wrote something");
  assert.match(requests.at(-1).user, /The world already has: .*Mira Fenn/, "the model was not told what the world has");
});

// ---- only what is ticked is made ----

const row = (name) => outline.entries.find((entry) => entry.name === name) ?? outline.assets.find((entry) => entry.name === name);
const made = {};
await test("Each ticked entry is made through the forge's apply, one at a time; the unticked are not.", async () => {
  const before = shelves();
  for (const name of ["Abbess Corra Vane", "The Last Steeple", "The Tide Priesthood"]) {
    const answer = await call(aiRoute, { tool: "apply", entities: [row(name)], links: [], stubs: [] });
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    assert.equal(answer.json.made.length, 1);
    made[row(name).key] = answer.json.made[0].ref;
  }
  assert.equal(shelves().world, before.world + 3);
  assert.equal(entity("Abbess Corra Vane").shelf, "npc");
  assert.equal(entity("Abbess Corra Vane").entry.hiddenTruth, "She sells dry berths to the smugglers.");
  for (const name of ["Tamsin Reed", "The Drowning", "Saint Marrow"]) assert.equal(entity(name), undefined, `${name} was made without being ticked`);
  assert.equal(shelves().monsters, before.monsters, "a creature was made by making entries");
});

await test("A creature the Bestiary's validator refuses is reported with its reason, and nothing is stored.", async () => {
  model.creature = BAD_CREATURE;
  const before = shelves();
  const answer = await call(outlineRoute, { step: "asset", asset: row("Silt Stalker"), premise: outline.premise });
  assert.equal(answer.status, 422, JSON.stringify(answer.json));
  assert.equal(answer.json.stage, "check");
  assert.match(answer.json.error, /The Bestiary refused Silt Stalker: "lotsofit" is not a dice expression/);
  assert.deepEqual(shelves(), before, "a refused creature left something behind");
});

await test("Retrying the one failed creature makes it once, in the Bestiary, with a World entry linked to it; nothing else is made.", async () => {
  model.creature = GOOD_CREATURE;
  const before = shelves();
  const asked = requests.length;
  const answer = await call(outlineRoute, { step: "asset", asset: row("Silt Stalker"), premise: outline.premise });
  assert.equal(answer.status, 201, JSON.stringify(answer.json));
  assert.equal(requests.length, asked + 1, "a retry asked the model more than once");
  assert.match(requests.at(-1).system, /named creature from the 5e System Reference Document 5\.1 .* or an original design/);
  assert.match(requests.at(-1).system, /Never a beholder, mind flayer/);
  const { made: asset } = answer.json;
  assert.equal(asset.lands, "Bestiary");
  const monsters = listHomebrewMonsters(author.id);
  assert.equal(monsters.length, before.monsters + 1);
  const stalker = monsters.find((monster) => monster.id === asset.id);
  assert.equal(stalker.draft.stats.cr, 3);
  assert.equal(stalker.draft.stats.size, "Large");
  assert.deepEqual(stalker.draft.stats.attacks.map((attack) => [attack.name, attack.damage, attack.type]), [["Claw", "2d6+3", "slashing"]]);
  assert.equal(stalker.draft.stats.xp, 700, "XP was not the CR's");
  const article = entities().find((entry) => entry.ref === asset.entryRef);
  assert.equal(article.shelf, "lore");
  assert.deepEqual(article.bound.map((record) => [record.kind, record.ownId, record.found]), [["monster", asset.id, true]]);
  assert.match(article.text, /wades the drowned streets/);
  assert.equal(shelves().items, before.items, "an item was made by making a creature");
  assert.equal(shelves().world, before.world + 1);
});

await test("A reserved creature never reaches the Bestiary, whether the outline or the model names it.", async () => {
  const before = shelves();
  const asked = requests.length;
  const named = await call(outlineRoute, { step: "asset", asset: { kind: "creature", name: "Mind Flayer Envoy", cr: 7 } });
  assert.equal(named.status, 422);
  assert.equal(requests.length, asked, "the model was asked for a reserved creature");
  model.creature = { ...GOOD_CREATURE, basis: "Beholder" };
  const drawn = await call(outlineRoute, { step: "asset", asset: { kind: "creature", name: "Eye of the Deep", summary: "An aberration from the trench.", cr: 5 } });
  assert.equal(drawn.status, 422, JSON.stringify(drawn.json));
  assert.match(drawn.json.error, /beholder/);
  assert.deepEqual(shelves(), before);
  model.creature = GOOD_CREATURE;
});

await test("A creature built on an SRD monster copies that block as it stands, under the outline's name.", async () => {
  if (!hasPack) {
    // CI has no content pack, so there is no SRD block to copy: the creature
    // is an original at its rating instead, and says nothing about a copy.
    const answer = await call(outlineRoute, { step: "asset", asset: row("Reef Owlbear") });
    assert.equal(answer.status, 201, JSON.stringify(answer.json));
    assert.doesNotMatch(answer.json.made.detail, /From the SRD/);
    return;
  }
  model.creature = { ...GOOD_CREATURE, basis: "Owlbear" };
  const answer = await call(outlineRoute, { step: "asset", asset: row("Reef Owlbear") });
  assert.equal(answer.status, 201, JSON.stringify(answer.json));
  assert.match(answer.json.made.detail, /From the SRD's Owlbear, CR 3/);
  const reef = listHomebrewMonsters(author.id).find((monster) => monster.id === answer.json.made.id);
  assert.equal(reef.draft.name, "Reef Owlbear");
  assert.ok(reef.draft.stats.attacks.some((attack) => attack.name === "Beak"), "the owlbear's own attacks were not copied");
  model.creature = GOOD_CREATURE;
});

await test("An item Homebrew refuses is reported with its reason; a published name is refused before the model is asked.", async () => {
  const before = shelves();
  model.item = BAD_ITEM;
  const refused = await call(outlineRoute, { step: "asset", asset: row("Tide Hook") });
  assert.equal(refused.status, 422, JSON.stringify(refused.json));
  assert.match(refused.json.error, /Homebrew refused Tide Hook: Tide Hook: a weapon's die is a d12 at most/);
  const asked = requests.length;
  const published = await call(outlineRoute, { step: "asset", asset: row("Longsword") });
  assert.equal(published.status, 422);
  assert.match(published.json.error, /Longsword/);
  assert.equal(requests.length, asked, "the model was asked for an item with a published name");
  assert.deepEqual(shelves(), before);
  model.item = GOOD_ITEM;
});

await test("A retried item lands in Homebrew as a real weapon, with a World entry linked to it.", async () => {
  const before = shelves();
  const answer = await call(outlineRoute, { step: "asset", asset: row("Tide Hook") });
  assert.equal(answer.status, 201, JSON.stringify(answer.json));
  const item = listHomebrew(author.id, "item").find((entry) => entry.id === answer.json.made.id);
  assert.equal(item.data.itemKind, "weapon");
  assert.equal(item.data.weapon.damage, "1d8 piercing");
  assert.deepEqual(item.data.weapon.properties, ["reach"]);
  assert.equal(answer.json.made.lands, "Homebrew");
  const article = entities().find((entry) => entry.ref === answer.json.made.entryRef);
  assert.deepEqual(article.bound.map((record) => [record.kind, record.found]), [["item", true]]);
  assert.equal(shelves().items, before.items + 1);
  assert.equal(shelves().monsters, before.monsters);
});

await test("The ticked links are written once both ends exist, and those waiting on an unmade end are not.", async () => {
  const stalker = entities().find((entry) => entry.bound.some((record) => record.kind === "monster" && record.name === "Silt Stalker"));
  const ref = (end) => made[end] ?? (end === row("Silt Stalker").key ? stalker.ref : end);
  const nameOf = (end) => row(end)?.name ?? outline.entries.find((entry) => entry.key === end || entry.existing === end)?.name ?? entities().find((entry) => entry.ref === end)?.name;
  const keyed = (end) => outline.entries.find((entry) => entry.key === end)?.name ?? outline.assets.find((entry) => entry.key === end)?.name ?? nameOf(end);
  const links = outline.links.map((link) => ({ ...link, from: ref(link.from), to: ref(link.to), fromName: keyed(link.from), toName: keyed(link.to) }));
  const answer = await call(aiRoute, { tool: "apply", entities: [], links, stubs: [] });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  assert.equal(answer.json.links, 3, JSON.stringify(answer.json));
  // Tamsin Reed was not ticked, so her link to Mira waits, named.
  assert.deepEqual(answer.json.linksLeft, [{ from: "Tamsin Reed", to: "Mira Fenn", label: "friend of", why: "Tamsin Reed was not added" }]);
  const { doc } = worldView(workshop.id);
  assert.ok(doc.links.some((link) => link.from === stalker.ref && link.label === "guards" && link.to === made[row("The Last Steeple").key]));
});

await test("A model that cannot be reached fails the one asset, says so, and stores nothing.", async () => {
  model.down = true;
  const before = shelves();
  const answer = await call(outlineRoute, { step: "asset", asset: { kind: "item", name: "Salt Lamp", itemKind: "gear" } });
  assert.equal(answer.status, 502);
  assert.equal(answer.json.stage, "model");
  assert.deepEqual(shelves(), before);
  const drafted = await call(outlineRoute, { step: "outline", idea: "Anything." });
  assert.equal(drafted.status, 502);
  model.down = false;
});

// ---- task-specific draft adapters ----

await test("Draft asks each kind of entry for what it needs, and tells a creature's entry its stat block.", async () => {
  const { doc } = worldView(workshop.id);
  const abbess = entity("Abbess Corra Vane");
  await draftEntry(getCampaignById(workshop.id), abbess.ref, "");
  assert.ok(requests.at(-1).system.includes(DRAFT_ASKS.person), "a person's draft did not ask for a person's things");
  const stalker = entity("Silt Stalker");
  assert.equal(draftKind(stalker.shelf, doc.types.find((type) => type.id === stalker.entry.typeId) ?? doc.types[0], stalker.bound), "creature");
  await draftEntry(getCampaignById(workshop.id), stalker.ref, "");
  assert.ok(requests.at(-1).system.includes(DRAFT_ASKS.creature));
  assert.match(requests.at(-1).user, /Its rules at the table, which the entry must agree with but never quote: Silt Stalker is a Large monstrosity, CR 3, AC \d+, \d+ hp[^;]*; attacks: Claw \(slashing\)/);
  const hook = entities().find((entry) => entry.bound.some((record) => record.kind === "item"));
  await draftEntry(getCampaignById(workshop.id), hook.ref, "");
  assert.ok(requests.at(-1).system.includes(DRAFT_ASKS.item));
  assert.match(requests.at(-1).user, /Tide Hook: martial melee, 1d8 piercing, reach/);
  const steeple = entity("The Last Steeple");
  await draftEntry(getCampaignById(workshop.id), steeple.ref, "");
  assert.ok(requests.at(-1).system.includes(DRAFT_ASKS.place));
  assert.equal(draftKind("lore", { id: "t_deity", loreCategory: "religion" }, []), "deity");
  assert.equal(draftKind("lore", { id: "t_artifact", loreCategory: "magic" }, []), "item");
  assert.equal(draftKind("lore", { id: "t_other", loreCategory: "other" }, []), "lore");
});

// ---- no AI ----

await test("With no text model, every Create choice can still be made by hand or by copy, and the chooser says where drafting is switched on.", () => {
  const none = { story: false, images: false };
  for (const choice of CREATE_CHOICES) {
    assert.ok(choice.steps.some((step) => !stepUnavailable(step, none)), `${choice.id} has no way in without AI`);
    for (const step of choice.steps.filter((entry) => !stepUnavailable(entry, none))) {
      assert.ok(!offeredWays(step, none).includes("draft") || !step.drafts, `${choice.id}: "${step.label}" offers drafting with no model`);
    }
  }
  const outlineChoice = CREATE_CHOICES.find((choice) => choice.id === "outline");
  const draftStep = outlineChoice.steps.find((step) => step.view === "outline");
  assert.ok(draftStep, "Create has no way to draft a world from an idea");
  assert.deepEqual(draftStep.ways, ["draft"]);
  assert.equal(stepUnavailable(draftStep, none), true);
  assert.equal(stepUnavailable(draftStep, { story: true, images: false }), false);
  assert.ok(outlineChoice.steps.some((step) => step.ways.includes("extract") && step.view === "forge"), "extracting from notes stopped being its own way in");
  assert.deepEqual(missingModels(CREATE_CHOICES.find((choice) => choice.id === "npc"), none), ["story"]);
  assert.match(ENABLE_DRAFTING.story, /Admin > Text model defaults/);
  assert.match(ENABLE_DRAFTING.images, /Admin > Image generation/);
  const chooser = fs.readFileSync(new URL("../src/app/workshop/[workshopId]/CreateChooser.tsx", import.meta.url), "utf8");
  assert.ok(chooser.includes("ENABLE_DRAFTING[") && chooser.includes("create-no-ai"), "the chooser does not explain a missing model");
  const panel = fs.readFileSync(new URL("../src/app/workshop/world/WorldForgePanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /AI_VIEWS: ReadonlySet<View> = new Set\(\["outline", "forge", "ask"\]\)/, "the Outline view shows on a server with no model");
});

await test("A player cannot draft or make anything from an outline.", async () => {
  const player = world.addUser("deckhand");
  const before = shelves();
  const drafted = await call(outlineRoute, { step: "outline", idea: "Anything." }, player);
  assert.notEqual(drafted.status, 200);
  const asset = await call(outlineRoute, { step: "asset", asset: { kind: "item", name: "Salt Lamp" } }, player);
  assert.notEqual(asset.status, 201);
  assert.deepEqual(shelves(), before);
});

await test("A play table's story authority cannot draft a world through the outline route: it is the workshop's.", async () => {
  const before = shelves();
  world.signIn({ id: world.owner.id });
  const response = await outlineRoute.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ step: "asset", asset: { kind: "item", name: "Salt Lamp" } }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /in its workshop/);
  assert.deepEqual(shelves(), before);
});

server.close();
world.close();
finish();
