// The drift guard between the two callers of the engine.
//
// The AI DM reaches the rules engine through tool calls; a human DM reaches
// it through the console, which renders itself from the adjudication
// catalog. A tool added for the model and not added to the catalog leaves a
// person unable to do something the machine can, which is the one failure
// human-DM mode exists to prevent. This test reads the tool names out of the
// source TEXTUALLY rather than importing the tool modules, because those
// modules pull in the database layer and this check has no business opening
// one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const { ADJUDICATIONS, ADJUDICATION_NAMES, adjudication, checkArgs, consoleAdjudications } =
  await import("../src/lib/dm/invoke-catalog.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Every `_TOOL_NAMES = [...]` array and every `name: "..."` inside a tool
// definition the model is handed.
function toolNamesIn(relative) {
  const source = read(relative);
  const names = new Set();
  for (const match of source.matchAll(/TOOL_NAMES\s*=\s*(?:new Set\()?\[([^\]]*)\]/g)) {
    for (const quoted of match[1].matchAll(/"([a-z_]+)"/g)) {
      names.add(quoted[1]);
    }
  }
  // Tool definitions: `name: "x"` on the line after `function: {`.
  for (const match of source.matchAll(/function:\s*\{\s*\n\s*name:\s*"([a-z_]+)"/g)) {
    names.add(match[1]);
  }
  // The `tool("name", ...)` helper mutations.ts builds its list with.
  for (const match of source.matchAll(/^\s*tool\(\s*\n?\s*"([a-z_]+)"/gm)) {
    names.add(match[1]);
  }
  return names;
}

const TOOL_SOURCES = [
  "src/lib/dm/mutations.ts",
  "src/lib/dm/encounter-tools.ts",
  "src/lib/dm/encounter-tools-extra.ts",
  "src/lib/dm/action-tools.ts",
  "src/lib/dm/check-tools.ts",
  "src/lib/dm/hazard-tools.ts",
  "src/lib/dm/rest-tools.ts",
  "src/lib/dm/pet-tools.ts",
  "src/lib/dm/social-tools.ts",
  "src/lib/dm/relationship-tools.ts",
  "src/lib/dm/world-tools.ts",
  "src/lib/dm/party-tools.ts",
  "src/lib/dm/effect-tools.ts",
  "src/lib/dm/scene-tools.ts",
  "src/lib/dm/ambience-tools.ts",
  "src/lib/dm/mount-tools.ts",
  "src/lib/dm/resource-tools.ts",
  "src/lib/dm/companion-tools.ts",
  "src/lib/dm/cast-tools.ts",
  "src/lib/dm/prompt.ts",
  "src/lib/dm/note-tools.ts",
  "src/lib/dm/lore-search.ts",
  "src/lib/dm/split-damage.ts",
  "src/lib/image-tool.ts",
];

const aiToolNames = new Set();
for (const source of TOOL_SOURCES) {
  for (const name of toolNamesIn(source)) {
    aiToolNames.add(name);
  }
}

// The two name sets invoke-dispatch routes on before it reaches its switch,
// read out of their own declarations. ENCOUNTER_TOOL_NAMES spreads two more
// lists, so those are read too.
function namedList(relative, constName) {
  const match = new RegExp(`${constName}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(read(relative));
  const names = match ? [...match[1].matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1]) : [];
  // A regex that quietly matched nothing would make the dispatch check below
  // pass for the wrong reason.
  assert.ok(names.length > 0, `found no names in ${constName}`);
  return names;
}

const routedBySet = new Set([
  ...namedList("src/lib/dm/mutations.ts", "MUTATION_TOOL_NAMES"),
  ...namedList("src/lib/dm/encounter-tools.ts", "ENCOUNTER_TOOL_NAMES"),
  ...namedList("src/lib/dm/encounter-tools-extra.ts", "EXTRA_ENCOUNTER_TOOL_NAMES"),
  ...namedList("src/lib/dm/action-tools.ts", "ACTION_TOOL_NAMES"),
]);

test("the tool scan actually found the tools", () => {
  // A regex that quietly matches nothing would make every check below pass.
  assert.ok(aiToolNames.size > 40, `only found ${aiToolNames.size} tool names`);
  for (const anchor of ["apply_damage", "pc_attack", "request_roll", "send_whisper"]) {
    assert.ok(aiToolNames.has(anchor), `scan missed ${anchor}`);
  }
});

test("every tool the model is offered has a catalog entry", () => {
  const missing = [...aiToolNames].filter((name) => !ADJUDICATION_NAMES.includes(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `these tools exist for the AI DM but not for a human one: ${missing.join(", ")}`,
  );
});

test("no catalog entry invents an action the engine cannot perform", () => {
  const unknown = ADJUDICATION_NAMES.filter((name) => !aiToolNames.has(name)).sort();
  assert.deepEqual(unknown, [], `catalog lists actions no handler answers: ${unknown.join(", ")}`);
});

test("names are unique", () => {
  assert.equal(new Set(ADJUDICATION_NAMES).size, ADJUDICATION_NAMES.length);
});

test("every entry is renderable", () => {
  for (const entry of ADJUDICATIONS) {
    assert.ok(entry.label, `${entry.name} has no label`);
    assert.ok(entry.summary, `${entry.name} has no summary`);
    assert.ok(entry.category, `${entry.name} has no category`);
    // Every entry is offered as a form, so every entry needs fields.
    assert.ok(entry.fields.length > 0, `${entry.name} is offered with no fields`);
    const fieldNames = entry.fields.map((field) => field.name);
    assert.equal(new Set(fieldNames).size, fieldNames.length, `${entry.name} repeats a field`);
    for (const field of entry.fields) {
      assert.ok(field.label, `${entry.name}.${field.name} has no label`);
      if (field.kind === "select") {
        assert.ok(field.options?.length, `${entry.name}.${field.name} is a select with no options`);
      }
    }
  }
});

test("lookup finds an entry and refuses an unknown one", () => {
  assert.equal(adjudication("apply_damage")?.category, "party");
  assert.equal(adjudication("no_such_tool"), null);
  assert.equal(adjudication(""), null);
});

test("the pre-flight check catches what a form can get wrong", () => {
  const damage = adjudication("apply_damage");
  assert.match(checkArgs(damage, {}), /needs character/i);
  assert.match(
    checkArgs(damage, { characterId: "c1" }),
    /needs damage/i,
  );
  assert.equal(checkArgs(damage, { characterId: "c1", amount: 6 }), null);
  assert.match(
    checkArgs(damage, { characterId: "c1", amount: "six" }),
    /must be a number/,
  );
});

test("a select refuses a value outside its options", () => {
  const action = adjudication("take_action");
  assert.match(
    checkArgs(action, { characterId: "c1", action: "somersault" }),
    /must be one of/,
  );
  assert.equal(checkArgs(action, { characterId: "c1", action: "dodge" }), null);
});

test("the console offers every entry exactly once", () => {
  // Not "every visible entry": nothing is hidden. If the engine can do it,
  // the person running the table can reach it.
  const groups = consoleAdjudications();
  const listed = groups.flatMap((group) => group.entries.map((entry) => entry.name));
  assert.deepEqual(listed.slice().sort(), ADJUDICATION_NAMES.slice().sort());
  assert.equal(new Set(listed).size, listed.length);
});

test("every catalog entry reaches a handler through the façade", () => {
  // The other direction of the same promise, and the one that was actually
  // broken: request_player_input and generate_image sat in the catalog, and
  // were offered as console forms, with no arm in the dispatcher to answer
  // them. A button that can only ever return "the engine has no action called
  // that" is worse than a missing button, because nothing looks wrong.
  //
  // Read textually for the same reason as the tool lists above: importing
  // invoke-dispatch pulls in the whole engine and opens a database.
  const cases = new Set(
    [...read("src/lib/dm/invoke-dispatch.ts").matchAll(/case "([a-z_]+)":/g)].map(
      (match) => match[1],
    ),
  );
  const dispatchable = new Set([...routedBySet, ...cases]);
  const orphans = ADJUDICATION_NAMES.filter((name) => !dispatchable.has(name)).sort();
  assert.deepEqual(orphans, [], `catalog entries with no dispatch arm: ${orphans.join(", ")}`);
});

console.log(`invoke-catalog: ${passed} tests passed`);
