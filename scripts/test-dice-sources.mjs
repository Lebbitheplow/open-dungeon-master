// Per-die dice sources: how a stored preference map is read back, and how a
// single face resolves to manual typing, a server roll, or a connected Pixels
// die. The resolution rules live in a pure function precisely so this file
// can hold them still: a missing or mismatched Pixel degrades to typing, and
// the d100 never resolves to a Pixel at all.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  DIE_SIDES,
  defaultDiceSources,
  parseStored,
  pixelSource,
  pixelSystemId,
  resolveFaceSource,
} = await import("../src/lib/dice/dice-sources.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// ---- the stored map ----

test("every die shape defaults to manual", () => {
  const map = defaultDiceSources();
  for (const sides of DIE_SIDES) {
    assert.equal(map[sides], "manual", `d${sides} should default to manual`);
  }
});

test("a stored map fills only the shapes it names", () => {
  const map = parseStored(JSON.stringify({ 20: "digital", 6: "pixel:abc" }));
  assert.equal(map[20], "digital");
  assert.equal(map[6], "pixel:abc");
  assert.equal(map[4], "manual");
  assert.equal(map[100], "manual");
});

test("junk in storage reads as the defaults rather than throwing", () => {
  const junk = parseStored("{not json");
  for (const sides of DIE_SIDES) {
    assert.equal(junk[sides], "manual");
  }
  const empty = parseStored("");
  assert.equal(empty[20], "manual");
});

test("a shape stored as something other than a string is ignored", () => {
  const map = parseStored(JSON.stringify({ 20: 7, 8: "digital" }));
  assert.equal(map[20], "manual");
  assert.equal(map[8], "digital");
});

// ---- the pixel source string ----

test("a pixel source string round-trips its system id", () => {
  assert.equal(pixelSystemId(pixelSource("die-123")), "die-123");
});

test("manual and digital carry no system id", () => {
  assert.equal(pixelSystemId("manual"), null);
  assert.equal(pixelSystemId("digital"), null);
  assert.equal(pixelSystemId(undefined), null);
});

// ---- face resolution ----

const D20_PIXEL = { systemId: "px-1", faceCount: 20, name: "Emberstone" };

test("no preference means typing", () => {
  assert.deepEqual(resolveFaceSource(undefined, 20, [D20_PIXEL]), { kind: "manual" });
  assert.deepEqual(resolveFaceSource("manual", 20, [D20_PIXEL]), { kind: "manual" });
});

test("a digital preference asks the server, whatever is connected", () => {
  assert.deepEqual(resolveFaceSource("digital", 20, [D20_PIXEL]), { kind: "digital" });
  assert.deepEqual(resolveFaceSource("digital", 100, []), { kind: "digital" });
});

test("a connected matching pixel resolves to it, name and all", () => {
  assert.deepEqual(resolveFaceSource("pixel:px-1", 20, [D20_PIXEL]), {
    kind: "pixel",
    systemId: "px-1",
    name: "Emberstone",
  });
});

test("an assigned but absent pixel degrades to typing", () => {
  assert.deepEqual(resolveFaceSource("pixel:px-1", 20, []), { kind: "manual" });
  assert.deepEqual(resolveFaceSource("pixel:px-gone", 20, [D20_PIXEL]), {
    kind: "manual",
  });
});

test("a pixel whose face count does not match the die degrades to typing", () => {
  assert.deepEqual(resolveFaceSource("pixel:px-1", 8, [D20_PIXEL]), { kind: "manual" });
});

test("the d100 never resolves to a pixel", () => {
  const impossible = { systemId: "px-100", faceCount: 100, name: "NotReal" };
  assert.deepEqual(resolveFaceSource("pixel:px-100", 100, [impossible]), {
    kind: "manual",
  });
});

console.log(`dice-sources: ${passed} tests passed`);
