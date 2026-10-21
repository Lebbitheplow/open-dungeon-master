// The browser half of the large-world measurements (audit WF-24, plan M6;
// docs/worldforge-large-worlds.md has the method and the numbers). Not a
// check: it runs only when named in full,
//
//   node scripts/browser/run.mjs --only large-world-measure --out <folder>
//
// and prints one MEASURE line of JSON per world size and viewport. For each
// size (ODM_MEASURE_SIZES, default 100,1000,4000) it brings the world from
// scripts/lib/large-world.mjs into a fresh workshop through the WorldForge
// file import, then records:
//   - world: the world route's answer: its time, and its size on the wire;
//   - firstUsable (median of 3): from opening the World tab to the entry list showing its
//     first entry, with the search box ready (afterAnswer: the part of it
//     after the world route answered);
//   - search (median of 3): from typing a name, a word deep in a body and a custom field's
//     value to the entry that holds it showing in the list (a miss is
//     recorded as such after 4 s);
//   - listRender: from clearing the search to the whole list back;
//   - scroll: the list scrolled top to bottom in 40 frames, the longest frame
//     and the mean;
//   - graph: from pressing Web to the web drawn and settled;
//   - heapMb: the page's JavaScript heap after all of it.
// Times are wall-clock from the test runner, so each includes a few
// milliseconds of the runner's own polling.
import { largeWorld } from "../../lib/large-world.mjs";
import { check } from "../lib.mjs";

const SEARCH_MISS_MS = 4_000;
const TRIES = 3;

export default {
  name: "large-world-measure",
  onlyWhenNamed: true,
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api, viewport } = t;
    const sizes = (process.env.ODM_MEASURE_SIZES ?? "100,1000,4000").split(",").map(Number).filter(Boolean);
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    // ODM_MEASURE_ENCODING=identity asks for every answer uncompressed, to
    // weigh what gzip costs and saves on this link.
    if (process.env.ODM_MEASURE_ENCODING) await page.setExtraHTTPHeaders({ "accept-encoding": process.env.ODM_MEASURE_ENCODING });
    for (const size of sizes) {
      const { file, needles } = largeWorld(size);
      const made = await api.post(`${base}/api/workshops`, { data: { title: `A world of ${size}`, description: "" } });
      check(made.ok(), "a workshop for the measurement");
      const id = (await made.json()).workshop.id;
      const campaign = `${base}/api/campaigns/${id}`;
      try {
        const imported = await api.post(`${campaign}/world/import`, { data: { text: JSON.stringify(file), accept: true }, timeout: 600_000 });
        check(imported.ok(), `the ${size}-entry world came in (${imported.status()}: ${(await imported.text()).slice(0, 200)})`);
        const result = { size, viewport };

        // The first usable World tab.
        const list = page.getByRole("listbox", { name: "Entries" }).locator("visible=true");
        const options = list.getByRole("option");
        const searchBox = page.getByRole("textbox", { name: "Find an entry" }).locator("visible=true");
        // Each opening and each search is timed three times, the median kept.
        const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const openings = [];
        for (let round = 0; round < TRIES; round += 1) {
          // Away from the World first, so each opening loads it afresh.
          await page.goto(`${base}/`, { waitUntil: "load", timeout: 120_000 });
          const worldAnswer = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/campaigns/${id}/world` && !new URL(response.url()).search && response.request().method() === "GET", { timeout: 120_000 });
          const opened = Date.now();
          await page.goto(`${base}/workshop/${id}?system=world&view=wiki`, { waitUntil: "commit", timeout: 120_000 });
          const answer = await worldAnswer;
          await answer.finished();
          const answered = Date.now();
          await options.first().waitFor({ timeout: 120_000 });
          await searchBox.waitFor({ timeout: 30_000 });
          const done = Date.now();
          const sizes = await answer.request().sizes();
          openings.push({ firstUsableMs: done - opened, afterAnswerMs: done - answered, answerMs: answered - opened, wireKb: Math.round(sizes.responseBodySize / 1024), encoding: answer.headers()["content-encoding"] ?? "none" });
        }
        result.firstUsableMs = median(openings.map((entry) => entry.firstUsableMs));
        result.afterAnswerMs = median(openings.map((entry) => entry.afterAnswerMs));
        result.world = { answerMs: median(openings.map((entry) => entry.answerMs)), wireKb: openings[0].wireKb, encoding: openings[0].encoding };
        result.listed = await options.count();

        // Search: a name, a word deep in a body, a custom field's value.
        result.search = {};
        for (const [kind, needle] of Object.entries(needles)) {
          const times = [];
          for (let round = 0; round < TRIES; round += 1) {
            await searchBox.fill("");
            await options.first().waitFor({ timeout: 30_000 });
            const started = Date.now();
            await searchBox.fill(needle.query);
            const holder = options.filter({ hasText: needle.holder }).first();
            const found = await holder.waitFor({ timeout: SEARCH_MISS_MS }).then(() => true, () => false);
            times.push(found ? Date.now() - started : Infinity);
          }
          const kept = median(times);
          result.search[kind] = Number.isFinite(kept) ? kept : "miss";
        }

        // The whole list again, then a scroll through it.
        const cleared = Date.now();
        await searchBox.fill("");
        await page.waitForFunction((count) => document.querySelectorAll('[role="listbox"][aria-label="Entries"] [role="option"]').length >= Math.min(count, 1), result.listed);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        result.listRenderMs = Date.now() - cleared;
        result.scroll = await list.evaluate(
          (element) =>
            new Promise((resolve) => {
              const frames = [];
              let last = performance.now();
              let step = 0;
              const tick = () => {
                const now = performance.now();
                frames.push(now - last);
                last = now;
                step += 1;
                element.scrollTop = (element.scrollHeight - element.clientHeight) * (step / 40);
                if (step < 40) requestAnimationFrame(tick);
                else resolve({ worstFrameMs: Math.round(Math.max(...frames.slice(1))), meanFrameMs: Math.round(frames.slice(1).reduce((a, b) => a + b, 0) / (frames.length - 1)) });
              };
              requestAnimationFrame(tick);
            }),
        );

        // The web: opened, drawn and settled.
        const graphStarted = Date.now();
        await page.locator('[data-tour="world-view-web"]').locator("visible=true").first().click();
        const svg = page.getByRole("img", { name: /of the world$/ }).locator("visible=true");
        const drawn = await svg.waitFor({ timeout: 180_000 }).then(() => true, () => false);
        result.graphMs = drawn ? Date.now() - graphStarted : "not drawn in 180 s";
        result.graphNodes = drawn ? await svg.locator("g.wf-node-body").count() : 0;
        result.heapMb = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
        console.log(`MEASURE ${JSON.stringify(result)}`);
      } finally {
        await api.delete(`${base}/api/workshops/${id}`, { timeout: 600_000 }).catch(() => {});
      }
    }
  },
};
