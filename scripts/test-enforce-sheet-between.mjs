// The sheet's "Between adventures" lines (workstream zones-ui,
// /tmp/odm-enf2/fixes/zones-ui.md): GET /sheet/between hands the sheet the
// engine's own lines about a character's lifestyle, downtime and afflictions
// (src/lib/dm/between-lines.ts, what the narrator reads). A player sees their
// own character and nothing the character cannot know: a disease still
// incubating (SRD 5.1, Diseases: no symptoms yet) is the DM's alone. The DM
// sees every character's, the hidden ones marked.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-sheet-between");
const world = await openWorld({ gameSettings: { dmMode: "human" } });
const campaigns = await import("../src/lib/db/campaigns.ts");
const route = await world.route("campaigns/[campaignId]/sheet/between");

const hero = world.addHero({ name: "Townie", class: "fighter", level: 3, proficiencies: TRAINED, gold: 50 });
const other = world.addHero({ name: "Other", class: "fighter", level: 3, proficiencies: TRAINED });
const heroUser = world.owner;
const otherUser = (await import("../src/lib/db/sheets.ts")).getSheetById(other.id).userId;
const dm = world.addUser("dm");
world.addHero({ class: "fighter", level: 1, user: dm });
assert.equal(campaigns.setHumanDm(world.campaignId, dm.id), true);

async function linesFor(user, characterId) {
  world.signIn(typeof user === "string" ? { id: user } : user);
  const query = characterId ? `?characterId=${characterId}` : "";
  const response = await route.GET(new Request(`http://odm.test/between${query}`), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).lines;
}

await test("A player's sheet shows their lifestyle and downtime in the engine's words, and another player's sheet shows them nothing.", async () => {
  const set = await world.invoke("set_lifestyle", { characterIds: [hero.id], lifestyle: "modest" });
  assert.equal(set.ok, true, set.error);
  const mine = await linesFor(heroUser, hero.id);
  const living = mine.find((line) => line.kind === "between");
  assert.ok(living, JSON.stringify(mine));
  assert.match(living.text, /^lifestyle modest/);
  assert.deepEqual(await linesFor(otherUser, hero.id), [], "a player read another character's life");
});

await test("A disease still incubating is on the DM's view of the sheet, marked, and not on the player's; once symptoms show, both see it.", async () => {
  world.clearDice();
  const infected = await world.invoke("afflict", { characterId: hero.id, kind: "disease", name: "Sewer Plague", save: false });
  world.clearDice();
  assert.equal(infected.ok, true, infected.error);
  const player = await linesFor(heroUser, hero.id);
  assert.equal(player.some((line) => line.kind === "affliction"), false, `the player saw ${JSON.stringify(player)}`);
  const seen = await linesFor(dm, hero.id);
  const hidden = seen.find((line) => line.kind === "affliction");
  assert.ok(hidden, JSON.stringify(seen));
  assert.equal(hidden.secret, true);
  assert.match(hidden.text, /Sewer Plague/);

  world.clearDice();
  const shown = await world.invoke("afflict", { characterId: other.id, kind: "disease", name: "Sight Rot", save: false, symptomsNow: true });
  world.clearDice();
  assert.equal(shown.ok, true, shown.error);
  const own = (await linesFor(otherUser, other.id)).find((line) => line.kind === "affliction");
  assert.ok(own, "the player did not see the symptoms their character has");
  assert.match(own.text, /Sight Rot/);
  assert.equal(own.secret, undefined);
});

world.close();
finish();
