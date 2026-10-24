// Issue 503 Phases 2 and 3: a companion leaving, where the table meets it.
// The lead runs the Gone Table as its DM; the player's Kael travels with
// Seren Vale, a timid paladin. Tam Hollis already walked out, so the Party
// panel's Gone list stands: named, at a phone's width, clean under axe by
// night and by day.
//
// The departure: the console records an atrocity against Seren's red line,
// and the server walks her out (never the narration). Her card leaves the
// party, dims over 600 ms where it stood at the foot of the cards (a
// CSS animation, greying as it sinks a little), then files under Gone with
// how she went. Reduced motion keeps the dimming colour and the words and
// drops the movement.
import { axeViolations, check, eventually, openPanelTab, sleep } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await sleep(400);
}

export default {
  name: "companion-departure",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.gone[viewport];
    const invoke = async (name, args) => {
      const response = await api.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
      const body = await response.json().catch(() => ({}));
      check(response.ok(), `the console's ${name} was refused (${response.status()}): ${body.error ?? ""}`);
      return body.result;
    };
    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "party");

    // ---- the Gone list as it stands ----
    const goneList = page.locator(`${root}[data-party-gone]`).locator("visible=true").first();
    await eventually(() => goneList.count(), { timeoutMs: 30_000, label: "the Gone list" });
    const tam = goneList.locator(`[data-gone-entry="Tam Hollis"]`);
    await eventually(() => tam.count(), { label: "Tam under Gone" });
    check(/Walked out on the party/.test((await tam.textContent()) ?? ""), "how he went, in words");
    check((await goneList.getByRole("heading", { name: /Gone/ }).count()) > 0, "the list is headed for screen readers");
    const card = page.locator(`${root}[data-party-card="${table.seren}"]`).locator("visible=true").first();
    await eventually(() => card.count(), { label: "Seren's card in the party" });
    await goneList.scrollIntoViewIfNeeded();
    await sleep(300);
    await axeClean(page, `${root}[data-party-gone]`, "the Gone list at night");
    await t.shot("gone-list");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-party-gone]`, "the Gone list by day");
    await t.shot("gone-list-day");
    await inTheme(page, "dark");

    // ---- the departure ----
    await page.evaluate(() => {
      window.__departs = [];
      document.addEventListener(
        "animationstart",
        (event) => {
          if (event.target instanceof Element && event.target.classList.contains("party-card-departing")) {
            const style = getComputedStyle(event.target);
            window.__departs.push({ name: event.animationName, duration: style.animationDuration });
          }
        },
        true,
      );
    });
    await card.scrollIntoViewIfNeeded();
    const done = await invoke("relationship_beat", {
      characterId: table.kael,
      subject: table.serenName,
      beat: "murder_helpless",
      severity: "atrocity",
      note: "Kael ran the surrendered guard through.",
    });
    check(done.departed === "Walked out on the party", `the server walked her out (${done.departed})`);
    const ghost = page.locator(`${root}[data-departing="${table.seren}"]`).locator("visible=true").first();
    // The card dims for DEPART_MS (600 ms, departing.ts): its words are read
    // the moment it shows, and the picture of it is best effort, since a slow
    // runner's scroll and screenshot can outlast it.
    let ghostText = "";
    await eventually(
      async () => {
        if (!(await ghost.count())) return false;
        ghostText = (await ghost.textContent({ timeout: 500 }).catch(() => "")) ?? "";
        return true;
      },
      { timeoutMs: 10_000, label: "her card dimming" },
    );
    await ghost.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => {});
    await t.shot("departing-mid");
    check(/Walked out on the party/.test(ghostText), `the dimming card says how she went: "${ghostText}"`);
    check((await page.locator(`${root}[data-party-card="${table.seren}"]`).count()) === 0, "out of the party's own cards");
    await eventually(async () => (await goneList.locator(`[data-gone-entry="Seren Vale"]`).count()) > 0, { label: "Seren under Gone" });
    await eventually(async () => (await ghost.count()) === 0, { label: "the dimmed card filed away" });
    const departs = await page.evaluate(() => window.__departs);
    const dim = departs.find((entry) => entry.name.replace(/^odm-game-/, "") === "party-card-depart");
    check(Boolean(dim), `the card dimmed (${JSON.stringify(departs)})`);
    check(/0\.6s/.test(dim.duration), `over 600 ms (${dim.duration})`);
    const seren = goneList.locator(`[data-gone-entry="Seren Vale"]`);
    check(/Walked out on the party/.test((await seren.textContent()) ?? ""), "filed with how she went");
    await seren.scrollIntoViewIfNeeded();
    await sleep(500);
    await axeClean(page, `${root}[data-party-gone]`, "the Gone list after she left, at night");
    await t.shot("gone-after");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-party-gone]`, "the Gone list after she left, by day");
    await t.shot("gone-after-day");
    await inTheme(page, "dark");
    if (viewport === "phone") {
      const width = await goneList.evaluate((element) => element.getBoundingClientRect().width);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      check(width <= viewportWidth, `the list fits a phone (${width} of ${viewportWidth})`);
    }

    // Reduced motion: the card still dims, without moving.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "party-card-departing";
      (document.querySelector(".game-root") ?? document.body).appendChild(probe);
      const name = getComputedStyle(probe).animationName.replace(/^odm-game-/, "");
      probe.remove();
      return name;
    });
    check(reduced === "party-card-depart-fade", `reduced motion keeps the dimming and drops the movement (${reduced})`);
    await page.emulateMedia({ reducedMotion: null });
  },
};
