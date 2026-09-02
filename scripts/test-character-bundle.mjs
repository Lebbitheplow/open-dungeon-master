// The portable character file (src/lib/character-bundle.ts): a sheet and its
// portrait survive the round trip, and the door refuses what it should. The
// reader and writer are fakes, so the format is exercised without a disk;
// the traversal guard is what keeps the export reader from ever being
// handed a path this app did not write.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  CHARACTER_BUNDLE_KIND,
  CHARACTER_BUNDLE_VERSION,
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_PORTRAIT_BYTES,
  buildCharacterBundle,
  characterBundleFilename,
  characterBundleSchema,
  dataUrlBytes,
  parseCharacterBundle,
  unpackCharacterBundle,
} = await import("../src/lib/character-bundle.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { isUploadedImagePath } = await import("../src/lib/uploads.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const sheet = createSheetSchema.parse({
  name: "Testa Quill",
  race: "halfling",
  class: "rogue",
  abilities: { str: 8, dex: 17, con: 12, int: 13, wis: 10, cha: 14 },
  maxHp: 9,
  ac: 14,
  hitDice: { die: "d8", total: 1, spent: 0 },
  proficiencies: { saves: ["dex", "int"], skills: ["stealth"], languages: [], tools: [], armor: [], weapons: [] },
  backstory: "Grew up picking locks.",
  portrait: { id: "abc", name: "Testa.webp", type: "image/webp", url: "/uploads/abc.webp" },
});

function character(overrides = {}) {
  return { name: "Testa Quill", level: 3, sheet, ...overrides };
}

const readerSeen = [];
async function fakeReader(url) {
  readerSeen.push(url);
  return { bytes: new Uint8Array(PNG_BYTES), type: "image/png" };
}

const written = [];
async function fakeWriter(bytes, type) {
  written.push({ bytes, type });
  return { id: "fresh", url: `/uploads/fresh.${type === "image/png" ? "png" : "webp"}` };
}

await test("export inlines the portrait and strips the stored path", async () => {
  readerSeen.length = 0;
  const bundle = await buildCharacterBundle(character(), fakeReader, new Date("2026-09-02T00:00:00Z"));
  assert.equal(bundle.kind, CHARACTER_BUNDLE_KIND);
  assert.equal(bundle.version, CHARACTER_BUNDLE_VERSION);
  assert.equal(bundle.exportedAt, "2026-09-02T00:00:00.000Z");
  assert.equal(bundle.level, 3);
  assert.equal(bundle.sheet.portrait, null, "the old host's path does not travel");
  assert.deepEqual(readerSeen, ["/uploads/abc.webp"]);
  assert.ok(bundle.portrait.dataUrl.startsWith("data:image/png;base64,"));
  assert.equal(bundle.portrait.type, "image/png");
  assert.equal(dataUrlBytes(bundle.portrait.dataUrl), PNG_BYTES.length);
  // What we built is what we accept.
  assert.ok(characterBundleSchema.safeParse(JSON.parse(JSON.stringify(bundle))).success);
});

await test("round trip: import writes a fresh file and rewires the sheet", async () => {
  written.length = 0;
  const bundle = await buildCharacterBundle(character(), fakeReader);
  const parsed = parseCharacterBundle(JSON.parse(JSON.stringify(bundle)));
  assert.ok(parsed.ok, parsed.error);
  const unpacked = await unpackCharacterBundle(parsed.bundle, fakeWriter);
  assert.equal(unpacked.level, 3);
  assert.equal(unpacked.carriedPortrait, true);
  assert.equal(written.length, 1);
  assert.equal(written[0].type, "image/png");
  assert.deepEqual(Buffer.from(written[0].bytes), PNG_BYTES);
  assert.equal(unpacked.sheet.portrait.url, "/uploads/fresh.png");
  assert.equal(unpacked.sheet.portrait.id, "fresh");
  assert.equal(unpacked.sheet.backstory, "Grew up picking locks.");
  assert.equal(unpacked.sheet.abilities.dex, 17);
});

await test("a bundle without a portrait imports with none and asks for a painting", async () => {
  written.length = 0;
  const bare = await buildCharacterBundle(
    character({ sheet: { ...sheet, portrait: null } }),
    fakeReader,
  );
  assert.equal(bare.portrait, undefined);
  const parsed = parseCharacterBundle(bare);
  assert.ok(parsed.ok);
  const unpacked = await unpackCharacterBundle(parsed.bundle, fakeWriter);
  assert.equal(unpacked.carriedPortrait, false);
  assert.equal(unpacked.sheet.portrait, null);
  assert.equal(written.length, 0);
});

await test("portrait paths outside /uploads/ are never read", async () => {
  for (const url of [
    "/etc/passwd",
    "/uploads/../secret.png",
    "https://evil.example/x.png",
    "/uploads/x.svg",
    "uploads/abc.png",
    "/uploads/abc.png/../../etc/passwd",
  ]) {
    readerSeen.length = 0;
    assert.equal(isUploadedImagePath(url), false, url);
    const bundle = await buildCharacterBundle(
      character({ sheet: { ...sheet, portrait: { url } } }),
      fakeReader,
    );
    assert.deepEqual(readerSeen, [], `${url} reached the reader`);
    assert.equal(bundle.portrait, undefined);
  }
});

await test("a missing portrait file exports the sheet alone", async () => {
  const bundle = await buildCharacterBundle(character(), async () => null);
  assert.equal(bundle.portrait, undefined);
  assert.equal(bundle.sheet.name, "Testa Quill");
});

await test("wrong kind and version are refused by name", async () => {
  const bundle = await buildCharacterBundle(character(), fakeReader);
  const kind = parseCharacterBundle({ ...bundle, kind: "odm.workshop" });
  assert.equal(kind.ok, false);
  assert.match(kind.error, /Not an Open Dungeon Master character file/);
  const version = parseCharacterBundle({ ...bundle, version: 2 });
  assert.equal(version.ok, false);
  assert.match(version.error, /version \(2\)/);
  assert.equal(parseCharacterBundle(null).ok, false);
  assert.equal(parseCharacterBundle("x").ok, false);
  assert.equal(parseCharacterBundle([]).ok, false);
});

await test("oversize data URLs are refused", async () => {
  const bundle = await buildCharacterBundle(character(), fakeReader);
  // Just over 8 MB decoded, as a syntactically valid base64 body.
  const tooBig = "A".repeat(Math.ceil(((MAX_BUNDLE_PORTRAIT_BYTES + 3) * 4) / 3 / 4) * 4);
  const result = parseCharacterBundle({
    ...bundle,
    portrait: { ...bundle.portrait, dataUrl: `data:image/png;base64,${tooBig}` },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /8MB/);
  // The declared byte length is judged before the schema runs.
  const huge = parseCharacterBundle(bundle, MAX_BUNDLE_BYTES + 1);
  assert.equal(huge.ok, false);
  assert.match(huge.error, /12MB/);
  assert.ok(parseCharacterBundle(bundle, MAX_BUNDLE_BYTES).ok);
});

await test("portrait type must match its data URL and be an image", async () => {
  const bundle = await buildCharacterBundle(character(), fakeReader);
  const mismatched = parseCharacterBundle({
    ...bundle,
    portrait: { ...bundle.portrait, type: "image/webp" },
  });
  assert.equal(mismatched.ok, false);
  const svg = parseCharacterBundle({
    ...bundle,
    portrait: { ...bundle.portrait, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
  });
  assert.equal(svg.ok, false);
});

await test("an invalid sheet is refused with its field named", async () => {
  const bundle = await buildCharacterBundle(character(), fakeReader);
  const result = parseCharacterBundle({ ...bundle, sheet: { ...bundle.sheet, maxHp: 0 } });
  assert.equal(result.ok, false);
  assert.match(result.error, /^sheet\.maxHp/);
});

await test("export filename is a slug", () => {
  assert.equal(characterBundleFilename("Testa Quill!"), "testa-quill.odm-character.json");
  assert.equal(characterBundleFilename("   "), "character.odm-character.json");
});

console.log(`test-character-bundle: ${passed} passed`);
