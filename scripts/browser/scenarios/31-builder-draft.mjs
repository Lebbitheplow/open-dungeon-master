// A new character's progress survives a reload: the builder keeps it on the
// device and offers it back with Resume, on the step it was left, and Start
// fresh throws it away. A draft kept under the step order before backlog F4
// resumes on the step it was left, not on the one now at its place. The
// library's new-character page is a native screen in the app too.
import { check, eventually, sleep, currentStep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

// The drafts the builder keeps on the device (src/app/characters/builder/
// builderDraft.ts), each written 400 ms after a change of step or fields.
const drafts = (page) =>
  page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("odm:builder-draft:"))
      .map((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")),
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
    await t.open("/characters/new");
    // A draft an earlier viewport left is not this one's.
    const fresh = visible(page, root, /^Start fresh$/);
    if (await fresh.count()) {
      await t.tap(fresh.first());
    }
    // The class is the first step and needs no name (backlog F4): a
    // barbarian owes only its two skills, which the step suggests.
    const barbarian = page.locator(`${root}section[data-active] .creator-card[aria-label^="Barbarian"]`).locator("visible=true").first();
    await barbarian.waitFor({ state: "visible", timeout: 30_000 });
    await t.tap(barbarian);
    await t.tap(page.locator(`${root}section[data-active] [data-suggest-skills]`).locator("visible=true").first());
    const was = await currentStep(page, root);
    await t.tap(visible(page, root, /^Continue/).first());
    await eventually(async () => (await currentStep(page, root)) !== was, { label: "the Ancestry step" });
    // The first lineage card on the Ancestry step.
    const card = page.locator(`${root}section[data-active] .creator-card`).locator("visible=true").first();
    await card.waitFor({ state: "visible", timeout: 15_000 });
    const lineage = await card.getAttribute("aria-label");
    await t.tap(card);
    // The step change writes a draft of its own: only one holding the pick
    // on the Ancestry step is what the reload has to find.
    await eventually(async () => (await drafts(page)).some((kept) => kept?.step === 1 && kept.fields.raceId), { label: "the pick kept on the device" });

    await reopen(t);
    const resume = visible(page, root, /^Resume$/);
    await eventually(() => resume.count(), { timeoutMs: 15_000, label: "the Resume offer after a reload" });
    const offer = (await page.locator(`${root}[role="status"]`).filter({ hasText: "unfinished character" }).first().innerText()).replace(/\s+/g, " ");
    check(/step 2 of 6/.test(offer), `the offer says its step (${offer})`);
    await t.shot("offer");
    await t.tap(resume.first());
    const current = () => page.locator(`${root}button[aria-current="step"]`).locator("visible=true").first().getAttribute("aria-label");
    await eventually(async () => /^Step 2:/.test((await current()) ?? ""), { timeoutMs: 10_000, label: "resumed on step 2" });
    const chosen = await page.locator(`${root}section[data-active] .creator-card[aria-pressed="true"]`).first().getAttribute("aria-label");
    check(chosen === lineage, `the lineage picked before the reload is picked again (${chosen}, was ${lineage})`);
    await t.shot("resumed");

    // A draft kept before the new order counted its steps by place, the
    // class third: it resumes on the class, not on the step now third.
    await eventually(async () => (await drafts(page)).some((kept) => kept?.fields), { label: "a kept draft to rewrite" });
    const rewritten = await page.evaluate(() => {
      const key = "odm:builder-draft:library";
      const draft = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (!draft?.fields) return false;
      window.localStorage.setItem(key, JSON.stringify({ v: 1, savedAt: Date.now(), step: 2, fields: draft.fields }));
      return true;
    });
    check(rewritten, "a kept draft to rewrite as an old one");
    await reopen(t);
    await eventually(() => resume.count(), { timeoutMs: 15_000, label: "the Resume offer for an old draft" });
    const old = (await page.locator(`${root}[role="status"]`).filter({ hasText: "unfinished character" }).first().innerText()).replace(/\s+/g, " ");
    check(/step 1 of 6/.test(old), `the old draft's offer names the class step (${old})`);
    await t.tap(resume.first());
    await eventually(async () => /^Step 1:/.test((await current()) ?? ""), { timeoutMs: 10_000, label: "the old draft resumed on the class step" });
    const klass = await page.locator(`${root}section[data-active] .creator-card[aria-pressed="true"]`).first().getAttribute("aria-label");
    check(/^Barbarian/.test(klass ?? ""), `the class picked before is picked again (${klass})`);

    // Start fresh forgets it.
    await reopen(t);
    await eventually(() => visible(page, root, /^Start fresh$/).count(), { timeoutMs: 15_000, label: "the offer again" });
    await t.tap(visible(page, root, /^Start fresh$/).first());
    await eventually(async () => (await drafts(page)).length === 0, { label: "the draft thrown away" });
    await reopen(t);
    await barbarian.waitFor({ state: "visible", timeout: 30_000 });
    // Time is the check: an offer the page still found would show within this while.
    await sleep(800);
    check((await visible(page, root, /^Resume$/).count()) === 0, "Start fresh leaves no draft to resume");
  },
};
