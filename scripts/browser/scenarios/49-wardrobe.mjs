// Issues 411 and 412 at the sheet. Vex, the lead's netrunner, is a genre
// class: her features explain themselves once the cyberpunk catalog has been
// fetched, which is no longer part of the table's first load (411). She wears
// a Cloak of Protection and carries a Cloak of Elvenkind: putting the second
// on asks to take the first off, the swap goes through in one press, and the
// lead (who corrects the table) may let both be worn, the SRD's exception
// (412). A workshop author says where a homebrew item is worn with the item
// form's "Worn on" picker, labelled, explained and clean under axe, and gone
// once the item is armour. Runs on the website and inside the app's own
// screens.
import { axeViolations, check, eventually, sleep } from "../lib.mjs";

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

    // The workshop: a homebrew mantle worn on the shoulders. The shelf is
    // the user's, shared by every run, so the name is this run's own.
    const mantle = `Mantle of the Gloaming ${viewport}${t.app ? " app" : ""}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Wardrobe", description: "" } });
    check(made.ok(), "a workshop for the item form");
    const workshopId = (await made.json()).workshop.id;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-homebrew", version: 1, how: "ended" }] } });
    try {
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.count(), { timeoutMs: 30_000, label: "the homebrew shelf" });
      await t.tap(kinds.getByText(/^Items/).first());
      await t.tap(page.getByRole("button", { name: /New item/ }).locator("visible=true").first());
      const name = page.getByRole("textbox", { name: /^Name/ }).locator("visible=true").first();
      await eventually(() => name.count(), { timeoutMs: 20_000, label: "the item form" });
      await name.fill(mantle);
      const wornOn = page.getByRole("button", { name: "Worn on", exact: true }).locator("visible=true").first();
      await eventually(() => wornOn.count(), { label: "the Worn on picker on plain gear" });
      check(/Not worn/.test(await wornOn.innerText()), "an item starts not worn");
      const kind = page.getByRole("button", { name: "Kind", exact: true }).locator("visible=true").first();
      await t.tap(kind);
      await t.tap(page.getByRole("menuitemradio", { name: "Magic item" }).locator("visible=true").first());
      await eventually(() => wornOn.count(), { label: "the Worn on picker on a magic item" });
      const field = wornOn.locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
      check(/One cloak, hat, pair of boots, gloves or bracers counts at a time\./.test(await field.innerText()), "the hint says what the place does");
      const box = await wornOn.boundingBox();
      check(box && box.height >= (viewport === "phone" ? 40 : 32), `the picker is big enough to tap (${Math.round(box?.height ?? 0)}px)`);

      // The ⓘ names every place and what the limit there is.
      await t.tap(page.getByRole("button", { name: "What is Places on the body?" }).locator("visible=true").first());
      const glossary = page.getByRole("dialog").filter({ hasText: "Shoulders (a cloak or cape)" }).locator("visible=true").first();
      await eventually(() => glossary.count(), { label: "the places explained" });
      check(/One cloak counts at a time/.test(await glossary.innerText()), "the glossary says one cloak counts");
      await sleep(900);
      await t.shot("worn-on-glossary");
      await page.keyboard.press("Escape");
      await eventually(async () => (await glossary.count()) === 0, { label: "the glossary closing" });

      // Picked from the keyboard: focus, open, choose.
      await wornOn.focus();
      await page.keyboard.press("Enter");
      const shoulders = page.getByRole("menuitemradio", { name: "Shoulders (a cloak or cape)" }).locator("visible=true").first();
      await eventually(() => shoulders.count(), { label: "the places listed from the keyboard" });
      await t.tap(shoulders);
      await eventually(async () => /Shoulders/.test(await wornOn.innerText()), { label: "Shoulders picked" });
      const form = page.locator(`${root}[role="dialog"]`).filter({ has: wornOn }).first();
      const problems = await axeViolations(page, (await form.count()) ? `[role="dialog"]` : "main");
      check(problems.length === 0, `the item form passes axe: ${JSON.stringify(problems).slice(0, 400)}`);
      await wornOn.scrollIntoViewIfNeeded().catch(() => undefined);
      await sleep(600);
      await t.shot("worn-on");
      // Legible in the day theme too: the field alone under axe, contrast included.
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await field.evaluate((element) => element.setAttribute("data-check", "worn-on"));
      await sleep(600);
      const day = await axeViolations(page, '[data-check="worn-on"]');
      check(day.length === 0, `the picker passes axe in the day theme: ${JSON.stringify(day).slice(0, 400)}`);
      await t.shot("worn-on-day");
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

      // Armour places itself, so the picker goes while it is armour.
      const alsoArmour = page.getByRole("switch", { name: "It is also armour" }).locator("visible=true").first();
      await alsoArmour.scrollIntoViewIfNeeded().catch(() => undefined);
      await t.tap(alsoArmour);
      await eventually(async () => (await wornOn.count()) === 0, { label: "the picker gone while it is armour" });
      await t.tap(alsoArmour);
      await eventually(() => wornOn.count(), { label: "the picker back" });

      await t.tap(page.getByRole("button", { name: "Keep it", exact: true }).locator("visible=true").first());
      const line = page.getByText(/worn on the shoulders/).locator("visible=true").first();
      await eventually(() => line.count(), { timeoutMs: 20_000, label: "the shelf line saying where it is worn" });
      const shelf = await (await api.get(`${base}/api/homebrew`)).json();
      const kept = (shelf.entries ?? []).find((entry) => entry.name === mantle);
      check(kept?.data?.wornOn === "cloak", `the mantle is stored worn on the shoulders (${JSON.stringify(kept?.data?.wornOn)})`);
    } finally {
      const shelf = await (await api.get(`${base}/api/homebrew`)).json().catch(() => ({}));
      for (const entry of (shelf.entries ?? []).filter((item) => item.name === mantle)) {
        await api.delete(`${base}/api/homebrew/${entry.id}`);
      }
      await api.delete(`${base}/api/workshops/${workshopId}`);
    }
  },
};
