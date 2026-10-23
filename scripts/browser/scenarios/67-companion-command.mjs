// Who takes an AI companion's turns in fights (src/lib/dm/companion-command.ts):
// on the Command Table, where the lead plays alone with an AI storyteller,
// Pip's Party card carries an "In fights" picker set to the lead, with a line
// saying the DM still plays Pip out of fights. Picking "The DM" hands Pip's
// turns back and the line says so; picking "You" takes them again. The pill
// slides, the choices are a named radio group a finger can hit on a phone,
// and axe finds nothing serious on the card. Pip ends under the lead again.
import { axeViolations, check, eventually, sleep } from "../lib.mjs";

export default {
  name: "companion-command",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const campaignUrl = `${base}/api/campaigns/${ids.commandTableId}`;
    const commander = async () => {
      const data = await (await api.get(campaignUrl)).json();
      return (data.sheets ?? []).find((sheet) => sheet.id === ids.pip)?.commandedBy ?? null;
    };
    const lead = await commander();
    check(Boolean(lead), "the seed put Pip under the lead's command");

    await t.open(`/campaigns/${ids.commandTableId}`);
    const card = page.locator(`${root}[data-companion-command="${ids.pip}"]`).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await sleep(800);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Pip's In fights picker" });
    const group = card.getByRole("radiogroup", { name: "Who takes Pip Thistle's turns in fights" });
    check((await group.count()) === 1, "the picker is a named radio group");
    const you = group.getByRole("radio", { name: "You" });
    const dm = group.getByRole("radio", { name: "The DM" });
    check((await you.getAttribute("aria-checked")) === "true", "You is picked");
    const hint = card.locator("p").first();
    check(/^You take Pip Thistle's turns in fights\. Out of fights the DM plays Pip Thistle\.$/.test((await hint.textContent()) ?? ""), `the line says who and when (${await hint.textContent()})`);
    if (viewport === "phone") {
      const box = await dm.boundingBox();
      check(Boolean(box && box.height >= 39.5), `a finger's height on a phone (${box?.height})`);
    }
    const violations = await axeViolations(page, `${root}[data-companion-command="${ids.pip}"]`);
    const serious = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    check(!serious.length, `axe finds nothing serious on the picker (${serious.map((violation) => violation.id).join(", ")})`);
    await card.scrollIntoViewIfNeeded();
    await t.shot("commanded");
    // Legible in the day theme too: the picker alone under axe, contrast included.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await sleep(600);
    const day = await axeViolations(page, `${root}[data-companion-command="${ids.pip}"]`);
    check(day.length === 0, `the picker passes axe in the day theme: ${JSON.stringify(day).slice(0, 400)}`);
    await t.shot("commanded-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    await t.tap(dm);
    await eventually(async () => (await commander()) === null, { label: "Pip's fights handed back to the DM" });
    await eventually(async () => (await dm.getAttribute("aria-checked")) === "true", { label: "The DM picked" });
    await eventually(async () => /^The DM plays Pip Thistle's turns in fights, as everywhere else\.$/.test((await hint.textContent()) ?? ""), { label: "the line saying the DM plays Pip" });
    const sliding = await group.evaluate((node) => node.getAnimations({ subtree: true }).length);
    check(sliding > 0 || (await dm.evaluate((node) => getComputedStyle(node).transitionDuration)) !== "0s", "the pick moves, it does not blink");
    await t.shot("dm");

    await t.tap(you);
    await eventually(async () => (await commander()) === lead, { label: "Pip under the lead again" });
    await eventually(async () => (await you.getAttribute("aria-checked")) === "true", { label: "You picked again" });
  },
};
