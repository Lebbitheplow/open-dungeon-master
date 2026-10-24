// Issue 503 Phase 7: a pact's approach is an offer only the character's own
// player is sent and answers. Seren's approach waits on the lead's Kael: the
// card says it is private, carries her words, and offers four answers (join,
// play along, tell the party, refuse) as 40px buttons, each described for a
// screen reader. Joining settles the card, and Kael's Bonds tab then shows
// the pact he is in. Clean under axe by night and by day.
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
  name: "pact-offer",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.pacts.offer[viewport];
    await t.open(`/campaigns/${table.id}`);

    const card = page.locator(`${root}[data-offer-card="${table.offerId}"]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the pact's offer card" });
    const words = await card.innerText();
    check(words.includes(table.summary), `the card's line is safe for a lock screen: ${words}`);
    check(/Seren Vale takes you aside/.test(words), "the card carries her words");
    check(/Only you see this, and only you answer/.test(words), "the card says it is the player's alone");
    const group = card.getByRole("group", { name: /your answer for kael ashvale/i });
    check(await group.count(), "the answers are one named group");
    for (const label of ["Join them", "Play along", "Tell the party", "Refuse"]) {
      const button = group.getByRole("button", { name: new RegExp(label, "i") });
      check(await button.count(), `${label} is offered`);
      const box = await button.boundingBox();
      check(box && box.height >= 40, `${label} is a 40px target (${box?.height})`);
      const described = await button.getAttribute("aria-describedby");
      check(Boolean(described), `${label} carries its hint for a screen reader`);
    }
    await axeClean(page, `${root}[data-offer-card="${table.offerId}"]`, "the pact's card at night");
    await t.shot("pact-offer");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-offer-card="${table.offerId}"]`, "the pact's card by day");
    await t.shot("pact-offer-day");
    await inTheme(page, "dark");

    // Kael joins: the card settles, and his Bonds tab shows the pact.
    await t.tap(group.getByRole("button", { name: /join them/i }));
    await eventually(async () => (await page.locator(`${root}[data-offer-card="${table.offerId}"]`).locator("visible=true").count()) === 0, {
      label: "the card settling once answered",
    });
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { label: "the Bonds sub-tab" });
    await t.tap(bondsTab);
    const own = page.locator(`${root}[data-own-pact]`).locator("visible=true").first();
    await eventually(() => own.count(), { timeoutMs: 20_000, label: "Kael's own pact on his Bonds tab" });
    check(/Kael Ashvale is in a pact/.test(await own.innerText()), "it names his place in it");
    await t.shot("pact-joined");
  },
};
