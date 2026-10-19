// M5 item 4 of the WorldForge plan (audit finding WF-18): before a world
// pack is published, the Plugin tool's Publish tab lists what the pack
// leaves out of the workshop, kind by kind, each with its entry. The
// workshop holds a native faction made through WorldForge, a member linked
// to it, an Atlas map, a timeline event, a secret, a storyboard card, a
// battle map and a hand-built monster. Before the pull, the list names the
// faction as not in the draft and every other kind with its entry. Pull
// from this workshop brings the faction into the Setting tab with its
// member in its line, and the list then names everything else but the
// faction. axe finds no serious problem in the list.
import { axeViolations, check, eventually } from "../lib.mjs";

export default {
  name: "world-pack-omissions",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = Date.now().toString(36);
    const factionName = `The Tide Wardens ${stamp}`;
    const memberName = `Mira Fenn ${stamp}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-plugin", version: 1, how: "ended" }] } });

    const made = await api.post(`${base}/api/workshops`, { data: { title: `Saltmarch ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const campaign = `${base}/api/campaigns/${id}`;
    let monsterId = "";
    try {
      const entity = async (data) => {
        const response = await api.post(`${campaign}/world/entities`, { data });
        check(response.ok(), `the World entry ${data.name} (${response.status()})`);
        return (await response.json()).entity;
      };
      const faction = await entity({ typeId: "t_faction", name: factionName, tagline: "Lamp-keepers who decide which ships come in." });
      const mira = await entity({ typeId: "t_character", name: memberName, tagline: "Keeper of the north lamp." });
      const seeded = await api.patch(`${campaign}/world`, {
        data: {
          links: [{ id: `l_${stamp}`, from: mira.ref, to: faction.ref, label: "member of", veracity: "known", oneway: false, rank: "" }],
          maps: [{ id: `m_${stamp}`, name: `Saltmarch from the cliffs ${stamp}`, image: "", parentPinId: "", regions: [] }],
          events: [{ id: `e_${stamp}`, title: `The chain is forged ${stamp}`, body: "", era: "", when: { calendarId: "", yearNum: null, year: "" }, refs: [], canon: "canon" }],
          secrets: [{ id: `s_${stamp}`, title: `The toll books are forged ${stamp}`, subject: faction.ref, notes: "", knownBy: [], partyKnows: false }],
        },
      });
      check(seeded.ok(), `the link, Atlas map, event and secret (${seeded.status()})`);
      const card = await api.post(`${campaign}/dm/storyboard`, { data: { kind: "event", title: `The chain breaks ${stamp}`, body: "" } });
      check(card.ok(), `a storyboard card (${card.status()})`);
      const map = await api.post(`${campaign}/dm/maps`, { data: { do: "create", name: `The chain-house cellar ${stamp}`, blank: "rock" } });
      check(map.ok(), `a battle map (${map.status()})`);
      const monster = await api.post(`${campaign}/dm/bestiary`, { data: { from: "cr", name: `Harbour Drowner ${stamp}`, cr: 2 } });
      check(monster.ok(), `a hand-built monster (${monster.status()})`);
      monsterId = (await monster.json()).monster.id;
      // A named draft, so the tool opens on its tabs rather than the guide.
      const stored = (await (await api.get(`${base}/api/workshops/${id}/plugin`)).json()).draft;
      const named = await api.put(`${base}/api/workshops/${id}/plugin`, { data: { draft: { ...stored, name: `Saltmarch ${stamp}` } } });
      check(named.ok(), `a named pack draft (${named.status()})`);

      // ---- before the pull ----
      await t.open(`/workshop/${id}?system=plugin`);
      const publish = page.locator(`${root}[data-tour="plugin-publish"]`).locator("visible=true").first();
      await eventually(() => publish.count(), { timeoutMs: 30_000, label: "the Plugin tool" });
      await t.tap(publish);
      const report = page.locator(`${root}[data-testid="pack-omissions"]`).locator("visible=true").first();
      const kind = (key) => report.locator(`[data-omission="${key}"]`);
      await eventually(async () => (await kind("atlas").count()) > 0, { timeoutMs: 30_000, label: "the list of what the pack leaves out" });
      const said = async (key) => (await kind(key).count() ? kind(key).innerText() : "");
      check((await said("not-pulled")).includes(`Faction: ${factionName}`), `the native faction is named as not in the draft: ${JSON.stringify((await said("not-pulled")).slice(0, 200))}`);
      const expected = {
        atlas: `Saltmarch from the cliffs ${stamp}`,
        timeline: `Event: The chain is forged ${stamp}`,
        secrets: `Secret: The toll books are forged ${stamp} (about ${factionName})`,
        storyboard: `The chain breaks ${stamp} (event)`,
        maps: `The chain-house cellar ${stamp}`,
        monsters: `Harbour Drowner ${stamp}`,
      };
      for (const [key, asset] of Object.entries(expected)) {
        const text = await said(key);
        check(text.includes(asset), `${key} names "${asset}": ${JSON.stringify(text.slice(0, 200))}`);
      }
      check((await report.innerText()).includes("World detail a pack cannot carry") && (await report.innerText()).includes("Scenario and mechanics"), "the list is grouped as world detail and scenario");
      // Before the ways out, so it is read before anything is published.
      const shareTop = await page.getByRole("button", { name: "Download the pack" }).locator("visible=true").first().boundingBox();
      const reportTop = await report.boundingBox();
      check(reportTop && shareTop && reportTop.y < shareTop.y, "the list stands above the Download button");
      const summary = kind("atlas").locator("summary");
      const box = await summary.boundingBox();
      check(box && box.height >= 40, `each kind is a finger-sized row (${box?.height})`);
      const problems = await axeViolations(page, `${root}[data-testid="pack-omissions"]`);
      check(!problems.length, `axe finds no serious problem in the list: ${JSON.stringify(problems)}`);
      await t.shot("before-pull");

      // ---- the pull ----
      await t.tap(page.locator(`${root}[data-tour="plugin-pull"]`).locator("visible=true").first());
      const notice = page.getByText(/Pulled \d+ entr/).locator("visible=true").first();
      await eventually(() => notice.count(), { timeoutMs: 30_000, label: "the pull's notice" });
      check(/Check & publish lists them/.test(await notice.innerText()), `the notice says what stays behind is listed: ${await notice.innerText()}`);
      await eventually(async () => (await kind("not-pulled").count()) === 0, { timeoutMs: 15_000, label: "the faction no longer named as not in the draft" });
      check((await said("atlas")).includes(expected.atlas), "the Atlas map is still named after the pull");
      await t.shot("after-pull");

      // The faction in the Setting tab, its member in its line.
      await t.tap(page.getByRole("radio", { name: "Setting" }).locator("visible=true").first());
      const values = async () => Promise.all((await page.locator(`${root}input, ${root}textarea`).locator("visible=true").all()).map((input) => input.inputValue()));
      await eventually(async () => (await values()).includes(factionName), { timeoutMs: 15_000, label: "the native faction in the Setting tab" });
      const lines = await values();
      check(lines.some((line) => line.startsWith("Lamp-keepers who decide which ships come in.") && line.includes(`Members: ${memberName}.`)), `its line carries its member: ${JSON.stringify(lines.filter((line) => line.startsWith("Lamp")))}`);
      await t.shot("setting");
    } finally {
      if (monsterId) await api.delete(`${campaign}/dm/bestiary/${monsterId}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};
