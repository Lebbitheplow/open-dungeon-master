// A board view draws the board once. Under an addon's view the table kept
// drawing the flat board too: the grid with its torches and dust, the
// weather, a painted picture nobody saw. Every report of where the view drew
// its figures re-rendered the whole board panel, and with the tabletop
// enlarged the panel's own copy of the view went on rendering every frame
// behind the dialog, so a 3D view ran twice.
//
// Now the grid rests hidden under a view (an empty board of the same shape
// keeps the frame's size, and it comes back for drawing), the action ring
// follows the newest anchors once a frame, and the panel's frame is hidden
// while the tabletop is open, which all but stops its animation frames.
import { readFileSync } from "node:fs";
import { check, eventually, sleep, untilStill } from "../lib.mjs";

// The example addon's view, served as a fixture (18-table-layout.mjs does the
// same). The page in the frame also keeps the last snapshot and counts its
// own animation frames, so the checks can read both.
async function installFixture(page) {
  await page.route("**/api/addons", (route) => route.fulfill({ json: {
    supported: true, workshopImporters: [], mapGenerators: [],
    boardViews: [
      { addonId: "covered-fixture", addonName: "Fixture", addonVersion: "1.0.0", id: "table", title: "Fixture table", description: "", needsViewData: false, options: [], url: "/api/addons/covered-fixture/ui/index.html" },
      // Its addon's threads permission was accepted (86-board-view-threads proves what that gives).
      { addonId: "covered-fixture", addonName: "Fixture", addonVersion: "1.0.0", id: "deep", title: "Fixture threads", description: "", needsViewData: false, options: [], url: "/api/addons/covered-fixture/ui/index.html", threads: true },
    ],
  } }));
  await page.route("**/api/addons/covered-fixture/ui/**", (route) => {
    const script = new URL(route.request().url()).pathname.endsWith("board.js");
    const body = readFileSync(new URL(`../../../examples/addons/hello-dungeon/ui/board.${script ? "js" : "html"}`, import.meta.url), "utf8");
    const probe = "<script>window.__frames = 0; (function tick() { window.__frames += 1; requestAnimationFrame(tick); })(); addEventListener('message', (e) => { if (e.source === parent && e.data?.odm === 1 && e.data.type === 'snapshot') window.__snapshot = e.data.snapshot; });</script>";
    return route.fulfill({ contentType: script ? "text/javascript" : "text/html", body: script ? body : body.replace('<script src="board.js">', `${probe}<script src="board.js">`) });
  });
}

// The context counts every tour as seen (newContext), and open() closes
// whatever greets the page; a tour still showing is closed here, each press
// waiting for it to go rather than for a set time.
async function dismissTour(page) {
  const tour = page.locator('[role="dialog"][aria-label="Guided tour"]');
  for (let attempt = 0; attempt < 3 && (await tour.count()); attempt += 1) {
    await page.keyboard.press("Escape");
    await tour.first().waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
  }
}

// How many animation frames a frame's page ran in a second.
async function framesPerSecond(frame) {
  const start = await frame.evaluate(() => window.__frames);
  // Time is the check: the frames counted over one second are the rate.
  await sleep(1000);
  return (await frame.evaluate(() => window.__frames)) - start;
}

// React's commits, counted through the hook its developer tools use (a
// production build calls it too), so a render that changes nothing on screen,
// the whole panel redone for a ring that did not move, can be told from none.
const countCommits = () => {
  window.__commits = 0;
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject: () => 1, onCommitFiberRoot: () => { window.__commits += 1; }, onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {}, checkDCE: () => {} };
  }
};

// The page's commits while `run` goes, beside an idle stretch just before.
async function commitsWhile(page, run) {
  const count = () => page.evaluate(() => window.__commits);
  const a = await count();
  // Time is the check: the commits of an idle while are the baseline.
  await sleep(600);
  const idle = (await count()) - a;
  const b = await count();
  await run();
  // Time is the check: the renders the run set off land within this while.
  await sleep(150);
  return { idle, busy: (await count()) - b };
}

// The view reporting a figure's anchor once a frame for `frames` frames, as a
// camera sweep would.
const sweep = (view, tokenId, frames) =>
  view.evaluate(({ tokenId, frames }) => new Promise((done) => {
    let step = 0;
    (function next() {
      step += 1;
      parent.postMessage({ odm: 1, type: "anchors", tokens: { [tokenId]: [0.2 + step / 100, 0.5, 0.6] } }, "*");
      if (step < frames) requestAnimationFrame(next); else done();
    })();
  }), { tokenId, frames });

export default {
  name: "board-view-covered",
  viewports: ["desktop"],
  app: false,
  async run(t) {
    const { page, root, ids } = t;
    await installFixture(page);
    await page.addInitScript(countCommits);
    await t.open(`/campaigns/${ids.campaignId}`);
    await dismissTour(page);
    const board = page.locator(`${root}[aria-label^="Board view"]`).locator("visible=true").first();
    const grid = board.locator('svg[aria-label="Battle map"]');
    await eventually(() => grid.isVisible(), { timeoutMs: 30_000, label: "the flat board" });
    const flat = await board.boundingBox();

    await t.tap(page.getByRole("radio", { name: "Fixture table", exact: true }));
    const inline = board.locator("iframe");
    await eventually(() => inline.count(), { label: "the view's frame" });
    const view = await (await inline.elementHandle()).contentFrame();
    await eventually(() => view.evaluate(() => Boolean(window.__snapshot)), { label: "the view's first snapshot" });

    check(
      await inline.evaluate((node) => node.hasAttribute("credentialless") && node.getAttribute("sandbox") === "allow-scripts" && node.getAttribute("allow") === ""),
      "the frame is sandboxed and credentialless, and without the threads permission it is allowed no isolation",
    );
    check(!(await grid.isVisible()), "under a board view the flat grid is not drawn");
    check((await grid.count()) === 1, "it stays mounted, so the effects it reports as played still are");
    check(!(await board.locator("canvas[data-painted-map]").isVisible()), "nor is the painted picture shown under the view");
    const covered = await board.boundingBox();
    check(Math.abs(covered.width - flat.width) < 2 && Math.abs(covered.height - flat.height) < 2, `the frame keeps the flat board's size (${flat.width}x${flat.height} then ${covered.width}x${covered.height})`);
    // The View switch slides to its choice and the frame paints its first picture.
    await untilStill(page);
    await t.shot("covered");

    // Where the view drew the figures: nothing on the page reads them until a
    // ring or a plate is open, so a camera sweep costs the page no renders.
    const mine = await view.evaluate(() => window.__snapshot.myTokenId);
    check(Boolean(mine), "the seeded player has a figure on the board");
    const unread = await commitsWhile(page, () => sweep(view, mine, 36));
    check(unread.busy - unread.idle <= 2, `a sweep of 36 frames with no ring open re-renders nothing (${unread.busy} commits, ${unread.idle} idle)`);

    // The action ring sits on the figure the view drew, and a burst of
    // reports in one go moves it once, to the newest.
    await view.evaluate((tokenId) => parent.postMessage({ odm: 1, type: "token", tokenId }, "*"), mine);
    const ring = page.locator(`${root}[role="menu"][aria-label^="Actions for"] > div`).first();
    await eventually(() => ring.count(), { label: "the action ring on the player's figure" });
    await view.evaluate((tokenId) => parent.postMessage({ odm: 1, type: "anchors", tokens: { [tokenId]: [0.25, 0.5, 0.6] } }, "*"), mine);
    await eventually(async () => (await ring.getAttribute("style"))?.includes("left: 25%"), { label: "the ring moving to the reported anchor" });
    const burst = await commitsWhile(page, () => view.evaluate((tokenId) => {
      for (let step = 1; step <= 30; step += 1) parent.postMessage({ odm: 1, type: "anchors", tokens: { [tokenId]: [0.25 + step / 60, 0.5, 0.6] } }, "*");
    }, mine));
    await eventually(async () => (await ring.getAttribute("style"))?.includes("left: 75%"), { label: "the ring at the newest of thirty reports" });
    check(burst.busy - burst.idle <= 1, `thirty reports sent at once are one render (${burst.busy} commits, ${burst.idle} idle)`);
    // The same report again moves nothing, so nothing renders.
    const still = await commitsWhile(page, () => view.evaluate((tokenId) => parent.postMessage({ odm: 1, type: "anchors", tokens: { [tokenId]: [0.75, 0.5, 0.6] } }, "*"), mine));
    check(still.busy <= still.idle, `an anchor that did not move re-renders nothing (${still.busy} commits, ${still.idle} idle)`);
    await view.evaluate((tokenId) => parent.postMessage({ odm: 1, type: "token", tokenId }, "*"), mine);
    await eventually(async () => (await ring.count()) === 0, { label: "the ring closed" });

    // The enlarged tabletop: its own view draws, the panel's rests hidden.
    await t.tap(page.getByRole("button", { name: "Enlarge battle map", exact: true }));
    const enlarged = page.getByRole("dialog").locator("iframe");
    await eventually(() => enlarged.count(), { label: "the enlarged view's frame" });
    const big = await (await enlarged.elementHandle()).contentFrame();
    await eventually(() => big.evaluate(() => Boolean(window.__snapshot)), { label: "the enlarged view's snapshot" });
    check(!(await inline.isVisible()), "the panel's own view is hidden behind the open tabletop");
    const hiddenRate = await framesPerSecond(view);
    const shownRate = await framesPerSecond(big);
    check(hiddenRate <= 5, `the hidden panel view all but stops drawing (${hiddenRate} frames a second)`);
    check(shownRate >= 20, `the tabletop's view draws on (${shownRate} frames a second)`);
    await untilStill(page);
    await t.shot("enlarged");
    await t.tap(page.getByRole("button", { name: "Close the board", exact: true }));
    await eventually(async () => (await page.getByRole("dialog").count()) === 0, { label: "the tabletop closed" });
    await eventually(() => inline.isVisible(), { label: "the panel's view shown again" });
    check((await framesPerSecond(view)) >= 20, "and drawing again, the same page, not a reload");
    check(await view.evaluate(() => Boolean(window.__snapshot)), "it kept the board it was sent while hidden");

    // Drawing uses the grid: the pencil brings it back, putting it away covers it again.
    const pencil = page.getByRole("button", { name: "Draw on the board" }).locator("visible=true").first();
    await t.tap(pencil);
    await eventually(() => grid.isVisible(), { label: "the grid back for drawing" });
    check((await inline.count()) === 0, "the view steps aside while drawing");
    await t.tap(pencil);
    await eventually(async () => (await inline.count()) === 1 && !(await grid.isVisible()), { label: "the view covering the grid again" });

    // A view whose addon was given threads: its frame may be isolated.
    await t.tap(page.getByRole("radio", { name: "Fixture threads", exact: true }));
    await eventually(() => inline.evaluate((node) => node.getAttribute("allow") === "cross-origin-isolated" && node.hasAttribute("credentialless")).catch(() => false), {
      label: "the threads view's frame allowed isolation",
    });

    // The flat board again: the grid draws and fills the same frame.
    await t.tap(page.getByRole("radio", { name: "Board", exact: true }));
    await eventually(() => grid.isVisible(), { label: "the flat board back" });
    const back = await board.boundingBox();
    check(Math.abs(back.height - flat.height) < 2, "the board is the size it was");
  },
};
