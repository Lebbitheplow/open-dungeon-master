// The quick build (F1, F2): "Help me build" on a new character's first step
// asks four questions, offers a suggested character and a second choice,
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
  await page.locator(`${root}input[aria-label="Name"]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
}

export default {
  name: "quick-build",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    const name = page.locator(`${root}input[aria-label="Name"]`).locator("visible=true").first();
    await fresh(t);

    // The door, and the four questions.
    const door = visible(page, root, /^Help me build$/);
    await eventually(() => door.count(), { timeoutMs: 15_000, label: "the Help me build door" });
    await t.tap(door.first());
    for (const answer of [/^Keep everyone alive$/, /^Magic$/, /^Faith$/, /^Knows the lore$/]) {
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

    // Fill what's left keeps what the player typed.
    const hero = `Kept Name ${t.viewport}`;
    await name.fill(hero);
    const fillButton = page.locator(`${root}section[data-active] [data-quick-fill]`).locator("visible=true");
    await eventually(() => fillButton.count(), { timeoutMs: 10_000, label: "Fill what's left" });
    await t.tap(fillButton.first());
    await eventually(() => readback.count(), { timeoutMs: 20_000, label: "the read-back after a fill" });
    await sleep(500);
    check((await name.inputValue()) === hero, "the typed name is kept");
    const text = await readback.first().innerText();
    check(!/Name:/.test(text), "the name is not read back as picked");
    await t.shot("fill-left");
    await t.tap(visible(page, root, /^Undo all of these$/).first());
    await sleep(300);
    check((await name.inputValue()) === hero, "Undo keeps the typed name too");
  },
};
