// The event log's list and its "Revert this turn" (src/app/campaigns/
// [campaignId]/event-log-logic.ts), issue #622: a turn that moved the clock
// is offered back even with fewer than two sheet changes (an undo of one
// change never moves the clock back), its time is listed where it fell, and
// a run of changes that only counted time down reads as one line. A host
// that sends no clock turns keeps the old rule. Every kind of change the
// server writes reads as words, never as its raw id.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import ts from "typescript";

register("./lib/register-alias.mjs", import.meta.url);

const { BOOKKEEPING_KINDS, buildFeed, describeAuditEntry, describeKnownEntry, revertableTurns, turnOfItem } = await import(
  "../src/app/campaigns/[campaignId]/event-log-logic.ts"
);
const { changesWindow, quietTick, undoConflictLine, fieldWords } = await import("../src/lib/sheet-audit-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

let seq = 0;
function entry(turnId, kind = "apply_damage", delta = {}, extra = {}) {
  seq += 1;
  return {
    id: `a${seq}`,
    campaignId: "c",
    characterId: "kara",
    characterName: "Kara",
    turnId,
    actor: "dm",
    kind,
    delta,
    reason: "",
    seq,
    createdAt: "",
    undoable: true,
    patchKeys: [],
    revertedBy: null,
    revertedAt: null,
    ...extra,
  };
}

test("without clock turns the old rule holds: two live changes offer the turn back, one does not", () => {
  const log = [entry("t1"), entry("t1"), entry("t2")];
  assert.deepEqual([...revertableTurns(log)], [["t1", 2]]);
  assert.deepEqual([...revertableTurns(log, [])], [["t1", 2]]);
});

test("a turn that moved the clock is offered back with one sheet change, or with none", () => {
  const log = [entry("t1"), entry("t2", "death_state")];
  const clock = [
    { turnId: "t2", seq: 50, passed: "8 hours" },
    { turnId: "t3", seq: 60, passed: "2 hours" },
  ];
  const turns = revertableTurns(log, clock);
  assert.equal(turns.has("t1"), false, "a lone change with no time moved is the single undo's");
  assert.equal(turns.get("t2"), 1);
  assert.equal(turns.get("t3"), 0, "a turn that only moved the clock cannot be put back from the log");
});

test("undone changes and undo rows do not count toward a turn's revert", () => {
  const log = [entry("t1"), entry("t1", "apply_damage", {}, { revertedAt: "x" }), entry("t1", "undo")];
  assert.equal(revertableTurns(log).has("t1"), false);
});

test("the time a turn moved on is listed where it fell, and belongs to that turn", () => {
  seq = 0;
  const log = [entry("t1"), entry("t1")];
  const feed = buildFeed(log, [], [{ turnId: "t9", seq: 2, passed: "3 hours" }]);
  assert.deepEqual(feed.map((item) => item.type), ["audit", "time", "audit"]);
  assert.equal(turnOfItem(feed[1]), "t9");
});

test("a run of one turn's quiet ticks folds into one line; changes that end or add a condition stay their own", () => {
  seq = 0;
  const log = [
    entry("t1", "condition_clock", { ended: [], added: [] }),
    entry("t1", "concentration_clock", { spell: "Bless", roundsLeft: 9 }),
    entry("t1", "condition_clock", { ended: ["poisoned"], added: [] }),
    entry("t2", "condition_clock", { ended: [], added: [] }),
    entry("t2", "condition_clock", { ended: [], added: [] }),
  ];
  assert.equal(quietTick(log[0]), true);
  assert.equal(quietTick(log[1]), true);
  assert.equal(quietTick(log[2]), false);
  const feed = buildFeed(log, []);
  assert.deepEqual(
    feed.map((item) => (item.type === "ticks" ? `ticks:${item.turnId}:${item.entries.length}` : item.type)),
    ["ticks:t2:2", "audit", "ticks:t1:2"],
  );
  assert.equal(turnOfItem(feed[0]), "t2");
  // Folded ticks still count toward the turn's revert.
  assert.equal(revertableTurns(log).get("t2"), 2);
});

test("a window of recent changes counts real changes only: the ticks among them ride along, older ones go, and the whole is bounded", () => {
  seq = 0;
  const log = [];
  for (let n = 0; n < 5; n += 1) log.push(entry("t0", "condition_clock", { ended: [], added: [] }));
  for (let n = 0; n < 60; n += 1) {
    log.push(entry("t1"));
    log.push(entry("t1", "concentration_clock", { spell: "Bless", roundsLeft: 9 }));
  }
  for (let n = 0; n < 300; n += 1) log.push(entry("t2", "condition_clock", { ended: [], added: [] }));
  const window = changesWindow(log, 50);
  assert.equal(window.filter((row) => !quietTick(row)).length, 50, "the window does not hold fifty changes");
  assert.equal(window[0].kind, "apply_damage", "the window opens before its oldest change");
  // Fifty changes, the tick after each, and the three hundred after the last.
  assert.equal(window.length, 50 + 50 + 300, "a tick among the changes, or after them, was dropped");
  assert.deepEqual(changesWindow(log.slice(0, 7), 50), log.slice(0, 7), "a short log is kept whole");
  assert.equal(changesWindow(log, 50, 100).length, 100, "the bound on the whole did not hold");
  assert.equal(changesWindow(log, 50, 100).at(-1), log.at(-1), "the bound kept the oldest rows, not the newest");
});

// ---- every kind the server writes, found in src ----
//
// The audit rows reach the table through a handful of writers:
// insertSheetAudit and patchSheetAudited take the kind in an object, and
// helpers around them (writeDeathState, saveEquipment, writeCharges, a file's
// own audit() or write()) take it as an argument and pass it on. The scan
// starts from the two and follows a kind that is a parameter back to its
// function, which becomes a writer too, until no new writer turns up; then
// it reads the kind at every call of every writer. A kind it cannot read
// (built from text, read from a row) fails the test, so a new writer is seen
// rather than skipped.

const srcRoot = path.join(import.meta.dirname, "..", "src");

function* sourceFiles(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.tsx?$/.test(item.name) && !item.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

function functionName(fn) {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  if (fn.parent && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
  return null;
}

// The variable a name refers to: the nearest declaration of it in an
// enclosing scope, a parameter, or a module constant.
function declarationOf(identifier) {
  const name = identifier.text;
  for (let at = identifier.parent; at; at = at.parent) {
    if (ts.isFunctionLike(at)) {
      const index = at.parameters.findIndex((param) => ts.isIdentifier(param.name) && param.name.text === name);
      if (index >= 0) return { param: at, index };
    }
    if (ts.isBlock(at) || ts.isSourceFile(at) || ts.isCaseClause(at)) {
      for (const statement of at.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) return { init: decl.initializer };
        }
      }
    }
  }
  return null;
}

// What a kind expression can hold: literal kinds, or a parameter of the
// function it sits in (a new writer), or nothing readable.
function readKind(expr) {
  while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) expr = expr.expression;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { kinds: [expr.text] };
  if (ts.isConditionalExpression(expr)) {
    const a = readKind(expr.whenTrue);
    const b = readKind(expr.whenFalse);
    if (a.kinds && b.kinds) return { kinds: [...a.kinds, ...b.kinds] };
    return a.kinds ? b : a;
  }
  if (ts.isIdentifier(expr)) {
    const decl = declarationOf(expr);
    if (decl?.init) return readKind(decl.init);
    if (decl?.param) return { writer: decl.param, at: decl.index, inObject: false };
  }
  // record.kind, with record a parameter: the function takes the kind in
  // an object, as insertSheetAudit does.
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "kind" && ts.isIdentifier(expr.expression)) {
    const decl = declarationOf(expr.expression);
    if (decl?.param) return { writer: decl.param, at: decl.index, inObject: true };
  }
  return {};
}

// The object literals an argument can be (`ok ? { kind: "a" } : { kind:
// "b" }`), with null for one the scan cannot see into.
function objectsOf(expr) {
  while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) expr = expr.expression;
  if (ts.isObjectLiteralExpression(expr)) return [expr];
  if (ts.isConditionalExpression(expr)) return [...objectsOf(expr.whenTrue), ...objectsOf(expr.whenFalse)];
  if (ts.isIdentifier(expr)) {
    const decl = declarationOf(expr);
    if (decl?.init) return objectsOf(decl.init);
  }
  return [null];
}

function importsOf(sf) {
  const names = new Map();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
    const bindings = statement.importClause.namedBindings;
    if (!ts.isNamedImports(bindings)) continue;
    const from = path.basename(statement.moduleSpecifier.text);
    for (const spec of bindings.elements) {
      names.set(spec.name.text, { from, original: (spec.propertyName ?? spec.name).text });
    }
  }
  return names;
}

function scanAuditKinds() {
  const files = [...sourceFiles(srcRoot)].map((file) => {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return { file: path.relative(srcRoot, file), base: path.basename(file).replace(/\.tsx?$/, ""), sf, imports: importsOf(sf) };
  });
  // A writer: where its kind is (argument index, or inside the object at
  // that index), and the file that defines it.
  const writers = new Map([
    ["lib/db/sheet-audit.ts#insertSheetAudit", { name: "insertSheetAudit", base: "sheet-audit", at: 0, inObject: true }],
    ["lib/dm/audited-patch.ts#patchSheetAudited", { name: "patchSheetAudited", base: "audited-patch", at: 3, inObject: true }],
  ]);
  const writerFor = (call, file) => {
    if (!ts.isIdentifier(call.expression)) return null;
    const local = call.expression.text;
    const imported = file.imports.get(local);
    for (const writer of writers.values()) {
      if (imported ? imported.original === writer.name && imported.from === writer.base : local === writer.name && file.base === writer.base) {
        return writer;
      }
    }
    return null;
  };
  const kinds = new Map();
  let unread = [];
  for (let grew = true; grew; ) {
    grew = false;
    kinds.clear();
    unread = [];
    for (const file of files) {
      const visit = (node) => {
        if (ts.isCallExpression(node)) {
          const writer = writerFor(node, file);
          const arg = writer ? node.arguments[writer.at] : null;
          let exprs = [];
          if (arg && writer.inObject) {
            for (const object of objectsOf(arg)) {
              if (!object) {
                exprs.push(null);
                continue;
              }
              for (const prop of object.properties) {
                if (ts.isPropertyAssignment(prop) && prop.name.getText(file.sf) === "kind") exprs.push(prop.initializer);
                if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "kind") exprs.push(prop.name);
              }
            }
          } else if (writer) {
            exprs.push(arg ?? null);
          }
          for (const expr of exprs) {
            const where = `${file.file}:${file.sf.getLineAndCharacterOfPosition(node.getStart(file.sf)).line + 1}`;
            const read = expr ? readKind(expr) : {};
            if (read.kinds) {
              for (const kind of read.kinds) kinds.set(kind, [...(kinds.get(kind) ?? []), where]);
            } else if (read.writer && functionName(read.writer)) {
              const name = functionName(read.writer);
              const id = `${file.file}#${name}`;
              if (!writers.has(id) && ![...writers.values()].some((known) => known.name === name && known.base === file.base)) {
                writers.set(id, { name, base: file.base, at: read.at, inObject: read.inObject });
                grew = true;
              }
            } else {
              unread.push(where);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file.sf);
    }
  }
  return { kinds, unread, writers: [...writers.keys()] };
}

const scanned = scanAuditKinds();

test("the scan reaches the writers that pass a kind on, and reads every kind they are given", () => {
  assert.deepEqual(scanned.unread, [], "an audit kind the scan cannot read: name it as a literal, or teach the scan its writer");
  for (const writer of ["writeDeathState", "saveEquipment", "writeCharges", "auditRest"]) {
    assert.ok(scanned.writers.some((id) => id.endsWith(`#${writer}`)), `the scan did not follow ${writer}`);
  }
  for (const kind of [
    "apply_damage", "death_state", "death_moment", "stabilize", "rest_long", "rest_short", "attune", "item", "trade",
    "reveal_item", "divine_intervention", "gear", "hand_item", "drop_item", "pick_up_item", "dawn_recharge", "use_item",
    "purchase", "player_adjust", "lead_edit", "concentration", "concentration_clock", "condition_clock", "wild_shape",
  ]) {
    assert.ok(scanned.kinds.has(kind), `the scan missed the kind ${kind}`);
  }
});

test("every kind the server writes reads as words, whatever its row holds", () => {
  const raw = [];
  for (const [kind, sites] of scanned.kinds) {
    for (const delta of [{}, { amount: null, name: 3, item: null, qty: "two", deathSaves: "x" }]) {
      const text = describeKnownEntry({ kind, delta }, "Kara");
      if (text === null) {
        raw.push(`${kind} (${sites[0]})`);
        break;
      }
      assert.doesNotMatch(text, /undefined|NaN|null|\[object|_/, `${kind} with ${JSON.stringify(delta)} reads "${text}"`);
      assert.match(text, /Kara/, `${kind} does not name the character`);
    }
  }
  assert.deepEqual(raw, [], "these kinds fall through to their raw id in the event log");
});

test("a death save's result, a pact's price, a trade and the gear moves read from what their rows store", () => {
  const say = (kind, delta) => describeAuditEntry({ kind, delta }, "Corra Venn");
  // src/lib/dm/death.ts writeDeathState and heal-spell.ts's revival.
  assert.equal(say("death_state", { deathSaves: { successes: 0, failures: 0, stable: false, dead: false } }), "Corra Venn is dying");
  assert.equal(say("death_state", { deathSaves: { successes: 2, failures: 1, stable: false, dead: false } }), "Corra Venn's death saves: 2 successes, 1 failure");
  assert.equal(say("death_state", { deathSaves: { successes: 3, failures: 0, stable: true, dead: false } }), "Corra Venn is stable");
  assert.equal(say("death_state", { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } }), "Corra Venn dies");
  assert.equal(say("death_state", { deathSaves: null, currentHp: 1 }), "Corra Venn is back on their feet at 1 HP");
  assert.equal(say("death_state", { deathSaves: null }), "Corra Venn is no longer dying");
  assert.equal(say("death_state", { revived: "Revivify", currentHp: 1 }), "Corra Venn is brought back by Revivify");
  assert.equal(say("stabilize", { deathSaves: null, healer: "Bram", currentHp: 1 }), "Bram stabilizes Corra Venn, who regains 1 HP");
  assert.equal(say("rest_short", { currentHp: 9, hitDice: { spent: 1 } }), "Corra Venn spends hit dice on a short rest");
  assert.equal(say("item", { removed: "her voice" }), "Corra Venn gives up her voice");
  assert.equal(say("trade", { with: "Bram", offer: {} }), "Corra Venn trades with Bram");
  assert.equal(say("reveal_item", { from: "Unknown ring", to: "Ring of Warmth" }), "Corra Venn's Unknown ring turns out to be Ring of Warmth");
  assert.equal(say("gear", { item: "Chain mail", equipped: false }), "Corra Venn takes off Chain mail");
  assert.equal(say("hand_item", { name: "Rope", to: "Bram", qty: 2 }), "Corra Venn hands Rope x2 to Bram");
  assert.equal(say("purchase", { item: "Torch", qty: 3, action: "buy", priceCp: 1, shop: "s" }), "Corra Venn buys Torch x3 for 0.03 gold");
  assert.equal(say("concentration", { concentratingOn: "Bless", concentrationRounds: 10 }), "Corra Venn concentrates on Bless");
  assert.equal(say("concentration", { concentratingOn: null }), "Corra Venn stops concentrating");
  assert.equal(say("concentration_clock", { spell: "Bless", roundsLeft: 9 }), "Time runs on Corra Venn's Bless");
  assert.equal(say("clear_condition", { spell: "Lesser Restoration", ended: ["poisoned"], exhaustion: false }), "Corra Venn is no longer poisoned");
  assert.equal(say("apply_damage", { relentlessRage: true, dc: 10 }), "Corra Venn holds on at 1 HP (Relentless Rage)");
  // A kind from another version of the server still reads as words.
  assert.equal(say("some_new_kind", {}), "Corra Venn: some new kind");
});

test("the moment a hero died is bookkeeping for revival, not a change, and stays off the list", () => {
  seq = 0;
  const log = [entry("t1", "death_moment", { instant: 1, encounterId: null, round: null }), entry("t1", "death_state", { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } })];
  assert.ok(BOOKKEEPING_KINDS.has("death_moment"));
  assert.deepEqual(buildFeed(log, []).map((item) => item.entry?.kind), ["death_state"]);
});

// The undo's conflict warning, shown where the lead decides whether to
// revert anyway, names the character and the fields in words (issue #622).
test("an undo's conflict warning names the character and the fields in words, never a kind or a key", () => {
  const line = undoConflictLine("Corra Venn", "The table recounts the saves", ["deathSaves", "currentHp", "conditionMeta", "conditions"]);
  assert.equal(line, "A later change to Corra Venn (The table recounts the saves) also changed their death saves, hit points, conditions.");
  assert.doesNotMatch(line, /[a-z][A-Z]|_/, line);
  assert.equal(undoConflictLine("Kara", "  ", ["gold"]), "A later change to Kara (no reason given) also changed their gold.");
  assert.equal(fieldWords("hitDiceRemaining"), "hit dice");
  assert.equal(fieldWords("featureUses"), "feature uses");
});

console.log(`\n${passed} event-log tests passed.`);
