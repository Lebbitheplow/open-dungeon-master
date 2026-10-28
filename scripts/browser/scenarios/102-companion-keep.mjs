// A companion worth travelling with is worth keeping. On the Command Table
// (the lead plays Kell alone with an AI storyteller; Pip is a companion the
// GM wrote in, kept in no library), Pip's card offers the lead "Save to my
// characters". Pressing it files Pip in the lead's characters as an ally the
// GM plays, tied to the sheet; viewports share one world, so a later press
// saves Pip's progress instead. The button is named, passes axe by night and
// by day, and is a finger's height on a phone.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "companion-keep",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    await t.open(`/campaigns/${ids.commandTableId}`);
    const card = page.locator(`${root}[data-party-card="${ids.pip}"]`).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Pip's party card" });
    await untilStill(page);

    const keep = card.getByRole("button", { name: "Save to my characters" });
    await eventually(() => keep.count(), { label: "Save to my characters on Pip's card" });
    check(/to bring to another campaign/.test((await keep.getAttribute("title")) ?? ""), "its hint says what it is for");
    if (viewport === "phone") {
      const box = await keep.boundingBox();
      check(Boolean(box && box.height >= 39.5), `a finger's height on a phone (${box?.height})`);
    }
    await keep.scrollIntoViewIfNeeded();
    const serious = (list) => list.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    const night = serious(await axeViolations(page, `${root}[data-party-card="${ids.pip}"]`));
    check(!night.length, `axe finds nothing serious on Pip's card (${night.map((violation) => violation.id).join(", ")})`);
    await t.shot("keep");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const day = serious(await axeViolations(page, `${root}[data-party-card="${ids.pip}"]`));
    check(!day.length, `Pip's card passes axe in the day theme (${day.map((violation) => violation.id).join(", ")})`);
    await t.shot("keep-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    await t.tap(keep);
    const said = card.getByRole("status");
    await eventually(
      async () => /Pip Thistle is in your characters\.|Level, gear and spells saved\.|your library keeps level/.test((await said.textContent().catch(() => "")) ?? ""),
      { label: "the card saying Pip was kept" },
    );
    await t.shot("kept");
    const library = await (await api.get(`${base}/api/characters?role=companion`)).json();
    const kept = (library.characters ?? []).find((character) => character.name === "Pip Thistle");
    check(Boolean(kept && kept.role === "companion"), "Pip is in the lead's characters as an ally the GM plays");
    const table = await (await api.get(`${base}/api/campaigns/${ids.commandTableId}`)).json();
    const pip = (table.sheets ?? []).find((sheet) => sheet.id === ids.pip);
    check(pip?.libraryCharacterId === kept?.id, "and Pip's sheet is tied to that entry");
  },
};
