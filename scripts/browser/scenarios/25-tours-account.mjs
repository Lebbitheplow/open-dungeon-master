// Issue 306: finishing a guided tour is the account's record, not the
// browser's. The walker ends the table's tour in one browser; a reload,
// cleared storage, a second tab and a second browser (under --app, the
// app's own screens) never open it again, and Help still replays it. A
// second account in the same browser meets its own tour, and an old
// per-browser flag keeps the tour closed for the account that finds it and
// leaves the browser. Under --app, the Escape the app's back gesture now
// sends ends an open tour and records it, and the page stays.
import { check, enterApp, eventually, newContext, signIn, sleep } from "../lib.mjs";

const TOUR = '[role="dialog"][aria-label="Guided tour"]';
// The step the tour shows, or null once it has closed.
const tourStep = (page) => page.locator(TOUR).evaluateAll((cards) => cards[0]?.getAttribute("data-tour-step") ?? null);

// Watches a page for the tour: the table opens it about 1.2 s after it has
// laid itself out, the workshop about 0.9 s.
async function tourOpens(page, timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.locator(TOUR).count()) return true;
    await sleep(250);
  }
  return false;
}

async function finished(context, base) {
  const response = await context.request.get(`${base}/api/profile/tours`);
  check(response.ok(), `the account's tours answered ${response.status()}`);
  return (await response.json()).tours ?? {};
}

const load = { waitUntil: "networkidle", timeout: 120_000 };

export default {
  name: "tours-account",
  viewports: ["desktop"],
  async run(t) {
    const { page, base, ids, app } = t;
    const browser = page.context().browser();
    const table = `${base}/campaigns/${ids.tourTableId}`;
    const contexts = [];
    const browserFor = async (username) => {
      const context = await newContext(browser, "desktop", { app: false, toursSeen: false });
      contexts.push(context);
      if (username) await signIn(context, base, username, ids.password);
      return context;
    };
    try {
      // The walker's first visit opens the table's tour; End the tour.
      const one = await browserFor(ids.walker);
      const tab = await one.newPage();
      await tab.goto(table, load);
      check(await tourOpens(tab, 20_000), "the walker's first visit opens the table's tour");
      await tab.locator(`${TOUR} [aria-label="End the tour"]`).click();
      await eventually(async () => (await finished(one, base))["table-player"]?.how === "ended", { label: "the account records the ended tour" });
      check((await tab.locator(TOUR).count()) === 0, "End the tour closes it");

      // A reload, then a reload with the browser's storage cleared.
      await tab.reload(load);
      check(!(await tourOpens(tab)), "a reload does not open it again");
      await tab.evaluate(() => window.localStorage.clear());
      await tab.reload(load);
      check(!(await tourOpens(tab)), "cleared storage does not bring it back: the account is the record");

      // A second tab finishes the shelf's tour with Done; the first tab then
      // visits the shelf and does not meet it.
      const second = await one.newPage();
      await second.goto(`${base}/workshop`, load);
      check(await tourOpens(second, 20_000), "the shelf's tour is still unfinished");
      for (let step = 0; step < 24 && (await second.locator(TOUR).count()); step += 1) {
        const was = await tourStep(second);
        await second.locator(`${TOUR} button`).filter({ hasText: /^(Next|Done)$/ }).first().click();
        await eventually(async () => (await tourStep(second)) !== was, { label: "the shelf's tour moving on" });
      }
      check((await second.locator(TOUR).count()) === 0, "Done closes the shelf's tour");
      await eventually(async () => (await finished(one, base))["workshop-shelf"]?.how === "done", { label: "the account records Done" });
      await tab.goto(`${base}/workshop`, load);
      check(!(await tourOpens(tab)), "the other tab does not open the shelf's tour");
      await second.close();

      // Help still replays the table's tour by hand.
      await tab.goto(table, load);
      check(!(await tourOpens(tab, 4_000)), "the table stays quiet");
      await tab.locator('[data-tour="header-help"]').locator("visible=true").first().click();
      await tab.getByRole("button", { name: /Tour the table/ }).click();
      check(await tourOpens(tab, 6_000), "Help replays the table's tour");
      await tab.keyboard.press("Escape");
      await eventually(async () => (await tab.locator(TOUR).count()) === 0, { label: "Escape ends the replay" });

      if (!app) {
        // Another browser: the same account does not meet it.
        const two = await browserFor(ids.walker);
        const other = await two.newPage();
        await other.goto(table, load);
        check(!(await tourOpens(other)), "another browser does not open a tour this account finished");
      } else {
        // The app's own screens, signed in as the walker: the tour the browser
        // finished stays closed there.
        const appContext = await newContext(browser, "phone", { app: true, toursSeen: false });
        contexts.push(appContext);
        const phone = await appContext.newPage();
        await enterApp(phone, new URL(page.url()).origin, base, { ...ids, lead: ids.walker }, true);
        const tile = phone.locator(".game-root a, .game-root button").filter({ hasText: new RegExp(ids.tourTableTitle, "i") }).first();
        // Entering lands on the latest table; the tour table's tile is on the
        // host's home.
        if (!(await tile.isVisible().catch(() => false))) {
          await phone.evaluate(() => window.odmShell.navigation.push("/"));
        }
        await tile.waitFor({ state: "visible", timeout: 30_000 });
        await tile.tap();
        await eventually(() => phone.locator(".game-root .cine-stage").count(), { timeoutMs: 30_000, label: "the table in the app" });
        check(!(await tourOpens(phone)), "the app does not open a tour the browser finished");

        // A tour the walker has not finished (a workshop's hub), ended the way
        // Android's back gesture now ends it: the shell sends Escape to the
        // focused control (client game-screen.ts escapeInGame, the same as a
        // controller's B). It closes, the page stays, the account records it,
        // and it does not open again. (Capacitor's web build never delivers
        // the hardware back event, so the gesture itself is proved on the
        // Android app, not here.)
        const made = await one.request.post(`${base}/api/workshops`, { data: { title: "Tour Bench" } });
        check(made.ok(), `making the walker a workshop answered ${made.status()}`);
        const workshopId = (await made.json()).workshop.id;
        await phone.evaluate((to) => window.odmShell.navigation.push(to), `/workshop/${workshopId}`);
        check(await tourOpens(phone, 20_000), "the workshop's hub tour opens in the app");
        const route = await phone.evaluate(() => window.odmShell.navigation.location());
        // The tour listens for keys from an effect, which the app's Preact runs
        // a frame after the card paints: an Escape in that frame is sent again.
        const taken = await eventually(
          () =>
            phone.evaluate(() => {
              const escape = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
              (document.activeElement instanceof HTMLElement ? document.activeElement : document.body).dispatchEvent(escape);
              return escape.defaultPrevented;
            }),
          { timeoutMs: 2_000, every: 50 },
        ).then(() => true, () => false);
        check(taken, "the tour takes the shell's Escape, so the back gesture stops there");
        await eventually(async () => (await phone.locator(TOUR).count()) === 0, { label: "the shell's Escape ends the tour" });
        // Time is the check: a back gesture the tour let through would move the page within this while.
        await sleep(600);
        const after = await phone.evaluate(() => window.odmShell.navigation.location());
        check(JSON.stringify(after) === JSON.stringify(route), `the page stays where it was (${JSON.stringify(route)} then ${JSON.stringify(after)})`);
        await eventually(async () => (await finished(one, base))["workshop-hub"]?.how === "ended", { label: "the account records the tour the Escape ended" });
        await phone.evaluate(() => window.odmShell.navigation.push("/"));
        await eventually(async () => (await phone.evaluate(() => window.odmShell.navigation.location()))?.pathname === "/", { label: "the app's home" });
        await phone.evaluate((to) => window.odmShell.navigation.push(to), `/workshop/${workshopId}`);
        check(!(await tourOpens(phone)), "the ended hub tour does not open again");
      }

      // A second account in the first browser meets its own first tour.
      await one.clearCookies();
      await signIn(one, base, ids.sharer, ids.password);
      await tab.goto(table, load);
      check(await tourOpens(tab, 20_000), "another account in the same browser gets its own first tour");
      await tab.keyboard.press("Escape");
      await eventually(async () => (await finished(one, base))["table-player"]?.how === "ended", { label: "the sharer's own record" });

      // The old per-browser flag: kept closed for the account that finds
      // it, carried to that account, and gone from the browser.
      const three = await browserFor(null);
      const fresh = await three.newPage();
      await fresh.goto(`${base}/`, load);
      await fresh.evaluate(() => window.localStorage.setItem("odm:tour:table-player", "done"));
      await signIn(three, base, ids.heir, ids.password);
      await fresh.goto(table, load);
      check(!(await tourOpens(fresh)), "the old flag keeps the tour closed for the account that finds it");
      await eventually(async () => Boolean((await finished(three, base))["table-player"]), { label: "the old flag carried to the account" });
      check((await fresh.evaluate(() => window.localStorage.getItem("odm:tour:table-player"))) === null, "the old flag leaves the browser");
    } finally {
      for (const context of contexts) await context.close().catch(() => {});
    }
  },
};
