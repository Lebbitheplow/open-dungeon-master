// A new character's progress survives a reload: the builder keeps it on the
// device and offers it back with Resume, on the step it was left, and Start
// fresh throws it away. The library's new-character page is a native screen
// in the app too.
import { check, eventually, sleep, currentStep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

// The draft the builder keeps on the device (src/app/characters/builder/
// builderDraft.ts), written a moment after each change; "" when there is none.
const draft = (page) =>
  page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("odm:builder-draft:"))
      .map((key) => window.localStorage.getItem(key))
      .join("\n"),
  );

// A reload in a browser; in the app, whose router keeps a screen mounted
// when it is pushed again, leaving for the library and coming back.
async function reopen(t) {
  if (t.app) await t.open("/characters");
  await t.open("/characters/new");
}

export default {
  name: "builder-draft",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    const hero = `Draft Keeper ${t.viewport}${t.app ? " app" : ""}`;
    await t.open("/characters/new");
    // A draft an earlier viewport left is not this one's.
    const fresh = visible(page, root, /^Start fresh$/);
    if (await fresh.count()) {
      await t.tap(fresh.first());
    }
    const name = page.locator(`${root}input[aria-label="Name"]`).locator("visible=true").first();
    await name.waitFor({ state: "visible", timeout: 30_000 });
    await name.fill(hero);
    // No background is picked for the player, and the first step owes one.
    await t.tap(page.locator(`${root}section[data-active] [data-builder-target="background"] button[aria-haspopup="listbox"]`).locator("visible=true").first());
    await t.tap(page.locator(`${root}[role="option"]`).filter({ hasText: "Soldier" }).locator("visible=true").first());
    const was = await currentStep(page, root);
    await t.tap(visible(page, root, /^Continue/).first());
    await eventually(async () => (await currentStep(page, root)) !== was, { label: "the Ancestry step" });
    // The first lineage card on the Ancestry step.
    const card = page.locator(`${root}section[data-active] .creator-card`).locator("visible=true").first();
    await card.waitFor({ state: "visible", timeout: 15_000 });
    const lineage = await card.getAttribute("aria-label");
    const kept = await draft(page);
    await t.tap(card);
    await eventually(async () => (await draft(page)) !== kept, { label: "the pick kept on the device" });

    await reopen(t);
    const resume = visible(page, root, /^Resume$/);
    await eventually(() => resume.count(), { timeoutMs: 15_000, label: "the Resume offer after a reload" });
    const offer = (await page.locator(`${root}[role="status"]`).filter({ hasText: "unfinished character" }).first().innerText()).replace(/\s+/g, " ");
    check(offer.includes(hero) && /step 2 of 6/.test(offer), `the offer names the hero and its step (${offer})`);
    await t.shot("offer");
    await t.tap(resume.first());
    await eventually(async () => (await name.inputValue()) === hero, { timeoutMs: 10_000, label: "the name back" });
    const current = await page.locator(`${root}button[aria-current="step"]`).locator("visible=true").first().getAttribute("aria-label");
    check(/^Step 2:/.test(current ?? ""), `resumed on step 2 (${current})`);
    const chosen = await page.locator(`${root}section[data-active] .creator-card[aria-pressed="true"]`).first().getAttribute("aria-label");
    check(chosen === lineage, `the lineage picked before the reload is picked again (${chosen}, was ${lineage})`);
    await t.shot("resumed");

    // Start fresh forgets it.
    await reopen(t);
    await eventually(() => visible(page, root, /^Start fresh$/).count(), { timeoutMs: 15_000, label: "the offer again" });
    await t.tap(visible(page, root, /^Start fresh$/).first());
    await eventually(async () => (await draft(page)) === "", { label: "the draft thrown away" });
    await reopen(t);
    await name.waitFor({ state: "visible", timeout: 30_000 });
    // Time is the check: an offer the page still found would show within this while.
    await sleep(800);
    check((await visible(page, root, /^Resume$/).count()) === 0, "Start fresh leaves no draft to resume");
  },
};
