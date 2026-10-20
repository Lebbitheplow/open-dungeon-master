// F25 and F27: the roster portrait arrives with a moment, and the lobby sees
// a player take a seat. Both run on effects and timers that
// renderToStaticMarkup never starts, so the live page is checked here.
//
// The portrait: the library read is stood in for (painting, painting, then
// painted), as in cover-polling. The card must say "Painting portrait…" in
// words, the finished portrait must fade in, and the toast must say it is
// ready without moving focus.
//
// The arrival: the lead seats a library character in the seeded lobby
// through the ordinary sheet route, and the lobby, already open, must raise
// "<name> takes a seat" from its own event stream. With motion it leaves on
// its own; with Effects set to low it waits for its Dismiss. Escape skips
// it. The seat is taken back at the end so the lobby stays as seeded.
import { check, eventually } from "../lib.mjs";

const PORTRAIT = "/assets/placeholders/character/masculine.webp";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  name: "portrait-and-arrival",
  viewports: ["desktop", "phone"],
  // The stand-in below is a browser-level route, which the app's patched
  // fetch bypasses.
  app: false,
  async run(t) {
    const { page, ids, base, api } = t;

    // ---- F25 ----
    let reads = 0;
    let name = ids.libraryName;
    await page.route(/\/api\/characters(\?|$)/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const body = await response.json();
      reads += 1;
      // The name as stored now: an earlier scenario (07-library-edit) may
      // have renamed the seeded character.
      name = (body.characters ?? []).find((character) => character.id === ids.library)?.name ?? name;
      body.characters = (body.characters ?? []).map((character) =>
        character.id !== ids.library
          ? character
          : reads <= 2
            ? { ...character, portraitStatus: "generating", sheet: { ...character.sheet, portrait: null } }
            : { ...character, portraitStatus: null, sheet: { ...character.sheet, portrait: { url: PORTRAIT } } },
      );
      await route.fulfill({ response, json: body });
    });
    await t.open("/characters");
    const painting = page.getByRole("status").filter({ hasText: "Painting portrait…" });
    await eventually(() => painting.count(), { label: "the card saying Painting portrait… as a status" });
    check(await painting.first().isVisible(), "the painting status is visible, not only a tooltip");
    await t.shot("portrait-painting");
    const focusBefore = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "");
    const toast = page.locator(".portrait-toast");
    await eventually(() => toast.count(), { timeoutMs: 15_000, label: `the ready toast (read ${reads} times)` });
    await eventually(async () => (await toast.textContent()) === `${name}'s portrait is ready`, {
      label: `the toast naming ${name}`,
    });
    check(
      (await page.locator(".portrait-toast-region").getAttribute("role")) === "status",
      "the toast is a polite status",
    );
    const focusAfter = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "");
    check(focusAfter === focusBefore, `the toast took no focus (${focusAfter})`);
    check((await page.locator("img.portrait-arrive").count()) === 1, "the finished portrait fades in");
    check((await painting.count()) === 0, "the painting status has gone quiet");
    await t.shot("portrait-ready");
    await page.unroute(/\/api\/characters(\?|$)/);

    // ---- F27 ----
    const seat = () => api.post(`${base}/api/campaigns/${ids.lobbyId}/sheet`, { data: { libraryCharacterId: ids.library } });
    const unseat = () => api.delete(`${base}/api/campaigns/${ids.lobbyId}/sheet`);
    await unseat();
    try {
      await t.open(`/campaigns/${ids.lobbyId}`);
      const banner = page.locator(".moment-arrival");
      check((await banner.count()) === 0, "nothing replays when the lobby opens");
      const seated = await seat();
      check(seated.ok(), `the seat was taken (${seated.status()})`);
      await eventually(() => banner.count(), { timeoutMs: 15_000, label: "the arrival banner from the lobby's own stream" });
      await eventually(async () => (await banner.textContent()).includes(`${name} takes a seat`), {
        label: `the banner naming ${name}`,
      });
      const announced = await page.locator('p[role="status"].sr-only').filter({ hasText: "takes a seat" }).count();
      check(announced === 1, `one polite announcement (${announced})`);
      check((await banner.getByRole("button").count()) === 0, "with motion it carries no button");
      // It covers only the lobby card's art, never another card's words.
      // Measured once its short slide-in has settled.
      await sleep(600);
      const box = await banner.boundingBox();
      const card = await page.locator(".lobby-hero").first().boundingBox();
      check(
        box && card && box.x >= card.x && box.x + box.width <= card.x + card.width && box.y >= card.y && box.y + box.height <= card.y + card.height,
        `the banner sits inside the lobby card (${JSON.stringify(box)} in ${JSON.stringify(card)})`,
      );
      await t.shot("arrival-banner");
      await eventually(async () => (await banner.count()) === 0, { timeoutMs: 10_000, label: "the banner leaving on its own" });

      // Effects low: it stays until Dismiss, and Escape also skips it.
      await page.evaluate(() => {
        window.localStorage.setItem("odm:effects", "low");
        window.dispatchEvent(new Event("odm-effects-pref"));
      });
      await unseat();
      await sleep(1_000);
      check((await seat()).ok(), "the seat was taken again");
      await eventually(() => banner.count(), { timeoutMs: 15_000, label: "the still arrival banner" });
      check((await banner.getAttribute("data-still")) === "true", "drawn still under low effects");
      const dismiss = banner.getByRole("button", { name: "Dismiss" });
      check((await dismiss.count()) === 1, "a Dismiss is offered");
      await sleep(6_000);
      check((await banner.count()) === 1, "it waited past the moving banner's time");
      await t.shot("arrival-still");
      await t.tap(dismiss);
      await eventually(async () => (await banner.count()) === 0, { label: "Dismiss closing the banner" });

      await unseat();
      await sleep(1_000);
      check((await seat()).ok(), "the seat was taken a third time");
      await eventually(() => banner.count(), { timeoutMs: 15_000, label: "the banner for Escape" });
      // The key is listened for once the banner has painted, as a person
      // would see it; a press in the same frame it appears would be early.
      await sleep(300);
      await page.keyboard.press("Escape");
      await eventually(async () => (await banner.count()) === 0, { label: "Escape closing the banner" });
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("odm:effects")).catch(() => {});
      await unseat();
    }
  },
};
