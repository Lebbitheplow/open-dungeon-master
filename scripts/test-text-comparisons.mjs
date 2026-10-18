// Every place src/ could compare, case, order or cut text by something other
// than Unicode is classified in scripts/text-comparisons.json: text a person
// writes goes through the helpers in src/lib/language/text-logic.ts, and
// every other site says why it stays (an id, a label shown, the SRD's English
// vocabulary). This walks the code (comments do not count) and holds each
// file to its counts per pattern, so a new toLowerCase(), \b or LIKE has to
// be put on a side before it ships, and a removed one is struck off.
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

const scanned = new Map();
for (const full of sourceFiles(root)) {
  const file = path.relative(root, full).split(path.sep).join("/");
  for (const [pattern, count] of comparisonSites(fs.readFileSync(full, "utf8"), file)) {
    scanned.set(`${file}#${pattern}`, count);
  }
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

test("every comparison site in src/ is classified, file by file and pattern by pattern", () => {
  for (const [key, count] of scanned) {
    const entries = classified.sites[key];
    assert.ok(
      entries,
      `${key.replace("#", ": ")} is new. Text a person writes goes through src/lib/language/text-logic.ts (textKey, words, containsPhrase, namesPattern, compareNames, slugOf, and stemmerWords in language.ts); anything else gets an entry in scripts/text-comparisons.json with its class and reason`,
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
