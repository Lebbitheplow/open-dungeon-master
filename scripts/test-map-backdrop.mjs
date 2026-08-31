// The picture under the grid. Nothing here decides a rule; what it decides
// is where an image lands and whether a stored path is one this app wrote,
// which is the part that would otherwise be a directory traversal.
// See docs/workshop-plan.md phase 4.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  BACKDROP_LIMITS,
  DEFAULT_BACKDROP_TRANSFORM,
  backdropRect,
  isBackdropPath,
  isDefaultTransform,
  normalizeBackdrop,
  normalizeBackdropTransform,
} = await import("../src/lib/battlemap/backdrop.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// ---- what counts as one of our files ----

test("a file this app uploaded is accepted", () => {
  assert.equal(isBackdropPath("/uploads/2f1c8b1e-0000-4000-8000-abcdefabcdef.png"), true);
  assert.equal(isBackdropPath("/uploads/abc123.jpg"), true);
  assert.equal(isBackdropPath("/uploads/abc123.jpeg"), true);
  assert.equal(isBackdropPath("/uploads/abc123.webp"), true);
});

test("a path that climbs out of uploads is refused", () => {
  assert.equal(isBackdropPath("/uploads/../../etc/passwd"), false);
  assert.equal(isBackdropPath("/uploads/../secrets.png"), false);
  assert.equal(isBackdropPath("../uploads/a.png"), false);
});

test("somebody else's server is refused", () => {
  assert.equal(isBackdropPath("https://example.com/a.png"), false);
  assert.equal(isBackdropPath("//example.com/a.png"), false);
  assert.equal(isBackdropPath("data:image/png;base64,AAAA"), false);
});

test("a file outside uploads is refused even with the right extension", () => {
  assert.equal(isBackdropPath("/public/a.png"), false);
  assert.equal(isBackdropPath("/a.png"), false);
});

test("a type this app does not write is refused", () => {
  assert.equal(isBackdropPath("/uploads/a.svg"), false, "svg can carry script");
  assert.equal(isBackdropPath("/uploads/a.gif"), false);
  assert.equal(isBackdropPath("/uploads/a"), false);
});

test("nothing at all is not a backdrop", () => {
  assert.equal(isBackdropPath(""), false);
  assert.equal(isBackdropPath(null), false);
  assert.equal(isBackdropPath(undefined), false);
  assert.equal(isBackdropPath(42), false);
});

// ---- the transform ----

test("a missing transform becomes the default rather than nothing", () => {
  assert.deepEqual(normalizeBackdropTransform(undefined), DEFAULT_BACKDROP_TRANSFORM);
  assert.deepEqual(normalizeBackdropTransform({}), DEFAULT_BACKDROP_TRANSFORM);
});

test("an absurd offset is clamped, not refused", () => {
  const transform = normalizeBackdropTransform({ offsetX: 9999, offsetY: -9999 });
  assert.equal(transform.offsetX, BACKDROP_LIMITS.maxOffset);
  assert.equal(transform.offsetY, -BACKDROP_LIMITS.maxOffset);
});

test("a scale of zero is clamped to something visible", () => {
  // A picture scaled to nothing is a picture the DM cannot find again.
  assert.equal(normalizeBackdropTransform({ scale: 0 }).scale, BACKDROP_LIMITS.minScale);
  assert.equal(normalizeBackdropTransform({ scale: 500 }).scale, BACKDROP_LIMITS.maxScale);
});

test("opacity stays between none and all of it", () => {
  assert.equal(normalizeBackdropTransform({ opacity: -3 }).opacity, 0);
  assert.equal(normalizeBackdropTransform({ opacity: 3 }).opacity, 1);
});

test("garbage in a stored transform reads as the default", () => {
  const transform = normalizeBackdropTransform({ scale: "wide", offsetX: null, opacity: {} });
  assert.deepEqual(transform, DEFAULT_BACKDROP_TRANSFORM);
});

test("the default transform knows it is the default", () => {
  assert.equal(isDefaultTransform(DEFAULT_BACKDROP_TRANSFORM), true);
  assert.equal(isDefaultTransform(normalizeBackdropTransform({ scale: 1.5 })), false);
});

// ---- reading a row back ----

test("a row with no picture reads as no backdrop", () => {
  assert.equal(normalizeBackdrop("", {}), null);
});

test("a row with a path nobody wrote reads as no backdrop", () => {
  // Belt and braces: even if a row were tampered with, nothing renders it.
  assert.equal(normalizeBackdrop("/uploads/../../etc/passwd", {}), null);
});

test("a real row reads back whole", () => {
  const backdrop = normalizeBackdrop("/uploads/a.png", { scale: 1.25, opacity: 0.5 });
  assert.equal(backdrop.path, "/uploads/a.png");
  assert.equal(backdrop.transform.scale, 1.25);
  assert.equal(backdrop.transform.opacity, 0.5);
});

// ---- where the picture lands ----

test("an untouched picture covers exactly the board", () => {
  const rect = backdropRect(DEFAULT_BACKDROP_TRANSFORM, 20, 15, 32);
  assert.deepEqual(rect, { x: 0, y: 0, width: 640, height: 480 });
});

test("scaling grows the picture about its middle, not its corner", () => {
  // Otherwise zooming in would also walk the image off the top left and the
  // DM would have to chase it with the offset sliders.
  const rect = backdropRect(normalizeBackdropTransform({ scale: 2 }), 10, 10, 32);
  assert.equal(rect.width, 640);
  assert.equal(rect.x, -160);
  assert.equal(rect.x + rect.width, 480);
  assert.equal(rect.x + rect.width / 2, 160, "the centre moved");
});

test("an offset is measured in tiles, so a nudge means the same at any zoom", () => {
  const near = backdropRect(normalizeBackdropTransform({ offsetX: 2 }), 10, 10, 32);
  const far = backdropRect(normalizeBackdropTransform({ offsetX: 2, scale: 3 }), 10, 10, 32);
  assert.equal(near.x, 64);
  assert.equal(far.x - (10 * 32 - 10 * 32 * 3) / 2, 64);
});

test("a half-tile nudge is allowed, because grids do not always line up", () => {
  const rect = backdropRect(normalizeBackdropTransform({ offsetX: 0.5 }), 10, 10, 32);
  assert.equal(rect.x, 16);
});

console.log(`map backdrop: ${passed} assertions passed.`);
