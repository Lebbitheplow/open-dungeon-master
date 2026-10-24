// Issue 503: a companion's conscience where the table meets it. The lead
// runs the Conscience Table as its DM; the player's Kael travels with Seren
// Vale, a lawful good paladin the seed left uneasy.
//
// The setting: the Bonds group of the table's settings carries one picker,
// "Companion conscience", Leave by default, named for screen readers, with
// a plain hint and an info button, finger-sized on a phone, usable by
// keyboard, clean under axe by night and by day.
//
// The ladder: Seren's Bonds row shows her rung as five steps. When the
// console records a deed the server moves her a rung, and the marker slides
// there (a CSS transition on transform, 360 ms); a further breach sets an
// ultimatum, whose demand and time left on the clock show on the row and
// count down as the clock moves; amends climb her back and the ultimatum
// goes. Reduced motion keeps the colour and drops the slide. Every move
// here comes from a server outcome, never from narration.
import { axeViolations, check, eventually, openPanelTab, openSettingsGroup, sleep } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await sleep(400);
}

export default {
  name: "companion-conscience",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.conscience[viewport];
    const invoke = async (name, args) => {
      const response = await api.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
      const body = await response.json().catch(() => ({}));
      check(response.ok(), `the console's ${name} was refused (${response.status()}): ${body.error ?? ""}`);
      return body.result;
    };
    await t.open(`/campaigns/${table.id}`);

    // ---- the setting ----
    await openPanelTab(t, "settings");
    await openSettingsGroup(t, "bonds");
    const row = page.locator(`${root}[data-settings-row="conscience"]`).locator("visible=true").first();
    await eventually(() => row.count(), { timeoutMs: 30_000, label: "the Conscience row" });
    await row.scrollIntoViewIfNeeded();
    await sleep(500);
    check(/Conscience/.test((await row.textContent()) ?? ""), "a visible label");
    const picker = row.locator(`[aria-label="Companion conscience"]`).first();
    check((await picker.count()) > 0, "the picker is named for screen readers");
    check(((await picker.textContent()) ?? "").includes("Leave"), "Leave is the default");
    const box = await picker.boundingBox();
    check(box && box.height >= (t.touch ? 40 : 30), `the picker is finger-sized on a phone (${box?.height}px)`);
    check(/walks out/.test((await row.textContent()) ?? ""), "a plain hint says what Leave does");
    check((await row.getByRole("button", { name: /what does companion conscience do/i }).count()) > 0, "an info button explains it");
    await axeClean(page, `${root}[data-settings-row="conscience"]`, "the Conscience row at night");
    await t.shot("setting");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-settings-row="conscience"]`, "the Conscience row by day");
    await t.shot("setting-day");
    await inTheme(page, "dark");

    // By keyboard: focus, open, pick Talk; the server's copy comes back.
    await picker.focus();
    await page.keyboard.press("Enter");
    const talk = page.getByRole("menuitem", { name: /^Talk$/ }).or(page.getByRole("menuitemradio", { name: /^Talk$/ })).first();
    await eventually(() => talk.count(), { label: "the picker's choices open by keyboard" });
    await talk.focus();
    await page.keyboard.press("Enter");
    await eventually(async () => ((await picker.textContent()) ?? "").includes("Talk"), { label: "Talk saved" });
    check(/stay whatever happens/.test((await row.textContent()) ?? ""), "the hint follows the choice");
    await picker.focus();
    await page.keyboard.press("Enter");
    const leave = page.getByRole("menuitem", { name: /^Leave$/ }).or(page.getByRole("menuitemradio", { name: /^Leave$/ })).first();
    await eventually(() => leave.count(), { label: "the choices again" });
    await leave.focus();
    await page.keyboard.press("Enter");
    await eventually(async () => ((await picker.textContent()) ?? "").includes("Leave"), { label: "back to Leave" });

    // ---- the ladder on Seren's Bonds row ----
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { label: "the Bonds sub-tab" });
    await t.tap(bondsTab);
    const ladder = page.locator(`${root}[data-conscience-ladder="${table.seren}"]`).locator("visible=true").first();
    await eventually(() => ladder.count(), { timeoutMs: 20_000, label: "Seren's conscience ladder" });
    check((await ladder.getAttribute("data-rung")) === "uneasy", "the seed left her uneasy");
    check(
      (await ladder.getByRole("img", { name: /Seren Vale's conscience: Uneasy, step 2 of 5/ }).count()) > 0,
      "the ladder is named for screen readers",
    );
    await ladder.scrollIntoViewIfNeeded();
    await sleep(300);
    await t.shot("ladder-uneasy");

    // The marker's transitions, as the server moves her.
    await page.evaluate(() => {
      window.__conscienceMoves = [];
      document.addEventListener(
        "transitionrun",
        (event) => {
          if (event.target instanceof Element && event.target.classList.contains("conscience-marker")) {
            window.__conscienceMoves.push({ property: event.propertyName, duration: getComputedStyle(event.target).transitionDuration });
          }
        },
        true,
      );
    });
    const warned = await invoke("relationship_beat", {
      characterId: table.kael,
      subject: table.seren,
      beat: "broke_word",
      note: "Kael sold the map he swore to keep.",
    });
    check(warned.conscience === "uneasy -> warning", `the server moved her (${warned.conscience})`);
    await eventually(async () => (await ladder.getAttribute("data-rung")) === "warning", { label: "the ladder at warning" });
    await sleep(120);
    await t.shot("ladder-sliding");
    await sleep(600);
    await t.shot("ladder-warning");
    const moves = await page.evaluate(() => window.__conscienceMoves);
    const slide = moves.find((move) => move.property === "transform");
    check(Boolean(slide), `the marker slid one rung (${JSON.stringify(moves)})`);
    check(/0\.36s/.test(slide.duration), `in 360 ms (${slide.duration})`);

    // A further breach: the ultimatum, with its demand and the time left.
    const pressed = await invoke("relationship_beat", {
      characterId: table.kael,
      subject: table.seren,
      beat: "torture",
      demand: "Free the captive in the cellar",
      deadlineHours: 6,
    });
    check(pressed.conscience === "warning -> ultimatum", `an ultimatum (${pressed.conscience})`);
    await eventually(async () => (await ladder.getAttribute("data-rung")) === "ultimatum", { label: "the ladder at ultimatum" });
    const terms = ladder.locator("[data-ultimatum]");
    await eventually(() => terms.count(), { label: "the ultimatum on the row" });
    check(((await terms.textContent()) ?? "").includes("Free the captive in the cellar"), "its demand");
    check(((await terms.locator("[data-countdown]").textContent()) ?? "") === "6 h left", "the time left on the clock");
    await sleep(500);
    await axeClean(page, `${root}[data-bond-row="${table.seren}"]`, "Seren's row at night");
    await t.shot("ultimatum");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-bond-row="${table.seren}"]`, "Seren's row by day");
    await t.shot("ultimatum-day");
    await inTheme(page, "dark");

    // The clock moves: the countdown follows it.
    await invoke("pass_time", { amount: 2, unit: "hours" });
    await eventually(async () => ((await terms.locator("[data-countdown]").textContent()) ?? "") === "4 h left", {
      label: "the countdown after two hours",
    });

    // Amends meet it: she climbs back a rung and the demand goes.
    const amends = await invoke("relationship_beat", { characterId: table.kael, subject: table.seren, beat: "amends", note: "Kael freed the captive." });
    check(amends.conscience === "ultimatum -> warning", `amends climb her back (${amends.conscience})`);
    await eventually(async () => (await ladder.getAttribute("data-rung")) === "warning", { label: "back at warning" });
    await eventually(async () => (await ladder.locator("[data-ultimatum]").count()) === 0, { label: "the demand met" });
    await sleep(500);
    await t.shot("amends");

    // Reduced motion: the colour still changes, the marker no longer slides.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await ladder.locator(".conscience-marker").evaluate((element) => getComputedStyle(element).transitionProperty);
    check(!/transform/.test(reduced) && /background-color/.test(reduced), `reduced motion keeps colour, drops the slide (${reduced})`);
    await page.emulateMedia({ reducedMotion: null });
  },
};
