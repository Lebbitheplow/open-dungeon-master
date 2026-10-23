// One tool per intent (issue #471): at a table a person runs, the DM's
// token menu deals an enemy's damage, sets its condition and teleports it
// through apply_damage, set_condition and move_token, the tools that took in
// damage_enemy, set_enemy_condition and teleport_token. On desktop and
// phone, on the website and in the app's own screens, which an older host
// would refuse.
import { check, eventually, openPanelTab, sleep } from "../lib.mjs";

export default {
  name: "directed-token-menu",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const { id: campaignId, goblin } = ids.directed[viewport];
    const enemy = async () => {
      const response = await api.get(`${base}/api/campaigns/${campaignId}/encounter`);
      const body = response.ok() ? await response.json() : {};
      return (body.encounter?.enemies ?? []).find((entry) => entry.id === goblin) ?? null;
    };
    const token = async () => {
      const response = await api.get(`${base}/api/campaigns/${campaignId}/battle-map`);
      const body = response.ok() ? await response.json() : {};
      return (body.view?.tokens ?? []).find((entry) => entry.refId === goblin) ?? null;
    };

    await t.open(`/campaigns/${campaignId}`);
    await openPanelTab(t, "battle");
    const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
    const frame = board.locator(".board-view").first();
    await eventually(() => frame.isVisible(), { timeoutMs: 30_000, label: "the DM's board" });
    const figure = frame.getByRole("img", { name: /^Goblin/ }).first();
    const menu = board.getByRole("menu", { name: /^Actions for Goblin/ });
    const pick = async (action) => {
      await eventually(() => figure.isVisible(), { label: "the goblin on the board" });
      if (!(await menu.count())) {
        await t.tap(figure);
      }
      await eventually(() => menu.count(), { label: "the goblin's menu" });
      await t.tap(menu.getByLabel(action, { exact: true }));
    };

    // Damage: apply_damage with the enemy's id.
    const before = await enemy();
    check(before, "the goblin in the fight");
    const hpBefore = Number(before.currentHp ?? before.hp);
    await pick("Damage");
    const amount = page.getByRole("dialog", { name: /^Damage Goblin/ }).getByRole("textbox").first();
    await eventually(() => amount.isVisible(), { label: "the damage prompt" });
    await amount.fill("3");
    await sleep(300);
    await t.shot("damage-prompt");
    await amount.press("Enter");
    await eventually(async () => Number((await enemy())?.currentHp ?? (await enemy())?.hp) === hpBefore - 3, {
      timeoutMs: 15_000,
      label: `the goblin down 3 from ${hpBefore}`,
    });

    // A condition: set_condition with the enemy's id. The app's run meets
    // the same table after the website's, so it lays another.
    const wanted = t.app ? "blinded" : "prone";
    await pick("Condition");
    const condition = page.getByRole("dialog", { name: /^Condition on Goblin/ }).getByRole("textbox").first();
    await eventually(() => condition.isVisible(), { label: "the condition prompt" });
    await condition.fill(wanted);
    await condition.press("Enter");
    await eventually(async () => ((await enemy())?.conditions ?? []).some((entry) => String(entry).startsWith(wanted)), {
      timeoutMs: 15_000,
      label: `the goblin ${wanted}`,
    });

    // A teleport: move_token with teleport, to the tile two to the left.
    const from = await token();
    check(from, "the goblin's token on the board");
    await pick("Teleport");
    await eventually(() => board.getByText("Tap the tile it appears on").count(), { label: "the teleport hint" });
    const box = await figure.boundingBox();
    check(box, "the goblin's figure has a box");
    await page.mouse.click(box.x + box.width / 2 - box.width * 2, box.y + box.height / 2);
    await eventually(async () => {
      const now = await token();
      return now && now.x !== from.x && now.y === from.y;
    }, { timeoutMs: 15_000, label: "the goblin teleported along its row" });
    await sleep(600);
    await t.shot("after-teleport");
  },
};
