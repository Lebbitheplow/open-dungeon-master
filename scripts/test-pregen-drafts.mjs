// AI-drafted pregens (src/lib/dm/pregen-draft.ts): the DM presses "Draft
// pregens" on a workshop's roster (or ticks the campaign creator's offer),
// the AI DM proposes a party for the adventure, the quick-build engine
// builds every sheet (src/lib/characters/pregen-drafts.ts), and the library's
// door judges each one before any is stored.
//
// Held here, with the model a scripted stand-in (enforce-narrator.mjs
// fakeModel):
//   - a failed call, or a reply that is not the shape asked for, stores
//     nothing at all;
//   - every draft is a sheet the library's door passes, every class at
//     every level band, and a class or race the builder does not offer
//     falls back to the closest one and says so;
//   - a draft is built at the table's starting level when the campaign
//     creator asks, with that level's hit points, subclass and
//     improvements, and at level 1 from the workshop;
//   - drafts land unticked: no player sees one until the DM ticks it, and
//     each is marked as drafted until the DM edits it;
//   - with no AI DM set up the action is off, says why, and drafts nothing.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation, PORTRAIT } from "./lib/enforce-creation.mjs";
import { fakeModel, failure, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-pregen-drafts");
const logic = await import("../src/lib/dm/pregen-draft-logic.ts");
const engine = await import("../src/lib/characters/pregen-drafts.ts");
const { admitSheet } = await import("../src/lib/characters/admit.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { recordOrigin } = await import("../src/lib/db/content-origins.ts");
const { upsertNpc } = await import("../src/lib/db/npcs.ts");
const { insertBeat } = await import("../src/lib/db/workshop-beats.ts");
const campaignsDb = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { requestTokens } = await import("../src/lib/dm/request-fit.ts");
const { subclassLevelFor } = await import("../src/lib/srd/features.ts");
const { earnedAsiCountFor } = await import("../src/lib/srd/asi.ts");

const model = await fakeModel();

const HEROES = [
  { name: "Brannoc Vell", concept: "A gate warden who never left his post", class: "Fighter", race: "Human", background: "Soldier", role: "tank", backstory: "Brannoc held the Sunken Keep's outer gate for ten years. When Mother Ysolde vanished he swore to bring her home." },
  { name: "Thessa Ironbraid", concept: "A healer of the deep shrines", class: "Cleric", race: "Hill Dwarf", background: "Acolyte", role: "healer", backstory: "Thessa tends the shrine below the keep. Mother Ysolde taught her the old rites." },
  { name: "Ilyra Moonwhisper", concept: "A scholar of drowned things", class: "Wizard", race: "High Elf", background: "Sage", role: "support", backstory: "Ilyra came to the Sunken Keep to read its flooded library. She believes the lost bell rings for her." },
  { name: "Kestrel Dunmore", concept: "A sharpshooter for hire", class: "Gunslinger", race: "Wood Elf", background: "Bounty Hunter", role: "dps", backstory: "Kestrel tracks bounties along the marsh roads. A writ for the keep's thief brought her here." },
];
const heroesReply = (heroes = HEROES) => reply({ text: JSON.stringify({ heroes }) });

// A table made from a workshop that holds an adventure: a premise, a hook,
// a person, a place and a secret. The DM is an admin, so the workshop may
// talk to the scripted model.
async function openDesk({ level = 1, ai = true } = {}) {
  const table = await openCreation({ campaign: { startingLevel: level } });
  const { world } = table;
  const dm = world.owner;
  const workshop = createWorkshop(dm.id, {
    title: "The Sunken Keep",
    description: "A keep half drowned in the marsh, where the abbess Mother Ysolde has gone missing.",
  });
  recordOrigin(table.campaignId, "npcs", "npc-copy", workshop.id, "npc-original");
  upsertNpc({ campaignId: workshop.id, name: "Mother Ysolde", trait: "stern, kind to the lost" });
  insertBeat(workshop.id, { kind: "hook", title: "The bell", body: "A drowned bell rings at night.", links: {}, edges: [], routes: {}, x: 0, y: 0 });
  insertBeat(workshop.id, { kind: "secret", title: "The truth", body: "Ysolde drowned the bell-ringer herself.", links: {}, edges: [], routes: {}, x: 0, y: 0 });
  if (ai) {
    model.pointAt({ owner: dm, campaignId: workshop.id });
  } else {
    campaignsDb.updateStorySettings(workshop.id, { textProvider: "none" });
  }
  const route = {
    draft: await world.route("workshops/[workshopId]/pregens/draft"),
    roster: await world.route("workshops/[workshopId]/pregens"),
    offered: await world.route("campaigns/[campaignId]/pregens"),
    character: await world.route("characters/[characterId]"),
  };
  async function as(user, mod, method, body, params) {
    world.signIn(user);
    return table.call(mod, method, body, params);
  }
  const ws = { workshopId: workshop.id };
  return {
    ...table,
    dm,
    workshop,
    route,
    readiness: () => as(dm, route.draft, "GET", undefined, ws),
    draft: (body = {}) => as(dm, route.draft, "POST", body, ws),
    roster: async () => (await as(dm, route.roster, "GET", undefined, ws)).json.pregens,
    offer: (characterId, offered) => as(dm, route.roster, "PATCH", { characterId, offered }, ws),
    playerSees: async () => (await as(table.player, route.offered, "GET", undefined, { campaignId: table.campaignId })).json.pregens,
    libraryCount: () => getDatabase().prepare(`SELECT COUNT(*) AS n FROM library_characters WHERE user_id = ?`).get(dm.id).n,
  };
}

await test("the AI DM is asked about the adventure in a short prompt: premise, hook and people, never a secret.", async () => {
  const desk = await openDesk();
  model.script([heroesReply()]);
  const drafted = await desk.draft();
  assert.equal(drafted.status, 201, JSON.stringify(drafted.json));
  const [request] = model.requests;
  const text = request.messages.map((message) => message.content).join("\n");
  assert.match(text, /Mother Ysolde has gone missing/);
  assert.match(text, /The bell: A drowned bell rings at night/);
  assert.match(text, /Mother Ysolde \(stern, kind to the lost\)/);
  assert.match(text, /exactly 4 heroes/);
  assert.doesNotMatch(text, /drowned the bell-ringer/, "a secret of the adventure reached the prompt");
  // Well inside the compact profile's 16K window, with room for the answer.
  assert.ok(requestTokens(request.messages) < 4000, `the draft prompt is ${requestTokens(request.messages)} tokens`);
  desk.world.close();
});

await test("drafts land on the roster unticked and marked, every sheet legal, and no player sees one until the DM ticks it.", async () => {
  const desk = await openDesk();
  model.script([heroesReply()]);
  const drafted = await desk.draft({ count: 4 });
  assert.equal(drafted.status, 201, JSON.stringify(drafted.json));
  assert.equal(drafted.json.level, 1, "a draft from the workshop is built at level 1");
  const roster = await desk.roster();
  assert.deepEqual(roster.map((entry) => entry.name).sort(), HEROES.map((hero) => hero.name).sort());
  for (const entry of roster) {
    assert.equal(entry.offered, false, `${entry.name} was offered without the DM ticking it`);
    assert.equal(entry.drafted, true, `${entry.name} is not marked as drafted`);
    assert.equal(entry.level, 1);
    const character = desk.characters.getCharacter(entry.id);
    assert.equal(character.workshopId, desk.workshop.id);
    assert.equal(character.role, "pc");
    assert.match(character.sheet.notes, /^Drafted by the AI DM\./);
    assert.ok(character.sheet.backstory.length > 20, "the backstory was not kept");
    const verdict = admitSheet({ door: "library", level: character.level, sheet: character.sheet, userId: desk.dm.id });
    assert.ok(verdict.ok, `${entry.name} is not legal: ${verdict.problems?.join("; ")}`);
  }
  // The class the builder does not offer fell back, and said so.
  const kestrel = roster.find((entry) => entry.name === "Kestrel Dunmore");
  assert.ok(["rogue", "fighter", "ranger"].includes(kestrel.class), `Gunslinger became ${kestrel.class}`);
  assert.ok(drafted.json.changes.some((line) => /Gunslinger is not a class the builder offers/.test(line)), drafted.json.changes.join("; "));
  assert.ok(drafted.json.changes.some((line) => /Bounty Hunter is not a background/.test(line)), drafted.json.changes.join("; "));
  assert.match(desk.characters.getCharacter(kestrel.id).sheet.notes, /Gunslinger is not a class/);
  // Nothing reached the players, until the DM ticked one.
  assert.deepEqual(await desk.playerSees(), []);
  const ticked = await desk.offer(kestrel.id, true);
  assert.equal(ticked.status, 200, JSON.stringify(ticked.json));
  assert.deepEqual((await desk.playerSees()).map((entry) => entry.name), ["Kestrel Dunmore"]);
  desk.world.close();
});

await test("an edited draft is no longer marked as drafted.", async () => {
  const desk = await openDesk();
  model.script([heroesReply()]);
  await desk.draft();
  const [first] = await desk.roster();
  const character = desk.characters.getCharacter(first.id);
  desk.world.signIn(desk.dm);
  const edited = await desk.call(
    desk.route.character,
    "PATCH",
    { level: character.level, sheet: { ...character.sheet, backstory: "Rewritten by the DM.", portrait: PORTRAIT } },
    { characterId: first.id },
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const after = (await desk.roster()).find((entry) => entry.id === first.id);
  assert.equal(after.drafted, false);
  assert.ok((await desk.roster()).filter((entry) => entry.drafted).length === 3);
  desk.world.close();
});

await test("drafted from the campaign creator, the heroes are built at the table's starting level with its hit points, subclass and improvements.", async () => {
  const desk = await openDesk({ level: 5 });
  model.script([heroesReply()]);
  const drafted = await desk.draft({ count: 4, campaignId: desk.campaignId });
  assert.equal(drafted.status, 201, JSON.stringify(drafted.json));
  assert.equal(drafted.json.level, 5);
  for (const entry of await desk.roster()) {
    const character = desk.characters.getCharacter(entry.id);
    assert.equal(character.level, 5, `${entry.name} is level ${character.level}`);
    const { sheet } = character;
    const pickAt = subclassLevelFor(sheet.class);
    if (pickAt !== null && pickAt <= 5) {
      assert.ok(sheet.subclass, `${entry.name} the level 5 ${sheet.class} has no subclass`);
    }
    assert.equal((sheet.asiChoices ?? []).length, earnedAsiCountFor([{ id: sheet.class, level: 5 }]), `${entry.name}'s improvements`);
    const levelOne = engine.buildDraft(
      { name: entry.name, concept: "", className: sheet.class, race: sheet.race, background: sheet.background, backstory: "x", role: null },
      1,
    );
    assert.ok(levelOne.ok);
    assert.ok(sheet.maxHp > levelOne.draft.sheet.maxHp * 2, `${entry.name} has ${sheet.maxHp} hit points at level 5`);
  }
  const fighter = (await desk.roster()).find((entry) => entry.class === "fighter");
  assert.ok(desk.characters.getCharacter(fighter.id).sheet.features.some((feature) => feature.name === "Extra Attack"), "a level 5 fighter without Extra Attack");
  // Somebody else's campaign gives no level to draft at.
  const stranger = desk.world.addUser("stranger");
  const theirs = campaignsDb.createCampaign(stranger.id, { title: "Elsewhere", description: "", theme: "", maxPlayers: 4, startingLevel: 9, difficulty: "standard" });
  const refused = await desk.draft({ campaignId: theirs.id });
  assert.equal(refused.status, 404);
  desk.world.close();
});

for (const [label, script] of [
  ["a reply that is not JSON", [reply({ text: "Here are some heroes: a fighter, a cleric and a wizard." })]],
  ["a reply with fewer heroes than asked", [heroesReply(HEROES.slice(0, 3))]],
  ["a reply with a hero who has no class", [heroesReply([...HEROES.slice(0, 3), { ...HEROES[3], class: "" }])]],
  ["a model that fails", [failure(500)]],
]) {
  await test(`${label} says so and drafts nothing.`, async () => {
    const desk = await openDesk();
    const before = desk.libraryCount();
    model.script(script);
    const drafted = await desk.draft({ count: 4 });
    assert.ok(drafted.status >= 400, `${label} drafted: ${JSON.stringify(drafted.json)}`);
    assert.match(drafted.json.error, /nothing was drafted/i);
    assert.equal(desk.libraryCount(), before, "a partial draft was stored");
    assert.deepEqual(await desk.roster(), []);
    desk.world.close();
  });
}

await test("with no AI DM set up, the action is off with a plain reason and drafts nothing.", async () => {
  const saved = process.env.DEFAULT_TEXT_PROVIDER;
  process.env.DEFAULT_TEXT_PROVIDER = "none";
  try {
    const desk = await openDesk({ ai: false });
    const readiness = await desk.readiness();
    assert.equal(readiness.status, 200);
    assert.equal(readiness.json.ready, false);
    assert.match(readiness.json.reason, /No AI DM is set up/);
    const before = model.requests.length;
    const drafted = await desk.draft();
    assert.equal(drafted.status, 409);
    assert.equal(drafted.json.reason, "no_ai");
    assert.equal(model.requests.length, before, "the model was asked anyway");
    assert.deepEqual(await desk.roster(), []);
    desk.world.close();
  } finally {
    process.env.DEFAULT_TEXT_PROVIDER = saved;
  }
});

await test("the action is on where an AI DM is set up, and a count outside 1 to 6 is refused.", async () => {
  const desk = await openDesk();
  const readiness = await desk.readiness();
  assert.equal(readiness.json.ready, true, JSON.stringify(readiness.json));
  assert.equal(readiness.json.defaultCount, 4);
  assert.equal(readiness.json.maxCount, 6);
  assert.equal((await desk.draft({ count: 7 })).status, 400);
  assert.equal((await desk.draft({ count: 0 })).status, 400);
  desk.world.close();
});

await test("every class the builder offers drafts to a legal sheet at levels 1, 4, 11 and 20.", async () => {
  const desk = await openDesk();
  const offered = engine.draftOffered();
  const swapped = [];
  for (const klass of offered.classes) {
    for (const level of [1, 4, 11, 20]) {
      const built = engine.buildDraft(
        { name: `Test ${klass.name}`, concept: "", className: klass.name, race: "Human", background: "Acolyte", backstory: "A test hero.", role: null },
        level,
        offered,
      );
      assert.ok(built.ok, `${klass.id} at ${level}: ${built.error}`);
      // A class the engine cannot finish at a level is swapped, and says so.
      if (built.draft.sheet.class !== klass.id) {
        assert.ok(
          built.draft.changes.some((line) => line.includes(`cannot finish a level ${level} ${klass.name}`)),
          `${klass.id} at ${level} became ${built.draft.sheet.class} unsaid: ${built.draft.changes.join("; ")}`,
        );
        swapped.push(`${klass.id} ${level}`);
      }
      const verdict = admitSheet({ door: "library", level: built.draft.level, sheet: built.draft.sheet, userId: desk.dm.id });
      assert.ok(verdict.ok, `${klass.id} at ${level} is not legal: ${verdict.problems?.join("; ")}`);
    }
  }
  // Only the artificer's late infusions are left to the player by the
  // engine today; any other class swapped is a new gap.
  assert.deepEqual(swapped, ["artificer 20"]);
  desk.world.close();
});

await test("a high fantasy adventure drafts from its setting's classes: no netrunner at the keep.", () => {
  const fantasy = engine.draftOffered("high_fantasy").classes.map((klass) => klass.id);
  assert.ok(fantasy.includes("fighter") && fantasy.includes("wizard"));
  assert.ok(!fantasy.includes("netrunner"), "a netrunner was offered for high fantasy");
  const cyber = engine.draftOffered("cyberpunk").classes.map((klass) => klass.id);
  assert.ok(cyber.includes("netrunner"), cyber.join(", "));
  const fallback = engine.resolveChoices({ name: "Vel", concept: "", className: "Netrunner", race: "Human", background: "Sage", backstory: "x", role: "support" }, engine.draftOffered("high_fantasy"));
  assert.notEqual(fallback.ids.classId, "netrunner");
  assert.match(fallback.changes.join(" "), /Netrunner is not a class the builder offers/);
});

await test("a race named loosely is built in the builder's own form of it, and an unknown one falls back with a line saying so.", () => {
  const offered = engine.draftOffered();
  const halfling = engine.resolveChoices({ name: "Pip", concept: "", className: "Rogue", race: "Halfling", background: "Urchin", backstory: "x", role: "utility" }, offered);
  assert.match(offered.races.find((race) => race.id === halfling.ids.raceId).name, /Halfling/);
  assert.match(halfling.changes.join(" "), /the builder's form of Halfling/);
  const unknown = engine.resolveChoices({ name: "Zed", concept: "", className: "Paladin", race: "Clockwork Moth", background: "Noble", backstory: "x", role: "tank" }, offered);
  assert.ok(offered.races.some((race) => race.id === unknown.ids.raceId));
  assert.match(unknown.changes.join(" "), /Clockwork Moth is not a race the builder offers/);
});

await test("the reply reader takes JSON in a fence or a sentence, keeps the first heroes of a longer list, and reads roles.", () => {
  const fenced = "Sure!\n```json\n" + JSON.stringify({ heroes: [...HEROES, HEROES[0]] }) + "\n```";
  const parsed = logic.parseDraftReply(fenced, 4);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.heroes.length, 4);
  assert.deepEqual(parsed.heroes.map((hero) => hero.role), ["tank", "healer", "support", "dps"]);
  const bare = logic.parseDraftReply(JSON.stringify(HEROES.slice(0, 2).map((hero) => ({ ...hero, role: "bard" }))), 2);
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.heroes.map((hero) => hero.role), [null, null]);
  assert.equal(logic.parseDraftReply("{ not json", 2).ok, false);
});

model.close();
finish();
