// Issue 249: a lobby whose imported prep already wrote the story arc warns
// the lead before AI Story Setup runs over it, with the two ways on. "Keep
// it on" is remembered on this device; "Turn off AI Story Setup" saves the
// table's setting and the warning has nothing left to say.
import { check, eventually, sleep } from "../lib.mjs";

const KEPT = (id) => `odm.storySetupKept.${id}`;

export default {
  name: "story-setup-warning",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    // Viewports share one seeded world: the setting on, nothing kept.
    const on = await api.patch(`${base}/api/campaigns/${ids.preparedId}/settings`, { data: { aiStorySetup: true } });
    check(on.ok(), `turning AI Story Setup back on answered ${on.status()}`);
    await t.open(`/campaigns/${ids.preparedId}`);
    await page.evaluate((key) => window.localStorage.removeItem(key), KEPT(ids.preparedId));
    await t.open(`/campaigns/${ids.preparedId}`);

    const warning = page.locator(`${root}[data-story-setup-warning]`).locator("visible=true").first();
    await eventually(() => warning.count(), { timeoutMs: 30_000, label: "the warning in the lobby" });
    const text = (await warning.innerText()).replace(/\s+/g, " ");
    check(/AI Story Setup/.test(text) && /arc/i.test(text), `the warning says what will meet the arc (${text})`);
    await warning.scrollIntoViewIfNeeded();
    await t.shot("warned");

    // Keep it on: gone, and still gone on the next visit from this device.
    await t.tap(warning.locator("[data-story-setup-keep]"));
    await eventually(() => page.locator(`${root}[data-story-setup-warning]`).count().then((count) => count === 0), { label: "the warning gone on Keep it on" });
    await t.open(`/campaigns/${ids.preparedId}`);
    // Time is the check: a warning the visit brought back would show within this while.
    await sleep(1_500);
    check((await page.locator(`${root}[data-story-setup-warning]`).count()) === 0, "a kept warning stays away on the next visit");
    const kept = await (await api.get(`${base}/api/campaigns/${ids.preparedId}`)).json();
    check(kept.campaign?.gameSettings?.aiStorySetup === true, "keeping it on changes nothing on the table");

    // Turn it off: saved on the table.
    await page.evaluate((key) => window.localStorage.removeItem(key), KEPT(ids.preparedId));
    await t.open(`/campaigns/${ids.preparedId}`);
    await eventually(() => warning.count(), { timeoutMs: 30_000, label: "the warning back once forgotten" });
    await t.tap(warning.locator("[data-story-setup-off]"));
    await eventually(async () => {
      const data = await (await api.get(`${base}/api/campaigns/${ids.preparedId}`)).json();
      return data.campaign?.gameSettings?.aiStorySetup === false;
    }, { label: "AI Story Setup saved off" });
    await eventually(() => page.locator(`${root}[data-story-setup-warning]`).count().then((count) => count === 0), { label: "the warning gone once the setting is off" });
    const after = await (await api.get(`${base}/api/campaigns/${ids.preparedId}`)).json();
    check(after.campaign?.gameSettings?.dmMode !== "human", "the AI still narrates");
    await t.shot("turned-off");
  },
};
