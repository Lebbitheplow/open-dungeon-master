// F23 and F26: the hero page a new character lands on after its first save.
// The seeded library fighter's page, read as it stands now: library-edit
// renames it and library-level-up may raise it before this runs, so the
// name and level come from the API, not from the seed. The page: the heading holds focus on arrival, the
// build's line and three things to try are there as text, "Don't show this
// again" is kept on the account across a reload, "Bring to a table" opens
// the join dialog, and Done goes to the roster. Nothing on it moves on by
// itself. scripts/test-hero-tips.mjs holds the words of each line.
import { check, eventually } from "../lib.mjs";

export default {
  name: "hero-page",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, ids, api, base } = t;
    const stored = await api.get(`${base}/api/characters/${ids.library}`);
    check(stored.ok(), "the seeded library character");
    const { character } = await stored.json();
    const heading = page.getByRole("heading", { level: 1, name: `${character.name} is ready`, exact: true });
    const skip = page.getByRole("checkbox", { name: "Don't show this again" });
    try {
      await t.open(`/characters/${ids.library}/ready`);
      await eventually(() => heading.isVisible(), { timeoutMs: 30_000, label: "the hero page's heading" });
      await eventually(() => heading.evaluate((node) => node === document.activeElement), { label: "focus on the heading" });

      const tips = page.getByRole("region", { name: "Three things to try on your turn" }).getByRole("listitem");
      await eventually(async () => (await tips.count()) === 3, { label: "three things to try" });
      check((await tips.first().innerText()).startsWith("Swing your Longsword: "), `the fighter's first thing is the sword: ${await tips.first().innerText()}`);
      // One of the reveal line's three rules, whichever the build meets now.
      const reveal = new RegExp(`^(AC \\d+ at level ${character.level}, |Spell DC \\d+, |(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \\d+, )`);
      check(await page.getByText(reveal).isVisible(), "the line that notices the build");
      await t.shot("hero-page");

      // Persistent: still there after a wait that a toast would not survive.
      await page.waitForTimeout(6_000);
      check(await heading.isVisible(), "the page stays until the player leaves it");

      check(!(await skip.isChecked()), "the hero page shows by default");
      // The save is awaited from before the click: armed afterwards, a save
      // that had already answered was waited on until the timeout.
      const saved = () => page.waitForResponse((response) => response.url().endsWith("/api/profile") && response.request().method() === "PATCH");
      let save = saved();
      await skip.check();
      await save;
      // A fresh read of the page: the shell's reload lands on its own home
      // screen, so in the app the page is left and opened again.
      if (t.app) {
        await t.open("/characters");
        await t.open(`/characters/${ids.library}/ready`);
      } else {
        await page.reload();
      }
      await eventually(() => skip.isChecked(), { timeoutMs: 20_000, label: "the account kept 'Don't show this again'" });
      save = saved();
      await skip.uncheck();
      await save;

      await page.getByRole("button", { name: "Bring to a table" }).click();
      await eventually(() => page.getByRole("dialog").isVisible(), { label: "the join dialog" });
      await t.shot("bring-to-a-table");
      await page.keyboard.press("Escape");
      await eventually(async () => !(await page.getByRole("dialog").isVisible()), { label: "the dialog closed" });

      await page.getByRole("link", { name: "Done" }).click();
      await eventually(async () => (await t.url()).pathname === "/characters", { timeoutMs: 20_000, label: "the roster" });
    } finally {
      await t.api.patch(`${t.base}/api/profile`, { data: { settings: { skipHeroPage: false } } }).catch(() => {});
    }
  },
};
