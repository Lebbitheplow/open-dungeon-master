// Every place src/ could decide which record a text names is classified in
// scripts/name-lookups.json, found by mechanism with the type checker, never
// by a function's name: a part of one text matched in another, two texts
// compared in a list scan, a table read by a name, a lookup's miss replaced
// by another record, a returned list's first element, a local case fold, a
// number read from text, and a call of a helper that matches a part of one
// text in another. An identity lookup (the text decides the record, and an
// engine applies that record's rules or state) compares the whole name by
// textKey, or reads a field naming the row, and refuses a miss with the
// options listed; search may match words. This holds each file to its counts
// per mechanism (comments do not count), so a new `SRD_WEAPONS.find((w) =>
// name.includes(w.name))`, `?? list[0]` or local `lower()` has to be put on
// a side before it ships, and a removed one is struck off.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");
const classified = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "name-lookups.json"), "utf8"));
const k = ts.SyntaxKind;

const PARTIAL_METHODS = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "search", "match", "matchAll"]);
const OWN_PARTIAL = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "search"]);
const LIST_METHODS = new Set(["find", "findLast", "filter", "some", "every", "findIndex", "findLastIndex", "forEach", "map", "flatMap", "reduce", "sort"]);
const LOOKUP_METHODS = new Set(["find", "findLast"]);
// A property or binding that holds what a record is called. Broad on
// purpose: a false hit is classified once, a miss is never seen.
const NAMEISH = /(^|[a-z])(name|Name|slug|Slug|label|Label|title|Title|alias|Alias|aliases|Aliases|form|Form|attack|Attack|base|Base|kind|Kind|type|Type|feature|Feature|spell|Spell|monster|Monster|item|Item|weapon|Weapon|armor|Armor|condition|Condition|key|Key|word|Word|term|Term|ref|Ref)s?$/;
// A carried item, or a narrower type one is passed as ({ name; gear? }).
const ITEM_FIELDS = ["srdName", "gear", "qty", "equipped", "attuned", "worth", "identified", "layered"];

const skip = (node) => {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
  return n;
};
const isStringish = (type) => (type.isUnion() ? type.types.every(isStringish) : Boolean(type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.TemplateLiteral)));
// Does an expression read a name (through textKey(x.name), x.name.trim()...)?
// An identifier is a name unless it is the member read off another value.
function readsName(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n) && NAMEISH.test(n.name.text)) found = true;
    else if (ts.isIdentifier(n) && NAMEISH.test(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}
// The list method or loop a node runs inside, or "-".
function within(node) {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isCallExpression(n.parent)) {
      const callee = n.parent.expression;
      if (ts.isPropertyAccessExpression(callee) && LIST_METHODS.has(callee.name.text)) return callee.name.text;
    }
    if (ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n) || ts.isWhileStatement(n)) return "loop";
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) return "-";
  }
  return "-";
}

// file#mechanism -> number of sites, over every source file the program
// holds under `under`. The program names files with "/" on every platform.
export function lookupSites(program, under) {
  const base = under.split(path.sep).join("/").replace(/\/$/, "");
  const checker = program.getTypeChecker();
  const inScope = (sf) => sf.fileName.startsWith(`${base}/`) && !sf.isDeclarationFile && /\.tsx?$/.test(sf.fileName);
  const files = program.getSourceFiles().filter(inScope);
  const typeOf = (node) => checker.getTypeAtLocation(node);
  const isLiteralish = (node) => {
    const n = skip(node);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isRegularExpressionLiteral(n)) return true;
    const type = typeOf(n);
    return type.isUnion() ? type.types.every((t) => t.flags & ts.TypeFlags.StringLiteral) : Boolean(type.flags & ts.TypeFlags.StringLiteral);
  };
  const constRegex = (node) => {
    const n = skip(node);
    const symbol = ts.isIdentifier(n) ? checker.getSymbolAtLocation(n) : ts.isPropertyAccessExpression(n) ? checker.getSymbolAtLocation(n.name) : undefined;
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    const init = declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) ? declaration.initializer : undefined;
    return Boolean(init && ts.isRegularExpressionLiteral(skip(init)));
  };
  const itemish = (type) => (type.isUnion() ? type.types : [type]).some((t) => ITEM_FIELDS.some((field) => t.getProperty(field)));
  // The list `x[0]` or `x.at(0)` takes the first of, or undefined.
  const firstElementOf = (node) =>
    ts.isElementAccessExpression(node) && ts.isNumericLiteral(skip(node.argumentExpression)) && skip(node.argumentExpression).text === "0"
      ? skip(node.expression)
      : ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "at" && node.arguments.length === 1 && ts.isNumericLiteral(node.arguments[0]) && node.arguments[0].text === "0"
        ? skip(node.expression.expression)
        : undefined;
  // The call a const holding a list was made by (`const hits = list.filter(...)`).
  const constCall = (node) => {
    const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined;
    const declaration = symbol?.valueDeclaration;
    const init = declaration && ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const ? declaration.initializer && skip(declaration.initializer) : undefined;
    return init && ts.isCallExpression(init) ? init : undefined;
  };
  // A value that can stand for a record: not a text, a number, a flag.
  const isRecord = (node) => !isStringish(typeOf(node)) && !(typeOf(node).flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike));

  // The functions of src/ that match a part of one of their two texts in the
  // other: a partial String method whose receiver comes from one text
  // parameter and whose argument from the other (through the local consts
  // made of them), or a call passing them on to such a function, to a
  // fixpoint (containsPhrase is one through phraseOffsets).
  const declOf = (callee) => {
    let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (!declaration || !inScope(declaration.getSourceFile())) return null;
    if (ts.isFunctionDeclaration(declaration)) return declaration;
    const init = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null;
  };
  const twoTexts = (fn) => fn.parameters.length >= 2 && fn.parameters.slice(0, 2).every((param) => ts.isIdentifier(param.name) && isStringish(typeOf(param)));
  // Which of the function's two text parameters an expression is made of:
  // 0, 1, or -1 for neither (or both).
  const paramOf = (fn, expr, depth = 0) => {
    const names = fn.parameters.slice(0, 2).map((param) => param.name.text);
    const found = new Set();
    const visit = (n) => {
      if (ts.isIdentifier(n)) {
        const at = names.indexOf(n.text);
        if (at >= 0) found.add(at);
        else if (depth < 3) {
          const declaration = checker.getSymbolAtLocation(n)?.valueDeclaration;
          if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && declaration.pos > fn.pos && declaration.end < fn.end) {
            const inner = paramOf(fn, declaration.initializer, depth + 1);
            if (inner >= 0) found.add(inner);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(expr);
    return found.size === 1 ? [...found][0] : -1;
  };
  const crosses = (fn, a, b) => {
    const left = paramOf(fn, a);
    const right = paramOf(fn, b);
    return left >= 0 && right >= 0 && left !== right;
  };
  const helpers = new Set();
  const passesOn = new Map();
  for (const sf of files) {
    const visit = (node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body && twoTexts(node)) {
        const calls = [];
        const walk = (n) => {
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && OWN_PARTIAL.has(n.expression.name.text) && n.arguments[0] && isStringish(typeOf(n.expression.expression)) && crosses(node, n.expression.expression, n.arguments[0])) helpers.add(node);
          if (ts.isCallExpression(n) && n.arguments.length >= 2 && crosses(node, n.arguments[0], n.arguments[1])) calls.push(n.expression);
          ts.forEachChild(n, walk);
        };
        walk(node.body);
        passesOn.set(node, calls);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [fn, calls] of passesOn) {
      if (!helpers.has(fn) && calls.some((callee) => helpers.has(declOf(callee)))) {
        helpers.add(fn);
        grew = true;
      }
    }
  }

  const found = new Map();
  for (const sf of files) {
    const add = (mechanism) => {
      const key = `${sf.fileName.slice(base.length + 1)}#${mechanism}`;
      found.set(key, (found.get(key) ?? 0) + 1);
    };
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        if (node.arguments.length >= 2 && helpers.has(declOf(node.expression)) && node.arguments.slice(0, 2).every((arg) => isStringish(typeOf(arg)))) add("helper");
        if (ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          const receiver = node.expression.expression;
          const arg = node.arguments[0];
          const textReceiver = () => isStringish(typeOf(receiver));
          const textArg = () => isStringish(typeOf(arg));
          if (arg && PARTIAL_METHODS.has(method) && textReceiver()) add("partial");
          else if (arg && (method === "test" || method === "exec") && textArg()) add("partial");
          else if (arg && (method === "replace" || method === "replaceAll") && textReceiver() && !isLiteralish(arg) && !constRegex(arg)) add("partial");
          else if (arg && method === "split" && textReceiver()) add("partial");
          else if (arg && (method === "has" || method === "get") && textArg() && /^(Set|Map|ReadonlySet|ReadonlyMap)$/.test(typeOf(receiver).getSymbol()?.getName() ?? "") && within(node) !== "-" && (readsName(arg) || /textKey|lower|toLowerCase|join|slice|key/i.test(arg.getText(sf)))) add("partial");
          // keyed: a whole-name index read outside a scan (byName.get(textKey(name)))
          if (arg && (method === "get" || method === "has") && within(node) === "-" && /^(Set|Map|ReadonlySet|ReadonlyMap)$/.test(typeOf(receiver).getSymbol()?.getName() ?? "") && textArg() && !isLiteralish(arg) && (readsName(arg) || /textKey|lower|toLowerCase|trim|slice/i.test(arg.getText(sf)))) add("keyed");
          // A list's membership test is a whole compare in a scan
          // (NAMES.includes(x) is NAMES.some((n) => n === x)).
          if (arg && ["includes", "indexOf", "lastIndexOf"].includes(method) && checker.isArrayLikeType(typeOf(receiver)) && textArg() && !isLiteralish(arg) && (readsName(arg) || /textKey|lower|toLowerCase|trim|slice/i.test(arg.getText(sf)))) add("whole");
        }
        // bypass: a carried item's own name handed to a function, where the
        // row it names (rowName) may be what is meant
        for (const arg of node.arguments) {
          const a = skip(arg);
          if (ts.isPropertyAccessExpression(a) && a.name.text === "name" && itemish(typeOf(a.expression))) add("bypass");
        }
        if (ts.isIdentifier(node.expression) && ["parseFloat", "parseInt", "Number"].includes(node.expression.text) && node.arguments[0] && isStringish(typeOf(node.arguments[0])) && !isLiteralish(node.arguments[0])) add("number");
      }
      // first: a returned list's first element taken as the record, read
      // off the call or off the const it was put in (`hits[0]`)
      const firstOf = firstElementOf(node);
      const listCall = firstOf && (ts.isCallExpression(firstOf) ? firstOf : constCall(firstOf));
      if (listCall) {
        const callee = listCall.expression;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf);
        if (!/^(split|match|matchAll|exec|keys|entries|values|getAll|readdirSync|querySelectorAll)$/.test(name)) add("first");
      }
      // keyed: an object read by a name (TABLE[item.name])
      if (ts.isElementAccessExpression(node) && !ts.isNumericLiteral(skip(node.argumentExpression)) && isStringish(typeOf(node.argumentExpression)) && !isLiteralish(node.argumentExpression) && readsName(node.argumentExpression) && !checker.isArrayLikeType(typeOf(node.expression))) add("keyed");
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        const strict = op === k.EqualsEqualsEqualsToken || op === k.ExclamationEqualsEqualsToken;
        const equality = strict || op === k.EqualsEqualsToken || op === k.ExclamationEqualsToken;
        const texts = equality && isStringish(typeOf(node.left)) && isStringish(typeOf(node.right));
        const named = () => readsName(node.left) || readsName(node.right);
        const literal = () => isLiteralish(node.left) || isLiteralish(node.right);
        if (strict && within(node) === "-" && texts && !literal() && named()) add("whole-single");
        if (equality && within(node) !== "-" && texts && !literal() && named()) add("whole");
        if (strict && [skip(node.left), skip(node.right)].some((s) => ts.isCallExpression(s) && ts.isPropertyAccessExpression(s.expression) && ["localeCompare", "compare"].includes(s.expression.name.text))) add("collator");
        // keyed: a text read as a table's key (x in TABLE)
        if (op === k.InKeyword && isStringish(typeOf(node.left)) && !isLiteralish(node.left) && (readsName(node.left) || /textKey|lower|toLowerCase|trim|slice/i.test(node.left.getText(sf)))) add("keyed");
        // fallback: a lookup's miss replaced by another record, or any
        // miss replaced by a list's first (`attackNamed(...) ?? attacks[0]`)
        if (op === k.QuestionQuestionToken || op === k.BarBarToken) {
          const left = skip(node.left);
          const right = skip(node.right);
          const lookup = (ts.isCallExpression(left) && ts.isPropertyAccessExpression(left.expression) && LOOKUP_METHODS.has(left.expression.name.text)) || (ts.isElementAccessExpression(left) && !ts.isNumericLiteral(skip(left.argumentExpression)));
          const empty = (ts.isArrayLiteralExpression(right) && right.elements.length === 0) || (ts.isObjectLiteralExpression(right) && right.properties.length === 0) || right.kind === k.NullKeyword || (ts.isIdentifier(right) && right.text === "undefined") || right.kind === k.FalseKeyword;
          if ((lookup || firstElementOf(right)) && !empty && isRecord(right)) add("fallback");
        }
      }
      // fallback: a miss replaced by a list's first in a conditional
      // (`found ? found : attacks[0]`)
      if (ts.isConditionalExpression(node) && [node.whenTrue, node.whenFalse].some((branch) => firstElementOf(skip(branch)) && isRecord(skip(branch)))) add("fallback");
      // collator: a compare's zero read as "the same" (!a.localeCompare(b))
      if (ts.isPrefixUnaryExpression(node) && node.operator === k.ExclamationToken) {
        const operand = skip(node.operand);
        if (ts.isCallExpression(operand) && ts.isPropertyAccessExpression(operand.expression) && ["localeCompare", "compare"].includes(operand.expression.name.text)) add("collator");
      }
      if (ts.isSwitchStatement(node) && isStringish(typeOf(node.expression)) && readsName(node.expression) && !isLiteralish(node.expression)) add("switch");
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && /\b(where|and|or)\b[^;]*\b\w*(name|title|label|slug)\w*\s*(=|like|in\s*\()|collate\s+nocase|\blower\s*\(/i.test(node.text)) add("sql");
      // normalizer: a named function folding text by its own toLowerCase
      // instead of, or on top of, textKey
      if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.body && node.parameters.length >= 1) {
        let folds = false;
        const walk = (n) => {
          if (n !== node.body && (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))) return;
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["toLowerCase", "toLocaleLowerCase"].includes(n.expression.name.text)) folds = true;
          ts.forEachChild(n, walk);
        };
        walk(node.body);
        const signature = checker.getSignatureFromDeclaration(node);
        const named = ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? ts.isVariableDeclaration(node.parent) : Boolean(node.name);
        if (folds && named && signature && isStringish(checker.getReturnTypeOfSignature(signature))) add("normalizer");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

test("the scan finds every way a lookup can guess, and never reads a comment", () => {
  const dir = "/probe";
  const file = "/probe/module.ts";
  const source = `
    // SRD_WEAPONS.find((weapon) => name.includes(weapon.name)) in a comment
    type Weapon = { name: string };
    type Item = { name: string; qty: number; srdName?: string };
    declare const SRD_WEAPONS: Weapon[];
    declare const TABLE: { [key: string]: number };
    declare const item: Item;
    declare const name: string;
    declare function rowFor(name: string): Weapon | null;
    export function phraseIn(text: string, phrase: string): boolean {
      return text.indexOf(phrase) >= 0;
    }
    export const lower = (value: string) => value.trim().toLowerCase();
    export const guessed = SRD_WEAPONS.find((weapon) => name.includes(weapon.name));
    export const first = SRD_WEAPONS.find((weapon) => weapon.name === name) ?? SRD_WEAPONS[0];
    export const listed = SRD_WEAPONS.filter((weapon) => phraseIn(name, weapon.name))[0];
    export const weight = TABLE[item.name];
    export const row = rowFor(item.name);
    export const same = lower(item.name) === name;
    export const amount = Number(name);
    declare const WEAPON_NAMES: string[];
    declare const WEAPON_KEYS: Set<string>;
    declare function words(text: string): string[];
    export const inList = WEAPON_NAMES.includes(name.toLowerCase());
    export const atIndex = WEAPON_NAMES.indexOf(name);
    export const asKey = name.toLowerCase() in TABLE;
    export const sameAs = !name.localeCompare(item.name, undefined, { sensitivity: "base" });
    export const word = words(name).find((w) => WEAPON_KEYS.has(w));
    export const helperFallback = rowFor(name) ?? SRD_WEAPONS[0];
    export const orFallback = rowFor(name) || SRD_WEAPONS.at(0);
    const found = rowFor(name);
    export const ternaryFallback = found ? found : SRD_WEAPONS[0];
    const hits = SRD_WEAPONS.filter((weapon) => weapon.name.length > 3);
    export const firstOfLocal = hits[0];
  `;
  const host = ts.createCompilerHost({});
  const fallback = host.getSourceFile;
  host.getSourceFile = (name, version) => (name === file ? ts.createSourceFile(name, source, version, true) : fallback.call(host, name, version));
  const program = ts.createProgram([file], { strict: true, noEmit: true, lib: ["lib.es2022.d.ts"], types: [] }, host);
  assert.deepEqual(Object.fromEntries(lookupSites(program, dir)), {
    "module.ts#partial": 2,
    "module.ts#whole": 3,
    "module.ts#fallback": 4,
    "module.ts#first": 2,
    "module.ts#helper": 1,
    "module.ts#keyed": 2,
    "module.ts#bypass": 3,
    "module.ts#whole-single": 1,
    "module.ts#normalizer": 1,
    "module.ts#number": 1,
    "module.ts#collator": 1,
  });
});

const paths = [...sourceFiles(root)];
const config = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "..", "tsconfig.json"), ts.sys.readFile).config, ts.sys, path.join(root, ".."));
const program = ts.createProgram(paths, { ...config.options, noEmit: true, incremental: false });
const scanned = lookupSites(program, root);
const CLASSES = Object.keys(classified.classes);

test("every classified entry names a known class, a count and its reason", () => {
  for (const [key, entries] of Object.entries(classified.sites)) {
    for (const [cls, count, reason] of entries) {
      assert.ok(CLASSES.includes(cls), `${key}: unknown class "${cls}"`);
      assert.ok(Number.isInteger(count) && count > 0, `${key}: count ${count}`);
      assert.ok(typeof reason === "string" && reason.trim(), `${key}: a ${cls} entry needs its reason`);
    }
  }
});

test("every place src/ could decide which record a text names is classified, file by file and mechanism by mechanism", () => {
  for (const [key, count] of scanned) {
    const entries = classified.sites[key];
    assert.ok(
      entries,
      `${key.replace("#", ": ")} is new. A record a text names is found by its whole name: textKey on both sides, findNamed for a list, lineNamed for a carried line, isNamed for a feature name, isConditionNamed for a condition, or a field naming the row (srdName, slug, id); a miss is refused with the options (namedOption, namesHolding), never the first record or one holding a word of it. Anything else gets an entry in scripts/name-lookups.json with its class and reason`,
    );
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    assert.equal(total, count, `${key.replace("#", ": ")} has ${count} sites, ${total} classified; classify the new one or strike the removed one`);
  }
});

test("a classified site that is gone is struck off", () => {
  for (const key of Object.keys(classified.sites)) {
    assert.ok(scanned.has(key), `${key.replace("#", ": ")} is classified but no longer in the code; remove its entry`);
  }
});

console.log(`\n${passed} name lookup tests passed`);
