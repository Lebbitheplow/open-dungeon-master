// Issue 503 Phases 5 and 7: when a pact makes its move, its secrets come
// out. The lead runs the Reveal table as its DM; the player's Brin joined
// Seren's pact and cut the horses loose in secret, and Seren is at her
// breaking point. The console's long rest sets the pact off: the server
// walks Seren out, and the transcript draws a reveal card, the server's own
// word, naming the pact and Brin's secret, which unmasks itself over 480 ms
// (a lift from a blur). Brin's hidden roll turns public. Reduced motion
// keeps the colour and the words and drops the movement. Clean under axe by
// night and by day.
import { axeViolations, check, eventually, sleep } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await sleep(400);
}

export default {
  name: "pact-reveal",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.pacts.reveal[viewport];
    await t.open(`/campaigns/${table.id}`);
    await sleep(800);
    check((await page.locator(`${root}[data-pact-reveal]`).count()) === 0, "nothing revealed before the pact moves");
    await page.evaluate(() => {
      window.__reveals = [];
      document.addEventListener(
        "animationstart",
        (event) => {
          if (event.target instanceof Element && event.target.classList.contains("pact-reveal")) {
            window.__reveals.push({ name: event.animationName, duration: getComputedStyle(event.target).animationDuration });
          }
        },
        true,
      );
    });

    const response = await api.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name: "take_rest", args: { kind: "long" } } });
    const body = await response.json().catch(() => ({}));
    check(response.ok(), `the console's long rest was refused (${response.status()}): ${body.error ?? ""}`);
    check(/The pact made its move/.test((body.result?.companionsLeft ?? []).join(" ")), `the rest set the pact off: ${JSON.stringify(body.result?.companionsLeft ?? [])}`);

    // The long rest's dawn card covers the table a moment; the player
    // returns to it as anyone would.
    await sleep(400);
    await page.keyboard.press("Escape");
    await sleep(600);
    const card = page.locator(`${root}[data-pact-reveal]`).locator("visible=true").last();
    await eventually(() => card.count(), { timeoutMs: 20_000, label: "the reveal card" });
    await card.scrollIntoViewIfNeeded();
    const words = await card.innerText();
    check(/Revealed/i.test(words), "headed Revealed");
    check(/The pact made its move: Seren Vale, Brin Hale/.test(words), `it names the pact: ${words}`);
    check(words.includes(table.secret), "and Brin's secret");
    await sleep(600);
    const reveals = await page.evaluate(() => window.__reveals);
    const unmask = reveals.find((entry) => entry.name.replace(/^odm-game-/, "") === "pact-unmask");
    check(Boolean(unmask), `the card unmasked itself (${JSON.stringify(reveals)})`);
    check(/0\.48s/.test(unmask.duration), `over 480 ms (${unmask.duration})`);
    await axeClean(page, `${root}[data-pact-reveal]`, "the reveal at night");
    await t.shot("pact-reveal");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-pact-reveal]`, "the reveal by day");
    await t.shot("pact-reveal-day");
    await inTheme(page, "dark");
    if (viewport === "phone") {
      const width = await card.evaluate((element) => element.getBoundingClientRect().width);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      check(width <= viewportWidth, `the card fits a phone (${width} of ${viewportWidth})`);
    }

    // Brin's hidden roll is public now.
    const rolls = await (await api.get(`${base}/api/campaigns/${table.id}/rolls`)).json();
    check((rolls.rolls ?? []).some((roll) => roll.characterId === table.brin && /Stealth, in secret/.test(roll.detail) && roll.visibility === "public" && typeof roll.total === "number"), "Brin's secret roll turned public");

    // Reduced motion: the card keeps its colour and words, without moving.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "pact-reveal";
      (document.querySelector(".game-root") ?? document.body).appendChild(probe);
      const name = getComputedStyle(probe).animationName.replace(/^odm-game-/, "");
      probe.remove();
      return name;
    });
    check(reduced === "pact-unmask-fade", `reduced motion keeps the fade and drops the movement (${reduced})`);
    await page.emulateMedia({ reducedMotion: null });
  },
};
