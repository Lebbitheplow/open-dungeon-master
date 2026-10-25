// The quick build (F1, F2): a new character's first step asks the quiz's
// first question, "In a fight, what's your job?". "Help me build" there
// asks the other three, offers a suggested character and a second choice,
// and fills the one chosen; the read-back marks every pick "Picked for
// you" and one Undo puts the builder back. "Fill what's left" fills only
// the empty slots and keeps a name the player typed.
import { check, eventually, sleep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

async function fresh(t) {
  const { page, root } = t;
  await t.open("/characters/new");
  const startFresh = visible(page, root, /^Start fresh$/);
  if (await startFresh.count()) {
    await t.tap(startFresh.first());
  }
  // The class step comes first (backlog F4), with the job question.
  await page.locator(`${root}section[data-active] [data-builder-target="class"]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
}

export default {
  name: "quick-build",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    // The name is on the identity step, mounted but hidden until it is
    // reached: read through any copy, typed into the visible one.
    const name = page.locator(`${root}input[aria-label="Name"]`).first();
    const shownName = page.locator(`${root}section[data-active] input[aria-label="Name"]`).locator("visible=true").first();
    await fresh(t);

    // The first question on the step, then the other three in the quiz.
    const job = page.getByRole("radiogroup", { name: "In a fight, what's your job?" }).locator("visible=true").first();
    await eventually(() => job.count(), { timeoutMs: 15_000, label: "the job question on step 1" });
    const healer = job.getByRole("radio", { name: "Keep everyone alive" });
    check(/\(Healer\)/.test(await healer.innerText()), "each job carries its gamer word");
    await t.tap(healer);
    const door = visible(page, root, /^Help me build$/);
    await eventually(() => door.count(), { timeoutMs: 15_000, label: "Help me build" });
    await t.tap(door.first());
    await eventually(
      async () => /Question 2 of 4/.test(await page.locator(`${root}[data-quick-quiz]`).first().innerText()),
      { timeoutMs: 10_000, label: "the quiz opening on question 2" },
    );
    for (const answer of [/^Magic$/, /^Faith$/, /^Knows the lore$/]) {
      const option = visible(page, root, answer);
      await eventually(() => option.count(), { timeoutMs: 10_000, label: `the answer ${answer}` });
      await t.tap(option.first());
    }
    const seeds = page.locator(`${root}[data-quick-seed]`).locator("visible=true");
    await eventually(async () => (await seeds.count()) === 2, { timeoutMs: 10_000, label: "two suggested characters" });
    check((await seeds.first().getAttribute("data-quick-seed")) === "cleric", "a faithful healer is a cleric first");
    await t.shot("suggestions");
    await t.tap(visible(page, root, /^Build this one$/).first());

    // The filled character opens on the last step, read back once.
    const readback = page.locator(`${root}[data-quick-readback]`).locator("visible=true");
    await eventually(() => readback.count(), { timeoutMs: 20_000, label: "the read-back" });
    await eventually(
      async () => /Step 6:/.test((await page.locator(`${root}button[aria-current="step"]`).locator("visible=true").first().getAttribute("aria-label")) ?? ""),
      { timeoutMs: 10_000, label: "the Finish step" },
    );
    const marks = await readback.locator("text=Picked for you").count();
    check(marks >= 8, `every pick is marked (${marks})`);
    const owed = await page.locator(`${root}[data-owed]`).count();
    check(owed === 0, `nothing is left owed on any step (${owed})`);
    await t.shot("filled");

    // One Undo puts it all back.
    await t.tap(page.locator(`${root}[data-quick-undo]`).first());
    await eventually(async () => (await page.locator(`${root}[data-quick-readback]`).count()) === 0, { timeoutMs: 10_000, label: "the read-back gone" });
    await eventually(async () => (await name.inputValue()) === "", { timeoutMs: 10_000, label: "the name cleared by Undo" });

    // Fill what's left keeps what the player typed. The name is asked last
    // (backlog F4), so the player fills the build, names the hero, then goes
    // back and changes the class, and fills what that change left.
    const fillButton = page.locator(`${root}section[data-active] [data-quick-fill]`).locator("visible=true");
    await eventually(() => fillButton.count(), { timeoutMs: 10_000, label: "Fill what's left on the class step" });
    await t.tap(fillButton.first());
    await eventually(() => readback.count(), { timeoutMs: 20_000, label: "the read-back after the first fill" });
    await t.tap(visible(page, root, /^Keep them$/).first());
    const hero = `Kept Name ${t.viewport}`;
    const heroDiamond = page.locator(`${root}button[aria-label^="Go to step 5:"]`).locator("visible=true");
    await eventually(async () => (await heroDiamond.count()) && heroDiamond.first().isEnabled(), { timeoutMs: 15_000, label: "the Hero diamond" });
    await t.tap(heroDiamond.first());
    await shownName.waitFor({ state: "visible", timeout: 15_000 });
    await shownName.fill(hero);
    await t.tap(page.locator(`${root}button[aria-label^="Back to step 1:"]`).locator("visible=true").first());
    const other = page.locator(`${root}section[data-active] .creator-card[aria-pressed="false"]`).locator("visible=true").first();
    await other.waitFor({ state: "visible", timeout: 15_000 });
    await t.tap(other);
    await eventually(() => fillButton.count(), { timeoutMs: 10_000, label: "Fill what's left after the class change" });
    await t.tap(fillButton.first());
    await eventually(() => readback.count(), { timeoutMs: 20_000, label: "the read-back after a fill" });
    check((await name.inputValue()) === hero, "the typed name is kept");
    const text = await readback.first().innerText();
    check(!/Name:/.test(text), "the name is not read back as picked");
    await t.shot("fill-left");
    // "Keep them" closes the panel; "Show what was picked" brings it back.
    await t.tap(visible(page, root, /^Keep them$/).first());
    const kept = page.locator(`${root}[data-quick-kept]`).locator("visible=true");
    await eventually(() => kept.count(), { timeoutMs: 10_000, label: "the Show what was picked line" });
    check((await readback.count()) === 0, "the panel closes");
    await t.tap(visible(page, root, /^Show what was picked$/).first());
    await eventually(() => readback.count(), { timeoutMs: 10_000, label: "the panel back" });
    await t.tap(visible(page, root, /^Undo all of these$/).first());
    // Time is the check: an Undo that took the name would clear it within this while.
    await sleep(300);
    check((await name.inputValue()) === hero, "Undo keeps the typed name too");
  },
};
