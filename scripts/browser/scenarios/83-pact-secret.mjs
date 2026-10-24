// Issue 503 Phase 7: a player in a pact acts in secret. The lead's Kael has
// joined Seren's pact; on his Bonds tab the pact card names who is in it and
// what it plans, for his eyes only, with a form to act in secret: a choice
// of what to do (radio buttons, 40px), what it is rolled with, and his own
// words. The server holds it and rolls it where only he and the storyteller
// see; the confirmation comes back to him alone, in a status line that fades
// up, and the action is listed as held. Nothing reaches the transcript.
// Clean under axe by night and by day.
import { axeViolations, check, eventually, openPanelTab, sleep } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await sleep(300);
}

export default {
  name: "pact-secret",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.pacts.secret[viewport];
    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { label: "the Bonds sub-tab" });
    await t.tap(bondsTab);

    const own = page.locator(`${root}[data-own-pact]`).locator("visible=true").first();
    await eventually(() => own.count(), { timeoutMs: 20_000, label: "Kael's own pact" });
    const words = await own.innerText();
    check(/Kael Ashvale is in a pact/.test(words) && /Seren Vale/.test(words), `the pact names him and Seren: ${words}`);
    check(/Only you see this/.test(words), "it says it is his alone");
    const form = own.locator(`[data-secret-form="${table.kael}"]`);
    check(await form.count(), "the secret action form");
    const scheme = form.getByRole("radio", { name: /quiet scheme/i });
    check(await scheme.count(), "a quiet scheme is offered");
    const option = await scheme.locator("xpath=ancestor::label[1]").boundingBox();
    check(option && option.height >= 40, `each choice is a 40px target (${option?.height})`);
    check((await form.getByRole("radio", { name: /strike when it moves/i }).count()) === 0, "no attack at a table set to Leave");
    await axeClean(page, `${root}[data-own-pact]`, "the pact card at night");
    await t.shot("pact-secret-form");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-own-pact]`, "the pact card by day");
    await t.shot("pact-secret-form-day");
    await inTheme(page, "dark");

    const before = await page.locator(`${root}[data-message-id]`).count();
    await t.tap(scheme);
    await form.locator("[data-secret-text]").fill("Loosen the cart's wheel");
    await t.tap(form.getByRole("button", { name: /do it in secret/i }));
    const status = form.locator("[data-secret-confirm]");
    await eventually(() => status.count(), { timeoutMs: 15_000, label: "the confirmation" });
    check((await status.getAttribute("data-secret-confirm")) === "held", "nobody caught it");
    check(/Done in secret: Loosen the cart's wheel/.test(await status.innerText()), "the confirmation says what was done");
    check((await status.getAttribute("role")) === "status", "said to a screen reader as a status");
    const anim = await status.evaluate((element) => getComputedStyle(element).animationName);
    check(/secret-confirm-in|pact-unmask-fade/.test(anim), `the confirmation fades up (${anim})`);
    await eventually(async () => (await own.locator('[data-own-secret="held"]').count()) > 0, { label: "the action listed as held" });
    await t.shot("pact-secret-done");
    await sleep(500);
    check((await page.locator(`${root}[data-message-id]`).count()) === before, "nothing reached the transcript");
  },
};
