// A PDF on a lore entry (docs/vtt-parity-implementation-plan.md section
// 5.3): the type and size guards, the text extractor over plain and Flate
// content streams, the chunking, and rule chunks kept apart by source.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-pdf-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { extractPdfText, isEncryptedPdf, isPdf, PDF_MAX_BYTES } = await import("../src/lib/pdf/text.ts");
const { isUploadedPdfPath, isUploadedImagePath } = await import("../src/lib/uploads.ts");
const { chunksForAttachment, feedsRules, rereadRulesAttachments } = await import("../src/lib/dm/lore-attachments.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { listRuleChunks, replaceSourceChunks, setHouseRules, deleteSourceChunks } = await import("../src/lib/db/rules.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// A minimal PDF with one page whose content stream is given raw or deflated.
function pdf(content, { flate = false, encrypted = false } = {}) {
  const body = flate ? deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
  const head = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length ${body.length}${flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`;
  const tail = `\nendstream\nendobj\n${encrypted ? "trailer << /Encrypt 5 0 R >>\n" : ""}%%EOF`;
  return Buffer.concat([Buffer.from(head, "latin1"), body, Buffer.from(tail, "latin1")]);
}

test("only a PDF this app wrote is a PDF path, and pictures stay pictures", () => {
  assert.ok(isUploadedPdfPath("/uploads/abc-123.pdf"));
  assert.ok(!isUploadedPdfPath("/uploads/abc.png"));
  assert.ok(!isUploadedPdfPath("/etc/passwd.pdf"));
  assert.ok(!isUploadedImagePath("/uploads/abc-123.pdf"));
  assert.equal(PDF_MAX_BYTES, 25 * 1024 * 1024);
});

test("the header and the encryption flag are read before anything else", () => {
  assert.ok(isPdf(pdf("BT (x) Tj ET")));
  assert.ok(!isPdf(Buffer.from("hello")));
  assert.ok(isEncryptedPdf(pdf("BT (x) Tj ET", { encrypted: true })));
  assert.equal(extractPdfText(pdf("BT (x) Tj ET", { encrypted: true })), "");
});

test("text comes out of plain and deflated streams, lines where the page breaks them", () => {
  const content = "BT /F1 12 Tf 72 700 Td (Grappling) Tj 0 -14 Td [(A grapple) -250 (is a contest.)] TJ ET";
  assert.equal(extractPdfText(pdf(content)), "Grappling\nA grapple is a contest.");
  assert.equal(extractPdfText(pdf(content, { flate: true })), "Grappling\nA grapple is a contest.");
  assert.equal(extractPdfText(pdf("BT (a \\(b\\) \\101) Tj ET")), "a (b) A");
  assert.equal(extractPdfText(pdf("BT <48656C6C6F> Tj ET")), "Hello");
});

// ---- what one file may cost to read ----
// Deflate packs a run of identical bytes about a thousand to one, so a file
// well under the upload cap can claim gigabytes once inflated. These files
// are small on disk and expensive to read without the limits in pdf/text.ts.

// A PDF of several streams, each { content, flate?, dict? } or a ready
// deflated { body } (so a big body is compressed once and reused).
function pdfOf(parts) {
  const chunks = [Buffer.from("%PDF-1.4\n", "latin1")];
  parts.forEach((part, index) => {
    const body = part.body ?? (part.flate ? deflateSync(Buffer.from(part.content, "latin1")) : Buffer.from(part.content, "latin1"));
    const filter = part.body || part.flate ? " /Filter /FlateDecode" : "";
    chunks.push(
      Buffer.from(`${index + 4} 0 obj << /Length ${body.length}${filter}${part.dict ?? ""} >>\nstream\n`, "latin1"),
      body,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    );
  });
  chunks.push(Buffer.from("%%EOF", "latin1"));
  return Buffer.concat(chunks);
}

test("every page of a book is read, not just the first", () => {
  // Pages that compress past 400 bytes, as real ones do. Each "endstream"
  // used to read as the start of another stream, which swallowed the page
  // after it, so only the first page of a real book ever came out.
  const page = (title) => ({
    flate: true,
    content: `BT (${title}) Tj ET\n${Array.from({ length: 300 }, (_, i) => `${(i * 7919) % 1000} ${(i * 104729) % 800} m ${(i * 31) % 997} ${(i * 17) % 811} l S`).join("\n")}`,
  });
  assert.equal(extractPdfText(pdfOf([page("Page one"), page("Page two"), page("Page three")])), "Page one\n\nPage two\n\nPage three");
});

const MB = 1024 * 1024;
// A page that draws text, padded with spaces to `size` bytes once inflated.
const paddedPage = (text, size) => `BT (${text}) Tj ET${" ".repeat(size - text.length - 12)}`;
const timed = (fn) => {
  const started = Date.now();
  const value = fn();
  return { value, ms: Date.now() - started };
};

test("one stream that inflates far past a page is skipped, not inflated", () => {
  const bomb = deflateSync(Buffer.from(paddedPage("BOMB", 48 * MB), "latin1"), { level: 9 });
  assert.ok(bomb.length < MB, `the bomb is ${bomb.length} bytes on disk`);
  const file = pdfOf([{ body: bomb }, { content: "BT (After) Tj ET" }]);
  const { value, ms } = timed(() => extractPdfText(file));
  assert.equal(value, "After", "the oversized stream was read, or the page after it was lost");
  assert.ok(ms < 2_000, `took ${ms}ms`);
});

test("many streams under the per-stream cap stop at the file's inflate budget", () => {
  const page = (n) => ({ body: deflateSync(Buffer.from(paddedPage(`P${n}`, 4 * MB), "latin1"), { level: 1 }) });
  const file = pdfOf(Array.from({ length: 30 }, (_, n) => page(n)));
  const value = extractPdfText(file);
  assert.ok(value.includes("P0") && value.includes("P10"), "pages inside the budget were lost");
  assert.ok(!value.includes("P20") && !value.includes("P29"), "reading went past the 64 MB budget");
});

test("a file of countless tiny streams stops at the stream cap", () => {
  const parts = Array.from({ length: 20_001 }, () => ({ content: "q Q" }));
  parts.push({ content: "BT (Too far) Tj ET" });
  const { value, ms } = timed(() => extractPdfText(pdfOf(parts)));
  assert.equal(value, "", "a stream past the cap was read");
  assert.ok(ms < 2_000, `took ${ms}ms`);
});

test("pictures are never inflated, so a well-illustrated book keeps its text", () => {
  // Ten 7 MB images would spend the whole budget if they were inflated.
  const picture = deflateSync(Buffer.alloc(7 * MB), { level: 1 });
  const parts = Array.from({ length: 10 }, () => ({ body: picture, dict: " /Type /XObject /Subtype /Image /Width 2000 /Height 1200" }));
  parts.push({ content: "BT (Chapter One) Tj ET", flate: true });
  assert.equal(extractPdfText(pdfOf(parts)), "Chapter One");
});

test("reading stops at the caller's text budget", () => {
  const parts = Array.from({ length: 200 }, (_, n) => ({ content: `BT (Page ${n} ${"text ".repeat(40)}) Tj ET`, flate: true }));
  const file = pdfOf(parts);
  const capped = extractPdfText(file, 1_000);
  assert.ok(capped.length <= 1_000, `got ${capped.length} characters`);
  assert.ok(capped.startsWith("Page 0"));
  assert.ok(!capped.includes("Page 10 "), "pages past the budget were read");
  assert.ok(extractPdfText(file).includes("Page 199"), "without a budget of its own the whole short book is read");
});

test("a rules-tagged entry with a PDF feeds retrieval; others do not", () => {
  assert.ok(feedsRules({ tags: ["Rules"], attachmentPath: "/uploads/a.pdf" }));
  assert.ok(!feedsRules({ tags: ["lore"], attachmentPath: "/uploads/a.pdf" }));
  assert.ok(!feedsRules({ tags: ["rules"], attachmentPath: "" }));
  const chunks = chunksForAttachment("Book", "# Grappling\nA contest.\n\n# Shoving\nAnother contest.");
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, "Grappling");
  const long = chunksForAttachment("Book", Array.from({ length: 600 }, (_, i) => `Paragraph ${i} ${"words ".repeat(12)}`).join("\n\n"));
  assert.ok(long.length > 20, "a long book is walked in windows, not clipped at the first");
});

test("house rules and a PDF's chunks live side by side and are removed apart", () => {
  const user = createUser("dm", "x");
  const campaign = createCampaign(user.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  setHouseRules(campaign.id, "# Crits\nDouble dice.");
  replaceSourceChunks(campaign.id, "entry-1", [{ heading: "Grappling", text: "A contest." }]);
  const both = listRuleChunks(campaign.id);
  assert.deepEqual(both.map((chunk) => chunk.source).sort(), ["entry-1", "house"]);
  setHouseRules(campaign.id, "# Crits\nTriple dice.");
  assert.equal(listRuleChunks(campaign.id).filter((chunk) => chunk.source === "entry-1").length, 1, "a house save keeps the book");
  deleteSourceChunks(campaign.id, "entry-1");
  assert.deepEqual(listRuleChunks(campaign.id).map((chunk) => chunk.source), ["house"]);
});

{
  // Run from the temp folder so the PDF lands in its public/uploads, not the
  // repo's.
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const user = createUser("reread", "x");
    const campaign = createCampaign(user.id, { title: "R", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
    fs.mkdirSync(path.join(dir, "public", "uploads"), { recursive: true });
    const name = "11111111-2222-4333-8444-555555555555.pdf";
    const page = (title) => ({
      flate: true,
      content: `BT (${title}) Tj ET\n${Array.from({ length: 300 }, (_, i) => `${(i * 7919) % 1000} ${(i * 104729) % 800} m ${(i * 31) % 997} ${(i * 17) % 811} l S`).join("\n")}`,
    });
    fs.writeFileSync(path.join(dir, "public", "uploads", name), pdfOf([page("Grappling"), page("Shoving")]));
    const entry = insertLoreEntry({ campaignId: campaign.id, category: "other", title: "Book", body: "", tags: ["rules"], attachmentPath: `/uploads/${name}` });
    // What the old reader left behind: the first page only.
    replaceSourceChunks(campaign.id, entry.id, [{ heading: "Book", text: "Grappling" }]);
    assert.equal(await rereadRulesAttachments(), 1);
    const text = listRuleChunks(campaign.id).filter((chunk) => chunk.source === entry.id).map((chunk) => chunk.text).join("\n");
    assert.match(text, /Shoving/, "the second page arrived");
    assert.equal(await rereadRulesAttachments(), 0, "it runs once");
    passed += 1;
    console.log("ok: rules PDFs already on the server are read again, whole, once");
  } finally {
    process.chdir(cwd);
  }
}

console.log(`test-pdf-attachment: ${passed} passed`);
