// Every option the character builder offers has something to say for
// itself, and the content pack's write-ups render as text rather than as
// raw markdown.
//
// The rule this file guards: no background, class, subclass or background
// feature is a bare name (issue #37). The SRD lists carry their own lines,
// the setting catalog its feature text, and the pack's five text shapes
// (Level Up feats with their benefits apart, backgrounds with a feature
// field, 2024 species with trait objects, "***bold***", paragraph breaks
// written as a line of one space) all come through describeContentEntry
// and the rules-text parser as readable blocks.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { SRD_BACKGROUNDS, SRD_CLASSES } = await import("../src/lib/srd/index.ts");
const { CUSTOM_BACKGROUNDS, backgroundFeatureFor, describeBackgroundFeature } = await import(
  "../src/lib/backgrounds/index.ts"
);
const { subclassBlurb, subclassNamesFor } = await import("../src/lib/srd/features.ts");
const { describeContentEntry, describeFeature } = await import("../src/lib/help/index.ts");
const { firstSentence, parseRulesBlocks, normalizeRulesText } = await import(
  "../src/lib/help/rules-text.ts"
);
const { mergedBackgroundOptions, srdBackgroundOptions } = await import(
  "../src/app/characters/builder/useBuilderOptions.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const noDash = (text, where) => assert.ok(!/—/.test(text), `em dash in ${where}`);

test("every SRD background has a line for the picker and text for its feature", () => {
  for (const background of SRD_BACKGROUNDS) {
    assert.ok(background.blurb?.trim(), `${background.id} blurb`);
    assert.ok(background.featureDesc?.trim(), `${background.id} feature text`);
    noDash(background.blurb + background.featureDesc, background.id);
  }
});

test("every catalog background's feature says what it does", () => {
  for (const background of CUSTOM_BACKGROUNDS) {
    assert.ok(background.featureDesc?.trim(), `${background.id} feature text`);
    noDash(background.featureDesc, background.id);
  }
});

test("the sheet's background chip finds its text by the feature's name", () => {
  for (const background of [...SRD_BACKGROUNDS, ...CUSTOM_BACKGROUNDS]) {
    const granted = backgroundFeatureFor(background.id);
    assert.ok(granted, `${background.id} grants a feature`);
    assert.equal(describeBackgroundFeature(granted.name), background.featureDesc);
    // The chip is labelled "Shelter of the Faithful (Acolyte)".
    assert.equal(describeFeature("fighter", "", `${granted.name} (${granted.background})`), background.featureDesc);
  }
});

test("every SRD class has a line for the picker", () => {
  for (const klass of SRD_CLASSES) {
    assert.ok(klass.blurb?.trim(), `${klass.id} blurb`);
    noDash(klass.blurb, klass.id);
  }
});

test("every subclass the builder offers without the pack has a line", () => {
  for (const klass of SRD_CLASSES) {
    for (const name of subclassNamesFor(klass.id)) {
      assert.ok(subclassBlurb(klass.id, name)?.trim(), `${klass.id} / ${name}`);
    }
  }
  assert.equal(subclassBlurb("fighter", "Champion").startsWith("A fighter"), true);
  assert.equal(subclassBlurb("fighter", "Nobody"), null);
});

test("the builder's background list is bundled first, pack rows added, same-slug pack rows dropped", () => {
  const rows = [
    { slug: "acolyte", name: "Acolyte", data: { desc: "Pack acolyte.", skill_proficiencies: "Insight, Religion" } },
    { slug: "charlatan", name: "Charlatan (a5e)", data: { desc: "Pack charlatan.", skill_proficiencies: "Deception" } },
    { slug: "court-servant", name: "Court Servant", data: { desc: "You served at court.", skill_proficiencies: "History, Insight", feature: "Servant's Invisibility", feature_desc: "Nobody notices the help." } },
    { slug: "cultist", name: "Cultist", data: { desc: "[No description provided]", skill_proficiencies: null } },
  ];
  const merged = mergedBackgroundOptions(rows);
  const ids = merged.map((option) => option.id);
  assert.equal(ids.filter((id) => id === "acolyte").length, 1);
  assert.equal(ids.filter((id) => id === "charlatan").length, 1);
  assert.equal(merged.find((option) => option.id === "acolyte").featureDesc, SRD_BACKGROUNDS[0].featureDesc);
  const servant = merged.find((option) => option.id === "court-servant");
  assert.deepEqual(servant.skills, ["history", "insight"]);
  assert.equal(servant.feature, "Servant's Invisibility");
  assert.equal(servant.featureDesc, "Nobody notices the help.");
  assert.ok(ids.includes("cultist"));
  assert.equal(ids.indexOf("acolyte") < ids.indexOf("court-servant"), true);
  assert.equal(ids.indexOf("court-servant") < ids.indexOf(srdBackgroundOptions().at(-1).id), true);
});

test("a Level Up feat shows its benefits, not only its flavor line", () => {
  const text = describeContentEntry({
    desc: "Crossbows are lethal in your hands.",
    prerequisite: null,
    effects_desc: ["Crossbows you wield do not have the loading quality.", "You do not suffer disadvantage when attacking adjacent creatures."],
  });
  assert.match(text, /^Crossbows are lethal in your hands\./);
  assert.match(text, /- Crossbows you wield do not have the loading quality\./);
  const blocks = parseRulesBlocks(text);
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "list"]);
  assert.equal(blocks[1].items.length, 2);
});

test("a pack background's feature is part of its description", () => {
  const text = describeContentEntry({ desc: "You served at court.", feature: "Servant's Invisibility", feature_desc: "Nobody notices the help." });
  assert.match(text, /\*\*Feature: Servant's Invisibility\.\*\* Nobody notices the help\./);
});

test("a 2024 species' trait objects read as named paragraphs, never as [object Object]", () => {
  const text = describeContentEntry({
    traits: [
      { name: "Speed", desc: "35 feet", type: "SPEED" },
      { name: "Powerful Build", desc: "You have Advantage on any check to end the Grappled condition.", type: null },
    ],
  });
  assert.ok(!text.includes("[object Object]"));
  assert.match(text, /\*\*Powerful Build\.\*\* You have Advantage/);
});

test("a placeholder or empty entry has no description", () => {
  assert.equal(describeContentEntry({ desc: "[No description provided]" }), null);
  assert.equal(describeContentEntry({ desc: "" }), null);
  assert.equal(describeContentEntry(undefined), null);
});

test("the pack's class write-up parses into headings and paragraphs, not one blob of hashes", () => {
  const fighter =
    "### Fighting Style \n \nYou adopt a particular style of fighting as your specialty. \n \n#### Archery \n \nYou gain a +2 bonus to attack rolls you make with ranged weapons. \n \n#### Defense \n \nWhile you are wearing armor, you gain a +1 bonus to AC. \n \n### Second Wind \n \nYou have a limited well of stamina.";
  const blocks = parseRulesBlocks(fighter);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "paragraph", "heading", "paragraph", "heading", "paragraph", "heading", "paragraph"],
  );
  assert.deepEqual(blocks.filter((block) => block.kind === "heading").map((block) => block.text), ["Fighting Style", "Archery", "Defense", "Second Wind"]);
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      assert.ok(!block.text.includes("#"), block.text);
    }
  }
});

test("bold-italic lead-ins and escaped newlines normalize, a captioned table stays a table", () => {
  assert.equal(normalizeRulesText("***Languages.*** You can speak Common."), "**Languages.** You can speak Common.");
  assert.equal(normalizeRulesText("**_Darkvision._** You can see in the dark."), "**Darkvision.** You can see in the dark.");
  assert.equal(normalizeRulesText("Line one.\\n\\nLine two.\r\n"), "Line one.\n\nLine two.");
  const blocks = parseRulesBlocks("Table: Costs\n| Item | Cost |\n|---|---|\n| Rope | 1 gp |");
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "table"]);
  assert.equal(blocks[1].rows.length, 3);
});

test("a hover preview is the first sentence with the markdown removed", () => {
  assert.equal(firstSentence("**Level 3.** *Form of the Beast.* You can transform. More text."), "Level 3.");
  assert.equal(firstSentence("**Cat's Claws.** You have claws. They hurt."), "Cat's Claws.");
  assert.equal(firstSentence("### Fighting Style \n \nYou adopt a style. Then more."), "Fighting Style You adopt a style.");
  assert.equal(firstSentence(""), null);
  assert.equal(firstSentence("x".repeat(200)).length, 160);
});

console.log(`\ntest-option-descriptions: ${passed} tests passed.`);
