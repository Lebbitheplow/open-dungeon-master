// Issue 530: a running campaign's prep. The lead, who steers the story at
// an AI-run table, steps out of play to the lobby's panels (party, rules,
// lore, Bring in prep, the schedule) and back. The campaign stays active the
// whole time, nothing is ended or written, and the table underneath is never
// torn down: a draft left in the message box is still there on the way
// back. The address carries the view, so a reload keeps it; and Home offers
// the same door in a running campaign's menu.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");
const DRAFT = "Hold the line at the waystation door.";

async function openPrep(t) {
  const { page, root, viewport } = t;
  if (viewport === "phone") {
    // The phone keeps it in the table menu.
    await t.tap(visible(page.locator(`${root}[data-tour="header-menu"]`)).first());
    const row = page.locator("[data-campaign-prep-row]");
    await eventually(() => visible(row).count(), { label: "Campaign prep in the table menu" });
    await t.tap(visible(row).first());
  } else {
    const button = visible(page.locator(`${root}[data-campaign-prep]`));
    check(/Campaign prep/.test((await button.first().textContent()) ?? ""), "the header says Campaign prep in words");
    await t.tap(button.first());
  }
  await eventually(() => visible(page.locator(`${root}[data-campaign-prep-screen]`)).count(), { label: "the prep screen" });
}

export default {
  name: "campaign-prep",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport, api, base, app } = t;
    const campaignId = ids.prepReturn[viewport];
    const status = async () => (await (await api.get(`${base}/api/campaigns/${campaignId}`)).json()).campaign?.status;
    await t.open(`/campaigns/${campaignId}`);

    // A draft in the message box: it survives only if the table does.
    const box = visible(page.locator(`${root}textarea`)).first();
    await eventually(() => box.count(), { timeoutMs: 30_000, label: "the message box" });
    await box.fill(DRAFT);

    await openPrep(t);
    const screen = page.locator(`${root}[data-campaign-prep-screen]`);
    const moving = await screen.first().evaluate((layer) => layer.getAnimations({ subtree: true }).length);
    check(moving > 0, `prep arrives with motion (${moving} animations)`);
    await untilStill(page);
    check((await t.url()).searchParams.get("view") === "prep", "the address carries the prep view");
    const focus = await screen.first().evaluate((layer) => ({
      inside: layer.contains(document.activeElement),
      on: `${document.activeElement?.tagName ?? "none"} ${String(document.activeElement?.className ?? "").slice(0, 80)}`,
    }));
    check(focus.inside, `the keyboard lands in the prep (focus is on ${focus.on})`);
    // The prep's own panels, and none of the lobby's start.
    check((await visible(screen.locator("[data-prep-banner]")).count()) === 1, "the prep says the adventure still runs");
    check(/Bring in prep/.test((await screen.first().textContent()) ?? ""), "Bring in prep is here");
    check(!/Begin the adventure/.test((await screen.first().textContent()) ?? ""), "no Begin the adventure in a running campaign");
    check(!/Ready up/i.test((await screen.first().textContent()) ?? ""), "no Ready up in a running campaign");
    // The table is still under it, inert.
    check((await page.locator(`${root}main[data-prep] > div.contents[inert]`).count()) === 1, "the table stays mounted and inert");
    check((await status()) === "active", "the campaign is still active");
    if (viewport === "desktop") {
      const problems = await axeViolations(page, `${root}[data-campaign-prep-screen]`.trim());
      check(problems.length === 0, `the prep screen passes axe: ${JSON.stringify(problems)}`);
    }
    await t.shot("prep");

    // Back to the table: the draft is where it was left.
    await t.tap(visible(screen.locator("[data-prep-resume]")).first());
    await eventually(async () => (await page.locator(`${root}[data-campaign-prep-screen]`).count()) === 0, { label: "the prep fading away" });
    check(!(await t.url()).searchParams.has("view"), "the address is the table's again");
    check((await box.inputValue()) === DRAFT, "the table was never torn down: the draft is still in the box");
    if (viewport === "desktop") {
      check(
        await page.evaluate(() => document.activeElement?.hasAttribute("data-campaign-prep") ?? false),
        "the keyboard is back on the Campaign prep button",
      );
    }
    check((await status()) === "active", "still active after the way back");
    await t.shot("table-again");

    // A reload on the prep address opens the prep.
    await openPrep(t);
    await t.reload();
    await eventually(() => visible(page.locator(`${root}[data-campaign-prep-screen]`)).count(), {
      timeoutMs: 30_000,
      label: "the prep after a reload",
    });
    await t.tap(visible(page.locator(`${root}[data-prep-resume]`)).first());
    await eventually(async () => (await page.locator(`${root}[data-campaign-prep-screen]`).count()) === 0, { label: "back once more" });

    // Home: a running campaign's menu has the same door (the server's home;
    // the app has a home of its own).
    if (!app && viewport === "desktop") {
      await t.open("/");
      const tile = page.locator(".ts-slot").filter({ hasText: `${ids.prepReturnTitle} (${viewport})` }).first();
      await eventually(() => tile.count(), { timeoutMs: 30_000, label: "the campaign's tile at home" });
      await tile.click({ button: "right" });
      const item = page.getByRole("menuitem", { name: "Open prep" });
      await eventually(() => visible(item).count(), { label: "Open prep in the tile's menu" });
      await item.first().click();
      await eventually(() => visible(page.locator("[data-campaign-prep-screen]")).count(), { timeoutMs: 30_000, label: "prep from home" });
      check((await status()) === "active", "opening prep from home changes nothing either");
    }
  },
};
