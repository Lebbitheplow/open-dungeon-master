// Stat blocks read whole (issue #473): the workshop's attack editor marks an
// attack made as a bonus action and keeps a swarm's weaker blow at half its
// hit points, a printed block shows its Bonus actions, and a block resistant
// to a condition shows that line. On desktop and phone, on the website and
// in the app's own screens, which an older host would drop.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "bestiary-attack",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base } = t;
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["world", "bestiary", "encounters", "homebrew"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Swarms ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const bestiary = `${base}/api/campaigns/${id}/dm/bestiary`;
    const name = `Gutter Rats ${t.viewport}${t.app ? " app" : ""} ${Date.now().toString(36)}`;
    let monsterId = null;
    try {
      const created = await api.post(bestiary, { data: { from: "cr", name, cr: 1 } });
      check(created.ok(), `the monster was made (${created.status()})`);
      const monster = (await created.json()).monster;
      monsterId = monster.id;
      // The block as the editor sends it: its fields flat beside its name.
      const draft = {
        ...monster.draft.stats,
        name,
        conditionResist: "frightened",
        attacks: [{ name: "Bites", toHit: 3, damage: "2d6", type: "piercing", reach: 0 }],
        printed: { bonus: [{ name: "Scatter", desc: "The swarm moves up to half its speed without provoking opportunity attacks." }] },
      };
      const saved = await api.patch(`${bestiary}/${monsterId}`, { data: { draft, desc: "" } });
      check(saved.ok(), `the monster's block was saved (${saved.status()}: ${saved.ok() ? "" : await saved.text()})`);

      await t.open(`/workshop/${id}?system=bestiary`);
      const row = page.locator(`${root}*`, { hasText: new RegExp(`^${name}$`, "i") }).locator("visible=true").last();
      await eventually(() => row.isVisible(), { timeoutMs: 30_000, label: "the monster on the shelf" });
      await t.tap(row);
      // The attack row's chip names what its details hold (reach 0 here).
      const details = page.locator(`${root}button[aria-expanded]`, { hasText: "reach 0" }).locator("visible=true").first();
      await eventually(() => details.isVisible(), { timeoutMs: 30_000, label: "the attack's chip in the editor" });

      // The printed block's Bonus actions, and the condition the block resists.
      const printed = page.locator(`${root}[data-testid="printed-block"]`).locator("visible=true").first();
      await eventually(() => printed.isVisible(), { timeoutMs: 15_000, label: "the printed block" });
      await t.tap(printed.locator("button[aria-expanded]").first());
      await eventually(async () => /Bonus actions/i.test((await printed.textContent().catch(() => "")) ?? ""), { timeoutMs: 15_000, label: "the printed Bonus actions" });
      check(((await printed.textContent()) ?? "").includes("Scatter"), "the printed block names the bonus action");
      check((await page.getByText("Resistant to conditions (advantage on the save)").count()) > 0, "the condition resistance line shows");

      // The attack's details: a bonus action, and the weaker blow.
      await t.tap(details);
      const bonus = page.getByRole("switch", { name: "Made as a bonus action, beside the action's attacks" }).locator("visible=true").first();
      await eventually(() => bonus.isVisible(), { timeoutMs: 10_000, label: "the attack's details" });
      await t.tap(bonus);
      await page.getByLabel("At half its hit points or fewer").locator("visible=true").first().fill("1d6");
      await sleep(600);
      await t.shot("attack-details");
      await eventually(() => details.textContent().then((text) => /bonus action/.test(text ?? "") && /weaker when bloodied/.test(text ?? "")), { label: "the chip naming the bonus action and the weaker blow" });
      await t.tap(page.getByRole("button", { name: "Save the block" }).locator("visible=true").first());
      const kept = await eventually(
        async () => {
          const response = await api.get(`${bestiary}/${monsterId}`);
          const body = response.ok() ? await response.json() : {};
          const attack = body.monster?.draft?.stats?.attacks?.[0] ?? body.monster?.draft?.attacks?.[0];
          return attack?.bonusAction === true && attack?.alternatives?.some((entry) => entry.when === "bloodied") ? attack : null;
        },
        { timeoutMs: 15_000, label: "the attack kept as a bonus action with its weaker blow" },
      );
      const weaker = kept.alternatives.find((entry) => entry.when === "bloodied");
      check(weaker.damage === "1d6" && weaker.type === "piercing", `the weaker blow is 1d6 piercing (${JSON.stringify(weaker)})`);
      check(kept.reach === 0, `a reach of 0 is kept (${kept.reach})`);
    } finally {
      if (monsterId) await api.delete(`${bestiary}/${monsterId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
