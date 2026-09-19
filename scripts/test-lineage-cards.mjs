// The lineage grid and the class cards (docs/visual-overhaul-plan.md 7.3 and
// 7.5). What is pinned here: the tagline rule, the trait parser over every
// bundled race (a body or a locked row, no exceptions), the carousel walking
// the picker's groups in the picker's order, the fold that keeps a long grid
// short without ever hiding the recommended tier or the chosen card, and that
// every plate a card can ask for is a file that exists.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";

register("./lib/register-alias.mjs", import.meta.url);

const {
  asiChips,
  canonicalRaceId,
  classArt,
  filterGroups,
  flattenGroups,
  foldGroups,
  lineageArt,
  lineageChoices,
  lineageFamily,
  lineageTagline,
  parseTrait,
  srdRaceFor,
  traitLines,
  wrapIndex,
} = await import("../src/app/characters/builder/lineage.ts");
const { SRD_RACES, SRD_CLASSES } = await import("../src/lib/srd/index.ts");
const { CUSTOM_CLASSES } = await import("../src/lib/classes/index.ts");

const publicDir = path.resolve(import.meta.dirname, "../public");
const exists = (webPath) => fs.existsSync(path.join(publicDir, webPath));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// ---- ids ----

test("pack slugs fold to the bundled ids", () => {
  assert.equal(canonicalRaceId("odm-hill-dwarf"), "hill_dwarf");
  assert.equal(canonicalRaceId("Half-Orc"), "half_orc");
  assert.equal(canonicalRaceId("  wood-elf "), "wood_elf");
  assert.equal(srdRaceFor("odm-rock-gnome")?.id, "rock_gnome");
  assert.equal(srdRaceFor("trollkin-heritage"), null);
});

// ---- the tagline rule ----

test("the tagline reads off the top ability bump", () => {
  assert.equal(lineageTagline({ asi: { str: 2, con: 1 } }), "Built to endure");
  assert.equal(lineageTagline({ asi: { con: 2, wis: 1 } }), "Hard to put down");
  assert.equal(lineageTagline({ asi: { cha: 2 }, asiChoice: { count: 2, amount: 1 } }), "Commands a room");
});

test("six bumps is adaptable, none is blank or yours to shape", () => {
  assert.equal(lineageTagline({ asi: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 } }), "Adaptable");
  assert.equal(lineageTagline({ asi: {} }), "");
  assert.equal(lineageTagline({ asi: {}, asiChoice: { count: 2, amount: 1 } }), "Yours to shape");
});

test("a tie keeps the order the race lists its bumps in", () => {
  assert.equal(lineageTagline({ asi: { str: 2, con: 2 } }), "Built to endure");
  assert.equal(lineageTagline({ asi: { con: 2, str: 2 } }), "Hard to put down");
});

test("every bundled race has a tagline", () => {
  for (const race of SRD_RACES) {
    assert.ok(lineageTagline(race).length > 0, race.id);
  }
});

test("chips: one per bump, six equal bumps as one", () => {
  assert.deepEqual(asiChips({ dex: 2, int: 1 }).map((chip) => chip.label), ["DEX +2", "INT +1"]);
  assert.deepEqual(asiChips({ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }).map((chip) => chip.label), ["ALL +1"]);
  assert.deepEqual(asiChips({}), []);
});

// ---- the trait parser ----

test("the three shapes", () => {
  const hill = SRD_RACES.find((race) => race.id === "hill_dwarf");
  assert.deepEqual(parseTrait("Dwarven Resilience (adv. vs poison)", hill), {
    head: "Dwarven Resilience",
    body: "Adv. vs poison.",
  });
  // The bracket names the feature, so the line itself is the mechanic.
  assert.deepEqual(parseTrait("+1 HP per level (Dwarven Toughness)", hill), {
    head: "+1 HP per level (Dwarven Toughness)",
    body: null,
  });
  assert.equal(parseTrait("Perception proficiency (Keen Senses)", hill).body, null);
  assert.equal(parseTrait("Stonecunning", hill).body, null);
});

test("a bare line that names a choice opens onto the choice", () => {
  const human = SRD_RACES.find((race) => race.id === "human");
  assert.match(parseTrait("One extra language", human).body, /One more tongue of your choice/);
  const highElf = SRD_RACES.find((race) => race.id === "high_elf");
  assert.match(parseTrait("One wizard cantrip", highElf).body, /One wizard cantrip of your choice/);
  assert.match(parseTrait("Tool proficiency", { ...hillDwarfLike() }).body, /^One of smith's tools/);
});

function hillDwarfLike() {
  return SRD_RACES.find((race) => race.id === "hill_dwarf");
}

test("all 31 bundled races parse to a body or a locked row, no exceptions", () => {
  assert.equal(SRD_RACES.length, 31);
  for (const race of SRD_RACES) {
    const lines = traitLines(race);
    assert.ok(lines.length > 0, `${race.id} has trait lines`);
    for (const line of lines) {
      const parsed = parseTrait(line, race);
      assert.ok(parsed.head.length > 0, `${race.id}: ${line}`);
      assert.ok(parsed.body === null || (parsed.body.length > 1 && parsed.body.endsWith(".")), `${race.id}: ${line}`);
      assert.ok(!`${parsed.head}${parsed.body ?? ""}`.includes(String.fromCharCode(0x2014)), "no long dash in copy");
    }
  }
});

test("a pack row's summary splits back into lines, and a cut-off bracket locks", () => {
  const lines = traitLines({ id: "trollkin-heritage", note: "Darkvision 60 ft · Dwarven Resilience (adv · Thick Hide" });
  assert.deepEqual(lines, ["Darkvision 60 ft", "Dwarven Resilience (adv", "Thick Hide"]);
  assert.equal(parseTrait(lines[1], { id: "x", name: "X", asi: {} }).body, null);
  assert.deepEqual(traitLines({ id: "unknown", note: "" }), []);
});

test("leaves you to choose", () => {
  const halfElf = SRD_RACES.find((race) => race.id === "half_elf");
  assert.deepEqual(lineageChoices(halfElf), [
    "Two abilities to raise by 1",
    "One bonus language",
    "Two skill proficiencies",
  ]);
  assert.deepEqual(lineageChoices(SRD_RACES.find((race) => race.id === "half_orc")), []);
  assert.deepEqual(lineageChoices(hillDwarfLike()), ["One set of artisan's tools"]);
});

// ---- the carousel's order ----

const groups = [
  { label: "Peoples of Arda", recommended: true, options: [{ id: "human", name: "Men" }, { id: "elf", name: "Eldar", meta: "Elf" }] },
  { label: "All races", options: [{ id: "dwarf", name: "Dwarf" }, { id: "gnome", name: "Gnome" }, { id: "orc", name: "Orc" }] },
];

test("the carousel walks the picker's groups in the picker's order", () => {
  const flat = flattenGroups(groups);
  assert.deepEqual(flat.map((entry) => entry.option.id), ["human", "elf", "dwarf", "gnome", "orc"]);
  assert.deepEqual(flat.map((entry) => entry.recommended), [true, true, false, false, false]);
  assert.equal(flat[2].group, "All races");
});

test("it wraps at both ends", () => {
  assert.equal(wrapIndex(0, -1, 5), 4);
  assert.equal(wrapIndex(4, 1, 5), 0);
  assert.equal(wrapIndex(2, 1, 5), 3);
  assert.equal(wrapIndex(0, 1, 0), 0);
});

test("search matches the name or the canonical name, and empty groups drop out", () => {
  assert.deepEqual(filterGroups(groups, "").length, 2);
  const byCanonical = filterGroups(groups, "elf");
  assert.deepEqual(byCanonical.map((group) => group.options.map((option) => option.id)), [["elf"]]);
  assert.equal(byCanonical[0].recommended, true);
  assert.deepEqual(filterGroups(groups, "zzz"), []);
});

test("the fold never hides the recommended tier or the chosen card", () => {
  const many = [
    groups[0],
    { label: "All races", options: Array.from({ length: 40 }, (_, index) => ({ id: `r${index}`, name: `R${index}` })) },
  ];
  const folded = foldGroups(many, { limit: 6, keepId: "r33" });
  assert.deepEqual(folded.groups[0].options.map((option) => option.id), ["human", "elf"]);
  assert.deepEqual(folded.groups[1].options.map((option) => option.id), ["r0", "r1", "r2", "r3", "r33"]);
  assert.equal(folded.hidden, 35);
});

test("a list with groups keeps its leading group whole; a single list folds by count", () => {
  const classes = [
    { label: "Standard classes", options: Array.from({ length: 14 }, (_, index) => ({ id: `c${index}` })) },
    { label: "From the Cyberpunk setting", options: [{ id: "netrunner" }, { id: "fixer" }] },
  ];
  const folded = foldGroups(classes, { limit: 12, keepId: "fixer" });
  assert.equal(folded.groups[0].options.length, 14);
  assert.deepEqual(folded.groups[1].options.map((option) => option.id), ["fixer"]);
  const single = foldGroups([{ label: null, options: classes[0].options }], { limit: 12, keepId: "c13" });
  assert.deepEqual(single.groups[0].options.length, 13);
  assert.equal(single.hidden, 1);
});

// ---- the plates ----

test("every bundled race resolves to its own family plate, in all three genders", () => {
  for (const race of SRD_RACES) {
    for (const gender of ["", "male", "female"]) {
      const art = lineageArt(race.id, race.name, gender);
      assert.match(art, /\/character-race\//, race.id);
      assert.ok(exists(art), `${art} exists`);
    }
  }
});

test("pack lineages borrow the family in their slug or name, else the adventurer", () => {
  assert.equal(lineageFamily("dwarf"), "dwarf");
  assert.equal(lineageFamily("odm-drow"), "drow");
  assert.equal(lineageFamily("humanhalf-elf-heritage"), "half-elf");
  assert.equal(lineageFamily("elfshadow-fey-heritage"), "elf");
  assert.equal(lineageFamily("dwarf-chassis"), "warforged");
  assert.equal(lineageFamily("stoor-halfling"), "halfling");
  assert.equal(lineageFamily("orc"), "half-orc");
  assert.equal(lineageFamily("catfolk"), "tabaxi");
  assert.equal(lineageFamily("reskinned", "Hill Dwarf"), "dwarf");
  assert.equal(lineageFamily("mushroomfolk"), null);
  const fallback = lineageArt("mushroomfolk", "Mushroomfolk", "");
  assert.ok(exists(fallback), `${fallback} exists`);
});

test("every class card has a plate that exists, and a neutral look still shows the class", () => {
  const ids = [...SRD_CLASSES.map((klass) => klass.id), ...CUSTOM_CLASSES.map((klass) => klass.id)];
  assert.ok(ids.length > 40);
  for (const id of ids) {
    for (const gender of ["", "male", "female"]) {
      const art = classArt(id, gender);
      assert.ok(exists(art), `${art} exists`);
      assert.match(art, /\/character-class\//, `${id} (${gender || "neutral"}) shows its class`);
    }
  }
  // A pack class nobody painted falls back to the adventurer, not a 404.
  assert.ok(exists(classArt("marshal", "")));
});

console.log(`test-lineage-cards: ${passed} passed`);
