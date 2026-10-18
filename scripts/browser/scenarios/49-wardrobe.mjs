// Issues 411 and 412 at the sheet. Vex, the lead's netrunner, is a genre
// class: her features explain themselves once the cyberpunk catalog has been
// fetched, which is no longer part of the table's first load (411). She wears
// a Cloak of Protection and carries a Cloak of Elvenkind: putting the second
// on asks to take the first off, the swap goes through in one press, and the
// lead (who corrects the table) may let both be worn, the SRD's exception
// (412). Runs on the website and inside the app's own screens.
import { check, eventually, sleep } from "../lib.mjs";

const PROTECTION = "Cloak of Protection";
const ELVENKIND = "Cloak of Elvenkind";

export default {
  name: "wardrobe",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const campaignId = ids.wardrobe[viewport];
    const gear = async () => {
      const table = await (await api.get(`${base}/api/campaigns/${campaignId}`)).json();
      const vex = (table.sheets ?? []).find((sheet) => sheet.name === "Vex Halloran");
      return Object.fromEntries((vex?.equipment ?? []).map((item) => [item.name, item]));
    };

    await t.open(`/campaigns/${campaignId}`);
    const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Vex Halloran" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await sleep(800);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Vex's party card" });
    await t.tap(card);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Worn gear sets your AC" }).first();
    await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Vex's sheet with her gear" });

    // 411: the genre feature's help arrives with its catalog.
    const help = sheet.getByRole("button", { name: "What is Deck Interface?" });
    await eventually(() => help.count(), { timeoutMs: 20_000, label: "Deck Interface's help, once the cyberpunk catalog is fetched" });
    await help.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(help.first());
    const explained = page.getByRole("dialog").filter({ hasText: /cyberdeck/ }).locator("visible=true").first();
    await eventually(() => explained.count(), { label: "Deck Interface explained" });
    // Past the dialog's fade-in, so the shot shows it.
    await sleep(900);
    await t.shot("feature-help");
    await page.keyboard.press("Escape");
    await eventually(async () => (await explained.count()) === 0, { label: "the help closing" });

    // 412: the second cloak asks first.
    const rowOf = (name) => sheet.locator(`[data-gear-row="${name}"]`).first();
    const before = await gear();
    check(before[PROTECTION]?.equipped === true && before[ELVENKIND]?.equipped === false, "Vex starts in the Cloak of Protection");
    await rowOf(ELVENKIND).scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(rowOf(ELVENKIND).getByRole("button", { name: "wear", exact: true }));
    const ask = sheet.getByRole("group", { name: `Wear ${ELVENKIND}?` });
    await eventually(() => ask.count(), { label: "the question before a second cloak" });
    const text = ((await ask.textContent()) ?? "").replace(/\s+/g, " ");
    check(text.includes(`${ELVENKIND} goes where ${PROTECTION} is: a character wears one cloak at a time.`), `the question names both cloaks (${text})`);
    check((await ask.getByRole("button", { name: /Wear both/ }).count()) === 1, "the lead is offered the DM's exception");
    await sleep(900);
    await t.shot("asked");
    check((await gear())[ELVENKIND]?.equipped === false, "nothing was posted before the answer");

    // The swap: one press, the first comes off, the second goes on.
    await t.tap(ask.getByRole("button", { name: `Take off ${PROTECTION}, wear ${ELVENKIND}` }));
    await eventually(async () => {
      const now = await gear();
      return now[PROTECTION]?.equipped === false && now[ELVENKIND]?.equipped === true;
    }, { label: "the swap stored" });
    await eventually(async () => ((await rowOf(ELVENKIND).getByRole("button", { name: "worn", exact: true }).count()) === 1), {
      label: "the Cloak of Elvenkind marked worn on the sheet",
    });
    await t.shot("swapped");

    // The lead's exception: both cloaks, the Cloak of Protection marked beside another.
    await t.tap(rowOf(PROTECTION).getByRole("button", { name: "wear", exact: true }));
    const again = sheet.getByRole("group", { name: `Wear ${PROTECTION}?` });
    await eventually(() => again.count(), { label: "the question before the first cloak goes back on" });
    await t.tap(again.getByRole("button", { name: /Wear both/ }));
    await eventually(async () => {
      const now = await gear();
      return now[PROTECTION]?.equipped === true && now[PROTECTION]?.layered === true && now[ELVENKIND]?.equipped === true;
    }, { label: "both cloaks stored, the second on the DM's say" });
    await eventually(() => rowOf(PROTECTION).getByText("beside another").count(), { label: "the beside-another mark" });
    await t.shot("both");
  },
};
