// The builder's card faces (backlog F11): every bundled class and lineage is
// put through the code the steps render (cardFaces.ts) and the grid that
// prints it. With "Show rules and numbers" off no card face may carry a bare
// die ("d10"). An ability's code may stand on a card only as a signed bonus
// ("CON +2") or a caster ("INT caster"), and only with its name beside it
// for a screen reader (AbilityText.tsx); a bonus stands only after its
// ability, "All" or "Choose". With the switch on the hit die comes back,
// after the words that say what it means. The switch stays as the player
// set it (numbersPref.ts), and the header's hit die follows it.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const noop = () => {};

const { classCard, lineageCard, playLine } = await import("../src/app/characters/builder/cardFaces.ts");
const { asiChips, asiChoiceChip, casterChip, hitDieChip, hitDieWords } = await import("../src/app/characters/builder/lineage.ts");
const { OptionCardGrid } = await import("../src/app/characters/builder/OptionCardGrid.tsx");
const { SRD_CLASSES, SRD_RACES } = await import("../src/lib/srd/index.ts");
const { CUSTOM_CLASSES } = await import("../src/lib/classes/index.ts");
const { classRoles } = await import("../src/lib/srd/class-roles.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const CODE = "(?:STR|DEX|CON|INT|WIS|CHA)";
const SIGNED = "[+−-]\\d+";
// The shapes a code or a bonus may take on a card face.
const ALLOWED = new RegExp(`\\b${CODE} ${SIGNED}|\\b${CODE} caster\\b|\\bAll ${SIGNED}|\\bChoose ${SIGNED}(?: / ${SIGNED})*`, "g");
// What a card face may not say with the numbers off, once those are taken out.
const BARE_CODES = [
  ["a die", /\bd(?:4|6|8|10|12|20|100)\b/i],
  ["an ability abbreviation", /\b(?:str|dex|con|int|wis|cha)\b/i],
  ["a bonus", /[+−-]\d/],
];
function bareCodes(text) {
  const rest = text.replace(ALLOWED, " ");
  return BARE_CODES.filter(([, pattern]) => pattern.test(rest)).map(([what]) => what);
}

// The bundled classes and lineages as the steps card them.
const classes = [...SRD_CLASSES, ...CUSTOM_CLASSES];
const classCards = (numbers) =>
  classes.map((klass) =>
    classCard({
      option: { id: klass.id, name: klass.name, source: klass.source },
      entry: klass,
      reading: classRoles(klass),
      numbers,
    }),
  );
const lineageCards = () => SRD_RACES.map((race) => lineageCard({ slide: { ...race, art: "/a.webp" } }));

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

// Each card's face (its choose button) in the grid's markup, a dozen cards to
// a grid so none is folded away: what the eye reads (the screen-reader-only
// names left out) and what a screen reader hears (the hidden codes left out).
function cardFaces(cards, extra = {}) {
  let markup = "";
  for (let start = 0; start < cards.length; start += 12) {
    markup += renderToStaticMarkup(
      createElement(OptionCardGrid, { groups: [{ label: null, options: cards.slice(start, start + 12) }], value: "", onChoose: noop, onDetails: noop, noun: "class", numbersSwitch: true, ...extra }),
    );
  }
  const buttons = [...markup.matchAll(/<button[^>]*class="creator-card motion-card"[^>]*>([\s\S]*?)<\/button>/g)].map((match) => match[1]);
  assert.equal(buttons.length, cards.length, "every card is rendered");
  const faces = buttons.map((html) => text(html.replace(/<span class="sr-only">[^<]*<\/span>/g, "")));
  const spoken = buttons.map((html) => text(html.replace(/<span aria-hidden="true">[^<]*<\/span>/g, "")));
  return { markup, faces, spoken };
}

await test("the words a code becomes", () => {
  assert.equal(hitDieWords(4), "Very low HP");
  assert.equal(hitDieWords(6), "Low HP");
  assert.equal(hitDieWords(8), "Medium HP");
  assert.equal(hitDieWords(10), "High HP");
  assert.equal(hitDieWords(12), "Very high HP");
  assert.equal(hitDieChip(10, false), "High HP");
  assert.equal(hitDieChip(10, true), "High HP, d10");
  assert.equal(casterChip("int"), "INT caster");
  assert.deepEqual(asiChips({ con: 2, wis: 1 }).map((chip) => [chip.label, chip.spoken]), [["CON +2", "Constitution +2"], ["WIS +1", "Wisdom +1"]]);
  assert.deepEqual(asiChips({ str: -2 }).map((chip) => chip.label), ["STR -2"]);
  assert.deepEqual(asiChips({ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }).map((chip) => [chip.label, chip.spoken]), [["All +1", "All abilities +1"]]);
  assert.equal(asiChoiceChip({ asiChoice: { count: 2, amount: 1 } }), "Choose +1 / +1");
  assert.equal(asiChoiceChip({ asiChoice: { count: 1, amount: 2 } }), "Choose +2");
  assert.equal(asiChoiceChip({ variants: { options: [{ asi: { str: 2, cha: 1 } }, { asi: { dex: 1, int: 2 } }] } }), "Choose +2 / +1");
  assert.equal(asiChoiceChip({ variants: { options: [{ asi: { str: 2 } }, { asi: { dex: 1 } }] } }), "Choose a bonus");
  assert.equal(asiChoiceChip({ variants: { options: [{}, {}] } }), null, "options without bonuses say nothing about one");
  assert.equal(asiChoiceChip({}), null);
});

await test("a choosable bonus is a chip of its own beside the fixed ones", () => {
  const halfElf = SRD_RACES.find((race) => race.asiChoice);
  assert.ok(halfElf, "a bundled lineage with a bonus to place");
  const card = lineageCard({ slide: { ...halfElf, art: "/a.webp" } });
  assert.ok(card.chips.some((chip) => chip.startsWith("Choose +")), `${halfElf.name}: ${card.chips.join(", ")}`);
  const species = lineageCard({
    slide: { id: "half-dragon", name: "Half-Dragon", asi: {}, art: "/a.webp", variants: { options: [{ asi: { str: 2, cha: 1 } }, { asi: { con: 2, wis: 1 } }] } },
  });
  assert.deepEqual(species.chips, ["Choose +2 / +1"]);
});

await test("a class card leads with its play line", () => {
  const reading = (playsLike, suggested = false) => ({ roles: [], playsLike, suggested });
  assert.equal(playLine(reading("Wizard + Fighter"), "artificer"), "Wizard/Fighter mix");
  assert.equal(playLine(reading("Cleric"), "druid"), "Cleric style");
  assert.equal(playLine(reading("Wizard"), "wizard"), "Core class");
  assert.equal(playLine(reading("Fighter", true), "marshal"), "Fighter style (suggested)");
  for (const card of classCards(false)) {
    const line = playLine(classRoles(classes.find((klass) => klass.id === card.id)), card.id);
    assert.ok(line && card.tagline.startsWith(line), `${card.name}'s first line under its name is its play line: ${card.tagline}`);
    assert.ok(!/caster/.test(card.tagline), `${card.name}'s caster is a chip, not in the play line`);
  }
});

await test("with the numbers off, no card face carries a bare code", () => {
  for (const [kind, cards] of [["class", classCards(false)], ["lineage", lineageCards()]]) {
    const { faces } = cardFaces(cards);
    for (const [index, face] of faces.entries()) {
      const found = bareCodes(face);
      assert.deepEqual(found, [], `the ${kind} card ${cards[index].name} reads "${face}": ${found.join(", ")}`);
    }
  }
});

await test("an ability's code is heard as its name", () => {
  const { faces, spoken, markup } = cardFaces([...classCards(false), ...lineageCards()]);
  assert.ok(faces.some((face) => /\bCON \+2\b/.test(face)), "a lineage chip prints CON +2");
  assert.ok(faces.some((face) => /\bINT caster\b/.test(face)), "a class chip prints INT caster");
  assert.match(markup, /<abbr title="Constitution" class="no-underline"><span aria-hidden="true">CON<\/span><span class="sr-only">Constitution<\/span><\/abbr>/);
  for (const face of spoken) {
    assert.ok(!new RegExp(`\\b${CODE}\\b`).test(face), `a screen reader hears no bare code: ${face}`);
  }
  assert.ok(spoken.some((face) => /\bConstitution \+2\b/.test(face)), "CON +2 is heard as Constitution +2");
  assert.ok(spoken.some((face) => /\bIntelligence caster\b/.test(face)), "INT caster is heard as Intelligence caster");
});

await test("the check still catches a bare die, a loose code and a loose bonus", () => {
  for (const old of ["Tank d10", "Fighter/Cleric mix · d8", "WIS", "Saves STR CON", "+2", "ALL +1"]) {
    assert.ok(bareCodes(old).length, `"${old}" is a bare code`);
  }
  for (const fine of ["CON +2", "INT caster", "All +1", "Choose +1 / +1", "Choose +2", "STR -2"]) {
    assert.deepEqual(bareCodes(fine), [], `"${fine}" may stand on a card`);
  }
});

await test("with the numbers on, the hit die follows its words", () => {
  for (const card of classCards(true)) {
    const health = card.chips.find((chip) => /\bd\d+\b/.test(chip));
    assert.match(health ?? "", /^(?:Very low|Low|Medium|High|Very high) HP, d\d+$/, `${card.name}'s hit die chip leads with words: ${health}`);
  }
});

await test("the numbers a card holds back are still searched", async () => {
  const { filterGroups } = await import("../src/app/characters/builder/lineage.ts");
  const groups = [{ label: null, options: [...classCards(false), ...lineageCards()] }];
  const ids = (query) => filterGroups(groups, query).flatMap((group) => group.options.map((option) => option.id));
  assert.ok(ids("d12").includes("barbarian"), "a die finds its class");
  assert.ok(ids("con +2").length > 0, "an abbreviated bonus finds its lineage");
  assert.ok(ids("constitution").length > 0, "and so does the ability's name");
  assert.ok(ids("high hp").includes("fighter"), "and the HP in words");
});

await test("the class grid offers the switch, off until it is set", () => {
  const { markup } = cardFaces(classCards(false).slice(0, 2));
  assert.match(markup, /<button[^>]*role="switch"[^>]*aria-checked="false"[^>]*aria-label="Show rules and numbers"/, "a named switch, off");
  assert.ok(markup.includes(">Show rules and numbers<"), "with a visible label");
  assert.ok(markup.includes("Adds the hit die after HP"), "and a hint that says what it adds");
});

await test("a grid the switch changes nothing on does not offer it", () => {
  const { markup } = cardFaces(classCards(false).slice(0, 2), { numbersSwitch: false });
  assert.ok(!markup.includes("Show rules and numbers"), "no switch where it would change nothing");
});

await test("the switch stays as the player set it", async () => {
  const { readNumbers, writeNumbers } = await import("../src/app/characters/builder/numbersPref.ts");
  const store = new Map();
  const events = [];
  const fakeWindow = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: (event) => events.push(event.type),
  };
  const previous = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    assert.equal(readNumbers(), false, "off on a device that never set it");
    writeNumbers(true);
    assert.equal(store.get("odm:builder-numbers"), "1", "kept on the device");
    assert.equal(readNumbers(), true);
    assert.ok(events.length, "the open grids and the header hear of it");
    writeNumbers(false);
    assert.equal(readNumbers(), false, "and off again when turned off");
    // A refused storage keeps the choice for the page.
    fakeWindow.localStorage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    writeNumbers(true);
    assert.equal(readNumbers(), true, "a refused storage still moves the switch for this page");
  } finally {
    globalThis.window = previous;
  }
});

await test("the steps and the header speak through the same words", () => {
  const calling = read("src/app/characters/builder/steps/CallingStep.tsx");
  const ancestry = read("src/app/characters/builder/steps/AncestryStep.tsx");
  const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
  assert.match(calling, /classCard\(\{/, "the class step cards through cardFaces.ts");
  assert.match(ancestry, /lineageCard\(\{ slide \}\)/, "the lineage step too");
  assert.match(builder, /hitDieChip\(klass\.hitDie, numbers\)/, "the header's hit die is in words");
  assert.ok(!/`d\$\{klass\.hitDie\}`/.test(builder), "and never a bare die");
});

console.log(`test-builder-plain-cards: ${passed} passed`);
