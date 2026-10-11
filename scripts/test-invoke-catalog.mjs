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
import { readdirSync, readFileSync } from "node:fs";
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
  "src/lib/dm/encounter-tool-defs.ts",
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
  "src/lib/dm/resource-tool-defs.ts",
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
  "src/lib/dm/explore-tools.ts",
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
  // Lifting, lifestyles, downtime and afflictions: invoke-dispatch routes
  // EXPLORE_TOOL_NAMES to handleExploreCall before its switch.
  ...namedList("src/lib/dm/explore-tools.ts", "EXPLORE_TOOL_NAMES"),
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
      // Escaped quotes stay inside the string: a description that quotes
      // "thieves' tools" must not end it early and hide the keys after it.
      index += 1;
      while (index < objectText.length && objectText[index] !== char) {
        index += objectText[index] === "\\" ? 2 : 1;
      }
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    } else if (depth === 1 && objectText.startsWith("...", index)) {
      // A spread of a named object (...ZONE_ARGS) is kept by name so the
      // caller can read that object's own keys; anything else stays "...".
      const spread = /^\.\.\.([A-Za-z_][A-Za-z0-9_]*)\s*[,}\n]/.exec(objectText.slice(index));
      keys.push(spread ? `...${spread[1]}` : "...");
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
const DEFINITION_SOURCES = [
  ...TOOL_SOURCES,
  "src/lib/dm/pc-attack.ts",
  "src/lib/dm/map-tools.ts",
  // aoe_damage's definition moved here from encounter-tools-extra.ts, and
  // add_enemies is defined beside the spawner; both names are routed by the
  // lists above, so only their properties were unread.
  "src/lib/dm/aoe-damage-tool.ts",
  "src/lib/dm/encounter-spawn.ts",
];

// The keys of the object literal a spread names: declared in the same file,
// or imported from "@/..." and declared there. Null when it cannot be read,
// which leaves the tool open (unchecked) rather than wrongly checked.
function spreadKeys(name, source, depth = 0) {
  const declared = (text) => new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\b[^=]*=\\s*\\{`).exec(text);
  let text = source;
  let found = declared(text);
  if (!found) {
    const imported = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"@/([^"]+)"`).exec(source);
    if (!imported) {
      return null;
    }
    try {
      text = read(`src/${imported[1]}.ts`);
    } catch {
      return null;
    }
    found = declared(text);
  }
  if (!found) {
    return null;
  }
  const open = found.index + found[0].length - 1;
  return expandSpreads(topLevelKeys(text.slice(open, closingBrace(text, open) + 1)), text, depth + 1);
}

// A key list with every named spread replaced by the keys it brings.
function expandSpreads(keys, source, depth = 0) {
  const out = [];
  for (const key of keys) {
    if (!key.startsWith("...") || key === "...") {
      out.push(key);
      continue;
    }
    const inner = depth < 4 ? spreadKeys(key.slice(3), source, depth) : null;
    out.push(...(inner ?? ["..."]));
  }
  return out;
}

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
      const keys = expandSpreads(topLevelKeys(body.slice(open, closingBrace(body, open) + 1)), source);
      return { keys, open: keys.includes("...") };
    }
    // mutations.ts: tool("x", "description", { ...properties }, [required]),
    // every one of which also takes characterId.
    const helper = new RegExp(`^\\s*tool\\(\\s*\\n?\\s*"${name}"`, "m").exec(source);
    if (helper) {
      const open = source.indexOf("{", helper.index);
      const close = closingBrace(source, open);
      const keys = expandSpreads(topLevelKeys(source.slice(open, close + 1)), source);
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
    "action", "bonus", "characterId", "enemyId", "item", "level", "reason", "shove", "skill",
    "spell", "targetCharacterId", "targetEnemyId", "trigger",
  ]);
  assert.ok(toolProperties("apply_damage").keys.includes("amount"));
  assert.ok(toolProperties("apply_damage").keys.includes("characterId"));
  assert.ok(toolProperties("pc_attack").keys.includes("targetEnemyId"));
});

// The spell-area placement every area tool spreads in (src/lib/dm/zone-args.ts
// ZONE_ARGS): the scan used to stop at a spread and skip the tool, so these
// three forms could leave the four fields off unseen.
test("a tool's spread-in arguments are read like its own", () => {
  for (const name of ["use_spell_slot", "aoe_damage", "cast_at_enemy"]) {
    const found = toolProperties(name);
    assert.ok(found, `${name} has no readable definition`);
    assert.equal(found.open, false, `${name} still has a spread the scan cannot read`);
    for (const key of ["atX", "atY", "towardX", "towardY"]) {
      assert.ok(found.keys.includes(key), `${name} does not show ${key}`);
    }
  }
});

// Where a tool definition may live without the scan knowing: every engine
// file that defines one is read, except the Ask panel's own search tool,
// which the players' question box hands its model and no DM calls.
const NOT_A_DM_TOOL = new Set(["src/lib/dm/ask.ts"]);
test("every file that defines a tool is one the scan reads", () => {
  const unread = [];
  for (const file of readdirSync(path.join(root, "src/lib/dm"))) {
    const relative = `src/lib/dm/${file}`;
    if (!file.endsWith(".ts") || NOT_A_DM_TOOL.has(relative) || DEFINITION_SOURCES.includes(relative)) {
      continue;
    }
    if (/function:\s*\{\s*\n\s*name:\s*"[a-z_]+"/.test(read(relative))) {
      unread.push(relative);
    }
  }
  assert.deepEqual(unread, [], `tool definitions the drift checks never read: ${unread.join(", ")}`);
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

// ---- every field a handler offers has a place on its form ----
//
// The other direction of the drift above, and the one the second audit found
// open (U:UD1 to UD6): start_encounter had no lair switch, so a human DM could
// never run a lair action; take_rest had no hit dice to spend; aoe_damage
// could not name a player's spell. Each tool property the model may send is
// either a field on the form or named below with the reason a person does not
// need it.
const OMITTED_ON_PURPOSE = {
  // The console asks for one modifier as three flat fields (FOLDED_BY_THE_FACADE).
  set_effect: ["modifiers"],
  // update_sheet's form names one field and its value; the fold turns it into
  // any of these keys (src/lib/dm/update-sheet-args.ts).
  update_sheet: "*",
  // The roster is one text field the façade parses (parseRoster), so the
  // model's per-enemy object keys never appear as form fields.
  start_encounter: ["enemies"],
  // A person runs one character's downtime per form; the model may batch
  // several in activities, each with the same fields the form offers.
  downtime: ["activities"],
};

function formOmissions(entry) {
  const found = toolProperties(entry.name);
  if (!found || found.open) {
    return null;
  }
  const allowed = OMITTED_ON_PURPOSE[entry.name];
  if (allowed === "*") {
    return [];
  }
  const offered = new Set(entry.fields.map((field) => field.name));
  // What the façade folds from another name (enemyIds -> targetEnemyId) is
  // offered under that other name.
  const aliases = {
    cast_at_enemy: { targetEnemyId: "enemyIds" },
    cast_at_player: { characterId: "characterIds" },
  };
  // waypoint tags the AI DM's call with the [NOW] step it accomplishes; a
  // person's console call never ticks a step (src/lib/dm/waypoint-tick.ts),
  // the arc panel does, so no form offers it.
  return found.keys.filter(
    (key) =>
      key !== "..." &&
      key !== "reason" &&
      key !== "waypoint" &&
      !offered.has(key) &&
      !offered.has(aliases[entry.name]?.[key] ?? "") &&
      !(allowed ?? []).includes(key),
  );
}

test("every form offers every field its handler reads, or names why not", () => {
  const omitted = {};
  for (const entry of ADJUDICATIONS) {
    const missing = formOmissions(entry);
    if (missing?.length) {
      omitted[entry.name] = missing.sort();
    }
  }
  assert.deepEqual(omitted, {}, `forms that leave out a handler's field: ${JSON.stringify(omitted)}`);
});

// A form may not demand what the handler does without: aoe_damage's damage
// kept a player's Entangle (no damage at all) off the console, and
// cast_at_enemy's save kept a known spell from bringing its own.
const REQUIRED_BY_THE_FORM_ONLY = {
  // The façade folds the flat fields into modifiers (FOLDED_BY_THE_FACADE).
  set_effect: ["field"],
  // The handler refuses a move with no hands in it ("someone has to be
  // handing it over or taking it"), so the form asks up front.
  party_stash: ["characterId"],
  // The handler refuses downtime without a character and an activity unless
  // activities lists several; the form runs one character, so it asks.
  downtime: ["characterId", "activity"],
};

test("no form requires a field its handler leaves optional", () => {
  const over = {};
  for (const entry of ADJUDICATIONS) {
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
      const tolerated = REQUIRED_BY_THE_FORM_ONLY[entry.name] ?? [];
      const extra = entry.fields
        .filter((field) => field.required && !names.includes(field.name) && !tolerated.includes(field.name))
        .map((field) => field.name);
      if (extra.length) {
        over[entry.name] = extra;
      }
      break;
    }
  }
  assert.deepEqual(over, {}, `forms that require what the handler does not: ${JSON.stringify(over)}`);
});

// ---- fixed values are picked, not typed (U:UD4) ----

const vocab = await import("../src/lib/dm/catalog-vocab.ts");
const { DAMAGE_TYPES } = await import("../src/lib/dm/damage-logic.ts");

test("the damage types offered are exactly the engine's", () => {
  assert.deepEqual([...vocab.DAMAGE_TYPE_VALUES], DAMAGE_TYPES);
});

test("the conditions offered are the SRD conditions the monster kit enforces", () => {
  const kit = read("src/lib/bestiary/kit.ts");
  const block = /export const CONDITIONS = \[([^\]]*)\]/.exec(kit);
  assert.ok(block, "kit.ts CONDITIONS not found");
  const listed = [...block[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...vocab.CONDITION_VALUES], listed);
});

test("trap severity, object material and size, and skills match the handlers' enums", () => {
  const hazard = read("src/lib/dm/hazard-tools.ts");
  const severity = /SEVERITY_ENUM = \[([^\]]*)\]/.exec(hazard);
  assert.deepEqual(
    vocab.TRAP_SEVERITY_OPTIONS.map((option) => option.value),
    [...severity[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]),
  );
  const objects = read("src/lib/dm/object-damage.ts");
  const materials = /OBJECT_MATERIALS[^=]*= \[([^\]]*)\]/.exec(objects);
  assert.deepEqual([...vocab.OBJECT_MATERIAL_VALUES], [...materials[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]));
  const sizes = /OBJECT_SIZES[^=]*= \[([^\]]*)\]/.exec(objects);
  assert.deepEqual(
    vocab.OBJECT_SIZE_OPTIONS.map((option) => option.value),
    [...sizes[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]),
  );
  const skills = JSON.parse(read("src/lib/srd/skills.json")).skills.map((skill) => skill.id);
  assert.deepEqual(vocab.SKILL_OPTIONS.map((option) => option.value), skills);
});

// Field names the engine reads as a damage type, a condition or a trap's
// severity. None of them may be a text box on any form.
const DAMAGE_TYPE_FIELDS = new Set(["type", "damageType"]);
test("no form asks for a damage type, a condition or a severity as free text", () => {
  const typed = [];
  for (const entry of ADJUDICATIONS) {
    for (const field of entry.fields) {
      const isDamageType = DAMAGE_TYPE_FIELDS.has(field.name) && entry.name !== "apply_hazard" && entry.name !== "request_roll"
        ? true
        : field.name === "damageType";
      // apply_hazard's and request_roll's `type`/`kind` are not damage types.
      const damageTypeField = isDamageType && !(field.name === "type" && ["apply_hazard", "summon_pet", "set_npc"].includes(entry.name));
      const conditionField = field.name === "condition";
      const severityField = field.name === "severity";
      if ((damageTypeField || conditionField || severityField) && field.kind !== "select") {
        typed.push(`${entry.name}.${field.name}`);
      }
      if (damageTypeField && field.kind === "select") {
        assert.deepEqual(field.options.map((option) => option.value), [...vocab.DAMAGE_TYPE_VALUES], `${entry.name}.${field.name}`);
      }
    }
  }
  assert.deepEqual(typed, []);
});

// A homebrew damage type is legitimate: the handlers take any word and a
// resistance answers only the type it names (test-enforce-damage-types holds
// "sonic" and "fir" landing whole). So the damage type pick offers the SRD's
// thirteen first and takes another typed in, as the condition pick does.
test("a condition pick takes a story condition and a damage type pick a homebrew type", () => {
  const condition = adjudication("set_condition");
  assert.equal(checkArgs(condition, { characterId: "c1", condition: "soaked" }), null);
  const damage = adjudication("apply_damage");
  assert.ok(damage.fields.find((field) => field.name === "type").other, "the damage type pick has an 'other' entry");
  assert.equal(checkArgs(damage, { characterId: "c1", amount: 4, type: "sonic" }), null);
  // The delegated AI writes the type its own way; the handler reads it.
  assert.equal(checkArgs(damage, { characterId: "c1", amount: 4, type: "Fire damage" }), null);
});

test("multi-target forms pick creatures instead of typing ids (U:UD5)", () => {
  assert.equal(adjudication("aoe_damage").fields.find((field) => field.name === "enemyIds").kind, "enemies");
  assert.equal(adjudication("split_damage").fields.find((field) => field.name === "targets").kind, "shares");
  for (const name of ["move_token", "teleport_token", "set_movement"]) {
    assert.equal(adjudication(name).fields.find((field) => field.name === "tokenName").kind, "combatant", name);
  }
  const split = adjudication("split_damage");
  assert.equal(checkArgs(split, { amount: 9, targets: [{ enemyId: "e1", share: "half" }] }), null);
  assert.match(checkArgs(split, { amount: 9, targets: ["e1 half"] }), /list of rows/);
  const rest = adjudication("take_rest");
  assert.equal(checkArgs(rest, { kind: "short", spend: [{ characterId: "c1", dice: 2 }] }), null);
});

test("the lair switch, a player's area spell and chosen hit dice reach the console (U:UD1, UD2, UD6)", () => {
  const start = adjudication("start_encounter");
  assert.equal(start.fields.find((field) => field.name === "lair")?.kind, "boolean");
  const aoe = adjudication("aoe_damage");
  for (const name of ["casterId", "spell", "level", "casterEnemyId"]) {
    assert.ok(aoe.fields.some((field) => field.name === name), `aoe_damage.${name}`);
  }
  assert.equal(aoe.fields.find((field) => field.name === "damage").required, undefined);
  // A successful save halves by default, as the handler says; an unticked
  // box would send false and quietly take the half away.
  assert.equal(aoe.fields.find((field) => field.name === "halfOnSave").default, true);
  assert.equal(adjudication("take_rest").fields.find((field) => field.name === "spend")?.kind, "hitDice");
});

const { needsConfirm } = await import("../src/lib/dm/catalog-types.ts");

test("what cannot be taken back asks first (U:UD8)", () => {
  assert.ok(needsConfirm(adjudication("end_encounter"), {}));
  assert.ok(needsConfirm(adjudication("dismiss_companion"), { characterId: "c1" }));
  const ending = adjudication("relationship_end");
  assert.ok(needsConfirm(ending, { reason: "death" }));
  assert.equal(needsConfirm(ending, { reason: "parting" }), null);
  assert.equal(needsConfirm(adjudication("apply_damage"), {}), null);
});

const { describeAdjudicationResult } = await import("../src/lib/dm/catalog-result.ts");
const said = (result) => describeAdjudicationResult(result).map((line) => line.text);

test("a result shows hit points, resistance, temp HP absorbed and broken concentration (U:UD3)", () => {
  const lines = said({
    ok: true,
    hp: "3/30",
    resistance: "Tharn is resistant to fire",
    tempHpAbsorbed: 5,
    concentrationBroken: "Bless",
  });
  assert.ok(lines.includes("HP now 3/30"), lines.join(" | "));
  assert.ok(lines.includes("Tharn is resistant to fire"));
  assert.ok(lines.includes("Temporary hit points absorbed 5"));
  assert.ok(lines.includes("Concentration on Bless broken"));
  assert.equal(describeAdjudicationResult({ concentrationBroken: "Bless" })[0].tone, "bad");
  const held = said({ ok: true, hp: "20/30", concentration: { spell: "Bless", dc: 10, rolled: 14, held: true } });
  assert.ok(held.includes("Concentration on Bless: rolled 14 against DC 10, held"), held.join(" | "));
  const down = said({ ok: true, hp: "0/30", dropped: true, dying: "0 successes, 1 failure" });
  assert.ok(down.includes("Down at 0 HP"));
  assert.ok(down.includes("Dying: 0 successes, 1 failure"));
});

test("an area result reads one line per creature caught", () => {
  const lines = said({
    ok: true,
    spell: "Fireball",
    damageRolled: 28,
    results: [
      { target: "Goblin 1", save: 8, success: false, damage: 28, dead: true },
      { target: "Aldric", save: 17, success: true, damage: 14, hp: "20/34" },
    ],
  });
  assert.ok(lines.includes("28 damage"));
  assert.ok(lines.includes("Goblin 1: failed the save (8), 28 damage, dead"), lines.join(" | "));
  assert.ok(lines.includes("Aldric: made the save (17), 14 damage, HP 20/34"));
  assert.ok(lines.includes("Spell: Fireball"));
});

test("a spell's area and what a walk met read as the engine's own lines", () => {
  const cast = describeAdjudicationResult({ ok: true, area: "Web covers 16 squares around (12,2) for 1 hour: difficult terrain." });
  assert.deepEqual(cast, [{ text: "Web covers 16 squares around (12,2) for 1 hour: difficult terrain.", tone: "info" }]);
  const walked = describeAdjudicationResult({
    ok: true,
    zoneEffects: ["Spike Growth: 5 piercing to Goblin 1.", "It is held fast at (4,4)."],
    opportunityAttacks: ["Kael strikes as it leaves: 7 slashing."],
  });
  assert.deepEqual(walked.map((line) => line.text), [
    "Kael strikes as it leaves: 7 slashing.",
    "Spike Growth: 5 piercing to Goblin 1.",
    "It is held fast at (4,4).",
  ]);
  assert.ok(walked.every((line) => line.tone === "bad"));
});

// Prismatic Spray's rows (src/lib/dm/prismatic.ts) carry the rays each
// creature drew and what each did.
test("a Prismatic Spray result says each creature's rays and what they did", () => {
  const lines = said({
    ok: true,
    spell: "Prismatic Spray",
    results: [
      { target: "Ogre", save: 9, success: false, rays: ["red"], effects: ["red: 31 fire"] },
      { target: "Goblin 2", save: 15, success: true, rays: ["indigo", "violet"], effects: ["indigo: no effect", "violet: no effect"] },
    ],
  });
  assert.ok(lines.includes("Ogre: failed the save (9), ray red, red: 31 fire"), JSON.stringify(lines));
  assert.ok(lines.includes("Goblin 2: made the save (15), rays indigo, violet, indigo: no effect, violet: no effect"), JSON.stringify(lines));
});

// A summoning spell's creature and a shape spell's beast are picked from the
// engine's own form table, and anything else can still be typed.
test("cast_buff's choice offers the engine's summon and beast forms and still takes a typed choice", () => {
  const entry = adjudication("cast_buff");
  const variant = entry.fields.find((field) => field.name === "variant");
  assert.equal(variant.kind, "select");
  assert.ok(variant.other, "no typed choice for Enlarge/Reduce and the rest");
  const values = variant.options.map((option) => option.value);
  // Find Familiar's forms come from the familiar table (src/lib/srd/familiar-forms.ts).
  for (const form of ["wolf", "skeleton", "giant spider", "owl", "imp", "pseudodragon"]) {
    assert.ok(values.includes(form), `${form} is not offered`);
  }
  assert.equal(checkArgs(entry, { characterId: "c1", spell: "Enlarge/Reduce", variant: "enlarge" }), null);
});

test("a result with nothing to read is still a confirmation", () => {
  assert.deepEqual(said({ ok: true }), ["Done."]);
  assert.deepEqual(said(null), ["Done."]);
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
