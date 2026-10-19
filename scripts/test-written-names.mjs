// A name someone writes is compared as written, in every table language: no
// English step (a plural "s", the word "armor", "the", "vial of", "Oath of",
// "Tasha's") is applied to it. The English rows carry their English
// spellings instead (src/lib/srd/name-forms.ts, the spell checklist's other
// names, a subclass's titles), and an article is a leading word of the table
// language's stop list (src/lib/language/language.ts nameTerms), so "the
// Grey Wolf", "il Lupo Grigio" and "der Grauwolf" each find their token. A
// name in another language finds no English row: the rulebook is English.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import Database from "better-sqlite3-multiple-ciphers";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-written-names-"));
const pack = path.join(dir, "open5e.sqlite");
{
  const importer = fs.readFileSync(path.join(import.meta.dirname, "import-open5e.mjs"), "utf8");
  const schema = /db\.exec\(`(\s*CREATE TABLE spells[\s\S]*?)`\);/.exec(importer)?.[1];
  assert.ok(schema, "the importer's schema is found");
  const db = new Database(pack);
  db.exec(schema);
  const item = db.prepare(`INSERT INTO items (slug, name, document_slug, kind, rarity, cost, category, weight, data_json) VALUES (?, ?, 'wotc-srd', 'gear', '', '', '', ?, ?)`);
  item.run("torch", "Torch", 1, JSON.stringify({ weight: "1 lb." }));
  item.run("pouch", "Pouch", 1, JSON.stringify({ weight: "1 lb." }));
  db.close();
}
process.env.CONTENT_DB_PATH = pack;
register("./lib/register-alias.mjs", import.meta.url);

const { matchArmor, armorInside, SRD_ARMOR } = await import("../src/lib/srd/armor.ts");
const { matchWeapon, SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { matchGear, SRD_GEAR } = await import("../src/lib/srd/adventuring-gear.ts");
const { buildItemSheet } = await import("../src/lib/help/item-sheet.ts");
const { itemWeightByName } = await import("../src/lib/content/item-weights.ts");
const { pluralForms } = await import("../src/lib/srd/name-forms.ts");
const { findPoison } = await import("../src/lib/srd/afflictions.ts");
const { subclassNamed } = await import("../src/lib/srd/subclass-name.ts");
const { spellSupportFor } = await import("../src/lib/srd/spell-support.ts");
const { spellMechFor } = await import("../src/lib/srd/spell-mechanics.ts");
const { materialComponents } = await import("../src/lib/dm/cast-materials.ts");
const { optionAllowed } = await import("../src/lib/srd/starting-kit.ts");
const { bundledPriceCopper } = await import("../src/lib/srd/starting-wealth.ts");
const { underwaterSwing } = await import("../src/lib/dm/underwater.ts");
const { nameTerms, withoutLeadingStopWords } = await import("../src/lib/language/language.ts");
const { findNamed } = await import("../src/lib/language/text-logic.ts");
const { normalizeCreatureName } = await import("../src/lib/dm/engine-boundary.ts");
const { racialNaturalWeapon } = await import("../src/lib/srd/racial-weapons.ts");
const { findBeastForm } = await import("../src/lib/srd/beast-forms.ts");
const { monsterPlaceholder } = await import("../src/lib/placeholders.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const LANGUAGES = ["english", "italian", "french", "spanish", "german"];
// The same item, weapon, armour and poison named in each table language.
const TRANSLATED = {
  english: { sword: "Longsword", swords: "Longswords", shield: "Shield", shields: "Shields", plate: "Plate Armor", torch: "Torches", poison: "Vial of Serpent Venom" },
  italian: { sword: "Spada lunga", swords: "Spade lunghe", shield: "Scudo", shields: "Scudi", plate: "Armatura di piastre", torch: "Torce", poison: "Fiala di veleno di serpente" },
  french: { sword: "Épée longue", swords: "Épées longues", shield: "Bouclier", shields: "Boucliers", plate: "Armure de plaques", torch: "Flambeaux", poison: "Fiole de venin de serpent" },
  spanish: { sword: "Espada larga", swords: "Espadas largas", shield: "Escudo", shields: "Escudos", plate: "Armadura de placas", torch: "Antorchas", poison: "Vial de veneno de serpiente" },
  german: { sword: "Langschwert", swords: "Langschwerter", shield: "Schild", shields: "Schilde", plate: "Plattenpanzer", torch: "Fackeln", poison: "Phiole Schlangengift" },
};

test("every SRD weapon, armour and gear row is found by its name and its plural", () => {
  for (const weapon of SRD_WEAPONS) {
    for (const form of pluralForms(weapon.name.toLowerCase())) {
      assert.equal(matchWeapon(form)?.name, weapon.name, form);
    }
  }
  for (const armor of SRD_ARMOR) {
    for (const form of pluralForms(armor.name.toLowerCase())) {
      assert.equal(matchArmor(form)?.name, armor.name, form);
    }
  }
  for (const gear of SRD_GEAR) {
    assert.equal(matchGear(gear.name)?.name, gear.name);
    for (const alias of gear.aliases ?? []) {
      assert.equal(matchGear(alias)?.name, gear.name, alias);
    }
  }
  assert.equal(matchGear("torches")?.name, "Torch");
  assert.equal(matchGear("rations")?.name, "Rations (1 day)");
});

test("the English forms of an armour stay on its row: Plate Armor, Shields, a magic bonus, a suit at the tail", () => {
  assert.equal(matchArmor("Plate Armor")?.name, "Plate");
  assert.equal(matchArmor("Plate Armour")?.name, "Plate");
  assert.equal(matchArmor("Armor, Plate")?.name, "Plate");
  assert.equal(matchArmor("Shields")?.name, "Shield");
  assert.equal(matchArmor("+1 Studded Leather Armor")?.name, "Studded Leather");
  assert.equal(matchArmor("Dwarven Chain Mail")?.name, "Chain Mail");
  // A Guild Engineer's work leathers are clothing (#113); leathers alone are Leather.
  assert.equal(matchArmor("work leathers"), null);
  assert.equal(matchArmor("Leathers")?.name, "Leather");
  assert.equal(armorInside("Plate Armor of Etherealness")?.name, "Plate");
  assert.equal(armorInside("Glamoured Padded Leathers of Resistance")?.name, "Padded");
  assert.equal(bundledPriceCopper("Plate Armor"), 150_000);
  assert.equal(bundledPriceCopper("Plate"), 150_000);
});

test("a weapon's tail and its plural reach the item sheet, and under water a weapon is the SRD row it swings as", () => {
  assert.equal(buildItemSheet("+1 Longswords", [])?.weapon?.damage, "1d8 + 1");
  assert.equal(buildItemSheet("Silvered Dagger", [])?.weapon?.damage, "1d4");
  for (const weapon of ["Javelins", "Giavellotto", "Javeline", "Jabalina", "Wurfspeer"]) {
    assert.equal(underwaterSwing({ weapon, base: "Javelin", melee: true, swims: false, beyondNormal: false }).disadvantage, false, weapon);
  }
  assert.equal(underwaterSwing({ weapon: "+1 Heavy Crossbow", base: "Heavy Crossbow", melee: false, swims: false, beyondNormal: false }).disadvantage, false);
  assert.equal(underwaterSwing({ weapon: "Longsword", base: "Longsword", melee: true, swims: false, beyondNormal: false }).disadvantage, true);
  assert.equal(underwaterSwing({ weapon: "Spear of the Deep", base: "Longsword", melee: true, swims: false, beyondNormal: false }).disadvantage, true, "a word in the name is no weapon");
});

test("a name in each table language is compared as written: it finds no English row, and loses no letter", () => {
  for (const language of LANGUAGES.slice(1)) {
    const names = TRANSLATED[language];
    assert.equal(matchWeapon(names.sword), null, `${language}: ${names.sword}`);
    assert.equal(matchWeapon(names.swords), null, `${language}: ${names.swords}`);
    assert.equal(matchArmor(names.shield), null, `${language}: ${names.shield}`);
    assert.equal(matchArmor(names.shields), null, `${language}: ${names.shields}`);
    assert.equal(matchArmor(names.plate), null, `${language}: ${names.plate}`);
    assert.equal(matchGear(names.torch), null, `${language}: ${names.torch}`);
    assert.equal(itemWeightByName(names.torch), null, `${language}: ${names.torch}`);
    assert.equal(findPoison(names.poison), null, `${language}: ${names.poison}`);
  }
  const english = TRANSLATED.english;
  assert.equal(matchWeapon(english.swords)?.name, "Longsword");
  assert.equal(matchArmor(english.shields)?.name, "Shield");
  assert.equal(matchArmor(english.plate)?.name, "Plate");
  assert.equal(matchGear(english.torch)?.name, "Torch");
  assert.equal(itemWeightByName(english.torch), 1);
  assert.equal(itemWeightByName("Pouches"), 1);
  assert.equal(findPoison(english.poison)?.id, "serpent_venom");
  // A name ending in "s" keeps its letter: the Kris and the Gladius are not a Kri or a Gladiu.
  assert.equal(matchWeapon("Kris"), null);
  assert.equal(matchGear("Pelles"), null);
});

test("a poison is found by its name, inside a vial's label, and without the words a label adds", () => {
  assert.equal(findPoison("Essence of Ether")?.id, "essence_of_ether");
  assert.equal(findPoison("Essence Ether")?.id, "essence_of_ether");
  assert.equal(findPoison("a dose of Malice")?.id, "malice");
  assert.equal(findPoison("Oil of Taggit (vial)")?.id, "oil_of_taggit");
});

test("a stored subclass names its subclass with or without a title, and a name in another language is matched whole", () => {
  assert.ok(subclassNamed("Devotion", "Oath of Devotion"));
  assert.ok(subclassNamed("Path of Berserker", "Path of the Berserker"));
  assert.ok(subclassNamed("Life", "Life Domain"));
  assert.ok(!subclassNamed("Oath", "Oath of Devotion"));
  assert.ok(subclassNamed("Giuramento della Luce", "Giuramento della Luce"));
  assert.ok(!subclassNamed("Luce", "Giuramento della Luce"), "no English title comes off another language's name");
  assert.ok(optionAllowed({ requires: "heavy-armor" }, { armor: [], weapons: [], subclass: "Tempest Domain" }));
  assert.ok(optionAllowed({ requires: "warhammer" }, { armor: [], weapons: [], subclass: "War" }));
  assert.ok(!optionAllowed({ requires: "heavy-armor" }, { armor: [], weapons: [], subclass: "Dominio della Tempesta" }));
});

test("a spell's other checklist names find its rows, with no possessive taken off", () => {
  const facts = (name) => ({ name, material: true, materialCostGp: 0, materialText: "", materialConsumed: false });
  assert.ok(materialComponents(facts("Mordenkainen's Magnificent Mansion")).length > 0);
  assert.deepEqual(materialComponents(facts("Mordenkainen's Magnificent Mansion")), materialComponents(facts("Magnificent Mansion")));
  assert.deepEqual(spellSupportFor("Tasha's Hideous Laughter"), spellSupportFor("Hideous Laughter"));
  assert.equal(Boolean(spellMechFor(["Bigby's Hand"])), Boolean(spellMechFor(["Arcane Hand"])));
  assert.equal(Boolean(spellMechFor(["Melf's Acid Arrow"])), Boolean(spellMechFor(["Acid Arrow"])));
  assert.equal(spellMechFor(["Freccia acida di Melf"]), null);
});

test("an article is a leading stop word of the table language, in every language", () => {
  const tokens = [{ name: "Grey Wolf" }, { name: "Lupo Grigio" }, { name: "Loup Gris" }, { name: "Lobo Gris" }, { name: "Grauwolf" }, { name: "La Volpe" }];
  const written = { english: ["the Grey Wolf", "Grey Wolf"], italian: ["il Lupo Grigio", "Lupo Grigio"], french: ["le Loup Gris", "Loup Gris"], spanish: ["el Lobo Gris", "Lobo Gris"], german: ["der Grauwolf", "Grauwolf"] };
  for (const language of LANGUAGES) {
    const [withArticle, name] = written[language];
    assert.equal(findNamed(tokens, nameTerms(withArticle, language), (token) => [token.name])?.name, name, `${language}: ${withArticle}`);
  }
  // A name that starts with a stop word is found whole first.
  assert.equal(findNamed(tokens, nameTerms("La Volpe", "italian"), (token) => [token.name])?.name, "La Volpe");
  // An English article is no article at an Italian table, and the reverse.
  assert.equal(findNamed(tokens, nameTerms("the Lupo Grigio", "italian"), (token) => [token.name]), null);
  assert.equal(findNamed(tokens, nameTerms("il Grey Wolf", "english"), (token) => [token.name]), null);
  assert.equal(withoutLeadingStopWords("l arco", "italian"), "arco", "an elided article");
});

test("the narration guard's creature names drop the table language's article and the run number", () => {
  assert.equal(normalizeCreatureName("the Ogre", "english"), "ogre");
  assert.equal(normalizeCreatureName("l'Orco 2", "italian"), "orco");
  assert.equal(normalizeCreatureName("l'Ogre", "french"), "ogre");
  assert.equal(normalizeCreatureName("el Ogro A", "spanish"), "ogro");
  assert.equal(normalizeCreatureName("der Oger #3", "german"), "oger");
  assert.equal(normalizeCreatureName("the Ogre", "italian"), "the ogre");
});

test("a lineage's natural weapon and a beast form are found as written, with the article the table writes", () => {
  const features = [{ name: "Claws (1d4 slashing unarmed strike)" }];
  assert.equal(racialNaturalWeapon(features, nameTerms("her claws", "english"))?.srd.name, "Claws");
  assert.equal(racialNaturalWeapon(features, nameTerms("gli artigli", "italian")), null, "a translated name finds no English trait");
  assert.equal(findBeastForm("the Brown Bear")?.name, "Brown Bear");
  assert.equal(findBeastForm("brown bear form")?.name, "Brown Bear");
  assert.equal(findBeastForm("Orso bruno"), null);
});

test("a genre token's picture is found with or without its The, and a name in another language finds none", () => {
  const plate = monsterPlaceholder(null, { genre: "horror", name: "The Skittering" });
  assert.equal(monsterPlaceholder(null, { genre: "horror", name: "Skittering" }), plate);
  assert.equal(monsterPlaceholder(null, { genre: "horror", name: "the skittering" }), plate);
  assert.notEqual(monsterPlaceholder(null, { genre: "horror", name: "Lo Zampettio" }), plate);
});

removeTempDir(dir);
console.log(`\n${passed} written-name tests passed`);
