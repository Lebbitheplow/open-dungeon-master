// The character builder's first batch of quick wins (Q1, Q2, Q3, Q10, Q13 in
// the 2026-10-16 backlog), each checked where it would regress: the gates'
// own words, the stepper's markup, the door's query, and the source lines a
// reader depends on. No server.
import assert from "node:assert/strict";
import fs from "node:fs";

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

// A Windows checkout may carry CRLF line endings; the patterns below expect LF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const submit = await import("../src/app/characters/builder/submit.ts");
const { owedPicks } = await import("../src/app/characters/builder/owed.ts");

const state = {
  name: "Vex",
  backgroundSkills: [],
  bonusLanguages: [],
  racialAsi: [],
  racialSkills: [],
  racialTool: "",
  racialCantrip: "",
  feats: [],
  repeatSkills: [],
};

// Q1. No background stands in before one is picked: the first step owes it,
// and nothing on the page falls back to the list's first row (an Acolyte,
// who owed two languages nobody asked for).
{
  const owed = submit.identityBlocks(state, undefined);
  assert.deepEqual(owed.map((entry) => entry.target), ["background"]);
  assert.match(owed[0].message, /did before adventuring \(background\)/);
  assert.equal(submit.identityBlocker(state, { id: "soldier", name: "Soldier", skills: [] }), null);
  // An unpicked background owes no languages on the next step.
  assert.equal(submit.bonusLanguageCount({ bonusLanguages: 0 }, undefined), 0);

  const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
  assert.ok(!builder.includes("?? backgrounds[0]"), "the builder shows the first background as if picked");
  const builderState = read("src/app/characters/builder/useBuilderState.ts");
  assert.ok(!builderState.includes("background: background ?? backgrounds[0]"), "the picks are reconciled against a background nobody chose");
  const { unofferedPicks } = await import("../src/app/characters/builder/unoffered.ts");
  const missing = unofferedPicks(
    { race: "human", class: "fighter", background: "table-gravedigger" },
    { raceId: "human", classId: "fighter", backgroundId: "table-gravedigger" },
    [{ id: "human" }],
    [{ id: "fighter" }],
    [{ id: "acolyte", name: "Acolyte" }],
  );
  assert.deepEqual(missing, [{ what: "background (table gravedigger)" }], "an unoffered background names no stand-in");
  console.log("ok: the background is empty until chosen (Q1)");
}

// Q2. Each step is named for its task in the heading and by a short name on
// the stepper, printed under its diamond; the current diamond stays
// focusable, and the name a screen reader hears is the printed one.
{
  const { DiamondStepper } = await import("../src/components/ui/DiamondStepper.tsx");
  const steps = [
    { key: "identity", label: "Hero" },
    { key: "ancestry", label: "Ancestry" },
    { key: "calling", label: "Class" },
  ];
  const markup = renderToStaticMarkup(createElement(DiamondStepper, { steps, current: 1, onSelect: () => {}, named: true }));
  const names = [...markup.matchAll(/<span aria-hidden="true" data-diamond-name=""[^>]*>([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(names, ["Hero", "Ancestry", "Class"], "each name is printed under its diamond");
  const buttons = [...markup.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
  assert.equal(buttons.length, 3);
  assert.ok(!buttons[0].includes("disabled"), "a done diamond goes back");
  assert.ok(!buttons[1].includes("disabled"), "the current diamond stays focusable");
  assert.ok(buttons[1].includes('aria-current="step"') && buttons[1].includes('aria-label="Step 2: Ancestry"'), "the current diamond says where the player is");
  assert.ok(buttons[2].includes("disabled"), "a diamond ahead stays inert");
  assert.ok(buttons[2].includes('aria-label="Step 3: Class"'), "the spoken name is the printed one");

  const unnamed = renderToStaticMarkup(createElement(DiamondStepper, { steps, current: 0 }));
  assert.ok(!unnamed.includes("data-diamond-name"), "a wizard that does not ask for names prints none");

  const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
  const labelled = [...builder.matchAll(/^\s+label: "([^"]+)",\n\s+title: "([^"]+)",/gm)].map((match) => [match[1], match[2]]);
  assert.deepEqual(labelled, [
    ["Hero", "Name your hero and choose their past"],
    ["Ancestry", "Choose where your hero comes from"],
    ["Class", "Choose how you fight or use magic"],
    ["Abilities", "Set what your hero is good at"],
    ["Finish", "Check your hero and finish"],
  ]);
  assert.ok(builder.includes('label: casts ? "Spells" : "Gear"') && builder.includes('title: casts ? "Choose spells and gear" : "Choose your gear"'));
  assert.ok(/variant="diamonds"\s+stepNames/.test(builder), "the builder prints its step names");
  for (const file of ["src/app/characters/builder/steps/IdentityStep.tsx", "src/app/characters/builder/BackgroundKitSection.tsx"]) {
    assert.ok(!read(file).includes("Calling step"), `${file} still sends the player to the Calling step`);
  }
  console.log("ok: steps are tasks, named under their diamonds (Q2)");
}

// Q3. A held Continue says the task, with the rule word in brackets for a
// veteran; the "choices left" line keeps the rule word as its link.
{
  const dwarf = { id: "hill_dwarf", name: "Hill Dwarf", toolChoice: { count: 1, options: ["Smith's tools"] }, skills: [], asi: {} };
  const owed = submit.ancestryBlocks(state, dwarf, { id: "soldier", name: "Soldier", skills: [] });
  assert.deepEqual(owed.map((entry) => entry.message), ["Pick a tool your Hill Dwarf knows how to use (tool proficiency)."]);
  assert.deepEqual(owedPicks(owed).map((pick) => pick.label), ["Tool"], "the Show me link keeps the rule's name");
  assert.equal(submit.ancestryBlocks(state, undefined)[0].message, "Choose where your hero comes from (race).");
  assert.equal(submit.callingBlocks(undefined)[0].message, "Choose how you fight or use magic (class).");

  const derived = {
    toolGrants: { choices: [{ label: "musical instrument" }], left: [2] },
    effectiveLevel: 1,
    subclassTraining: [],
    styleSlots: 1,
    optionSlots: [],
    proficientSkills: [],
  };
  const fighter = { id: "fighter", name: "Fighter", skillChoices: { count: 2 } };
  const calling = submit.callingBlocks(fighter, { ...state, chosenSkills: [], stylePicks: [], expertisePicks: [], subclass: "" }, derived);
  assert.deepEqual(calling.map((entry) => entry.message), [
    "Pick 2 more skills your training taught you (class skills).",
    "Pick 2 more musical instruments you know how to use (tool proficiency).",
    "Pick how you like to fight (fighting style).",
  ]);
  // No message still leads with the rule's word alone.
  const source = read("src/app/characters/builder/submit.ts");
  for (const old of ["tool proficiency first", "skill proficiencies first", "cantrip first", "for your tool proficiency", "ability score improvement first"]) {
    assert.ok(!source.includes(old), `a blocker still says "${old}"`);
  }
  console.log("ok: Continue blockers say the task in plain words (Q3)");
}

// Q10. The Finish portrait is named for the hero, as the roster names it.
{
  const finish = read("src/app/characters/builder/steps/FinishStep.tsx");
  assert.ok(!finish.includes('alt="Character portrait"'), "the portrait is still just a character portrait");
  assert.ok(finish.includes("alt={state.name.trim() ||"), "the portrait's alt is the hero's name");
  console.log("ok: the Finish portrait is named for the hero (Q10)");
}

// Q13. The door decides: a link that knows the role or the level says so,
// and the builder asks only for what it leaves open.
{
  const { readBuilderDoor, newCharacterHref } = await import("../src/app/characters/builder/door.ts");
  const door = (query) => readBuilderDoor(new URLSearchParams(query));
  assert.deepEqual(door(""), {}, "plain /characters/new knows nothing and asks for both");
  assert.deepEqual(door("as=pc"), { role: "pc" });
  assert.deepEqual(door("as=companion"), { role: "companion" });
  assert.deepEqual(door("as=dm&level=0"), {}, "an unknown role or level is ignored");
  assert.deepEqual(door("level=21"), {});
  assert.deepEqual(door("as=pc&level=5&from=party"), { role: "pc", level: 5, levelNote: "The party is built for level 5." });
  assert.deepEqual(door("level=3&from=elsewhere"), { level: 3 });

  assert.equal(newCharacterHref(), "/characters/new");
  assert.equal(newCharacterHref({ role: "pc", level: 4, from: "party" }), "/characters/new?as=pc&level=4&from=party");
  assert.deepEqual(readBuilderDoor(new URL(newCharacterHref({ role: "pc", level: 4, from: "party" }), "http://x").searchParams), {
    role: "pc",
    level: 4,
    levelNote: "The party is built for level 4.",
  });

  const page = read("src/app/characters/new/page.tsx");
  assert.ok(page.includes("role={door.role ? undefined : { value: role, onChange: setRole }}"), "the role toggle shows only when the door did not say");
  assert.ok(page.includes("startLevel={door.level}"), "the builder opens at the door's level");
  assert.ok(page.includes("<Suspense"), "useSearchParams needs a Suspense boundary");
  const party = read("src/app/workshop/party/PartyPanel.tsx");
  assert.ok(party.includes('newCharacterHref({ role: "pc", level: targetParty.level, from: "party" })'), "the Party tool's door says what it knows");
  const builderState = read("src/app/characters/builder/useBuilderState.ts");
  assert.ok(builderState.includes(": (startLevel ?? 1)"), "a new character opens at the door's level");
  console.log("ok: each door sets what it already knows (Q13)");

  // Albert's call: plain "New character" starts a player character, and
  // the toggle waits on the Finish step with its explanation.
  assert.ok(page.includes('useState<"pc" | "companion">(door.role ?? "pc")'), "a new character starts as a player character");
  const identity = read("src/app/characters/builder/steps/IdentityStep.tsx");
  assert.ok(!identity.includes("Their place at the table"), "the Hero step no longer asks who plays them");
  assert.ok(!identity.includes("role?:"), "the Hero step takes no role");
  const finish = read("src/app/characters/builder/steps/FinishStep.tsx");
  assert.ok(finish.includes("Their place at the table"), "the Finish step asks who plays them");
  assert.ok(finish.includes("Joins a campaign as yours to control."), "the player character choice is explained");
  assert.ok(finish.includes("Nobody has to roll them up again."), "the companion choice is explained");
  const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
  assert.ok(/<FinishStep[\s\S]*?role=\{role\}[\s\S]*?\/>/.test(builder), "the builder hands the role to the Finish step");
  assert.ok(!builder.match(/<IdentityStep[\s\S]*?\/>/)[0].includes("role={role}"), "and not to the Hero step");
  console.log("ok: the role toggle waits on the Finish step (Q13)");
}
