// Issue 520, where a person meets it. The console's Summon a pet form asks
// for a drake's Draconic Essence only for a drake, and a story pet's hit
// points and AC only for a story pet. At a table the AI narrates, the lead's
// prep says what the storyteller does with a fight beyond the party: cut it
// down to fit, saying what it leaves out, or hold it. On desktop and phone,
// on the website and in the app's own screens.
import { check, eventually, openPanelTab, sleep } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true").first();

export default {
  name: "pet-form-and-prepared-cut",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;

    // The console, at a table the lead runs as its DM.
    const { id: directedId } = ids.directed[viewport];
    await t.open(`/campaigns/${directedId}`);
    await openPanelTab(t, "dm");
    const combat = visible(page.locator(`${root}button.dm-tab`).filter({ hasText: /^Combat$/ }));
    await eventually(() => combat.count(), { timeoutMs: 30_000, label: "the console's Combat tab" });
    await t.tap(combat);
    const summon = visible(page.locator(root ? `${root}button` : "button").filter({ hasText: /Summon a pet/ }));
    await eventually(() => summon.count(), { label: "Summon a pet in the combat list" });
    await t.tap(summon);
    const form = visible(page.locator(`${root}.ornate`).filter({ hasText: "Summon a pet" }));
    await eventually(() => form.count(), { label: "the summon form" });
    const label = (text) => form.getByText(text, { exact: true });
    check((await label("Draconic Essence").count()) === 0, "the essence is asked only for a drake");
    check((await label("Hit points").count()) === 0, "a story pet's hit points are asked only for a story pet");

    // Kind is the kit's select: a button named for the field, opening a
    // menu of its choices.
    const choose = async (option) => {
      await t.tap(form.getByRole("button", { name: "Kind", exact: true }));
      const item = visible(page.getByRole("menuitemradio", { name: option, exact: true }));
      await eventually(() => item.count(), { label: `${option} in the Kind list` });
      await t.tap(item);
    };
    await choose("Drake");
    await eventually(() => label("Draconic Essence").count(), { label: "the essence once Kind is Drake" });
    check((await label("Hit points").count()) === 0, "no hit points for a drake");
    await sleep(300);
    await t.shot("summon-drake");
    await choose("A pet the story gave them");
    await eventually(async () => (await label("Hit points").count()) > 0 && (await label("Armor Class").count()) > 0, {
      label: "hit points and AC for a story pet",
    });
    check((await label("Draconic Essence").count()) === 0, "no essence for a story pet");
    await sleep(300);
    await t.shot("summon-story-pet");

    // The lead's prep at the AI table: two fights, one the party can be cut
    // down to meet (a bugbear and seven goblins), one it cannot.
    const campaignId = ids.campaignId;
    const made = [];
    for (const [name, enemies] of [[`Warren mouth (${viewport}${t.app ? ", app" : ""})`, "bugbear\ngoblin x7"], [`The red's lair (${viewport}${t.app ? ", app" : ""})`, "adult red dragon"]]) {
      const response = await api.post(`${base}/api/campaigns/${campaignId}/dm/encounter-templates`, { data: { name, enemies } });
      check(response.ok(), `preparing ${name} answered ${response.status()}`);
      made.push({ name, id: (await response.json()).template.id });
    }
    try {
      const listed = await api.get(`${base}/api/campaigns/${campaignId}/dm/encounter-templates`);
      const templates = (await listed.json()).templates ?? [];
      const readout = (name) => templates.find((entry) => entry.name === name)?.readout ?? null;
      const lair = readout(made[1].name);
      check(lair?.held === true, `an adult red dragon is held for this party (${JSON.stringify(lair)})`);

      await t.open(`/campaigns/${campaignId}`);
      await openPanelTab(t, "lead");
      const open = visible(page.getByRole("button", { name: "Open the prep" }));
      await eventually(() => open.count(), { timeoutMs: 30_000, label: "Open the prep on the lead's desk" });
      await t.tap(open);
      const row = (name) => visible(page.locator(`${root}li, ${root}[data-template-row]`).filter({ hasText: name }));
      await eventually(() => row(made[1].name).count(), { label: "the held fight in the prep" });
      const held = (await row(made[1].name).textContent()) ?? "";
      check(/Beyond the party even cut down: the storyteller holds it/.test(held), `the held fight says so (${held.slice(0, 200)})`);
      const warren = readout(made[0].name);
      check(warren?.tooDeadly && warren.scaledWithout && !warren.held, `a bugbear and seven goblins are cut down for this party (${JSON.stringify(warren)})`);
      const cut = (await row(made[0].name).textContent()) ?? "";
      check(
        cut.includes(`The storyteller cuts it to fit: it runs without ${warren.scaledWithout}.`),
        `the cut fight says what it leaves out (${cut.slice(0, 200)})`,
      );
      await row(made[1].name).scrollIntoViewIfNeeded();
      await sleep(300);
      await t.shot("prep-held");
      await row(made[0].name).scrollIntoViewIfNeeded();
      await sleep(300);
      await t.shot("prep-cut");
    } finally {
      for (const { id } of made) {
        await api.delete(`${base}/api/campaigns/${campaignId}/dm/encounter-templates/${id}`).catch(() => undefined);
      }
    }
  },
};
