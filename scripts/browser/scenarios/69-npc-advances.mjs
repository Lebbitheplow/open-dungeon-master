// Issue 501: an NPC's romantic advance is an offer only the character's own
// player answers, and "Open to advances from NPCs" is that player's switch on
// their own Bonds row. The lead plays Kael, who is open, and Mira's advance
// waits on him: the card names who asks whom, carries her words and offers
// Accept and Decline at a finger's size; accepting settles the card and
// Mira's Bonds row reads Courting with its rung; the switch is a real
// switch that works by keyboard. Checked by axe in the night and day themes.
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
  name: "npc-advances",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.courting[viewport];
    await t.open(`/campaigns/${table.id}`);

    const card = page.locator(`${root}[data-advance-card]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Mira's advance card" });
    const words = await card.innerText();
    check(words.includes(table.advanceSummary), `the card says who asks whom: ${words}`);
    check(words.includes(table.advanceLine), "the card carries her own words");
    check(words.includes("Only you answer this"), "the card says the answer is the player's alone");
    const accept = card.getByRole("button", { name: /^accept$/i });
    const decline = card.getByRole("button", { name: /^decline$/i });
    for (const [name, button] of [["Accept", accept], ["Decline", decline]]) {
      const box = await button.boundingBox();
      check(box && box.height >= 40 && box.width >= 40, `${name} is a 40px target (${box?.width}x${box?.height})`);
    }
    await axeClean(page, `${root}[data-advance-card]`, "the advance card at night");
    await t.shot("advance-card");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-advance-card]`, "the advance card by day");
    await t.shot("advance-card-day");
    await inTheme(page, "dark");

    // Kael's player says yes: the card settles and leaves.
    await t.tap(accept);
    await eventually(async () => (await page.locator(`${root}[data-advance-card]`).locator("visible=true").count()) === 0, {
      label: "the card settling once answered",
    });

    // Kael's own Bonds row: Mira courting, and the switch.
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { label: "the Bonds sub-tab" });
    await t.tap(bondsTab);
    const row = page.locator(`${root}[data-bond-row="Mira Vell"]`).locator("visible=true").first();
    await eventually(() => row.count(), { timeoutMs: 20_000, label: "Mira's Bonds row" });
    await eventually(async () => (await row.innerText()).includes("Courting"), { label: "Mira courting Kael on the Bonds row" });
    check(await row.locator(".romance-rung-fill").count(), "the romance rung under the row");

    const block = page.locator(`${root}[data-advances-switch="${table.kael}"]`).locator("visible=true").first();
    await eventually(() => block.count(), { timeoutMs: 20_000, label: "Kael's advances switch" });
    const toggle = block.getByRole("switch", { name: /open to advances from npcs, for kael/i });
    check(await toggle.count(), "a real switch, named for the character");
    check((await toggle.getAttribute("aria-checked")) === "true", "Kael is open, as seeded");
    if (t.touch) {
      const target = await block.locator("label").first().boundingBox();
      check(target && target.height >= 40, `the switch's row is a finger's size on a phone (${target?.height})`);
    }
    await axeClean(page, `${root}[data-advances-switch="${table.kael}"]`, "the Bonds switch at night");
    await t.shot("bonds-switch");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-advances-switch="${table.kael}"]`, "the Bonds switch by day");
    await t.shot("bonds-switch-day");
    await inTheme(page, "dark");

    // By keyboard: focus, Space, and the server's answer comes back.
    await toggle.focus();
    await page.keyboard.press("Space");
    await eventually(async () => (await toggle.getAttribute("aria-checked")) === "false", { label: "switched off by keyboard" });
    await page.keyboard.press("Space");
    await eventually(async () => (await toggle.getAttribute("aria-checked")) === "true", { label: "switched back on" });
  },
};
