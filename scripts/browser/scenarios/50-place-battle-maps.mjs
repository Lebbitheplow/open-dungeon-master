// M4 item 3 of the WorldForge plan: a place's battle maps and encounters,
// from an Atlas pin and from the map nested inside it. In a workshop the
// author opens the harbour map, picks the tavern's pin and presses Create
// battle map: a blank map named for the tavern opens in the map editor, and
// the place's line says no walls or light are drawn yet (the tavern's Atlas
// picture is never read as walls). Back on the place, Create encounter
// makes a fight there with its first foe, on that map. The tavern's nested
// taproom map then opens both, and the world still has one tavern. At the
// quiet table the World tab's nested map opens the same map editor and the
// encounter's form in sheets over the tab. Everything made for the quiet
// table is taken off again, since every viewport and later scenario
// shares it.
import { check, eventually, openPanelTab } from "../lib.mjs";

const seedAtlas = async (api, campaign, ref, stamp, before = { maps: [], pins: [] }) => {
  const harbour = `m_harbour_${stamp}`;
  const taproom = `m_taproom_${stamp}`;
  const pin = `p_anchor_${stamp}`;
  const seeded = await api.patch(`${campaign}/world`, {
    data: {
      maps: [{ id: harbour, name: `Saltmarch Harbour ${stamp}`, image: "", parentPinId: "", regions: [] }, { id: taproom, name: `The taproom ${stamp}`, image: "", parentPinId: pin, regions: [] }, ...before.maps],
      pins: [...before.pins, { id: pin, mapId: harbour, x: 0.45, y: 0.55, name: "", ref, linkedMapId: taproom, notes: "" }],
    },
  });
  check(seeded.ok(), `an Atlas map with the tavern's pin, and the taproom inside it (${seeded.status()})`);
  return { harbour: `Saltmarch Harbour ${stamp}`, taproom: `The taproom ${stamp}` };
};

const placesNamed = async (api, campaign, name) =>
  ((await (await api.get(`${campaign}/world`)).json()).entities ?? []).filter((entity) => entity.shelf === "location" && entity.name === name).length;

export default {
  name: "place-battle-maps",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = Date.now().toString(36);
    const tavernName = `The Rusty Anchor ${stamp}`;
    const ratName = `Dock Rat ${stamp}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["world", "maps", "encounters"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });
    const params = async () => (await t.url()).searchParams;
    const editorOpen = page.getByRole("button", { name: "More for this map" }).locator("visible=true");

    // ---- the workshop ----
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Harbour prep ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const campaign = `${base}/api/campaigns/${id}`;
    // The author's own monster, made in the workshop's Bestiary: homebrew is
    // the author's, so the quiet table (whose lead is the same author) can
    // put it into a fight too, and it is taken off before the workshop goes.
    let monsterId = "";
    try {
      const tavern = (await (await api.post(`${campaign}/world/entities`, { data: { typeId: "t_location", name: tavernName, text: "A taproom over the harbour." } })).json()).entity;
      const rat = await api.post(`${campaign}/dm/bestiary`, { data: { from: "cr", name: ratName, cr: 1 } });
      check(rat.ok(), `a monster of the author's own (${rat.status()})`);
      monsterId = (await rat.json()).monster.id;
      const names = await seedAtlas(api, campaign, tavern.ref, stamp);

      // The pin's card: Create battle map opens the map editor on a map named for the tavern.
      await t.open(`/workshop/${id}?system=world&view=atlas`);
      const maps = page.getByRole("complementary", { name: "Maps" }).locator("visible=true").first();
      await eventually(() => maps.count(), { timeoutMs: 30_000, label: "the Atlas" });
      await t.tap(maps.getByRole("button", { name: new RegExp(names.harbour) }).first());
      const surface = page.locator(`${root}[data-testid="atlas-surface"]`).locator("visible=true").first();
      await t.tap(surface.getByRole("button", { name: new RegExp(tavernName) }).first());
      const card = page.locator(`${root}[data-tour="world-atlas-card"]`).locator("visible=true").first();
      const section = card.locator('[data-testid="place-battle-maps"]');
      await eventually(() => section.isVisible(), { label: "the pin's battle maps" });
      check(/No battle map yet/.test(await section.innerText()), "the pin's place has no battle map yet, and says so");
      await t.shot("pin-card");
      await t.tap(section.getByRole("button", { name: "Create battle map" }));
      await eventually(async () => (await params()).get("system") === "maps" && Boolean((await params()).get("open")), { timeoutMs: 20_000, label: "the map library, asked to open the new map" });
      await eventually(() => editorOpen.count(), { timeoutMs: 30_000, label: "the map editor open on the new map" });
      const mapId = (await params()).get("open");
      const library = (await (await api.get(`${campaign}/dm/maps`)).json()).maps;
      const map = library.find((entry) => entry.id === mapId);
      check(map?.name === tavernName, `the new map is named for the tavern: ${map?.name}`);
      check(map && !map.backdrop, "the new map took no picture from the Atlas");
      await t.shot("map-editor");

      // Back on the place: the map's line says nothing is drawn yet.
      await page.keyboard.press("Escape");
      await t.tap(page.locator(`${root}[data-testid="back-to-world-entry"]`).locator("visible=true").first());
      const place = page.locator(`${root}[data-tour="world-entry"]`).locator("visible=true").first().locator('[data-testid="place-battle-maps"]');
      await eventually(() => place.isVisible(), { timeoutMs: 20_000, label: "the place's battle maps on its entry" });
      const mapRow = place.locator('[data-testid="place-battle-record"][data-kind="map"]');
      check(/no walls or light drawn yet/.test(await mapRow.innerText()), `the map says no walls or light are drawn: ${await mapRow.innerText()}`);

      // Create encounter: its first foe, on the tavern's map.
      await t.tap(place.getByRole("button", { name: "Create encounter" }));
      const fight = place.locator('[data-testid="place-battle-fight"]');
      await t.tap(fight.getByRole("button", { name: "Its first foe" }));
      await t.tap(page.getByRole("menuitemradio", { name: ratName }).locator("visible=true").first());
      await t.tap(fight.getByRole("button", { name: "Make the encounter" }));
      await eventually(async () => (await params()).get("system") === "encounters" && Boolean((await params()).get("open")), { timeoutMs: 20_000, label: "the new encounter opened in Encounters" });
      const roster = page.getByRole("textbox", { name: "Roster" }).locator("visible=true").first();
      await eventually(() => roster.isVisible(), { timeoutMs: 20_000, label: "the encounter's form" });
      check((await roster.inputValue()).includes(ratName), `the roster starts with the first foe: ${JSON.stringify(await roster.inputValue())}`);
      const fightId = (await params()).get("open");
      const template = (await (await api.get(`${campaign}/dm/encounter-templates`)).json()).templates.find((entry) => entry.id === fightId);
      check(template?.map?.mapId === mapId, "the encounter is drawn on the tavern's battle map");
      await page.keyboard.press("Escape");

      // The nested taproom map opens both, and there is still one tavern.
      await t.open(`/workshop/${id}?system=world&view=atlas`);
      await eventually(() => maps.count(), { timeoutMs: 30_000, label: "the Atlas again" });
      await t.tap(maps.getByRole("button", { name: new RegExp(names.taproom) }).first());
      const inside = page.locator(`${root}[data-testid="atlas-inside-place"]`).locator("visible=true").first();
      await eventually(() => inside.isVisible(), { label: "the taproom map naming the place it is inside" });
      check(/never read from a picture/.test(await inside.innerText()), "the taproom's picture says it is not walls or light");
      await t.shot("nested-map");
      await t.tap(inside.getByRole("button", { name: new RegExp(`Open encounter: ${tavernName}`) }));
      await eventually(async () => (await params()).get("system") === "encounters" && (await params()).get("open") === fightId, { timeoutMs: 20_000, label: "the encounter opened from the nested map" });
      await eventually(() => roster.isVisible(), { timeoutMs: 20_000, label: "the encounter's form from the nested map" });
      await page.keyboard.press("Escape");
      await t.open(`/workshop/${id}?system=world&view=atlas`);
      await eventually(() => maps.count(), { timeoutMs: 30_000, label: "the Atlas once more" });
      await t.tap(maps.getByRole("button", { name: new RegExp(names.taproom) }).first());
      await t.tap(inside.getByRole("button", { name: new RegExp(`Open battle map: ${tavernName}`) }));
      await eventually(async () => (await params()).get("system") === "maps" && (await params()).get("open") === mapId, { timeoutMs: 20_000, label: "the battle map opened from the nested map" });
      await eventually(() => editorOpen.count(), { timeoutMs: 30_000, label: "the map editor from the nested map" });
      await page.keyboard.press("Escape");
      check((await placesNamed(api, campaign, tavernName)) === 1, "the world still has one tavern");
      await atTheTable(t, { tavernName, ratName, monsterId, stamp, editorOpen });
    } finally {
      if (monsterId) await api.delete(`${campaign}/dm/bestiary/${monsterId}`);
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};

// ---- the table's World tab ----
async function atTheTable(t, { tavernName, ratName, monsterId, stamp, editorOpen }) {
  const { page, root, api, base, ids } = t;
  const quiet = `${base}/api/campaigns/${ids.quietId}`;
  const before = (await (await api.get(`${quiet}/world`)).json()).doc;
  const madePlace = await api.post(`${quiet}/world/entities`, { data: { typeId: "t_location", name: tavernName, text: "A taproom over the harbour." } });
  check(madePlace.ok(), `the tavern in the quiet table's world (${madePlace.status()})`);
  const ref = (await madePlace.json()).entity.ref;
  let tableMap = "";
  let tableFight = "";
  try {
    const names = await seedAtlas(api, quiet, ref, stamp, before);
    const placeRoute = `${quiet}/world/entities/${encodeURIComponent(ref)}/battle-maps`;
    const madeMap = await api.post(placeRoute, { data: { make: "map" } });
    check(madeMap.status() === 201, `the tavern's battle map (${madeMap.status()})`);
    tableMap = (await madeMap.json()).made.id;
    const madeFight = await api.post(placeRoute, { data: { make: "encounter", monster: `homebrew:${monsterId}`, mapId: tableMap } });
    check(madeFight.status() === 201, `the tavern's encounter (${madeFight.status()})`);
    tableFight = (await madeFight.json()).made.id;

    await t.open(`/campaigns/${ids.quietId}`);
    await openPanelTab(t, "world");
    const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
    await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab" });
    await t.tap(panel.locator('[data-tour="world-view-atlas"]').first());
    const listed = panel.getByRole("complementary", { name: "Maps" }).getByRole("button", { name: new RegExp(names.taproom) }).first();
    await eventually(() => listed.count(), { timeoutMs: 20_000, label: "the taproom in the Atlas's list" });
    await t.tap(listed);
    const inside = panel.locator('[data-testid="atlas-inside-place"]');
    await eventually(() => inside.isVisible(), { label: "the taproom naming its place at the table" });
    await t.tap(inside.getByRole("button", { name: new RegExp(`Open battle map: ${tavernName}`) }));
    await eventually(() => editorOpen.count(), { timeoutMs: 30_000, label: "the map editor over the World tab" });
    await t.shot("table-map");
    await page.keyboard.press("Escape");
    await eventually(async () => (await editorOpen.count()) === 0, { label: "the map editor closed" });
    check(await inside.isVisible(), "the World tab is where it was");
    await t.tap(inside.getByRole("button", { name: new RegExp(`Open encounter: ${tavernName}`) }));
    const roster = page.getByRole("textbox", { name: "Roster" }).locator("visible=true").first();
    await eventually(() => roster.isVisible(), { timeoutMs: 30_000, label: "the encounter's form over the World tab" });
    check((await roster.inputValue()).includes(ratName), `the table's encounter roster: ${JSON.stringify(await roster.inputValue())}`);
    await t.shot("table-encounter");
    await page.keyboard.press("Escape");
    check((await placesNamed(api, quiet, tavernName)) === 1, "the table's world still has one tavern");
  } finally {
    await api.patch(`${quiet}/world`, { data: { maps: before.maps, pins: before.pins } });
    await api.delete(`${quiet}/world/entities/${encodeURIComponent(ref)}`);
    if (tableFight) await api.delete(`${quiet}/dm/encounter-templates/${tableFight}`);
    if (tableMap) await api.delete(`${quiet}/dm/maps/${tableMap}`);
  }
}
