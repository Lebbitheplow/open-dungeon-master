// Every place src/ could compare, case, order or cut text by something other
// than Unicode, and every English word the code matches text against, is
// classified in scripts/text-comparisons.json: text a person writes goes
// through the helpers in src/lib/language/text-logic.ts, and every other site
// says why it stays (an id, a label shown, the SRD's English vocabulary). A
// word list that reads text written in the table's language is listed as
// such, reader by reader, until a structured field replaces it. This walks the
// code (comments do not count) and holds each file to its counts per pattern,
// so a new toLowerCase(), \b, LIKE or /potion|vial/ has to be put on a side
// before it ships, and a removed one is struck off.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");
const classified = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "text-comparisons.json"), "utf8"));

const METHODS = new Map([
  ["toLowerCase", "toLowerCase"],
  ["toUpperCase", "toUpperCase"],
  ["toLocaleLowerCase", "toLocaleLowerCase"],
  ["toLocaleUpperCase", "toLocaleUpperCase"],
  ["localeCompare", "localeCompare"],
  ["normalize", ".normalize("],
]);
// Read in the raw source of string, template and regex literals. SQL's own
// words in any case, except LIKE: a lower-case "like" in a literal is English
// prose ("try something like 2d6+1").
const IN_LITERALS = [
  ["COLLATE NOCASE", /COLLATE NOCASE/gi],
  ["LOWER(", /\bLOWER\(/gi],
  ["UPPER(", /\bUPPER\(/gi],
  ["LIKE", /\bLIKE\b/g],
  ["GLOB", /\bGLOB\b/gi],
  ["\\b", /(?<!\\)(?:\\\\)*\\{1,2}b/g],
  ["\\B", /(?<!\\)(?:\\\\)*\\{1,2}B/g],
  ["\\w", /(?<!\\)(?:\\\\)*\\{1,2}w/g],
  ["\\W", /(?<!\\)(?:\\\\)*\\{1,2}W/g],
  ["[a-z]", /\[[^\]]*?(?:a-z|A-Z)[^\]]*\]/g],
];
const LITERALS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

// file#pattern -> number of sites, for one module's source.
export function comparisonSites(source, fileName = "module.ts") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Map();
  const add = (pattern) => found.set(pattern, (found.get(pattern) ?? 0) + 1);
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      if (METHODS.has(node.name.text)) add(METHODS.get(node.name.text));
      if (node.name.text === "Collator" && node.expression.getText(file) === "Intl") add("Intl.Collator");
    }
    if (LITERALS.has(node.kind)) {
      const raw = node.getText(file);
      for (const [pattern, re] of IN_LITERALS) for (let n = raw.match(re)?.length ?? 0; n > 0; n -= 1) add(pattern);
    }
    // A pattern built from data and matched without case: "i" folds ASCII
    // only without "u", and reads names whatever its flags.
    if (ts.isNewExpression(node) && node.expression.getText(file) === "RegExp" && (node.arguments?.length ?? 0) > 1) {
      const flags = node.arguments[1];
      if (!ts.isStringLiteralLike(flags) || flags.text.includes("i")) add("RegExp i");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// ---- English words the code matches text against ----
//
// re-word: a regex holding a run of three letters or more; re-affix: a
// shorter run beside ^, $ or \b (/s$/, /^the\s/). str-<method>: a word as the
// argument of includes, startsWith, split, replace and the like; str-eq: a
// word compared with ===; str-case: a word as a case label; str-list: an
// array of two words or more; str-key: the word keys of an object or Map read
// by a computed key; str-alt and str-split-list: words joined by "|" or split
// from one string. A site the type checker types as a string-literal union (a
// fixed choice, an enum) is a key by type and needs no entry.

// Regex body tokens: L a letter, A an anchor (^, $, \b), T transparent
// (groups, quantifiers), | an alternative, O anything else.
function regexTokens(body) {
  const out = [];
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c === "\\") {
      const n = body[i + 1];
      if ("pPk".includes(n) && "{<".includes(body[i + 2])) {
        i = body.indexOf(n === "k" ? ">" : "}", i) + 1;
        out.push("O");
      } else if (n === "u" && body[i + 2] === "{") {
        i = body.indexOf("}", i) + 1;
        out.push("O");
      } else {
        out.push(n === "b" ? "A" : "O");
        i += n === "u" ? 6 : n === "x" ? 4 : n === "c" ? 3 : 2;
      }
    } else if (c === "[") {
      let j = i + 1;
      if (body[j] === "]") j += 1;
      while (j < body.length && body[j] !== "]") j += body[j] === "\\" ? 2 : 1;
      i = j + 1;
      out.push("O");
    } else if (c === "(") {
      if (body[i + 1] === "?") {
        const named = /^\(\?<(?![=!])[^>]*>/.exec(body.slice(i));
        i += named ? named[0].length : body[i + 2] === "<" ? 4 : 3;
      } else {
        i += 1;
      }
      out.push("T");
    } else if (c === ")" || c === "?" || c === "*" || c === "+") {
      out.push("T");
      i += 1;
    } else if (c === "{" && /^\{\d+(,\d*)?\}/.test(body.slice(i))) {
      i = body.indexOf("}", i) + 1;
      out.push("T");
    } else if (c === "^" || c === "$") {
      out.push("A");
      i += 1;
    } else {
      out.push(c === "|" ? "|" : /\p{L}/u.test(c) ? "L" : "O");
      i += 1;
    }
  }
  return out;
}
function regexPattern(body) {
  const tokens = regexTokens(body);
  let affix = false;
  for (let i = 0; i < tokens.length; ) {
    if (tokens[i] !== "L") {
      i += 1;
      continue;
    }
    let j = i;
    while (tokens[j] === "L") j += 1;
    if (j - i >= 3) return "re-word";
    let l = i - 1;
    while (tokens[l] === "T") l -= 1;
    let r = j;
    while (tokens[r] === "T") r += 1;
    if (tokens[l] === "A" || tokens[r] === "A") affix = true;
    i = j;
  }
  return affix ? "re-affix" : null;
}

const k = ts.SyntaxKind;
const letters = (text) => (text.match(/\p{L}/gu) ?? []).length;
const isWord = (text, min = 2) => /^[\p{L}\p{M}'’ -]+$/u.test(text) && letters(text) >= min;
const isStringLit = (node) => node.kind === k.StringLiteral || node.kind === k.NoSubstitutionTemplateLiteral;
const unwrap = (node) => {
  while (node && [k.ParenthesizedExpression, k.AsExpression, k.SatisfiesExpression, k.TypeAssertionExpression].includes(node.kind)) node = node.expression;
  return node;
};
const WORD_METHODS = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "split", "replace", "replaceAll", "match", "search"]);
const AFFIX_METHODS = new Set(["startsWith", "endsWith"]);
const SLICES = new Set(["slice", "at", "charAt", "substring", "substr"]);
const isSliceOfText = (node) => {
  node = unwrap(node);
  if (node.kind === k.CallExpression && node.expression.kind === k.PropertyAccessExpression) return SLICES.has(node.expression.name.text);
  return node.kind === k.ElementAccessExpression;
};
function isLiteralUnion(type) {
  if (!type) return false;
  let literal = 0;
  for (const part of type.isUnion() ? type.types : [type]) {
    if (part.isStringLiteral()) literal += 1;
    else if (!(part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.BooleanLiteral | ts.TypeFlags.NumberLiteral))) return false;
  }
  return literal > 0;
}

// file#pattern -> number of untyped word sites, over every source file the
// program holds under `under`. The program names files with "/" on every
// platform.
export function wordSites(program, under) {
  const base = under.split(path.sep).join("/").replace(/\/$/, "");
  const checker = program.getTypeChecker();
  const typedOperand = (other) => isLiteralUnion(checker.getTypeAtLocation(other));
  const typedContext = (node) => isLiteralUnion(checker.getContextualType(node));
  const inScope = (sf) => sf.fileName.startsWith(`${base}/`) && !sf.isDeclarationFile && /\.tsx?$/.test(sf.fileName);
  const found = new Map();
  const add = (sf, pattern, typed) => {
    if (typed) return;
    const key = `${sf.fileName.slice(base.length + 1)}#${pattern}`;
    found.set(key, (found.get(key) ?? 0) + 1);
  };
  // Objects read by a computed key (x[k], k in x, Object.hasOwn(x, k)),
  // resolved to the object literal x is bound to, in whichever file.
  const objectLiteralOf = (expr) => {
    expr = unwrap(expr);
    if (expr.kind !== k.Identifier && expr.kind !== k.PropertyAccessExpression) return null;
    let symbol = checker.getSymbolAtLocation(expr.kind === k.PropertyAccessExpression ? expr.name : expr);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    const init = decl && [k.VariableDeclaration, k.PropertyDeclaration, k.PropertyAssignment].includes(decl.kind) ? unwrap(decl.initializer) : null;
    return init && init.kind === k.ObjectLiteralExpression ? init : null;
  };
  const lookedUp = new Set();
  for (const sf of program.getSourceFiles().filter(inScope)) {
    const visit = (node) => {
      if (node.kind === k.RegularExpressionLiteral) {
        const text = node.getText(sf);
        const pattern = regexPattern(text.slice(1, text.lastIndexOf("/")));
        if (pattern) add(sf, pattern, false);
      }
      if ((node.kind === k.NewExpression || node.kind === k.CallExpression) && node.expression.kind === k.Identifier && node.expression.text === "RegExp" && node.arguments?.length) {
        const arg = unwrap(node.arguments[0]);
        const body = isStringLit(arg) ? arg.text : arg.kind === k.TemplateExpression ? [arg.head.text, ...arg.templateSpans.map((span) => span.literal.text)].join("\u0000") : null;
        const pattern = body !== null && regexPattern(body);
        if (pattern) add(sf, pattern, false);
      }
      if (node.kind === k.CallExpression && node.expression.kind === k.PropertyAccessExpression && WORD_METHODS.has(node.expression.name.text) && node.arguments.length) {
        const method = node.expression.name.text;
        const arg = unwrap(node.arguments[0]);
        if (isStringLit(arg) && isWord(arg.text, AFFIX_METHODS.has(method) ? 1 : 2)) add(sf, `str-${method}`, typedContext(arg));
      }
      if (node.kind === k.BinaryExpression && [k.EqualsEqualsEqualsToken, k.ExclamationEqualsEqualsToken, k.EqualsEqualsToken, k.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
        for (const [lit, other] of [[unwrap(node.left), node.right], [unwrap(node.right), node.left]]) {
          if (isStringLit(lit) && isWord(lit.text, isSliceOfText(other) ? 1 : 2)) add(sf, "str-eq", typedOperand(other));
        }
      }
      if (node.kind === k.CaseClause) {
        const lit = unwrap(node.expression);
        if (isStringLit(lit) && isWord(lit.text)) add(sf, "str-case", typedOperand(node.parent.parent.expression));
      }
      if (isStringLit(node)) {
        const parent = node.parent;
        const split = parent.kind === k.PropertyAccessExpression && parent.expression === node && parent.name.text === "split";
        const parts = node.text.split(split ? /[\s,|]+/ : /\|/).filter(Boolean);
        if (parts.length >= 2 && parts.every((part) => isWord(part, 1)) && parts.filter((part) => letters(part) >= 2).length >= 2 && (split || node.text.includes("|"))) {
          add(sf, split ? "str-split-list" : "str-alt", false);
        }
      }
      if (node.kind === k.ArrayLiteralExpression) {
        const words = node.elements.map(unwrap).filter((el) => isStringLit(el) && isWord(el.text));
        if (words.length >= 2) add(sf, "str-list", words.every(typedContext));
        const parent = node.parent;
        if (parent.kind === k.NewExpression && parent.expression.getText(sf) === "Map" && parent.arguments?.[0] === node) {
          const keys = node.elements.map(unwrap).filter((el) => el.kind === k.ArrayLiteralExpression && el.elements.length && isStringLit(unwrap(el.elements[0])) && isWord(unwrap(el.elements[0]).text));
          if (keys.length) add(sf, "str-key", keys.every((pair) => typedContext(unwrap(pair.elements[0]))));
        }
      }
      if (node.kind === k.ElementAccessExpression && !isStringLit(unwrap(node.argumentExpression)) && unwrap(node.argumentExpression).kind !== k.NumericLiteral) {
        const obj = objectLiteralOf(node.expression);
        if (obj) lookedUp.add(obj);
      }
      if (node.kind === k.BinaryExpression && node.operatorToken.kind === k.InKeyword && !isStringLit(unwrap(node.left))) {
        const obj = objectLiteralOf(node.right);
        if (obj) lookedUp.add(obj);
      }
      if (node.kind === k.CallExpression && node.expression.getText(sf) === "Object.hasOwn" && node.arguments.length === 2) {
        const obj = objectLiteralOf(node.arguments[0]);
        if (obj) lookedUp.add(obj);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const obj of lookedUp) {
    const sf = obj.getSourceFile();
    if (!inScope(sf)) continue;
    if (!obj.properties.some((prop) => prop.name && (prop.name.kind === k.Identifier || isStringLit(prop.name)) && isWord(prop.name.text))) continue;
    const contextual = checker.getContextualType(obj);
    add(sf, "str-key", !!contextual && !checker.getIndexInfoOfType(contextual, ts.IndexKind.String) && !contextual.isUnion());
  }
  return found;
}

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.tsx?$/.test(entry.name)) {
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

test("the scan reads code, never comments, and counts every pattern", () => {
  const found = comparisonSites(`
    // name.toLowerCase() in a comment, and /\\bword\\b/ too
    const a = name.toLowerCase() === other.trim().toLowerCase();
    const b = /\\bfire\\b/i.test(text) && /[a-z]+/.test(text);
    const c = db.prepare(\`SELECT name FROM t WHERE name LIKE ? ORDER BY name COLLATE NOCASE\`);
    const d = db.prepare("UPDATE t SET x = ? WHERE lower(y) = ?");
    const e = new RegExp(\`\\\\b\${word}\\\\b\`, "gi");
    const f = new Intl.Collator("en").compare(a, b) || a.localeCompare(b) || s.normalize("NFC");
    const g = "try something like 2d6";
  `);
  assert.deepEqual(Object.fromEntries(found), {
    toLowerCase: 2,
    "\\b": 4,
    "[a-z]": 1,
    LIKE: 1,
    "COLLATE NOCASE": 1,
    "LOWER(": 1,
    "RegExp i": 1,
    "Intl.Collator": 1,
    localeCompare: 1,
    ".normalize(": 1,
  });
});

test("the word scan finds English words matched against text, and leaves a fixed choice the types name to the checker", () => {
  const dir = "/words";
  const file = "/words/module.ts";
  const source = `
    // /potion|vial/ in a comment
    type Kind = "melee" | "ranged";
    declare const kind: Kind;
    declare const name: string;
    const KINDS = { potion: 1, scroll: 2 };
    export const all = [
      /potion|vial/i.test(name), /s$/.test(name), /\\d+/.test(name),
      name.includes("ranged"), name === "torch", kind === "melee",
      ["arrows", "bolts"].includes(name), "buy|sell".length, KINDS[name as keyof typeof KINDS],
    ];
    switch (name) { case "fire": break; }
  `;
  const host = ts.createCompilerHost({});
  const fallback = host.getSourceFile;
  host.getSourceFile = (name, version) => (name === file ? ts.createSourceFile(name, source, version, true) : fallback.call(host, name, version));
  const program = ts.createProgram([file], { strict: true, noEmit: true, noLib: true, types: [] }, host);
  assert.deepEqual(Object.fromEntries(wordSites(program, dir)), {
    "module.ts#re-word": 1,
    "module.ts#re-affix": 1,
    "module.ts#str-includes": 1,
    "module.ts#str-eq": 1,
    "module.ts#str-list": 1,
    "module.ts#str-alt": 1,
    "module.ts#str-key": 1,
    "module.ts#str-case": 1,
  });
});

const scanned = new Map();
const paths = [...sourceFiles(root)];
for (const full of paths) {
  const file = path.relative(root, full).split(path.sep).join("/");
  for (const [pattern, count] of comparisonSites(fs.readFileSync(full, "utf8"), file)) {
    scanned.set(`${file}#${pattern}`, count);
  }
}
const config = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "..", "tsconfig.json"), ts.sys.readFile).config, ts.sys, path.join(root, ".."));
const program = ts.createProgram(paths, { ...config.options, noEmit: true, incremental: false });
for (const [key, count] of wordSites(program, root)) {
  scanned.set(key, count);
}
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

test("every comparison site and word list in src/ is classified, file by file and pattern by pattern", () => {
  for (const [key, count] of scanned) {
    const entries = classified.sites[key];
    assert.ok(
      entries,
      `${key.replace("#", ": ")} is new. Text a person writes goes through src/lib/language/text-logic.ts (textKey, words, containsPhrase, namesPattern, compareNames, slugOf, and stemmerWords in language.ts), and what a thing is comes from a field, never from English words in its name; anything else gets an entry in scripts/text-comparisons.json with its class and reason`,
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

test("text a person writes is compared only inside the shared helpers", () => {
  for (const [key, entries] of Object.entries(classified.sites)) {
    const file = key.split("#")[0];
    if (entries.some(([cls]) => cls === "human")) {
      assert.ok(classified.humanTextIn.includes(file), `${file} compares text a person writes itself; use the helpers in src/lib/language/text-logic.ts`);
    }
  }
});

console.log(`\n${passed} text comparison tests passed`);
