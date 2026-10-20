// The level-up through a player's agent: odm_level_up_options reads what the
// next level offers, odm_level_up takes it. Before these an agent had no way
// to level a character at all: the dialog's PATCH on /sheet was the only
// door, and no tool reached it.
//
// workbenchCall reaches routes over loopback fetch; here fetch goes straight
// to the route handlers, signed in with the session the grant minted (as
// scripts/test-mcp-lore-tools.mjs does), so what is tested is the tool's
// request, the route's checks and the level the engine builds.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, LEGAL_WIZARD, openCreation } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-mcp-level-up");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { workbenchCall, workbenchTools } = await import("../src/lib/agents/workbench.ts");

// A fetch that answers the two sheet routes the tools call.
async function routeFetch(world) {
  const sheet = await world.route("campaigns/[campaignId]/sheet");
  const options = await world.route("campaigns/[campaignId]/sheet/level-up");
  return async (url, init = {}) => {
    const target = new URL(url);
    const match = /^\/api\/campaigns\/([A-Za-z0-9_-]+)\/sheet(\/level-up)?$/.exec(target.pathname);
    assert.ok(match, `unexpected path ${target.pathname}`);
    globalThis.__odmTestToken = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const method = init.method ?? "GET";
    const handler = (match[2] ? options : sheet)[method];
    assert.ok(handler, `no ${method} handler for ${target.pathname}`);
    return handler(new Request(target, { method, headers: init.headers, body: init.body }), {
      params: Promise.resolve({ campaignId: match[1] }),
    });
  };
}

async function seated(sheet) {
  const table = await openCreation();
  const joined = await table.throughLibrary(sheet, 1);
  assert.ok(joined.status < 300, joined.error ?? "");
  campaigns.setCampaignStatus(table.campaignId, "active");
  const grant = (scopes) =>
    createConnectionGrant({ userId: table.player.id, name: `agent ${scopes.join("+")}`, scopes, campaignId: table.campaignId }).grant;
  return { ...table, hero: joined.sheet, play: grant(["read", "play"]), readOnly: grant(["read"]) };
}

const originalFetch = globalThis.fetch;
const json = (outcome) => JSON.parse(outcome.text);

try {
  await test("The read is on the read scope and the level-up on play, so a read-only agent can look but not level.", async () => {
    const { play, readOnly, world } = await seated(LEGAL_FIGHTER);
    const names = (grant) => workbenchTools(grant).map((tool) => tool.name);
    assert.ok(names(readOnly).includes("odm_level_up_options"));
    assert.ok(!names(readOnly).includes("odm_level_up"), "a read-only connection was offered the level-up");
    assert.ok(names(play).includes("odm_level_up_options") && names(play).includes("odm_level_up"));
    const refused = await workbenchCall(readOnly, "odm_level_up", { campaignId: play.campaignId, level: 2 });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /Unknown tool/);
    world.close();
  });

  await test("A fighter goes from 1 to 4 through the agent: unearned levels refused, a pick left out carried as owed, a retry said as such, and nothing but the level's fields reaching the sheet.", async () => {
    const { world, campaignId, hero, play, sheets, player } = await seated(LEGAL_FIGHTER);
    globalThis.fetch = await routeFetch(world);
    const options = async () => {
      const outcome = await workbenchCall(play, "odm_level_up_options", { campaignId });
      assert.equal(outcome.isError, false, outcome.text);
      return json(outcome);
    };
    const levelUp = (args) => workbenchCall(play, "odm_level_up", { campaignId, ...args });
    const award = async (amount) => {
      const out = await world.invoke("award_xp", { characterIds: [hero.id], amount, reason: "the road" });
      assert.equal(out.ok, true, out.error);
    };

    // No experience yet: the read says why, and the level-up is refused.
    const early = await options();
    assert.equal(early.ready, false);
    assert.equal(early.nextLevel, 2);
    assert.equal(early.xpForNextLevel, 300);
    assert.match(early.notReady, /300 experience points/);
    const unearned = await levelUp({ level: 2 });
    assert.equal(unearned.isError, true);
    assert.match(unearned.text, /HTTP 403/);
    assert.equal(sheets.getSheetForUser(campaignId, player.id).level, 1);

    // Level 2: the d10's fixed 6 and Constitution 14's +2, and no picks.
    await award(300);
    const two = await options();
    assert.equal(two.ready, true, two.notReady);
    assert.equal(two.levelUpClass, "fighter");
    assert.equal(two.classLevelAfter, 2);
    assert.deepEqual([two.hitPoints.die, two.hitPoints.fixed, two.hitPoints.min, two.hitPoints.max], ["d10", 8, 3, 12]);
    assert.deepEqual(two.choices, {}, `a fighter's 2nd level asks for nothing: ${JSON.stringify(two.choices)}`);
    const before = sheets.getSheetForUser(campaignId, player.id);
    // Fields outside the level-up ride along and must not land.
    const taken = await levelUp({ level: 2, maxHp: 500, xp: 999999, notes: "agent was here", portrait: null, gold: 5000 });
    assert.equal(taken.isError, false, taken.text);
    assert.equal(json(taken).hpGained, 8);
    const atTwo = sheets.getSheetForUser(campaignId, player.id);
    assert.equal(atTwo.level, 2);
    assert.equal(atTwo.maxHp, before.maxHp + 8);
    assert.equal(atTwo.xp, 300, "the agent's xp reached the sheet");
    assert.equal(atTwo.gold, before.gold, "the agent's gold reached the sheet");
    assert.equal(atTwo.notes, before.notes, "a cosmetic edit rode in on the level-up");
    assert.ok(atTwo.features.some((feature) => feature.name.startsWith("Action Surge")), "Action Surge did not arrive");

    // The same call again: already level 2, said plainly, nothing changed.
    const again = await levelUp({ level: 2 });
    assert.equal(again.isError, true);
    assert.match(again.text, /HTTP 403/);
    assert.match(again.text, /already level 2/);
    assert.equal(sheets.getSheetForUser(campaignId, player.id).maxHp, atTwo.maxHp);

    // Level 3 offers the subclass. Taken without it, the level stands and the
    // pick is owed, which the next read lists.
    await award(600);
    const three = await options();
    assert.ok(three.choices.subclass?.options.includes("Champion"), JSON.stringify(three.choices));
    assert.equal(three.countedUnderSubclass, null);
    // Weighing a subclass counts what it opens with the level: a Battle
    // Master's three maneuvers, an Eldritch Knight's wizard spells, and
    // nothing more for a Champion. A name off the list is refused.
    const weigh = async (subclass) => workbenchCall(play, "odm_level_up_options", { campaignId, subclass });
    const battle = json(await weigh("battle master"));
    assert.equal(battle.countedUnderSubclass, "Battle Master");
    const maneuvers = battle.choices.featurePicks?.find((entry) => entry.label === "Maneuver");
    assert.equal(maneuvers?.count, 3, JSON.stringify(battle.choices));
    assert.ok(maneuvers.options.length > 3);
    const knight = json(await weigh("Eldritch Knight"));
    assert.deepEqual(
      [knight.choices.spells?.list, knight.choices.spells?.newCantrips, knight.choices.spells?.newSpells, knight.choices.spells?.maxSpellLevel],
      ["wizard", 2, 3, 1],
      JSON.stringify(knight.choices.spells),
    );
    const champion = json(await weigh("Champion"));
    assert.equal(champion.choices.featurePicks, undefined);
    assert.equal(champion.choices.spells, undefined);
    const offList = await weigh("Knight of the Lantern");
    assert.equal(offList.isError, true);
    assert.match(offList.text, /not a subclass/);
    const skipped = await levelUp({ level: 3 });
    assert.equal(skipped.isError, false, skipped.text);
    assert.equal(sheets.getSheetForUser(campaignId, player.id).subclass, "");

    // Level 4: the owed subclass again, and the Ability Score Improvement.
    await award(1800);
    const four = await options();
    assert.ok(four.owedFromEarlierLevels.some((line) => /subclass/i.test(line)), JSON.stringify(four.owedFromEarlierLevels));
    assert.ok(four.choices.subclass?.options.includes("Champion"));
    assert.equal(four.choices.asiChoices?.count, 1);

    // Two improvements where the level gives one: refused with the count.
    const greedy = await levelUp({
      level: 4,
      subclass: "Champion",
      asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "con" }],
    });
    assert.equal(greedy.isError, true);
    assert.match(greedy.text, /1 Ability Score Improvement/);

    const atFourBefore = sheets.getSheetForUser(campaignId, player.id);
    const done = await levelUp({ level: 4, subclass: "Champion", asiChoices: [{ mode: "plus2", ability: "str" }] });
    assert.equal(done.isError, false, done.text);
    const atFour = sheets.getSheetForUser(campaignId, player.id);
    assert.equal(atFour.level, 4);
    assert.equal(atFour.subclass, "Champion");
    assert.equal(atFour.abilities.str, atFourBefore.abilities.str + 2);
    assert.ok(atFour.features.some((feature) => feature.name === "Improved Critical"), "Champion's feature did not arrive");
    const after = await options();
    assert.deepEqual(after.owedFromEarlierLevels, [], "the subclass is still owed");
    assert.equal(after.ready, false, "level 5 was offered without its experience");
    world.close();
  });

  await test("A wizard's 2nd level through the agent: the school, two spells for the book and the cantrip the read counts, which the engine then accepts.", async () => {
    const { world, campaignId, hero, play, sheets, player } = await seated(LEGAL_WIZARD);
    globalThis.fetch = await routeFetch(world);
    const out = await world.invoke("award_xp", { characterIds: [hero.id], amount: 300, reason: "the library" });
    assert.equal(out.ok, true, out.error);
    const read = json(await workbenchCall(play, "odm_level_up_options", { campaignId }));
    assert.equal(read.ready, true, read.notReady);
    assert.ok(read.choices.subclass?.options.includes("School of Evocation"), JSON.stringify(read.choices));
    assert.deepEqual(
      [read.choices.spells?.style, read.choices.spells?.newSpells, read.choices.spells?.newCantrips, read.choices.spells?.maxSpellLevel],
      // A high elf's wizard cantrip is known on top of the class's three
      // (src/lib/srd/free-cantrips.ts), so of the three held one is the
      // race's and the class has room for one more, as the engine counts.
      ["spellbook", 2, 1, 1],
      JSON.stringify(read.choices.spells),
    );

    // A spell above the slots the level reaches is the engine's refusal.
    const tooHigh = await workbenchCall(play, "odm_level_up", {
      campaignId,
      level: 2,
      subclass: "School of Evocation",
      levelUpSpells: ["Fireball", "Feather Fall"],
    });
    assert.equal(tooHigh.isError, true);
    assert.match(tooHigh.text, /Fireball/);

    const taken = await workbenchCall(play, "odm_level_up", {
      campaignId,
      level: 2,
      subclass: "School of Evocation",
      levelUpSpells: ["Thunderwave", "Feather Fall", "Ray of Frost"],
    });
    assert.equal(taken.isError, false, taken.text);
    const after = sheets.getSheetForUser(campaignId, player.id);
    assert.equal(after.level, 2);
    assert.equal(after.subclass, "School of Evocation");
    for (const spell of ["Thunderwave", "Feather Fall"]) {
      assert.ok(after.spellcasting.spellbook.includes(spell), `${spell} did not reach the book`);
    }
    assert.ok(after.spellcasting.cantrips.includes("Ray of Frost"), "the counted cantrip was refused or lost");
    world.close();
  });

  await test("Feature picks go back as the read names them: a fighting style is offered by its feature name and lands on the sheet.", async () => {
    // A level 1 fighter seated without the style it owes: the read offers
    // the styles, and the level-up takes the one named.
    const { world, campaignId, hero, play, sheets, player } = await seated({ ...LEGAL_FIGHTER, features: [] });
    globalThis.fetch = await routeFetch(world);
    const out = await world.invoke("award_xp", { characterIds: [hero.id], amount: 300, reason: "the yard" });
    assert.equal(out.ok, true, out.error);
    const read = json(await workbenchCall(play, "odm_level_up_options", { campaignId }));
    const styles = read.choices.featurePicks?.find((entry) => entry.label === "Fighting Style");
    assert.ok(styles?.options.includes("Fighting Style: Dueling"), JSON.stringify(read.choices));
    const taken = await workbenchCall(play, "odm_level_up", { campaignId, level: 2, featurePicks: ["Fighting Style: Dueling"] });
    assert.equal(taken.isError, false, taken.text);
    const after = sheets.getSheetForUser(campaignId, player.id);
    assert.ok(after.features.some((feature) => feature.name === "Fighting Style: Dueling"), "the style did not land");
    world.close();
  });

  await test("A workshop subclass that casts by Eldritch Knight rules is weighed with its spells, as the dialog offers them.", async () => {
    // The table's DM wrote the subclass; its casting comes from the stored
    // profile, which its name never shows (src/lib/srd/third-caster.ts).
    const { world, campaignId, hero, play, sheets, player } = await seated(LEGAL_FIGHTER);
    const homebrew = await world.route("homebrew");
    world.signIn(world.owner);
    const made = await homebrew.POST(
      new Request("http://test/", {
        method: "POST",
        body: JSON.stringify({ kind: "archetype", name: "Hedge Knight", data: { desc: "A spell-touched sellsword.", classSlug: "fighter", castingProfile: "eldritch-knight", levels: {} } }),
      }),
    );
    assert.equal(made.status, 201, JSON.stringify(await made.clone().json()));
    globalThis.fetch = await routeFetch(world);
    const out = await world.invoke("award_xp", { characterIds: [hero.id], amount: 900, reason: "the road" });
    assert.equal(out.ok, true, out.error);
    const at = async (args) => json(await workbenchCall(play, "odm_level_up_options", { campaignId, ...args }));
    // Level 2 first, so the next level is the subclass's 3rd.
    const two = await workbenchCall(play, "odm_level_up", { campaignId, level: 2 });
    assert.equal(two.isError, false, two.text);
    const three = await at({});
    assert.ok(three.choices.subclass?.options.includes("Hedge Knight"), JSON.stringify(three.choices.subclass));
    const hedge = await at({ subclass: "Hedge Knight" });
    assert.equal(hedge.countedUnderSubclass, "Hedge Knight");
    assert.deepEqual(
      [hedge.choices.spells?.list, hedge.choices.spells?.newCantrips, hedge.choices.spells?.newSpells, hedge.choices.spells?.maxSpellLevel],
      ["wizard", 2, 3, 1],
      JSON.stringify(hedge.choices.spells),
    );
    // And the engine takes the level with what the read named.
    const taken = await workbenchCall(play, "odm_level_up", {
      campaignId,
      level: 3,
      subclass: "Hedge Knight",
      levelUpSpells: ["Shield", "Burning Hands", "Feather Fall", "Fire Bolt", "Light"],
    });
    assert.equal(taken.isError, false, taken.text);
    const after = sheets.getSheetForUser(campaignId, player.id);
    assert.equal(after.subclass, "Hedge Knight");
    const held = [...(after.spellcasting?.known ?? []), ...(after.spellcasting?.cantrips ?? [])];
    for (const spell of ["Shield", "Burning Hands", "Feather Fall", "Fire Bolt", "Light"]) {
      assert.ok(held.includes(spell), `${spell} did not land: ${JSON.stringify(after.spellcasting)}`);
    }
    world.close();
  });

  await test("The classes a level could start are listed with the table's setting first, and a class of another setting says so (issue #434).", async () => {
    const { world, campaignId, play } = await seated(LEGAL_FIGHTER);
    globalThis.fetch = await routeFetch(world);
    const outcome = await workbenchCall(play, "odm_level_up_options", { campaignId });
    assert.equal(outcome.isError, false, outcome.text);
    const others = json(outcome).otherClasses;
    const flagged = (id) => others.find((entry) => entry.id === id)?.fromAnotherSetting === true;
    // The table plays high fantasy (the default): a wizard belongs, a netrunner does not.
    assert.equal(flagged("wizard"), false);
    assert.equal(flagged("grave_knight"), false);
    assert.equal(flagged("netrunner"), true);
    const firstStranger = others.findIndex((entry) => entry.fromAnotherSetting);
    assert.ok(firstStranger > 0 && others.slice(firstStranger).every((entry) => entry.fromAnotherSetting), "the setting's classes come first");
    world.close();
  });

  await test("A malformed class id is refused before any route is called.", async () => {
    const { play, world } = await seated(LEGAL_FIGHTER);
    globalThis.fetch = () => {
      throw new Error("no route should be called");
    };
    const outcome = await workbenchCall(play, "odm_level_up_options", { campaignId: play.campaignId, levelUpClass: "../admin" });
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /not valid/);
    world.close();
  });
} finally {
  globalThis.fetch = originalFetch;
}

finish();
