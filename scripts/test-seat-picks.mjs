// The owed choices picked on the confirm sheet before a hero seats
// (src/lib/characters/seat-picks.ts, JoinConfirmDialog.tsx). A hero seated
// above the level it was built at owes what that level earned: a subclass,
// Ability Score Improvements, a feat's picks. The confirm sheet now lets the
// player make them before the seat is taken; the join and its preview both
// apply them through the same admit path (src/lib/characters/seat-preview.ts)
// and hold them to the level-up's rules. Anything left unpicked stays owed,
// as before (scripts/test-pregen-join-level.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation, LEGAL_FIGHTER } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-seat-picks");
const { asiOwed, readAsiLedger } = await import("../src/lib/srd/asi-ledger.ts");
const { owedChoices } = await import("../src/lib/srd/owed-choices.ts");
const { pregenById } = await import("../src/lib/starter/pregens.ts");
const { applySeatPicks, owedPicksOf } = await import("../src/lib/characters/seat-picks.ts");

async function routes(table) {
  return {
    pregen: await table.world.route("campaigns/[campaignId]/sheet/pregen"),
    preview: await table.world.route("campaigns/[campaignId]/sheet/preview"),
  };
}

async function previewOf(table, body) {
  const { preview } = await routes(table);
  table.world.signIn(table.player);
  const response = await table.call(preview, "POST", body, { campaignId: table.campaignId });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.preview;
}

async function seatPregen(table, id, picks) {
  table.clearSeat();
  table.world.signIn(table.player);
  const { pregen } = await routes(table);
  return table.call(pregen, "POST", { id, ...(picks ? { picks } : {}) }, { campaignId: table.campaignId });
}

await test("the confirm sheet offers what a level 4 table owes kara: the fighter's subclass and one improvement.", async () => {
  const table = await openCreation({ campaign: { startingLevel: 4 } });
  const preview = await previewOf(table, { pregenId: "kara" });
  assert.equal(preview.ok, true, preview.problems.join("; "));
  assert.ok(preview.picks, "no pickers were offered");
  assert.equal(preview.picks.asi, 1);
  assert.deepEqual(preview.picks.subclasses.map((entry) => entry.classId), ["fighter"]);
  assert.ok(preview.picks.subclasses[0].options.includes("Champion"), preview.picks.subclasses[0].options.join(", "));
  assert.equal(preview.picks.scores.str, pregenById("kara").sheet.abilities.str);
  table.world.close();
});

await test("kara takes her seat with the Champion and +2 Strength picked; nothing is owed after, here or in her library.", async () => {
  const table = await openCreation({ campaign: { startingLevel: 4 } });
  const picks = { subclasses: { fighter: "Champion" }, asiChoices: [{ mode: "plus2", ability: "str" }] };
  const preview = await previewOf(table, { pregenId: "kara", picks });
  assert.equal(preview.ok, true, preview.problems.join("; "));
  assert.deepEqual(preview.owed, [], `the preview still lists: ${preview.owed.join("; ")}`);
  // The pickers stay what was owed before the picks.
  assert.equal(preview.picks.asi, 1);

  const seated = await seatPregen(table, "kara", picks);
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  const sheet = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  assert.equal(sheet.level, 4);
  assert.equal(sheet.subclass, "Champion");
  assert.equal(sheet.abilities.str, pregenById("kara").sheet.abilities.str + 2);
  assert.equal(readAsiLedger(sheet.features), 1);
  assert.equal(asiOwed(sheet, [{ id: "fighter", level: 4 }]), 0);
  assert.ok(sheet.features.some((feature) => /improved critical/i.test(feature.name)), "the Champion's feature was not granted");
  assert.deepEqual(owedChoices(sheet), []);
  const library = table.characters.getCharacter(sheet.libraryCharacterId);
  assert.equal(library.sheet.subclass, "Champion");
  assert.equal(asiOwed({ level: 4, features: library.sheet.features }, [{ id: "fighter", level: 4 }]), 0);
  table.world.close();
});

await test("a feat in place of the improvement: Resilient raises the chosen score and brings its saving throw.", async () => {
  const table = await openCreation({ campaign: { startingLevel: 4 } });
  const seated = await seatPregen(table, "kara", { asiChoices: [{ mode: "feat", feat: "resilient", ability: "wis" }] });
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  const sheet = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  assert.ok(sheet.feats.includes("Resilient"), sheet.feats.join(", "));
  assert.equal(sheet.abilities.wis, pregenById("kara").sheet.abilities.wis + 1);
  assert.ok(sheet.proficiencies.saves.includes("wis"), "Resilient's saving throw is missing");
  // The subclass was left: still owed, for the first level-up.
  assert.equal(sheet.subclass, "");
  assert.ok(owedChoices(sheet).some((line) => /subclass for fighter/.test(line)), owedChoices(sheet).join("; "));
  table.world.close();
});

await test("picks outside the rules are refused by the join and named by the preview; nothing is seated.", async () => {
  const table = await openCreation({ campaign: { startingLevel: 4 } });
  const cases = [
    [{ subclasses: { fighter: "School of Evocation" } }, /not a subclass of the Fighter/],
    [{ subclasses: { wizard: "School of Evocation" } }, /no Wizard levels/],
    [{ asiChoices: [{ mode: "plus2", ability: "str" }, { mode: "plus2", ability: "con" }] }, /owed 1 Ability Score Improvement/],
    [{ asiChoices: [{ mode: "feat", feat: "War Caster" }] }, /War Caster requires/],
    [{ asiChoices: [{ mode: "feat", feat: "Linguist" }] }, /Linguist/],
    [{ asiChoices: [{ mode: "feat", feat: "Not A Feat" }] }, /not a feat this table offers/],
  ];
  for (const [picks, pattern] of cases) {
    const preview = await previewOf(table, { pregenId: "kara", picks });
    assert.equal(preview.ok, false, `the preview passed ${JSON.stringify(picks)}`);
    assert.ok(preview.problems.some((line) => pattern.test(line)), `${JSON.stringify(picks)}: ${preview.problems.join("; ")}`);
    const seated = await seatPregen(table, "kara", picks);
    assert.equal(seated.status, 400, JSON.stringify(seated.json));
    assert.ok(pattern.test(seated.json.error), seated.json.error);
    assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id), null, "a refused pick seated the hero");
  }
  table.world.close();
});

await test("a subclass is not picked before its level: a level 2 table owes the fighter none.", async () => {
  const table = await openCreation({ campaign: { startingLevel: 2 } });
  const preview = await previewOf(table, { pregenId: "kara" });
  assert.equal(preview.picks, undefined, JSON.stringify(preview.picks));
  const seated = await seatPregen(table, "kara", { subclasses: { fighter: "Champion" } });
  assert.equal(seated.status, 400);
  assert.match(seated.json.error, /chooses a subclass at Fighter level 3/);
  table.world.close();
});

await test("a library hero joining above its level picks the improvement it owes on the way in.", async () => {
  const table = await openCreation({ campaign: { startingLevel: 4 } });
  table.world.signIn(table.player);
  const made = await table.call(table.libraryRoute, "POST", { level: 1, sheet: LEGAL_FIGHTER });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.character.id;
  const preview = await previewOf(table, { libraryCharacterId: id });
  assert.equal(preview.picks?.asi, 1, JSON.stringify(preview.picks));
  const joined = await table.call(table.sheetRoute, "POST", {
    libraryCharacterId: id,
    picks: { subclasses: { fighter: "Champion" }, asiChoices: [{ mode: "plus1x2", abilities: ["str", "con"] }] },
  }, { campaignId: table.campaignId });
  assert.equal(joined.status, 201, JSON.stringify(joined.json));
  const sheet = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  assert.equal(sheet.subclass, "Champion");
  assert.equal(sheet.abilities.str, LEGAL_FIGHTER.abilities.str + 1);
  assert.equal(sheet.abilities.con, LEGAL_FIGHTER.abilities.con + 1);
  // Constitution 15 for four levels of d10 at the table's average.
  assert.equal(sheet.maxHp, 10 + 2 + 3 * (6 + 2));
  assert.deepEqual(owedChoices(sheet), []);
  // The library copy is the player's own hero, untouched at level 1.
  assert.equal(table.characters.getCharacter(id).level, 1);
  assert.equal(table.characters.getCharacter(id).sheet.subclass, "");

  // A bad pick on a switch is refused before the current hero is given up.
  const other = await table.call(table.libraryRoute, "POST", { level: 1, sheet: { ...LEGAL_FIGHTER, name: "Second" } });
  const switched = await table.call(table.sheetRoute, "PUT", {
    libraryCharacterId: other.json.character.id,
    picks: { subclasses: { fighter: "Nonsense" } },
  }, { campaignId: table.campaignId });
  assert.equal(switched.status, 400, JSON.stringify(switched.json));
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id).id, sheet.id, "the refused switch cost the player their hero");
  table.world.close();
});

await test("a Constitution picked on the way in adds its hit points for every level, at a table that rolls them too.", async () => {
  const joinWith = async (hpMethod, picks) => {
    const table = await openCreation({ campaign: { startingLevel: 4 }, gameSettings: { hpMethod } });
    table.world.signIn(table.player);
    const made = await table.call(table.libraryRoute, "POST", { level: 1, sheet: LEGAL_FIGHTER });
    const joined = await table.call(table.sheetRoute, "POST", {
      libraryCharacterId: made.json.character.id,
      ...(picks ? { picks } : {}),
    }, { campaignId: table.campaignId });
    assert.equal(joined.status, 201, JSON.stringify(joined.json));
    const sheet = table.sheets.getSheetForUser(table.campaignId, table.player.id);
    table.world.close();
    return sheet;
  };
  const con = { asiChoices: [{ mode: "plus2", ability: "con" }] };
  // Constitution 14 to 16: one more hit point for each of the four levels.
  for (const hpMethod of ["rolled", "average"]) {
    const without = await joinWith(hpMethod);
    const raised = await joinWith(hpMethod, con);
    assert.equal(raised.abilities.con, LEGAL_FIGHTER.abilities.con + 2);
    assert.equal(raised.maxHp, without.maxHp + 4, `${hpMethod}: ${without.maxHp} without the pick, ${raised.maxHp} with it`);
  }
});

await test("applySeatPicks pays back the hit points of a raised Constitution and of a feat that adds them per level.", () => {
  const kara = pregenById("kara").sheet;
  const seated = { ...kara, maxHp: 30, abilities: { ...kara.abilities, con: 13 }, features: [{ name: "Ability Score Improvements taken: 0", source: "story" }] };
  const context = {
    classOf: (id) => (id === "fighter" ? { hitDie: 10 } : null),
    featOf: (name) => (/^tough$/i.test(name) ? { name: "Tough", prerequisite: "", desc: "Your hit point maximum increases by an amount equal to twice your level." } : null),
    spellOf: () => null,
    subclassOffered: () => true,
    subclassesOf: () => [],
  };
  // Constitution 13 to 14 at level 4: the modifier rises by one, four hit points.
  const raised = applySeatPicks(seated, 4, { asiChoices: [{ mode: "plus1x2", abilities: ["con", "str"] }] }, context);
  assert.equal(raised.ok, true, raised.problems?.join("; "));
  assert.equal(raised.sheet.maxHp, 34);
  // Tough: two hit points for each of the four levels.
  const tough = applySeatPicks(seated, 4, { asiChoices: [{ mode: "feat", feat: "Tough" }] }, context);
  assert.equal(tough.ok, true, tough.problems?.join("; "));
  assert.equal(tough.sheet.maxHp, 38);
  // Strength raises no hit points.
  const strength = applySeatPicks(seated, 4, { asiChoices: [{ mode: "plus2", ability: "str" }] }, context);
  assert.equal(strength.sheet.maxHp, 30);
});

await test("each owed-choice chip is itself the finger-sized target, with a focus ring of its own.", () => {
  const source = readFileSync(new URL("../src/app/campaigns/[campaignId]/OwedPicksFields.tsx", import.meta.url), "utf8");
  const chip = source.match(/const chip = \(picked: boolean\) =>[\s\S]*?\);/)?.[0] ?? "";
  assert.match(chip, /min-h-11/, "the chip is shorter than 40px");
  assert.match(chip, /focus-visible:ring/, "the chip has no focus ring");
  // The size is on what is pressed, never only on a wrapper around it: the
  // skill and expertise chips are buttons, and the subclass rows' buttons
  // carry the same height and ring.
  assert.doesNotMatch(source, /<span[^>]*className=\{chip\(/, "a chip's size sits on a wrapper around its button");
  const chipped = [...source.matchAll(/<button\b(?:(?!<\/button>)[\s\S])*?className=\{chip\(picked\)\}/g)];
  assert.equal(chipped.length, 2, `${chipped.length} chip buttons, not the skill and expertise ones`);
  assert.match(source, /className="min-h-11 grow[^"]*focus-visible:ring/, "the subclass button has no focus ring");
});

await test("the pickers read the owed choices off the seated sheet; a sheet that owes nothing offers none.", () => {
  const kara = pregenById("kara").sheet;
  const context = { subclassesOf: () => ["Champion", "Battle Master"] };
  assert.equal(owedPicksOf({ ...kara, features: [] }, 1, context), null);
  const owed = owedPicksOf({ ...kara, features: [{ name: "Ability Score Improvements taken: 0", source: "story" }] }, 6, context);
  assert.equal(owed.asi, 2);
  assert.equal(owed.subclasses[0].dueAt, 3);
  // Two improvements picked as plus2 on a 19 stop at the cap of 20.
  const applied = applySeatPicks(
    { ...kara, abilities: { ...kara.abilities, str: 19 }, features: [{ name: "Ability Score Improvements taken: 0", source: "story" }] },
    6,
    { asiChoices: [{ mode: "plus2", ability: "str" }] },
    { classOf: () => null, featOf: () => null, spellOf: () => null, subclassOffered: () => true, subclassesOf: () => [] },
  );
  assert.equal(applied.ok, true);
  assert.equal(applied.sheet.abilities.str, 20);
  assert.equal(readAsiLedger(applied.sheet.features), 1);
});

finish();
