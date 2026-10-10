// The board's resting view (src/lib/battlemap/camera-fit.ts, issue 87): a
// board in a frame as tall as itself rests as it always did, and a board in
// a fixed window is shrunk until all of it shows.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { fitCamera, minZoomFor, clampZoomTo, MIN_ZOOM, MAX_ZOOM } = await import("../src/lib/battlemap/camera-fit.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

test("a frame sized by its own board rests on the plain view", () => {
  // 20 by 15 tiles in a 400 px panel: the frame is 300 px tall.
  assert.deepEqual(fitCamera({ width: 400, height: 300 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0 });
  // Rounding either way is still the plain view.
  assert.deepEqual(fitCamera({ width: 401, height: 300 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0 });
});

test("a frame taller than its board rests on the plain view, the board in the middle of it", () => {
  // The enlarged tabletop: 400 px wide, 900 tall, a 300 px board centred.
  assert.deepEqual(fitCamera({ width: 400, height: 900 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 300 });
  // A pixel of rounding slack is still the plain view, not half a pixel down.
  assert.deepEqual(fitCamera({ width: 400, height: 301 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0.5 });
});


test("a short window shrinks the board to show all of it, centred", () => {
  // The fight stage on a 1080p screen: 1188 by 562 for a 4:3 board.
  const fit = fitCamera({ width: 1188, height: 562 }, { width: 20, height: 15 });
  assert.ok(Math.abs(fit.zoom - 562 / 891) < 1e-9);
  assert.equal(fit.y, 0);
  // The board's width at that zoom, centred in the frame.
  assert.ok(Math.abs(fit.x - (1188 - 1188 * fit.zoom) / 2) < 1e-9);
  // And it does fill the height exactly.
  assert.ok(Math.abs(891 * fit.zoom - 562) < 1e-9);
});

test("a frame with no size yet is the plain view, not a division by zero", () => {
  assert.deepEqual(fitCamera({ width: 0, height: 0 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0 });
  assert.deepEqual(fitCamera({ width: 400, height: 300 }, { width: 0, height: 0 }), { zoom: 1, x: 0, y: 0 });
});

test("the view may zoom out as far as the fit, and no further than before otherwise", () => {
  assert.equal(minZoomFor({ zoom: 1, x: 0, y: 0 }), MIN_ZOOM);
  assert.equal(minZoomFor({ zoom: 0.3, x: 10, y: 0 }), 0.3);
  assert.equal(clampZoomTo(0.1, 0.3), 0.3);
  assert.equal(clampZoomTo(0.1, MIN_ZOOM), MIN_ZOOM);
  assert.equal(clampZoomTo(9, MIN_ZOOM), MAX_ZOOM);
  assert.equal(clampZoomTo(1.5, MIN_ZOOM), 1.5);
});

console.log(`\n${passed} board fit checks passed`);
