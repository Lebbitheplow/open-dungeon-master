// The gender is asked on the class step, above the class cards, because
// their art follows it, as the ancestry cards' does after them. Asked with
// the name on the last step (pull request 513, backlog F4), it left every
// card before it in a look nobody had chosen. It has no default: unset is a
// real answer, saved as unset. Until it is chosen each card shows its own
// stable look among the three painted (lineage.ts previewGender), which is
// only what the card shows. The clicks are walked in
// scripts/browser/scenarios/102-builder-gender.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { classArt, lineageArt, previewGender } = await import("../src/app/characters/builder/lineage.ts");
const { classCard } = await import("../src/app/characters/builder/cardFaces.ts");
const { summaryRows } = await import("../src/app/characters/builder/summary.ts");
const { GenderField } = await import("../src/app/characters/builder/steps/CallingSetup.tsx");
const { SRD_RACES, SRD_CLASSES } = await import("../src/lib/srd/index.ts");
const { CUSTOM_CLASSES } = await import("../src/lib/classes/index.ts");

// Windows CI checks out with CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const exists = (url) => fs.existsSync(new URL(`../public${url}`, import.meta.url));
const look = (art) => /-(feminine|masculine|neutral)\.webp$/.exec(art)?.[1];

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
const calling = read("src/app/characters/builder/steps/CallingStep.tsx");
const identity = read("src/app/characters/builder/steps/IdentityStep.tsx");

await test("the class step asks the gender above the class cards, and the Hero step no longer does", () => {
  const step = builder.slice(builder.indexOf('      key: "calling",'), builder.indexOf('      key: "ancestry",'));
  assert.match(step, /genderField=\{<GenderField state=\{state\}/);
  const at = calling.indexOf("{genderField}");
  assert.ok(at > 0, "the class step draws the gender");
  assert.ok(at > calling.indexOf("<PlaystylePicker") && at < calling.indexOf("<OptionCardGrid"), "between the playstyle question and the cards");
  // The Hero step says it and points back; it holds no control that sets it.
  assert.doesNotMatch(identity, /setGender|<Select/);
  assert.match(identity, /onClick=\{onEditGender\}[^>]*>\s*Change on the Class step/);
  assert.match(builder, /onEditGender=\{\(\) => changePick\("gender"\)\}/);
  assert.match(builder, /target === "gender" \? "calling" :/, "its way back opens the class step");
});

await test("the gender starts unchosen, with no default", () => {
  const html = renderToStaticMarkup(createElement(GenderField, { state: { gender: "", setGender: () => {} } }));
  assert.match(html, /data-builder-target="gender"/);
  assert.match(html, />Not chosen</, "the trigger reads Not chosen");
  assert.match(html, /The cards show a mix of looks until you choose/);
  const state = read("src/app/characters/builder/useBuilderState.ts");
  assert.match(state, /useState<Gender>\(initial\?\.gender \?\? ""\)/, "a new hero starts unset");
});

await test("a chosen gender is what every class and lineage card shows", () => {
  const classIds = [...SRD_CLASSES.map((klass) => klass.id), ...CUSTOM_CLASSES.map((klass) => klass.id)];
  for (const [gender, expected] of [["Female", "feminine"], ["Male", "masculine"], ["Nonbinary", "neutral"]]) {
    for (const id of classIds) {
      assert.equal(look(classArt(id, gender)), expected, `${id} as ${gender}`);
    }
    for (const race of SRD_RACES) {
      assert.equal(look(lineageArt(race.id, race.name, gender)), expected, `${race.id} as ${gender}`);
    }
    // Through the class card's face, as the grid builds it.
    const card = classCard({ option: { id: "fighter", name: "Fighter" }, entry: undefined, reading: undefined, gender, numbers: false });
    assert.equal(look(card.art), expected);
  }
});

await test("unchosen, the cards show a stable mix of all three looks", () => {
  for (const ids of [SRD_CLASSES.map((klass) => klass.id), SRD_RACES.map((race) => race.id)]) {
    const looks = ids.map((id) => previewGender(id, ""));
    assert.deepEqual([...new Set(looks)].sort(), ["Female", "Male", "Nonbinary"], "all three appear");
    // The same pick on every call, so a re-render or a reload shows the same card.
    assert.deepEqual(ids.map((id) => previewGender(id, "")), looks);
  }
  assert.equal(look(classArt("wizard", "")), look(classArt("wizard", previewGender("wizard", ""))));
  assert.equal(look(lineageArt("hill_dwarf", "Hill Dwarf", "")), look(lineageArt("hill_dwarf", "Hill Dwarf", previewGender("hill_dwarf", ""))));
  // Every preview pick is a plate that ships, the hooded stranger included
  // for a pack lineage no family covers.
  for (const id of [...SRD_CLASSES.map((klass) => klass.id), ...CUSTOM_CLASSES.map((klass) => klass.id)]) {
    assert.ok(exists(classArt(id, "")), `${classArt(id, "")} exists`);
  }
  for (const race of SRD_RACES) {
    assert.ok(exists(lineageArt(race.id, race.name, "")), race.id);
  }
  assert.ok(exists(lineageArt("spacefolk", "Spacefolk", "")));
});

await test("the preview writes no gender: the sheet and the summary keep the player's", () => {
  // Only the card art reads the preview.
  for (const path of ["submit.ts", "useBuilderState.ts", "summary.ts", "builderDraft.ts", "CharacterBuilder.tsx"]) {
    assert.doesNotMatch(read(`src/app/characters/builder/${path}`), /previewGender/, path);
  }
  assert.match(read("src/app/characters/builder/submit.ts"), /\n\s+gender: state\.gender,\n/);
  const base = { name: "Wren", klass: "Wizard", level: 1, abilities: null, casts: false, cantrips: [], spells: [], gear: [], portrait: false, appearance: false, backstory: false, owed: { identity: [], ancestry: [], calling: [], abilities: [], spells: [] } };
  const [unset] = summaryRows(base);
  assert.deepEqual(unset.lines, ["Wizard, level 1"], "an unset gender is not said, and owes nothing");
  assert.deepEqual(unset.owed, []);
  const [chosen] = summaryRows({ ...base, gender: "Female" });
  assert.equal(chosen.key, "calling", "its Edit opens the class step");
  assert.deepEqual(chosen.lines, ["Wizard, level 1", "Gender: Female"]);
  assert.match(builder, /gender: state\.gender \|\| undefined,/);
});

console.log(`test-builder-gender-first: ${passed} passed`);
