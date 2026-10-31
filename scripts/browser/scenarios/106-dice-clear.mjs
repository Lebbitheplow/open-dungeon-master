// Issue 668: one, later two, 3D d20s stayed parked over the Hand, the
// composer and the right rail through fights and after them. The overlay
// awaited the dice library's throw with no deadline, and the library
// settles a throw only from inside its own animation-frame loop: a loop
// that stopped (a frame that threw, a hidden tab, a lost context) left the
// throw pending forever, its dice drawn on the canvas, and every later roll
// queued behind it. Now a throw that does not land in time takes its tray
// with it, a hidden tab throws nothing, and the overlay says which state it
// is in (data-dice), which is what this scenario reads.
import { check, eventually, sleep } from "../lib.mjs";

const DEADLINE_MS = 10_000;

export default {
  name: "dice-clear",
  viewports: ["desktop"],
  async run(t) {
    const { page, root, ids, base, api } = t;
    // 3D dice are on unless this browser switched them off.
    const plant = () => window.localStorage.removeItem("odm:dice3d");
    await page.context().addInitScript(plant);
    if (t.app) await page.evaluate(plant);
    await t.open(`/campaigns/${ids.quietId}`);
    const overlay = page.locator(`${root}#dice-overlay`);
    await eventually(() => overlay.count(), { timeoutMs: 30_000, label: "the dice overlay" });
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    });
    if (!webgl) {
      // Headless Chromium without a GL backend builds no tray at all; the
      // pure deadlines are covered by scripts/test-dice-lifecycle.mjs.
      console.log("[dice-clear] no WebGL in this browser: the 3D tray cannot be built here, skipped");
      return;
    }
    const roll = async () => {
      const response = await api.post(`${base}/api/campaigns/${ids.quietId}/rolls`, { data: { expression: "1d20" } });
      check(response.ok(), `the roll was refused (${response.status()})`);
    };
    const state = () => overlay.getAttribute("data-dice");

    // A clean throw lands, clears and goes idle.
    await roll();
    await eventually(async () => (await state()) === "rolling", { timeoutMs: 10_000, label: "the throw starting" });
    await eventually(async () => (await state()) === "idle", { timeoutMs: DEADLINE_MS + 5_000, label: "the throw landing and clearing" });

    // A throw whose frame loop stops never lands: it must still be cleared,
    // canvas and all, once the deadline passes.
    await page.evaluate(() => {
      window.__odmRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
    });
    await roll();
    await eventually(async () => (await state()) === "rolling", { timeoutMs: 10_000, label: "the stuck throw starting" });
    await eventually(async () => (await state()) === "idle" && (await overlay.locator("canvas").count()) === 0, {
      timeoutMs: DEADLINE_MS + 6_000,
      label: "the stuck throw cleared with its canvas",
    });
    await page.evaluate(() => {
      window.requestAnimationFrame = window.__odmRaf;
    });
    await t.shot("dice-cleared");

    // A hidden tab throws nothing: the roll would freeze mid-air and replay
    // stale when the seat came back.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await roll();
    await sleep(2_500);
    check((await state()) === "idle", `a hidden tab threw the dice (data-dice=${await state()})`);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // And the table still throws once it is back in view.
    await roll();
    await eventually(async () => (await state()) === "rolling", { timeoutMs: 10_000, label: "a throw after the tab came back" });
    await eventually(async () => (await state()) === "idle", { timeoutMs: DEADLINE_MS + 5_000, label: "that throw clearing" });
  },
};
