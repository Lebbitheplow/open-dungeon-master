// Issue 553: a workshop's prepared fight answered Deploy with "No party
// characters to fight.", because a workshop has no party. The fight's
// button is Test fight now (src/lib/workshop/test-fight.ts): it asks who
// fights it (the stand-in party by default, or characters the author picks),
// opens a table only the author can see with the fight on the board, and
// the table's banner leads back to the workshop, where the open test can be
// returned to or ended.
import http from "node:http";
import { axeViolations, check, eventually, freePort, untilStill } from "../lib.mjs";

// The sheet and the banner pass axe in the night theme and the day one.
async function axeBothThemes(t, selector, name) {
  const { page } = t;
  const night = await axeViolations(page, selector);
  check(night.length === 0, `${name} passes axe: ${JSON.stringify(night).slice(0, 400)}`);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await untilStill(page);
  const day = await axeViolations(page, selector);
  check(day.length === 0, `${name} passes axe in the day theme: ${JSON.stringify(day).slice(0, 400)}`);
  await t.shot(`${name.replace(/\W+/g, "-")}-day`);
  await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
}

// A stand-in narrator: every turn of the test table's AI DM is one short
// passage, so the table's opening is written without a real model.
function narrator(port) {
  const state = { asked: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      state.asked += 1;
      const content = "The goblins snarl in the mud of the lane and close in.";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ state, close: () => server.close() })));
}

const sheet = (name) => ({
  name,
  race: "human",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "N",
  abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 },
  maxHp: 12,
  ac: 18,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["perception", "survival", "athletics", "intimidation"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Chain Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  gold: 10,
  copper: 0,
  feats: [],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  notes: "",
  backstory: "",
});

export default {
  name: "test-fight",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api, root } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const hero = `Test Hero ${stamp}`;
    const made = await api.post(`${base}/api/characters`, { data: { level: 1, role: "pc", sheet: sheet(hero) } });
    check(made.ok(), `a library character to pick (${made.status()})`);
    const characterId = (await made.json()).character.id;
    const shop = await api.post(`${base}/api/workshops`, { data: { title: `Test fights ${stamp}`, description: "" } });
    check(shop.ok(), "a workshop");
    const workshopId = (await shop.json()).workshop.id;
    const port = await freePort();
    const model = await narrator(port);
    try {
      const fight = await api.post(`${base}/api/campaigns/${workshopId}/dm/encounter-templates`, {
        data: { name: `Goblin pair ${stamp}`, enemies: "goblin x2", battlefield: "a muddy lane", notes: "" },
      });
      check(fight.ok(), `a prepared fight (${fight.status()}: ${(await fight.text()).slice(0, 200)})`);
      const templateId = (await fight.json()).template.id;
      const button = page.locator(`${root}[data-encounter-deploy="${templateId}"]`).locator("visible=true").first();
      const sheetPanel = page.locator('[data-testid="test-fight-sheet"]').locator("visible=true").first();
      const openSheet = async () => {
        await t.open(`/workshop/${workshopId}?system=encounters`);
        await eventually(() => button.count(), { timeoutMs: 30_000, label: "the fight's button" });
        await t.tap(button);
        await eventually(() => sheetPanel.isVisible(), { timeoutMs: 15_000, label: "the Test fight sheet" });
      };

      // No model on this server: the sheet says why, and nothing starts.
      await openSheet();
      check(/Test fight/i.test(await button.textContent()), `the fight's button tests it (${await button.textContent()})`);
      const notReady = sheetPanel.locator('[data-testid="test-fight-not-ready"]');
      await eventually(() => notReady.count(), { timeoutMs: 15_000, label: "the reason a test cannot start" });
      check(/run by the AI DM/.test(await notReady.innerText()), `the reason says why (${await notReady.innerText()})`);
      check(await sheetPanel.getByRole("button", { name: /Start the test fight/ }).isDisabled(), "Start is off with no AI DM");
      await t.shot("sheet-no-ai");
      await page.keyboard.press("Escape");

      // The workshop's own story settings name a model; the test table takes them.
      const pointed = await api.patch(`${base}/api/campaigns/${workshopId}/story-settings`, {
        data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "test-fight-narrator" },
      });
      check(pointed.ok(), `pointing the workshop at the stand-in answered ${pointed.status()}`);
      await openSheet();
      await eventually(async () => !(await notReady.count()), { timeoutMs: 15_000, label: "no reason once a model is named" });
      const said = (await sheetPanel.innerText()).replace(/\s+/g, " ");
      check(/4 heroes at level 3/.test(said) && /Fighter, Cleric, Rogue and Wizard/.test(said), `the stand-ins are named (${said.slice(0, 300)})`);
      const standIns = sheetPanel.getByRole("radio", { name: /The stand-in party/ });
      check(await standIns.isChecked(), "the stand-in party is the default");
      await t.shot("sheet-stand-ins");

      // The other answer lists the author's characters, and can come back.
      await t.tap(sheetPanel.getByText("Characters you pick", { exact: true }));
      const pick = sheetPanel.locator(`[data-test-pick="${characterId}"]`);
      await eventually(() => pick.isVisible(), { timeoutMs: 15_000, label: "the library character to pick" });
      const start = sheetPanel.getByRole("button", { name: /Start the test fight/ });
      check(await start.isDisabled(), "nobody picked, nothing to start");
      await t.tap(pick);
      check(await start.isEnabled(), "one picked, the test can start");
      const box = await pick.boundingBox();
      check(box && box.height >= 40, `a character's row is finger-sized (${box?.height})`);
      await untilStill(page);
      await t.shot("sheet-characters");
      await axeBothThemes(t, '[data-testid="test-fight-sheet"]', "the test fight sheet");
      await t.tap(sheetPanel.getByText("The stand-in party", { exact: true }));

      await t.tap(start);
      await eventually(async () => (await t.url()).pathname.startsWith("/campaigns/"), { timeoutMs: 60_000, label: "the test table" });
      const tableId = (await t.url()).pathname.split("/")[2];
      // The header's way out leads to the workshop, on a phone's battle view
      // as everywhere; the banner above the composer says what the table is.
      const phone = t.viewport === "phone";
      const back = page.locator(`${root}header a[aria-label="Back to the workshop"]`).locator("visible=true").first();
      await eventually(() => back.isVisible(), { timeoutMs: 60_000, label: "the header's way back to the workshop" });
      const banner = page.locator(`${root}.test-fight-banner`).locator("visible=true").first();
      if (!phone) {
        await eventually(() => banner.isVisible(), { timeoutMs: 30_000, label: "the test fight's banner" });
        const told = (await banner.innerText()).replace(/\s+/g, " ");
        check(/Test fight/i.test(told) && told.includes(`Test fights ${stamp}`), `the banner names the workshop (${told})`);
        await axeBothThemes(t, `${root}.test-fight-banner`, "the test fight banner");
      }
      const snapshot = await (await api.get(`${base}/api/campaigns/${tableId}`)).json();
      check(snapshot.sheets?.length === 4, `four stand-ins seated (${snapshot.sheets?.length})`);
      check(Boolean(snapshot.encounter), "the fight is running");
      await eventually(() => model.state.asked > 0, { timeoutMs: 30_000, label: "the AI DM asked to open the fight" });
      await t.shot("table");

      // Back keeps the test, and the workshop leads back to it. The press is
      // the page's first: it also lets the table's held sound play, and must
      // still land where it was aimed.
      await t.tap(phone ? back : banner.getByRole("link", { name: "Back to the workshop" }));
      const open = page.locator(`${root}[data-testid="open-test-fight"]`).locator("visible=true").first();
      await eventually(() => open.isVisible(), { timeoutMs: 30_000, label: "the open test in Encounters" });
      check((await open.innerText()).includes(`Test: Goblin pair ${stamp}`), "the open test is named");
      await t.shot("open-test");
      await t.tap(open.getByRole("link", { name: "Return to it" }));
      await eventually(() => back.isVisible(), { timeoutMs: 60_000, label: "back at the test table" });

      if (!phone) {
        // End deletes the table and lands back in the workshop.
        await eventually(() => banner.isVisible(), { timeoutMs: 30_000, label: "the banner again" });
        await t.tap(banner.getByRole("button", { name: "End the test" }));
        const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).locator("visible=true").first();
        await eventually(() => confirm.isVisible(), { timeoutMs: 10_000, label: "the confirm" });
        await t.tap(confirm.getByRole("button", { name: "End the test" }));
        await eventually(async () => (await t.url()).pathname === `/workshop/${workshopId}`, { timeoutMs: 60_000, label: "back in the workshop" });
      } else {
        // On a phone, from the workshop's card.
        await t.tap(back);
        await eventually(() => open.isVisible(), { timeoutMs: 30_000, label: "the open test again" });
        await t.tap(open.getByRole("button", { name: "End it" }));
      }
      await eventually(async () => !(await page.locator(`${root}[data-testid="open-test-fight"]`).count()), { timeoutMs: 15_000, label: "no open test listed" });
      const gone = await api.get(`${base}/api/campaigns/${tableId}`);
      check(gone.status() === 404 || gone.status() === 403, `the test table is gone (${gone.status()})`);
    } finally {
      model.close();
      await api.delete(`${base}/api/workshops/${workshopId}`);
      await api.delete(`${base}/api/characters/${characterId}`);
    }
  },
};
