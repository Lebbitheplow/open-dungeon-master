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
const { chunksForAttachment, feedsRules } = await import("../src/lib/dm/lore-attachments.ts");
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

console.log(`test-pdf-attachment: ${passed} passed`);
