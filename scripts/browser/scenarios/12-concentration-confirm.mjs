// Issue 252: a cast that would end the spell a character is concentrating
// on asks first. Sister Ama holds Spirit Guardians at a quiet table; the
// lead types a Bless cast in the composer, is asked in the table's own
// dialog, cancels (the draft stays, nothing is posted), then confirms (the
// cast is posted). Her spell list marks the concentration spells.
import { check, eventually, sleep } from "../lib.mjs";

const CAST = "I cast Bless on Corin and myself before we cross.";

export default {
  name: "concentration-confirm",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    // No storyteller runs here, so the cast posted below never resolves:
    // every viewport finds Ama still holding Spirit Guardians.
    const table = await (await api.get(`${base}/api/campaigns/${ids.quietId}`)).json();
    const ama = (table.sheets ?? []).find((sheet) => sheet.id === ids.ama);
    check(ama?.concentratingOn === "Spirit Guardians", `Ama holds Spirit Guardians (${ama?.concentratingOn})`);
    await t.open(`/campaigns/${ids.quietId}`);
    const box = page.locator(`${root}form:has(button[aria-label="Send"]) textarea`).locator("visible=true").first();
    await eventually(() => box.count(), { timeoutMs: 30_000, label: "the composer" });
    const posted = async () => {
      const response = await api.get(`${base}/api/campaigns/${ids.quietId}/messages?limit=20`);
      const data = await response.json().catch(() => ({}));
      return (data.messages ?? []).filter((message) => message.content === CAST).length;
    };
    const before = await posted();

    const ask = async () => {
      await box.fill(CAST);
      await t.tap(page.locator(`${root}button[aria-label="Send"]`).locator("visible=true").first());
      const dialog = page.getByRole("dialog").filter({ hasText: "Replace Spirit Guardians?" }).locator("visible=true").first();
      await eventually(() => dialog.count(), { label: "the question before Bless ends Spirit Guardians" });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      check(/Casting Bless will end Sister Ama's concentration on Spirit Guardians/.test(text), `the dialog names both spells (${text})`);
      return dialog;
    };

    // Cancel: the draft stays, nothing is posted, the spell is still held.
    const first = await ask();
    await t.shot("asked");
    await t.tap(first.getByRole("button", { name: /^cancel$/i }));
    await eventually(() => first.count().then((count) => count === 0), { label: "the dialog closing on Cancel" });
    check((await box.inputValue()) === CAST, "the draft is kept after Cancel");
    // Time is the check: a post the Cancel let through would land within this while.
    await sleep(800);
    check((await posted()) === before, "nothing was posted after Cancel");

    // Confirm: the cast is posted and the box clears.
    const second = await ask();
    await t.tap(second.getByRole("button", { name: /^cast bless$/i }));
    await eventually(async () => (await box.inputValue()) === "", { label: "the composer clearing once confirmed" });
    await eventually(async () => (await posted()) === before + 1, { label: "the Bless cast posted once" });
    await t.shot("cast");

    // Her spells mark the ones that need concentration.
    const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Sister Ama" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 20_000, label: "Sister Ama's party card" });
    await t.tap(card);
    const marks = page.locator(`${root}[role="dialog"] [data-concentration]`);
    await eventually(async () => (await marks.count()) > 0, { timeoutMs: 20_000, label: "a concentration mark in Ama's spells" });
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ has: page.locator("[data-concentration]") }).first();
    // The book shows one spell level at a time (1st here); its search box
    // reaches the 3rd-level Spirit Guardians.
    const markedRows = () =>
      sheet.evaluate((dialog) =>
        Array.from(dialog.querySelectorAll(".spell-tile"))
          .map((tile) => `${tile.querySelector("[data-concentration]") ? "C " : "- "}${tile.textContent?.replace(/\s+/g, " ").trim() ?? ""}`),
      );
    const levelOne = await markedRows();
    check(levelOne.some((row) => /^C Bless/.test(row)), `Bless is marked (${levelOne.join(" | ")})`);
    check(levelOne.some((row) => /^- Cure Wounds/.test(row)), "Cure Wounds is not marked");
    await sheet.locator('input[aria-label="Find a spell"]').fill("Spirit Guardians");
    await eventually(async () => (await markedRows()).some((row) => /^C Spirit Guardians/.test(row)), { label: "Spirit Guardians marked" });
    await t.shot("marks");
  },
};
