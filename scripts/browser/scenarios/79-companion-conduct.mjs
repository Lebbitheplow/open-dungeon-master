// Issue 503 Phases 4 and 6: a companion inside the party, where the table
// sees it. The lead runs the Conduct Table as its DM at Turn; the player's
// Kael travels with Varn Hale, a mercenary cleric wary of him, and Brannoc
// Rusk, a rash fighter who holds the innocent as a red line.
//
// Every beat is the server's: the console asks Varn to heal Kael and the
// server refuses (his Bonds row says what he refused, appearing with the
// kit's reveal); a fight starts and he asks his share (the row says what is
// still owed); then a deed past Brannoc's red line turns him on the party
// where he stands, and his party card wears the foes' colour with an
// "against the party" tag that pops in. Reduced motion keeps the colour and the words and
// drops the movement. Night and day, desktop and phone, clean under axe.
import { axeViolations, check, eventually, openPanelTab, sleep } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await sleep(400);
}

const scenario = {
  name: "companion-conduct",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.conduct[viewport];
    const call = async (name, args) => {
      const response = await api.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok(), status: response.status(), body };
    };
    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { timeoutMs: 30_000, label: "the Bonds sub-tab" });
    await t.tap(bondsTab);
    const ladder = page.locator(`${root}[data-conscience-ladder="${table.varnName}"]`).locator("visible=true").first();
    await eventually(() => ladder.count(), { timeoutMs: 20_000, label: "Varn's row" });

    // ---- a refusal ----
    await page.evaluate(() => {
      window.__reveals = [];
      document.addEventListener(
        "animationstart",
        (event) => {
          if (event.target instanceof Element && (event.target.hasAttribute("data-refused") || event.target.hasAttribute("data-share-demand") || event.target.hasAttribute("data-side-badge"))) {
            window.__reveals.push({ what: [...event.target.attributes].map((attribute) => attribute.name).find((name) => name.startsWith("data-")), name: event.animationName });
          }
        },
        true,
      );
    });
    const healed = await call("heal", { characterId: table.kael, casterId: table.varn, spell: "Cure Wounds", level: 1 });
    check(!healed.ok || healed.body.ok === false, `the server refused the heal (${healed.status})`);
    check(/will not spend a spell slot on Kael Ashvale/.test(JSON.stringify(healed.body)), `with the reason (${JSON.stringify(healed.body).slice(0, 200)})`);
    const refused = ladder.locator("[data-refused]");
    await eventually(() => refused.count(), { timeoutMs: 15_000, label: "the refusal on his row" });
    check(((await refused.textContent()) ?? "").includes("a spell for Kael Ashvale"), "what he refused, in words");
    await ladder.scrollIntoViewIfNeeded();
    await sleep(500);
    await axeClean(page, `${root}[data-bond-row="${table.varnName}"]`, "Varn's row at night");
    await t.shot("refused");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-bond-row="${table.varnName}"]`, "Varn's row by day");
    await t.shot("refused-day");
    await inTheme(page, "dark");

    // ---- his share ----
    const started = await call("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
    check(started.ok, `the fight started (${started.status}): ${started.body.error ?? ""}`);
    check(/Varn Hale demands their share before fighting: 30 gp/.test(started.body.result?.shares ?? ""), `he asks his share (${started.body.result?.shares})`);
    // A fight opens the board, and the Party panel on its roster: back to
    // the Bonds.
    await openPanelTab(t, "party");
    await eventually(() => bondsTab.count(), { label: "the Bonds sub-tab in the fight" });
    await t.tap(bondsTab);
    await eventually(() => ladder.count(), { timeoutMs: 15_000, label: "Varn's row in the fight" });
    const demand = ladder.locator("[data-share-demand]");
    await eventually(() => demand.count(), { timeoutMs: 15_000, label: "his share on the row" });
    check(((await demand.textContent()) ?? "").includes("30 gp before they fight"), "what is still owed");
    await sleep(500);
    await t.shot("share");
    const reveals = await page.evaluate(() => window.__reveals);
    check(reveals.some((entry) => entry.what === "data-refused" && entry.name.replace(/^odm-game-/, "") === "fade-up"), `the refusal revealed (${JSON.stringify(reveals)})`);
    check(reveals.some((entry) => entry.what === "data-share-demand" && entry.name.replace(/^odm-game-/, "") === "fade-up"), `the share revealed (${JSON.stringify(reveals)})`);

    // ---- he turns where he stands ----
    const turned = await call("relationship_beat", {
      characterId: table.kael,
      subject: table.brannocName,
      beat: "murder_helpless",
      severity: "atrocity",
      note: "Kael cut down the goblin's hostage to make a point.",
    });
    check(turned.ok, `the deed was recorded (${turned.status}): ${turned.body.error ?? ""}`);
    check(turned.body.result?.turned === "Turned on the party", `the server turned him (${JSON.stringify(turned.body.result)})`);
    await openPanelTab(t, "party");
    const rosterTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Roster\s*$/ }).locator("visible=true").first();
    await eventually(() => rosterTab.count(), { label: "the Roster sub-tab" });
    await t.tap(rosterTab);
    const card = page.locator(`${root}[data-party-card="${table.brannoc}"]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 15_000, label: "Brannoc's card" });
    await eventually(async () => (await card.getAttribute("data-against")) !== null, { timeoutMs: 15_000, label: "his card against the party" });
    const tag = card.locator('[data-side-badge="foe"]');
    check(((await tag.textContent()) ?? "").trim() === "Against the party", "the badge says it in words");
    const ring = await card.evaluate((element) => getComputedStyle(element).borderTopColor);
    const kaelRing = await page.locator(`${root}[data-party-card="${table.kael}"]`).locator("visible=true").first().evaluate((element) => getComputedStyle(element).borderTopColor);
    check(ring !== kaelRing && /oklab\(0\.6\d* 0\.2|rgba?\(2[0-4]\d, /.test(ring), `the card wears the foes' colour (${ring}, the party's ${kaelRing})`);
    await card.scrollIntoViewIfNeeded();
    await sleep(500);
    const pops = await page.evaluate(() => window.__reveals);
    check(pops.some((entry) => entry.what === "data-side-badge" && entry.name.replace(/^odm-game-/, "") === "side-badge-in"), `the badge came in (${JSON.stringify(pops)})`);
    await axeClean(page, `${root}[data-party-card="${table.brannoc}"]`, "Brannoc's card at night");
    await t.shot("against");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-party-card="${table.brannoc}"]`, "Brannoc's card by day");
    await t.shot("against-day");
    await inTheme(page, "dark");
    if (viewport === "phone") {
      const width = await card.evaluate((element) => element.getBoundingClientRect().width);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      check(width <= viewportWidth, `the card fits a phone (${width} of ${viewportWidth})`);
    }

    // Reduced motion: the colour and the words stay, the movement goes.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await tag.evaluate((element) => ({ animation: getComputedStyle(element).animationName, color: getComputedStyle(element).color }));
    check(still.animation === "none", `reduced motion drops the pop (${still.animation})`);
    check(/^(rgb|lab|oklab)/.test(still.color) && !/ 0\)$/.test(still.color), `and keeps the colour (${still.color})`);
    await page.emulateMedia({ reducedMotion: null });
  },
};

export default scenario;
