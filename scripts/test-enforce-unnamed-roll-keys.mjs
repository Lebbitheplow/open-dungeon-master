// A trait the character holds is never lost to a field the model leaves out
// (src/lib/srd/roll-keys.ts unnamedRollKeys): when a request_roll names no
// `about`, `creature` or `terrain` (a check) or no `against` or `magical` (a
// save) and a trait the roller holds reads it on this roll, the model is
// asked for it before anything is rolled; "none" says the roll is none of
// the listed.
// A character with no such trait is never asked, and the console (a human
// DM) is never asked. The same at every table language: the reason's words
// decide nothing.
//
// SRD 5.1: Favored Enemy, advantage on Survival checks to track the chosen
// enemies; Natural Explorer, double proficiency on INT and WIS checks in the
// favored terrain; Fey Ancestry, advantage on saves against being charmed;
// Gnome Cunning, advantage on INT, WIS and CHA saves against magic.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED, d20Faces } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-unnamed-roll-keys");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { CHECK_ABOUT } = await import("../src/lib/dm/roll-about.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const { heldCheckTraits } = await import("../src/lib/srd/check-traits.ts");
const { heldFeatChecks } = await import("../src/lib/srd/feat-combat.ts");
const { authoredRows } = await import("../src/lib/srd/authored-effects.ts");

// The model's call, through the turn loop's dispatch.
async function ai(name, args, actor) {
  world.say("player", "I do it.", actor);
  const turn = createDmTurn(world.campaignId, []);
  const sheets = listSheets(world.campaignId);
  return dispatchAdjudication(name, JSON.stringify(args), { campaign: world.campaign(), turn, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set() });
}

const ranger = world.addHero({
  class: "ranger", level: 3, abilities: { wis: 14 },
  proficiencies: { ...TRAINED, skills: ["survival"] },
  features: [{ name: "Favored Enemy (undead)", source: "class", classId: "ranger" }, { name: "Natural Explorer (forest)", source: "class", classId: "ranger" }],
});
const elf = world.addHero({ race: "high_elf", class: "fighter", level: 3, features: [{ name: "Fey Ancestry", source: "race" }] });
const gnome = world.addHero({ race: "rock_gnome", class: "wizard", level: 3, features: [{ name: "Gnome Cunning", source: "race" }] });
const plain = world.addHero({ race: "human", class: "fighter", level: 3, proficiencies: { ...TRAINED, skills: ["survival"] } });
// The picks the builder writes on the sheet (a created hero gets its class's
// features without them).
world.patch(ranger.id, { features: [{ name: "Favored Enemy (undead)", source: "class", classId: "ranger" }, { name: "Natural Explorer (forest)", source: "class", classId: "ranger" }] });
world.patch(elf.id, { features: [{ name: "Fey Ancestry", source: "race" }] });
world.patch(gnome.id, { features: [{ name: "Gnome Cunning", source: "race" }] });
world.patch(plain.id, { features: [] });

// The same declaration at five tables: the reason is the table's language.
const REASONS = ["following the zombie's tracks", "seguire le tracce dello zombie", "suivre les traces du zombie", "seguir las huellas del zombi", "den Spuren des Zombies folgen"];

await test("A ranger's tracking check that names no circumstance, creature or terrain is asked for them, at every table, and nothing is rolled.", async () => {
  for (const reason of REASONS) {
    const out = await ai("request_roll", { kind: "skill_check", characterId: ranger.id, skill: "survival", difficulty: "moderate", reason }, ranger);
    assert.equal(out.retry, true, `${reason}: rolled without asking`);
    assert.match(out.error, /about: [^;]*tracking[^;]*, or 'none'/, out.error);
    assert.match(out.error, /creature: its type/);
    assert.match(out.error, /terrain: [^;]*forest[^;]*, or 'none'/);
  }
});

await test("Named, the ranger's traits apply; named 'none', the roll goes through without them.", async () => {
  const named = await ai("request_roll", { kind: "skill_check", characterId: ranger.id, skill: "survival", difficulty: "moderate", reason: REASONS[1], about: "tracking", creature: "undead", terrain: "forest" }, ranger);
  assert.equal(named.ok, true, named.error);
  assert.ok(named.conditionEffects.some((line) => /Favored Enemy/.test(line)), JSON.stringify(named.conditionEffects));
  assert.ok(named.conditionEffects.some((line) => /Natural Explorer/.test(line)));
  const none = await ai("request_roll", { kind: "skill_check", characterId: ranger.id, skill: "survival", difficulty: "moderate", reason: REASONS[1], about: "none", creature: "none", terrain: "none" }, ranger);
  assert.equal(none.ok, true, none.error);
  assert.equal((none.conditionEffects ?? []).some((line) => /Favored Enemy|Natural Explorer/.test(line)), false);
});

await test("A save that names nothing it resists is asked for it when Fey Ancestry would answer, and for magical when Gnome Cunning would.", async () => {
  const charm = await ai("request_roll", { kind: "saving_throw", characterId: elf.id, ability: "wis", dc: 13, reason: "il canto della sirena" }, elf);
  assert.equal(charm.retry, true, "the elf's save was rolled without asking");
  assert.match(charm.error, /against: [^;]*charmed[^;]*, or 'none'/);
  const named = await ai("request_roll", { kind: "saving_throw", characterId: elf.id, ability: "wis", dc: 13, against: "charmed", reason: "il canto della sirena" }, elf);
  assert.equal(named.ok, true, named.error);
  assert.ok(named.conditionEffects.some((line) => /Fey Ancestry/.test(line)));
  const magic = await ai("request_roll", { kind: "saving_throw", characterId: gnome.id, ability: "wis", dc: 13, against: "none", reason: "a curse" }, gnome);
  assert.equal(magic.retry, true, "the gnome's save was rolled without asking whether it is magic");
  assert.match(magic.error, /magical: true or false/);
  const told = await ai("request_roll", { kind: "saving_throw", characterId: gnome.id, ability: "wis", dc: 13, against: "none", magical: true, reason: "a curse" }, gnome);
  assert.ok(told.conditionEffects.some((line) => /Gnome Cunning/.test(line)));
});

await test("A character with no trait the fields answer is never asked, and the console is never asked.", async () => {
  const check = await ai("request_roll", { kind: "skill_check", characterId: plain.id, skill: "survival", difficulty: "moderate", reason: REASONS[0] }, plain);
  assert.equal(check.ok, true, check.error);
  const save = await ai("request_roll", { kind: "saving_throw", characterId: plain.id, ability: "wis", dc: 13, reason: "the song" }, plain);
  assert.equal(save.ok, true, save.error);
  const consoleRoll = await world.invoke("request_roll", { kind: "skill_check", characterId: ranger.id, skill: "survival", difficulty: "moderate", reason: "tracking" });
  assert.equal(consoleRoll.ok, true, consoleRoll.error);
});

await test("A binding condition's save asks whether it is magic when Gnome Cunning would answer, and applies it when told.", async () => {
  const asked = await ai("set_condition", { characterId: gnome.id, condition: "charmed", saveAbility: "wis", saveDc: 13, rounds: 10 }, gnome);
  assert.equal(asked.retry, true, "the binding save was rolled without asking");
  assert.match(asked.error, /magical: true or false/);
  world.dice(1, 20);
  const told = await ai("set_condition", { characterId: gnome.id, condition: "charmed", saveAbility: "wis", saveDc: 13, rounds: 10, magical: true }, gnome);
  world.clearDice();
  assert.equal(told.saved, true, `two dice, the higher kept: ${JSON.stringify(told)}`);
});

await test("A blinded roller's check that names no sense is asked for it; named sight, it fails as the rules say; a roller who sees is never asked.", async () => {
  world.patch(plain.id, { conditions: ["blinded"] });
  const asked = await ai("request_roll", { kind: "skill_check", characterId: plain.id, skill: "perception", difficulty: "moderate", reason: "le orme nel fango" }, plain);
  assert.equal(asked.retry, true, "the blinded check was rolled without asking");
  assert.match(asked.error, /by: sight, or 'none'/);
  const failed = await ai("request_roll", { kind: "skill_check", characterId: plain.id, skill: "perception", difficulty: "moderate", by: "sight", reason: "le orme nel fango" }, plain);
  assert.equal(failed.autoFailed, true, JSON.stringify(failed));
  world.patch(plain.id, { conditions: [] });
  const seeing = await ai("request_roll", { kind: "skill_check", characterId: plain.id, skill: "perception", difficulty: "moderate", reason: "le orme nel fango" }, plain);
  assert.equal(seeing.ok, true, seeing.error);
});

await test("A check_notice that names no hidden thing is asked for it when a character tested holds Dungeon Delver, and the feat applies when named.", async () => {
  const delver = world.addHero({ race: "human", class: "rogue", level: 3, feats: ["Dungeon Delver"] });
  world.patch(delver.id, { feats: ["Dungeon Delver"] });
  const asked = await ai("check_notice", { characterIds: [delver.id], dc: 30, reason: "una lastra che suona vuota" }, delver);
  assert.equal(asked.retry, true, "the notice was rolled without asking");
  assert.match(asked.error, /about: 'traps_and_secret_doors' or 'none'/);
  const named = await ai("check_notice", { characterIds: [delver.id], dc: 30, about: "traps_and_secret_doors", reason: "una lastra che suona vuota" }, delver);
  assert.ok(JSON.stringify(named).includes("Dungeon Delver, +5"), JSON.stringify(named));
  const plainNotice = await ai("check_notice", { characterIds: [plain.id], dc: 30, reason: "una lastra che suona vuota" }, plain);
  assert.equal(plainNotice.retry, undefined, plainNotice.error);
});

await test("A group check names what it is about too: a party with a ranger is asked for the fields their traits read, and named, the ranger tracks at advantage.", async () => {
  const asked = await ai("group_check", { skill: "survival", difficulty: "moderate", characterIds: [ranger.id, plain.id], reason: REASONS[1] }, ranger);
  assert.equal(asked.retry, true, "the group check was rolled without asking");
  assert.match(asked.error, /^[^.]+ holds a trait/, "only the ranger is named");
  assert.doesNotMatch(asked.error, / and [^.]+ hold a trait/);
  assert.match(asked.error, /about: [^;]*tracking[^;]*, or 'none'/);
  const named = await ai("group_check", { skill: "survival", difficulty: "moderate", characterIds: [ranger.id, plain.id], about: "tracking", creature: "undead", terrain: "forest", reason: REASONS[1] }, ranger);
  assert.equal(named.ok, true, named.error);
  const rangerRoll = listRecentRolls(world.campaignId, 5).filter((roll) => roll.characterId === ranger.id).at(-1);
  assert.equal(d20Faces(rangerRoll).length, 2, "Favored Enemy: two d20s on the ranger's tracking");
  const plainOnly = await ai("group_check", { skill: "survival", difficulty: "moderate", characterIds: [plain.id], reason: REASONS[1] }, plain);
  assert.equal(plainOnly.ok, true, plainOnly.error);
});

await test("An advantage claimed with its reason but no source is asked where it comes from, never set aside; with source 'other' it stands.", async () => {
  const asked = await ai("request_roll", { kind: "skill_check", characterId: plain.id, skill: "athletics", difficulty: "moderate", advantage: "advantage", advantageReason: "il goblin è impigliato nella tenda", reason: "spingere il goblin" }, plain);
  assert.equal(asked.retry, true, "the claim was rolled without its source");
  assert.match(asked.error, /names no advantageSource/);
  world.dice(3, 18);
  const ruled = await ai("request_roll", { kind: "skill_check", characterId: plain.id, skill: "athletics", difficulty: "moderate", advantage: "advantage", advantageSource: "other", advantageReason: "il goblin è impigliato nella tenda", reason: "spingere il goblin" }, plain);
  world.clearDice();
  assert.equal(ruled.ok, true, ruled.error);
  assert.equal(d20Faces(listRecentRolls(world.campaignId, 3).filter((roll) => roll.characterId === plain.id).at(-1)).length, 2, "the ruling's two d20s");
});

await test("GAME STATE names the fields a character's traits read, from the same keys the ask reads, so a call can name them at once; a character with none gets no line.", () => {
  const cue = (sheet) => describeSheet(world.sheet(sheet.id), "player", false).split("\n").find((line) => line.includes("Their traits read these fields"));
  assert.match(cue(ranger) ?? "", /survival checks: about 'tracking', creature \(undead\)/);
  assert.match(cue(ranger) ?? "", /terrain 'forest'/);
  assert.match(cue(elf) ?? "", /saves: against 'charmed'/);
  assert.match(cue(gnome) ?? "", /INT, WIS, CHA saves: magical/);
  assert.equal(cue(plain), undefined);
});

await test("A ranger's Nature check they are not proficient in is never asked for a terrain: Natural Explorer needs the proficiency.", async () => {
  const out = await ai("request_roll", { kind: "skill_check", characterId: ranger.id, skill: "nature", difficulty: "moderate", about: "none", creature: "none", reason: "le erbe del sottobosco" }, ranger);
  assert.equal(out.ok, true, out.error);
});

await test("Every circumstance a check can be about is read by a trait's key, so the ask never names one that changes nothing.", () => {
  const everything = {
    race: "dwarf",
    features: ["Favored Enemy (undead)", "Stonecunning", "Artificer's Lore", "Stone Camouflage"].map((name) => ({ name, source: "race" })),
    feats: ["Actor", "Stalker", "Forest Denizen", "Floriographer", "Surgical Combatant", "Monster Hunter", "Crafting Expert", "Ace Driver"],
  };
  const read = new Set([...heldCheckTraits(everything), ...heldFeatChecks(everything)].map((key) => key.about));
  for (const row of authoredRows()) {
    for (const effect of row.entry.effects ?? []) {
      if (effect.kind === "check_adv" && effect.about) read.add(effect.about);
    }
  }
  assert.deepEqual(CHECK_ABOUT.filter((about) => !read.has(about)), []);
});

world.close();
finish();
