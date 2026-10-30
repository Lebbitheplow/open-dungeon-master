// "Best effort" on mechanics nobody checked (issue #570, "Rules and
// content"): an entry the engine plays from mechanics it read from the text
// itself, which no person has held up against that text, says so wherever a
// player or the GM reads it: the info dialog, the reference, the Hand's
// spell card. A hand-written row, a reader's golden case and the SRD's own
// entries (held to the SRD 5.1 text by the audit) are checked; a spell with
// nothing to play is no guess.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-best-effort");
process.env.CONTENT_DB_PATH = "/nonexistent/open5e.sqlite";
const { withBestEffort } = await import("../src/lib/content/entry-labels.ts");
const { BEST_EFFORT_NOTE } = await import("../src/lib/content/reading-logic.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");

const golden = (kind, id) => JSON.parse(fs.readFileSync(new URL(`./fixtures/reader-golden/${kind}.json`, import.meta.url), "utf8")).cases.find((entry) => entry.id === id).row;
const asEntry = (row, overrides = {}) => ({ slug: row.slug, name: row.name, source: "open5e", documentSlug: row.documentSlug, data: row.data, aliases: row.aliases ?? [], ...overrides });

await test("A third-party spell played from its parsed text, unchecked, is best effort; the same text checked is not.", () => {
  const steal = golden("spell", "spell:dmag/steal-warmth");
  assert.equal(withBestEffort("spells", asEntry(steal)).bestEffort, undefined, "a golden case was checked by hand");
  assert.equal(withBestEffort("spells", asEntry(steal, { slug: "steal-warmth-reprint" })).bestEffort, true);
});

await test("The SRD's own entries are checked: the SRD 5.1 text audit held every one against the book.", () => {
  const burning = golden("spell", "spell:wotc-srd/burning-hands");
  assert.equal(withBestEffort("spells", asEntry(burning, { slug: "burning-hands-copy" })).bestEffort, undefined);
  const goblin = golden("monster", "monster:wotc-srd/goblin");
  assert.equal(withBestEffort("monsters", asEntry(goblin, { slug: "goblin-copy", data: { ...goblin.data, slug: "goblin-copy" } })).bestEffort, undefined);
});

await test("A Tome of Beasts block nobody corrected is best effort; a hand-written spell row, a homebrew entry and a utility spell are not.", () => {
  const wisp = golden("monster", "monster:tob/deathwisp");
  assert.equal(withBestEffort("monsters", asEntry(wisp, { slug: "deathwisp-copy", data: { ...wisp.data, slug: "deathwisp-copy" } })).bestEffort, true);
  assert.equal(withBestEffort("spells", { slug: "fireball-x", name: "Fireball", source: "open5e", documentSlug: "kp", data: { desc: "A bright streak flashes." } }).bestEffort, undefined, "Fireball's row is hand-written");
  assert.equal(withBestEffort("spells", { slug: "homebrew:1", name: "Sparks", source: "homebrew", documentSlug: "homebrew", data: { desc: "Make a ranged spell attack. 1d10 fire damage." } }).bestEffort, undefined);
  const alarm = golden("spell", "spell:wotc-srd/alarm");
  assert.equal(withBestEffort("spells", asEntry(alarm, { slug: "alarm-copy", documentSlug: "kp" })).bestEffort, undefined, "nothing read, nothing to guess");
  assert.equal(withBestEffort("items", { slug: "x", name: "X", source: "open5e", documentSlug: "vom", data: {} }).bestEffort, undefined, "items have no reader here");
});

const wizard = {
  id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
  name: "Lys", race: "human", class: "wizard", subclass: "", background: "", alignment: "", gender: "",
  level: 5, xp: 0,
  abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
  maxHp: 27, currentHp: 27, tempHp: 0, ac: 12, acOverride: false, speed: 30,
  hitDice: { die: "d6", total: 5, spent: 0 }, classes: [], hitDicePools: null,
  proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["daggers", "quarterstaffs"] },
  equipment: [], gold: 0, copper: 0, feats: [], features: [],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } }, prepared: ["Steal Warmth"], known: [] },
  conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
  deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
  isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
};
const steal = golden("spell", "spell:dmag/steal-warmth").data;
const fact = { level: 3, school: "necromancy", castingTime: "1 reaction", range: "Self", concentration: false, desc: steal.desc, higherLevel: "" };
const myTurn = { ...FRESH_TURN, table: { round: 1, orderReady: true, acting: { id: "s1", name: "Lys" }, surprised: { acting: [], reacting: [] } } };

await test("The Hand's spell card says so in its details.", () => {
  const card = (bestEffort) => deriveHand(wizard, myTurn, { spells: { "steal warmth": { ...fact, ...(bestEffort ? { bestEffort: true } : {}) } } }).find((entry) => /steal warmth/i.test(entry.name));
  assert.ok(card(true), "the card is dealt");
  assert.ok(card(true).description.includes(BEST_EFFORT_NOTE));
  assert.ok(!card(false).description.includes(BEST_EFFORT_NOTE));
});

finish();
