// M5 item 6 of the WorldForge plan (audit WF-22): the workshop's tours are
// walked as people meet them, from Help, on desktop and phone. Each tour is
// read from its own data (src/lib/tours/workshop.ts), so a step added or
// renamed is walked too. Every step must show, in order, and every step
// that names a target must light it: a target that has gone, or a lazy one
// its prepare no longer brings up, fails here rather than leaving a card
// floating over nothing. The page is told it has a text model, so the
// AI views' steps (Outline, Forge, Ask) are walked as well.
import { readFileSync } from "node:fs";
import { check, eventually, sleep } from "../lib.mjs";

const TOUR = '[role="dialog"][aria-label="Guided tour"]';

// Steps a seeded workshop cannot light, each with why. Empty means every step.
const ABSENT = {};

export default {
  name: "workshop-tours",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const { HUB_TOUR, SYSTEM_TOURS } = await import("../../../src/lib/tours/workshop.ts");
    // Each tool's label, as Help names its tour ("Tour WorldForge"), read
    // from the tool list itself rather than imported with its icons.
    const systemsFile = readFileSync(new URL("../../../src/app/workshop/[workshopId]/systems.ts", import.meta.url), "utf8");
    const labels = new Map([...systemsFile.matchAll(/\{ id: "([a-z]+)", label: "([^"]+)"/g)].map((match) => [match[1], match[2]]));
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Tours ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const campaign = `${base}/api/campaigns/${id}`;
    // A tour walks a workshop with something in it: a storyboard card, so
    // the board has what it is missing and what it becomes, and a lore
    // entry, so the lore editor has another entry to link.
    const card = await api.post(`${campaign}/dm/storyboard`, { data: { kind: "event", title: "The bell rings at low tide", body: "" } });
    check(card.ok(), `a storyboard card for the walk (${card.status()})`);
    const lore = await api.post(`${campaign}/world/entities`, { data: { typeId: "t_other", name: "The Drowned Bell", text: "It rings for drowned wardens." } });
    check(lore.ok(), `a lore entry for the walk (${lore.status()})`);
    // The app shell reads the host's capabilities once, at sign-in, so this
    // stand-in never reaches it; there the AI views' steps are skipped by
    // design and the walk checks the rest.
    if (!t.app) {
      await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.story = { ...body.story, configured: true };
        await route.fulfill({ response, json: body });
      });
    }
    const AI_STEPS = new Set(["outline", "forge", "ask"]);
    const labelOf = (system) => labels.get(system);

    // Walks the open tour to its end: the steps shown, and any that named a
    // target and lit none.
    async function walk(expected, name) {
      const card = page.locator(TOUR);
      await eventually(() => card.count(), { timeoutMs: 15_000, label: `${name}'s tour opening` });
      const shown = [];
      const unlit = [];
      for (let guard = 0; guard < 40 && (await card.count()); guard += 1) {
        const stepId = await card.getAttribute("data-tour-step");
        const step = expected.find((entry) => entry.id === stepId);
        check(step, `${name}: the tour showed a step it does not have (${stepId})`);
        if (shown.at(-1) !== stepId) {
          shown.push(stepId);
          if (step.anchors.length) {
            // A lazy step's target appears once its prepare has run.
            const lit = await eventually(() => page.locator("[data-tour-spot]").count(), { timeoutMs: step.lazy ? 4_000 : 2_000 }).then(() => true, () => false);
            if (!lit) unlit.push(stepId);
          }
          // A few of the rewritten steps, as they stand, for the review.
          if (["to-table", "create", "outline", "atlas", "list"].includes(stepId) && ["the hub", "WorldForge", "Bestiary"].includes(name)) {
            await sleep(400);
            await t.shot(`${name === "the hub" ? "hub" : name.toLowerCase()}-${stepId}`);
          }
        }
        // The tour's own key: a sheet a lazy step opened can sit over the
        // card's buttons for a pointer, never for the keyboard.
        await page.keyboard.press("ArrowRight");
        await sleep(300);
      }
      check((await card.count()) === 0, `${name}: the tour did not end`);
      return { shown, unlit };
    }

    async function openHelpTour(label) {
      const help = page.locator(`${root}[data-tour="system-help"], ${root}[data-tour="hub-help"]`).locator("visible=true").first();
      await eventually(() => help.isVisible(), { timeoutMs: 30_000, label: "Help" });
      await help.click();
      const button = page.getByRole("dialog").getByRole("button", { name: label, exact: true });
      await eventually(() => button.isVisible(), { timeoutMs: 10_000, label: `the ${label} button` });
      await button.click();
    }

    const problems = [];
    try {
      await t.open(`/workshop/${id}`);
      await openHelpTour("Tour the workshop");
      const hub = await walk(HUB_TOUR, "the hub");
      const hubMissing = HUB_TOUR.map((step) => step.id).filter((stepId) => !hub.shown.includes(stepId));
      if (hubMissing.length || hub.unlit.length) problems.push(`hub: skipped ${hubMissing.join(", ") || "none"}; unlit ${hub.unlit.join(", ") || "none"}`);

      for (const [system, steps] of Object.entries(SYSTEM_TOURS)) {
        const label = labelOf(system);
        check(label, `no label for the ${system} tool`);
        await t.open(`/workshop/${id}?system=${system}`);
        await openHelpTour(`Tour ${label}`);
        const { shown, unlit } = await walk(steps, label);
        const allowed = new Set([...(ABSENT[system] ?? []), ...(t.app && system === "world" ? AI_STEPS : [])]);
        const missing = steps.map((step) => step.id).filter((stepId) => !shown.includes(stepId) && !allowed.has(stepId));
        const dark = unlit.filter((stepId) => !allowed.has(stepId));
        if (missing.length || dark.length) problems.push(`${system}: skipped ${missing.join(", ") || "none"}; unlit ${dark.join(", ") || "none"}`);
        // An editor a lazy step opened closes before the next tool.
        for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
          await page.keyboard.press("Escape");
          await sleep(200);
        }
        if (system === "world") await t.shot("world-tour-walked");
      }
      check(problems.length === 0, `tour steps that did not show or lit nothing:\n  ${problems.join("\n  ")}`);
    } finally {
      await page.unroute(/\/api\/capabilities(\?|$)/).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
