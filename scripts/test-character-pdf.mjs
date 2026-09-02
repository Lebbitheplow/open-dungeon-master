// The character-sheet PDF builder in Node: a fighter comes out as a real PDF
// with a fillable form. The portrait path is the browser's job (WebP is
// transcoded there, see src/lib/pdf/download.ts); here the sheet has none,
// which is the common case for a fresh character anyway.
import assert from "node:assert/strict";
import { register } from "node:module";
import { PDFDocument } from "pdf-lib";

register("./lib/register-alias.mjs", import.meta.url);

const { buildCharacterSheetPdf, libraryToPdfCharacter } = await import(
  "../src/lib/pdf/character-sheet-pdf.ts"
);
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const sheet = createSheetSchema.parse({
  name: "Brunhilde Ironvow",
  race: "human",
  class: "fighter",
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  maxHp: 12,
  ac: 16,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "perception"],
    languages: ["common"],
    tools: [],
    armor: ["all armor", "shields"],
    weapons: ["simple weapons", "martial weapons"],
  },
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Chain mail", qty: 1 }],
  features: [{ name: "Second Wind", source: "class", level: 1 }],
});

await test("a fighter builds to a PDF with a fillable form", async () => {
  const character = libraryToPdfCharacter({
    name: sheet.name,
    race: sheet.race,
    class: sheet.class,
    subclass: "",
    background: "soldier",
    level: 1,
    sheet,
  });
  const bytes = await buildCharacterSheetPdf(character);
  assert.ok(bytes.length > 1000, "PDF has substance");
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  assert.equal(head, "%PDF-");
  const doc = await PDFDocument.load(bytes);
  const fields = doc.getForm().getFields();
  assert.ok(fields.length > 1, `expected several AcroForm fields, got ${fields.length}`);
  assert.equal(doc.getPageCount(), 1, "a non-caster gets one page");
});

await test("pre-fetched portrait bytes are embedded without a fetch", async () => {
  // Smallest valid PNG: 1x1 transparent pixel.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const character = libraryToPdfCharacter({
    name: sheet.name,
    race: sheet.race,
    class: sheet.class,
    subclass: "",
    background: "",
    level: 1,
    sheet: { ...sheet, portrait: { url: "/uploads/nonexistent.png" } },
  });
  const bytes = await buildCharacterSheetPdf(character, { portraitBytes: new Uint8Array(png) });
  const doc = await PDFDocument.load(bytes);
  // pdf-lib registers every embedded image as an XObject in the page tree.
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes("/Subtype /Image"), "an image XObject is present");
  assert.equal(doc.getPageCount(), 1);
});

console.log(`test-character-pdf: ${passed} passed`);
