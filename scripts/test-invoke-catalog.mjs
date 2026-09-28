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
  "src/lib/dm/legendary-tools.ts",
  "src/lib/dm/intent-tools.ts",
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
  "src/lib/dm/binder-tools.ts",
  "src/lib/dm/faction-tools.ts",
  "src/lib/dm/shop-tools.ts",
  "src/lib/dm/settlement-tools.ts",
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

// ---- every form sends the fields its handler reads ----
//
// A form whose field is called enemyId, in front of a handler that reads
// targetEnemyId, is refused as invalid arguments however it is filled in.
// So each catalog entry's field names are held against the property names
// of the tool definition the model is given, which is written beside the
// handler's own schema. Read textually, like everything above.

// The index of the brace that closes the one at `from`.
function closingBrace(source, from) {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index += 1;
      while (index < source.length && source[index] !== char) {
        index += source[index] === "\\" ? 2 : 1;
      }
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

// The keys written directly inside an object literal's braces. A spread at
// that level is reported as the key "..." since it brings names this scan
// cannot see.
function topLevelKeys(objectText) {
  const keys = [];
  let depth = 0;
  for (let index = 0; index < objectText.length; index += 1) {
    const char = objectText[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = objectText.indexOf(char, index + 1);
      index = end < 0 ? objectText.length : end;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    } else if (depth === 1 && objectText.startsWith("...", index)) {
      keys.push("...");
      index += 2;
    } else if (depth === 1 && /[A-Za-z_]/.test(char) && /[\s{,]/.test(objectText[index - 1] ?? " ")) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(objectText.slice(index));
      if (match) {
        keys.push(match[1]);
        index += match[0].length - 1;
      }
    }
  }
  return keys;
}

// The property names of one tool's parameters, or null when no source
// declares the tool with a literal properties object.
// Where tool definitions are written: the scan list above, and the two
// modules whose tools reach it by name only.
const DEFINITION_SOURCES = [...TOOL_SOURCES, "src/lib/dm/pc-attack.ts", "src/lib/dm/map-tools.ts"];

function toolProperties(name) {
  for (const relative of DEFINITION_SOURCES) {
    const source = read(relative);
    // A full definition: function: { name: "x", ... properties: { ... } }.
    const defined = new RegExp(`function:\\s*\\{\\s*\\n\\s*name:\\s*"${name}"`).exec(source);
    if (defined) {
      const end = closingBrace(source, source.indexOf("{", defined.index));
      const body = source.slice(defined.index, end + 1);
      const at = body.indexOf("properties:");
      if (at < 0) {
        continue;
      }
      const open = body.indexOf("{", at);
      const keys = topLevelKeys(body.slice(open, closingBrace(body, open) + 1));
      return { keys, open: keys.includes("...") };
    }
    // mutations.ts: tool("x", "description", { ...properties }, [required]),
    // every one of which also takes characterId.
    const helper = new RegExp(`^\\s*tool\\(\\s*\\n?\\s*"${name}"`, "m").exec(source);
    if (helper) {
      const open = source.indexOf("{", helper.index);
      const close = closingBrace(source, open);
      const keys = topLevelKeys(source.slice(open, close + 1));
      // characterProperty, which the helper spreads into every one of them.
      return { keys: ["characterId", "reason", ...keys], open: keys.includes("...") };
    }
  }
  return null;
}

// What the façade folds into the handler's shape before dispatch
// (src/lib/dm/invoke.ts normalizeArgs): the form's own names for them.
const FOLDED_BY_THE_FACADE = {
  set_effect: ["field", "mode", "value"],
};

// What a handler folds itself: update_sheet turns the form's one named field
// and its value into the sheet's own key (src/lib/dm/update-sheet-args.ts).
const FOLDED_BY_THE_HANDLER = {
  update_sheet: ["field", "value"],
};

// Fields only a person is offered: the handler reads them, and the model's
// tool definition leaves them out on purpose (who may see a roll or a quest,
// which handout to take down).
const FOR_A_PERSON_ONLY = {
  request_roll: ["visibility"],
  set_quest: ["visibility"],
  dismiss_handout: ["handoutId"],
};

function formDrift(entry) {
  const found = toolProperties(entry.name);
  if (!found || found.open) {
    return null;
  }
  const folded = [
    ...(FOLDED_BY_THE_FACADE[entry.name] ?? []),
    ...(FOLDED_BY_THE_HANDLER[entry.name] ?? []),
    ...(FOR_A_PERSON_ONLY[entry.name] ?? []),
  ];
  return entry.fields
    .map((field) => field.name)
    .filter((field) => !found.keys.includes(field) && !folded.includes(field));
}

const { COMBAT_ADJUDICATIONS } = await import("../src/lib/dm/catalog-combat.ts");
const COMBAT_NAMES = new Set(COMBAT_ADJUDICATIONS.map((entry) => entry.name));

test("the property scan reads the tools it is pointed at", () => {
  assert.deepEqual(toolProperties("take_action").keys.sort(), [
    "action", "characterId", "reason", "shove", "targetCharacterId", "targetEnemyId",
  ]);
  assert.ok(toolProperties("apply_damage").keys.includes("amount"));
  assert.ok(toolProperties("apply_damage").keys.includes("characterId"));
  assert.ok(toolProperties("pc_attack").keys.includes("targetEnemyId"));
});

test("every combat form sends only fields its handler reads", () => {
  const drift = {};
  for (const entry of COMBAT_ADJUDICATIONS) {
    const extra = formDrift(entry);
    if (extra === null) {
      continue;
    }
    if (extra.length) {
      drift[entry.name] = extra;
    }
  }
  assert.deepEqual(drift, {}, `forms sending fields no handler reads: ${JSON.stringify(drift)}`);
});

// What the model is told to send and the handler does without: end_encounter
// reads the outcome off the roster when none is given
// (src/lib/dm/encounter-logic.ts coerceEncounterOutcome).
const HANDLER_FILLS_IN = {
  end_encounter: ["outcome"],
};

test("every combat form offers what its handler requires", () => {
  const missing = {};
  for (const entry of COMBAT_ADJUDICATIONS) {
    for (const relative of DEFINITION_SOURCES) {
      const source = read(relative);
      const defined = new RegExp(`function:\\s*\\{\\s*\\n\\s*name:\\s*"${entry.name}"`).exec(source);
      if (!defined) {
        continue;
      }
      const end = closingBrace(source, source.indexOf("{", defined.index));
      // The last `required` in the definition is the tool's own; any before
      // it belong to the items of an array argument.
      const lists = [...source.slice(defined.index, end + 1).matchAll(/required:\s*\[([^\]]*)\]/g)];
      const required = lists.at(-1);
      const names = required ? [...required[1].matchAll(/"([A-Za-z_]+)"/g)].map((match) => match[1]) : [];
      const offered = entry.fields.filter((field) => field.required).map((field) => field.name);
      const tolerated = HANDLER_FILLS_IN[entry.name] ?? [];
      const absent = names.filter((name) => !offered.includes(name) && !tolerated.includes(name));
      if (absent.length) {
        missing[entry.name] = absent;
      }
    }
  }
  assert.deepEqual(missing, {}, `forms that do not require what the handler does: ${JSON.stringify(missing)}`);
});

// The catalogs outside combat are held to the same rule. What is listed here
// is the drift they carry today, entry by entry, so the list can only shrink:
// a form that is fixed has to come off it, and a new mismatch fails at once.
const KNOWN_FORM_DRIFT = {};

test("the other forms carry no drift beyond what is already recorded", () => {
  const drift = {};
  for (const entry of ADJUDICATIONS) {
    if (COMBAT_NAMES.has(entry.name)) {
      continue;
    }
    const extra = formDrift(entry);
    if (extra?.length) {
      drift[entry.name] = extra.sort();
    }
  }
  assert.deepEqual(drift, KNOWN_FORM_DRIFT);
});

// What the model must send and a person is asked for another way.
const REQUIRED_ANOTHER_WAY = {
  ...HANDLER_FILLS_IN,
  // The form's flat fields become the one modifier (FOLDED_BY_THE_FACADE).
  set_effect: ["modifiers"],
  // A checkbox is never missing: it starts ticked (CatalogField.default).
  move_party: ["visionClear"],
  update_location: ["visionClear"],
  // A slot burned with no spell named still spends (Divine Smite, ODM's
  // rule), so the console leaves the spell optional.
  use_spell_slot: ["spell"],
};

test("every other form requires what its handler requires", () => {
  const missing = {};
  for (const entry of ADJUDICATIONS) {
    if (COMBAT_NAMES.has(entry.name)) {
      continue;
    }
    const offered = entry.fields.filter((field) => field.required).map((field) => field.name);
    const tolerated = REQUIRED_ANOTHER_WAY[entry.name] ?? [];
    for (const relative of DEFINITION_SOURCES) {
      const source = read(relative);
      const defined = new RegExp(`function:\\s*\\{\\s*\\n\\s*name:\\s*"${entry.name}"`).exec(source);
      if (!defined) {
        continue;
      }
      const end = closingBrace(source, source.indexOf("{", defined.index));
      const lists = [...source.slice(defined.index, end + 1).matchAll(/required:\s*\[([^\]]*)\]/g)];
      const required = lists.at(-1);
      const names = required ? [...required[1].matchAll(/"([A-Za-z_]+)"/g)].map((match) => match[1]) : [];
      const absent = names.filter((name) => !offered.includes(name) && !tolerated.includes(name));
      if (absent.length) {
        missing[entry.name] = absent;
      }
    }
  }
  assert.deepEqual(missing, {}, `forms that do not require what the handler does: ${JSON.stringify(missing)}`);
});

const { foldFieldValue, UPDATE_SHEET_FIELDS } = await import("../src/lib/dm/update-sheet-args.ts");
const SCORES = { str: 10, dex: 12, con: 14, int: 8, wis: 13, cha: 15 };

test("Correct a sheet turns a named field and its value into the sheet's own key", () => {
  assert.deepEqual(foldFieldValue({ field: "level", value: "5" }, SCORES), { args: { level: 5 } });
  assert.deepEqual(foldFieldValue({ field: "alignment", value: " LG " }, SCORES), { args: { alignment: "LG" } });
  assert.deepEqual(foldFieldValue({ field: "Max HP", value: 40 }, SCORES), { args: { maxHp: 40 } });
  assert.deepEqual(foldFieldValue({ field: "hp", value: "1,000" }, SCORES), { args: { currentHp: 1000 } });
  assert.deepEqual(foldFieldValue({ field: "str", value: "16" }, SCORES), {
    args: { abilities: { ...SCORES, str: 16 } },
  });
  assert.deepEqual(foldFieldValue({ field: "conditions", value: "poisoned, prone" }, SCORES), {
    args: { conditions: ["poisoned", "prone"] },
  });
  assert.deepEqual(foldFieldValue({ field: "conditions", value: "none" }, SCORES), { args: { conditions: [] } });
  // The model's own keys pass through, and win over the pair beside them.
  assert.deepEqual(foldFieldValue({ level: 3, gold: 10 }, SCORES), { args: { level: 3, gold: 10 } });
  assert.deepEqual(foldFieldValue({ field: "level", value: 9, level: 4 }, SCORES), { args: { level: 4 } });
  // What cannot be read is refused, never guessed.
  assert.match(foldFieldValue({ field: "shoe size", value: 9 }, SCORES).error, /no field called/);
  assert.match(foldFieldValue({ field: "level", value: "five" }, SCORES).error, /whole number/);
  assert.match(foldFieldValue({ field: "level", value: "4.5" }, SCORES).error, /whole number/);
  assert.match(foldFieldValue({ field: "level" }, SCORES).error, /becomes/);
  // Every field the form offers is one the fold knows.
  for (const field of UPDATE_SHEET_FIELDS) {
    const value = field.kind === "text" ? "x" : field.kind === "list" ? "prone" : "3";
    assert.ok("args" in foldFieldValue({ field: field.name, value }, SCORES), field.name);
  }
});

console.log(`invoke-catalog: ${passed} tests passed`);
