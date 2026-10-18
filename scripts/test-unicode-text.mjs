// Text people write is compared by Unicode everywhere it is read: a name in
// another case of an accented letter, written decomposed (E + U+0301) or
// with a doubled space is the same name, a word of any script is a word, and
// an id made from a name keeps the name's letters. In English and at an
// Italian, French, German and Russian table alike. Pure modules only; the
// lookups that read the database are scripts/test-unicode-lookups.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { asciiSlugOf, commonWords, containsPhrase, findNamed, namesPattern, phraseOffsets, slugOf, splitWords, textKey, words } = await import(
  "../src/lib/language/text-logic.ts"
);
const { attributeKey } = await import("../src/lib/dm/attributes-logic.ts");
const { normalizeSpellName } = await import("../src/lib/dm/engine-boundary.ts");
const { factSimilarity, normalizeSubject } = await import("../src/lib/dm/fact-logic.ts");
const { toolProficiencyBonus } = await import("../src/lib/dm/roll-riders.ts");
const { parseSpellcasting } = await import("../src/lib/dm/monster-abilities.ts");
const { snippetFor, stem } = await import("../src/lib/rulebook/search.ts");
const { detectWitnesses } = await import("../src/lib/dm/witness-logic.ts");
const { factionsNamedBy } = await import("../src/lib/dm/faction-logic.ts");
const { findCarriedItem } = await import("../src/lib/dm/item-logic.ts");
const { addToRoster } = await import("../src/lib/dm/encounter-template-logic.ts");
const { pickLairOption } = await import("../src/lib/dm/legendary-logic.ts");
const { spellsNamedIn } = await import("../src/lib/dm/concentration-confirm-logic.ts");
const { transcriptPassages } = await import("../src/lib/dm/ask-logic.ts");
const { cueTerms, scoreEvent } = await import("../src/lib/dm/arc-relevance.ts");
const { scoreRuleByKeywords } = await import("../src/lib/dm/rules-logic.ts");
const { deskTerms } = await import("../src/lib/reference/desk-logic.ts");
const { attributeSpeech } = await import("../src/lib/dm/speech.ts");
const { mentionSegments, stubScan } = await import("../src/lib/worldforge/text.ts");
const { fuzzyScore } = await import("../src/lib/palette/fuzzy.ts");
const { labelLines } = await import("../src/lib/voice/transcript.ts");
const { filterGroups } = await import("../src/app/characters/builder/lineage.ts");
const { packIdFrom } = await import("../src/lib/workshop/to-pack.ts");
const { receiverSlug } = await import("../src/lib/agents/receiver-config.ts");
const { attachmentDisposition } = await import("../src/lib/serve-file.ts");
const { exportFilename } = await import("../src/lib/export/story-document.ts");
const { bundledGearRows } = await import("../src/lib/workshop/bundled-gear-rows.ts");
const { plannedSwings } = await import("../src/lib/dm/enemy-profile.ts");
const { stopWordsFor } = await import("../src/lib/language/language.ts");
const { bundledRaceRows } = await import("../src/lib/workshop/catalog-mechanics.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// "É" written as E + combining acute: what a macOS keyboard or a pasted PDF
// can hand the table.
const decomposed = (text) => text.normalize("NFD");

// One name per table language, each with a letter outside ASCII.
const NAMES = {
  english: "Élodie Marsh",
  italian: "Niccolò della Città",
  french: "Épée de Saint-Rémi",
  german: "Äbtissin von Ölmühle",
  russian: "Ёлка Олеговна",
};

test("a name keys the same across case, Unicode form, spacing and punctuation, in every language", () => {
  for (const [language, name] of Object.entries(NAMES)) {
    const variants = [name.toUpperCase(), name.toLowerCase(), decomposed(name), name.replace(" ", "  "), ` ${name}, `];
    for (const variant of variants) {
      assert.equal(textKey(variant), textKey(name), `${language}: ${JSON.stringify(variant)}`);
    }
  }
  assert.notEqual(textKey("papà"), textKey("papa"));
});

test("the key keeps every script's letters and a number's sign; every other mark is a gap", () => {
  assert.equal(textKey("Épée"), "épée");
  assert.notEqual(textKey("Élan"), textKey("Lan"));
  assert.equal(textKey("Hunter’s  Mark"), "hunter s mark");
  assert.equal(textKey("Fire Bolt!"), "fire bolt");
  assert.equal(textKey("Олег-Иван"), "олег иван");
  // A bonus is part of a name; dice stay dice.
  assert.equal(textKey("Longsword +1"), "longsword +1");
  assert.equal(textKey("Cursed Ring −1"), textKey("Cursed Ring -1"));
  assert.equal(textKey("Cursed Ring -1"), "cursed ring -1");
  assert.deepEqual(words("2d6+3 fire, -2 to hit"), ["2d6", "3", "fire", "-2", "to", "hit"]);
  // A query of symbols alone keys to nothing, and searches like an empty box.
  assert.equal(textKey("&"), "");
  assert.equal(normalizeSpellName("Hunter’s Mark (3rd level)"), "hunter s mark");
  assert.equal(normalizeSpellName("Boule de Feu Éclatante"), normalizeSpellName(decomposed("boule de feu éclatante")));
  assert.equal(normalizeSubject("La  Cité d'Ys"), normalizeSubject(decomposed("la cité d’ys")));
});

test("a name keys the same however a model marks it, as spells, tools and gear always were", () => {
  for (const variant of ["Hunter`s Mark", "hunter_s_mark", "Hunterʼs Mark", "HUNTER’S MARK", "hunter-s-mark"]) {
    assert.equal(textKey(variant), textKey("Hunter's Mark"), variant);
  }
  assert.equal(textKey("cure_wounds"), "cure wounds");
  // Case folds in full, and a compatibility form is its letters.
  assert.equal(textKey("Straße der Krähen"), textKey("STRASSE DER KRÄHEN"));
  assert.equal(textKey("ﬁre bolt"), textKey("Fire Bolt"));
  assert.equal(textKey("ｆｕｌｌ ｐｌａｔｅ"), "full plate");
  assert.equal(textKey("ΟΔΟΣ"), textKey("οδος"));
  assert.notEqual(textKey("papà"), textKey("papa"));
  assert.equal(slugOf("Straße"), "strasse");
  assert.equal(asciiSlugOf("Straße der Krähen"), "strasse_der_krahen");
  assert.equal(textKey("Cure-Wounds"), textKey("Cure Wounds"));
  assert.equal(textKey(decomposed("Épée +1")), "épée +1");
  assert.equal(textKey("Aspʼs Kiss"), textKey("Asp's Kiss"));
  assert.equal(textKey("Asp´s Kiss"), textKey("Asp's Kiss"));
  // "Thieves' tools" and "thieves tools" are one tool.
  const rogue = { proficiencies: { tools: ["Thieves' Tools"] } };
  assert.ok(toolProficiencyBonus(rogue, "thieves tools", 2));
  assert.ok(toolProficiencyBonus(rogue, "Thieves’ tools (lockpicks)", 2));
  // A creature or a form by the name a model writes.
  const spider = { name: "Giant Spider" };
  assert.equal(findNamed([spider, { name: "Spider" }], "giant_spider", (entry) => entry.name), spider);
  assert.equal(findNamed([spider], "a Giant-Spider", (entry) => entry.name), spider);
  // A possessive or an elision shares its word with the bare one.
  assert.equal(factSimilarity("Marla's sword gleams", "the sword of Marla gleams"), 1);
});

test("a stat block's spells keep their title case, each hyphen part capitalized and an apostrophe's tail not", () => {
  const block = parseSpellcasting("The mage is a 5th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 13).\nCantrips (at will): green-flame blade, melf's acid arrow, élan vital\n");
  assert.deepEqual(block?.spells.map((spell) => spell.name), ["Green-Flame Blade", "Melf's Acid Arrow", "Élan Vital"]);
});

test("a search finds a word's parts: an elision, a possessive, a hyphenated word", () => {
  assert.ok(scoreRuleByKeywords(decomposed("dell'Oracolo"), { heading: "Oracolo", text: "" }) > 0);
  assert.equal(scoreRuleByKeywords("Marla’s orders", { heading: "Marla", text: "Her orders stand." }), 1);
  // A snippet starts at a word whose part is searched for, as at a whole word.
  const rule = `${"Filler words. ".repeat(30)}A two-handed weapon needs both hands.`;
  assert.match(snippetFor(rule, [stem("handed")]), /two-handed weapon/);
});

test("one word character: letters, digits and combining marks of every script, never _", () => {
  assert.deepEqual(words(decomposed("Élodie et José")), ["Élodie", "et", "José"]);
  assert.deepEqual(words("Олег и Ёлка"), ["Олег", "и", "Ёлка"]);
  // A word keeps an underscore inside it like an apostrophe or a hyphen, for
  // the stemmers; at a word's edge it is punctuation, as in markdown emphasis.
  // The key makes it a gap, so an id and the words it spells are one name.
  assert.deepEqual(words("sleight_of_hand, _Marla_"), ["sleight_of_hand", "Marla"]);
  assert.equal(textKey("sleight_of_hand"), textKey("Sleight of Hand"));
  assert.ok(containsPhrase("_Marla_ arrives", "marla"));
  assert.deepEqual(splitWords("Élodie, ça va?"), ["", "Élodie", ", ", "ça", " ", "va", "?"]);
});

test("a phrase is found as whole words, an apostrophe or a hyphen being an edge", () => {
  assert.ok(containsPhrase(decomposed("Then Élodie nods."), "élodie"));
  assert.ok(!containsPhrase("Élodiette nods.", "Élodie"));
  assert.ok(containsPhrase("Marla's sword", "Marla"));
  assert.ok(containsPhrase("il tempio dell'Oracolo", "oracolo"));
  assert.ok(containsPhrase("Saint-Rémi burns", "SAINT-RÉMI"));
  assert.deepEqual(phraseOffsets("Олег и Олег", "олег"), [0, 7]);
});

test("a names pattern finds any name whole, in either Unicode form, offsets into the text as written", () => {
  const pattern = namesPattern(["Élodie", "Élodie Marsh"], "gu");
  const text = `Then ${decomposed("Élodie Marsh")} and Élodiette.`;
  const found = [...text.matchAll(pattern)].map((match) => text.slice(match.index, match.index + match[0].length));
  assert.deepEqual(found, [decomposed("Élodie Marsh")]);
});

test("commonWords reads words as words() does, so a hyphenated lower-case name is common", () => {
  const common = commonWords(["they crossed the saint-rémi bridge", "Олег спит"]);
  assert.ok(common.has(textKey("Saint-Rémi")));
  assert.ok(common.has("спит"));
  assert.ok(!common.has("олег"));
  // The stub scan no longer offers a name the world writes in lower case.
  const texts = ["The saint-rémi bridge.", "We met at Saint-Rémi again.", "Then Saint-Rémi burned."];
  assert.deepEqual(stubScan(texts, [], []), []);
});

test("an id made from a name keeps its letters; an ASCII-only format drops accents and falls back", () => {
  assert.equal(slugOf("Ёлка"), "ёлка");
  assert.notEqual(slugOf("Ёлка"), slugOf("Дуб"));
  assert.equal(slugOf("Faction Standing"), "faction_standing");
  assert.equal(slugOf("Épée d'Argent"), "épée_d_argent");
  assert.equal(slugOf("?!"), "");
  assert.equal(attributeKey("Réputation de la Guilde"), "réputation_de_la_guilde");
  assert.equal(attributeKey("Harbour Guild"), "harbour_guild");
  assert.notEqual(attributeKey("Ёлка"), attributeKey("Дуб"));
  assert.equal(asciiSlugOf("Épée de Feu"), "epee_de_feu");
  assert.equal(asciiSlugOf(decomposed("Épée")), "epee");
  assert.equal(asciiSlugOf("Ёлка"), "");
  assert.equal(packIdFrom("Città Perduta"), "citta_perduta");
  assert.equal(packIdFrom("Олег"), "my_world");
  // A name that is one part of a file name is left out when nothing is left.
  assert.equal(exportFilename({ title: "Città d'Ombra" }, "html"), "città_d_ombra-story.html");
  assert.equal(exportFilename({ title: "???" }, "html"), "story.html");
  assert.equal(attachmentDisposition("ёлка (2).odm-character.json"), "attachment; filename*=UTF-8''%D1%91%D0%BB%D0%BA%D0%B0%20%282%29.odm-character.json");
  assert.equal(receiverSlug("Ölmühle", "abc-123-def-456"), "ölmühle-23def456");
  assert.equal(receiverSlug("Ёлка", "sheet-42"), "ёлка-sheet42");
  assert.equal(receiverSlug("???", "sheet-42"), "sheet42");
});

test("names found in text people write, across case and form", () => {
  const roster = Object.values(NAMES).map((name) => ({ name }));
  for (const name of Object.values(NAMES)) {
    assert.deepEqual(detectWitnesses(`… ${decomposed(name.toUpperCase())} watched.`, roster), [name]);
  }
  const faction = { id: "f1", campaignId: "c", name: "Gilde der Äbte", blurb: "", goal: "" };
  assert.deepEqual(factionsNamedBy("Die GILDE DER ÄBTE schweigt.", [faction]).map((entry) => entry.name), ["Gilde der Äbte"]);
  const equipment = [{ name: "Épée de Feu" }, { name: "Щит" }];
  assert.equal(findCarriedItem(equipment, decomposed("épée de feu"))?.name, "Épée de Feu");
  assert.equal(findCarriedItem(equipment, "щит")?.name, "Щит");
  assert.deepEqual(addToRoster([{ monster: "Élan", count: 1 }], "ÉLAN"), [{ monster: "Élan", count: 2 }]);
  assert.deepEqual(spellsNamedIn("je lance BOULE DE FEU", ["Boule de Feu"]), ["Boule de Feu"]);
});

test("the words a person types are searched by Unicode words, not ASCII runs", () => {
  assert.equal(pickLairOption(["Il soffitto crolla sui nemici.", "La nebbia avvolge la città."], "nebbia città"), "La nebbia avvolge la città.");
  const lines = [{ speaker: "dm", content: "Олег ушёл в лес." }, { speaker: "dm", content: "Nothing here." }];
  const found = transcriptPassages(lines, "куда ушёл Олег");
  assert.equal(found.length, 1);
  assert.match(found[0], /Олег ушёл в лес\./);
  const terms = cueTerms({ location: "Città Vecchia", npcs: ["Niccolò"] });
  assert.ok(scoreEvent({ name: "Agguato", trigger: decomposed("Niccolò arriva in CITTÀ VECCHIA"), detail: "" }, terms).score > 0);
  assert.equal(scoreRuleByKeywords("Überraschung", { heading: "Überraschung", text: "" }), 1);
  assert.deepEqual(deskTerms("Qu'est-ce que l'épée"), ["est", "que", "épée"]);
  assert.ok(fuzzyScore("öl", "Ölmühle öffnen") !== null);
  assert.deepEqual(
    filterGroups([{ label: "Elfi", options: [{ name: "Elfo dei Boschi", meta: "Città" }] }], "città elfo").map((group) => group.options.length),
    [1],
  );
});

test("a key never loses what a match needs: tags stripped before keying, stop words kept as written", () => {
  // The model names an attack with its recharge tag; the parenthetical goes
  // from the request as written, before the key drops its brackets.
  const attacks = [{ name: "Claw" }, { name: "Fire Breath" }];
  assert.equal(plannedSwings({ attacks }, attacks, "FIRE BREATH (Recharge 5–6)", { single: true })[0].name, "Fire Breath");
  // An elision in a stop list matches no word token; keyed it would stop "d".
  assert.ok(stopWordsFor("irish").has("d'"));
  assert.ok(!stopWordsFor("irish").has("d"));
});

test("the workshop pickers' searches fold case, spacing and form like every other search", () => {
  const chain = bundledGearRows("chain mail").map((row) => row.name);
  assert.ok(chain.length > 0);
  assert.deepEqual(bundledGearRows("CHAIN  MAIL").map((row) => row.name), chain);
  assert.deepEqual(bundledGearRows(decomposed(" Chain Mail ")).map((row) => row.name), chain);
  const dwarves = bundledRaceRows("hill dwarf", []).map((row) => row.name);
  assert.ok(dwarves.length > 0);
  assert.deepEqual(bundledRaceRows("HILL  DWARF", []).map((row) => row.name), dwarves);
});

test("speech is tied to a speaker whose name the prose writes decomposed or in another case", () => {
  const speaker = { kind: "npc", id: "n1", name: "Élodie Marsh" };
  for (const prose of [`${decomposed("Élodie")} says: "Hello."`, `ÉLODIE says: "Hello."`]) {
    const segments = attributeSpeech(prose, [speaker], { pronouns: true });
    const spoken = segments.find((segment) => segment.kind === "speech");
    assert.equal(spoken?.speaker.id, "n1", prose);
    // The prose keeps the name as it was written, in its own form.
    assert.ok(segments.some((segment) => segment.kind === "prose" && segment.text.includes(prose.split(" ")[0])), prose);
  }
  const russian = { kind: "npc", id: "n2", name: "Олег" };
  const said = attributeSpeech("Олег говорит: «Привет.»", [russian], { pronouns: false });
  assert.equal(said.find((segment) => segment.kind === "speech")?.speaker.id, "n2");
});

test("an entry name links in prose wherever a word of any script ends", () => {
  const named = [{ ref: "e1", name: "Città Vecchia", aliases: [] }];
  assert.deepEqual(
    mentionSegments("Verso Città Vecchia.", named).map((segment) => segment.ref ?? null),
    [null, "e1", null],
  );
  // A combining mark continues the word, so "Città Vecchiȧ" is not the entry.
  assert.ok(mentionSegments("Città Vecchiȧ.", named).every((segment) => !segment.ref));
});

test("a spoken transcript splits at sentence ends before any capital letter", () => {
  const lines = labelLines("Va bene. Élodie arriva. Олег ждёт.", "Kara", "t", "12:00");
  assert.deepEqual(lines.map((line) => line.text), ["Va bene.", "Élodie arriva.", "Олег ждёт."]);
});

console.log(`\n${passed} unicode text tests passed`);
