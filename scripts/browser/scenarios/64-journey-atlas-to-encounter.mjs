// M6 of the WorldForge plan (audit WF-23), journey 4: from the Atlas to a
// fight in a campaign. In a new workshop the author makes the first Atlas
// map with a picture uploaded through its form, adds a pin in the middle,
// moves it with the arrow keys and a typed number, and has it stand for a
// place. The map becomes the Region's backdrop and the pin's place is placed
// in the Region. From the pin's card the place gets a battle map, and from
// the place an encounter on that map. The workshop is brought into a new
// campaign through the lobby's import picker; once play begins, the DM opens
// the place on the campaign's Atlas, the encounter over the World tab, and
// the Region in the Map tab.
//
// The finish, at the campaign: the place stands in the Region on the cell
// under its Atlas pin (the same cell it had in the workshop, the pin at the
// same spot of the picture), the Region draws the Atlas map's own picture,
// the encounter is drawn on the place's battle map, and that battle map has
// no picture, walls or light taken from the Atlas picture.
//
// The single steps are proven in 49-atlas-region (backdrop and placing),
// 50-place-battle-maps (battle map and encounter from a place), 51-atlas-edit
// (a pin without a pointer) and 43-world-use-in-campaign (the import picker);
// this chains them and checks the campaign at the end. No model is called:
// the campaign has a person in the DM seat. Setup through the API is only
// what the journey is not about: the workshop and its place, a monster of
// the author's own for the first foe, the campaign, and the player seated
// and readied so the table can begin.
import zlib from "node:zlib";
import { check, eventually, openPanelTab, signIn } from "../lib.mjs";

// The picture an <img> draws, as the server stored it: the apps load a
// host's pictures from its address or as a fetched copy and keep the stored
// path beside it (the client's runtime, data-odm-src).
const storedSrc = async (image) => (await image.getAttribute("data-odm-src")) ?? (await image.getAttribute("src"));

// A picture in one strong colour, so the Region's canvas can be read for
// it: a real PNG, 16:10 like the Atlas's box, so a pin's spot on the box is
// the same spot on the picture.
const COLOUR = [214, 38, 186];
function solidPng(width, height, [red, green, blue]) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(width * 3 + 1);
  for (let x = 0; x < width; x += 1) row.set([red, green, blue], 1 + x * 3);
  const rows = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", rows), chunk("IEND", Buffer.alloc(0))]);
}

// A campaign a person runs, with the seeded player seated on a ready-made
// hero and everyone ready, so the lead can begin it after the import.
async function seatTable(t, title) {
  const { page, base, ids, api } = t;
  const made = await api.post(`${base}/api/campaigns`, { data: { title, gameSettings: { ttsEnabled: false, dmMode: "human" } } });
  check(made.ok(), `a campaign the lead runs (${made.status()})`);
  const campaign = (await made.json()).campaign;
  const player = await page.context().browser().newContext();
  await signIn(player, base, ids.player, ids.password);
  const joined = await player.request.post(`${base}/api/campaigns/join`, { data: { inviteCode: campaign.inviteCode } });
  check(joined.ok(), `the player joined by the invite code (${joined.status()})`);
  const hero = await player.request.post(`${base}/api/campaigns/${campaign.id}/sheet/pregen`, { data: { id: "brakk" } });
  check(hero.status() === 201, `the player took a ready-made hero (${hero.status()})`);
  const library = (await hero.json()).sheet?.libraryCharacterId ?? "";
  for (const request of [player.request, api]) {
    const ready = await request.post(`${base}/api/campaigns/${campaign.id}/ready`, { data: { ready: true } });
    check(ready.ok(), `a seat readied (${ready.status()})`);
  }
  return {
    id: campaign.id,
    begin: async () => {
      const begun = await api.patch(`${base}/api/campaigns/${campaign.id}`, { data: { status: "active" } });
      check(begun.ok(), `the lead began the campaign (${begun.status()}: ${await begun.text()})`);
    },
    close: async () => {
      await api.delete(`${base}/api/campaigns/${campaign.id}`).catch(() => {});
      if (library) await player.request.delete(`${base}/api/characters/${library}`).catch(() => {});
      await player.close().catch(() => {});
    },
  };
}

const focused = (locator) => locator.evaluate((element) => element === document.activeElement).catch(() => false);

// Reaches a control without the pointer and presses it with the keyboard.
async function press(page, locator, key = "Enter") {
  await locator.focus();
  await page.keyboard.press(key);
}

export default {
  name: "journey-atlas-to-encounter",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = Date.now().toString(36);
    const shopTitle = `Gullreach atlas ${stamp}`;
    const placeName = `Saltgate ${stamp}`;
    const mapName = `The Gullreach coast ${stamp}`;
    const ratName = `Wharf Rat ${stamp}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["world", "maps", "encounters"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });
    const params = async () => (await t.url()).searchParams;
    const editorOpen = page.getByRole("button", { name: "More for this map" }).locator("visible=true");

    const made = await api.post(`${base}/api/workshops`, { data: { title: shopTitle, description: "" } });
    check(made.ok(), "a workshop for the journey");
    const shopId = (await made.json()).workshop.id;
    const shop = `${base}/api/campaigns/${shopId}`;
    let monsterId = "";
    let table = null;
    try {
      const place = (await (await api.post(`${shop}/world/entities`, { data: { typeId: "t_location", name: placeName, text: "A walled harbour gate." } })).json()).entity;
      check(Boolean(place?.ref), "a place in the workshop's world");
      const placeId = place.ref.slice(place.ref.indexOf(":") + 1);
      const rat = await api.post(`${shop}/dm/bestiary`, { data: { from: "cr", name: ratName, cr: 1 } });
      check(rat.ok(), `a monster of the author's own (${rat.status()})`);
      monsterId = (await rat.json()).monster.id;
      const readDoc = async (id) => (await (await api.get(`${base}/api/campaigns/${id}/world`)).json()).doc;

      // ---- the workshop's Atlas: the first map, with its picture ----
      await t.open(`/workshop/${shopId}?system=world&view=atlas`);
      const first = page.locator(`${root}[data-tour="world-atlas"]`).getByRole("button", { name: "First map" }).locator("visible=true").first();
      await eventually(() => first.count(), { timeoutMs: 30_000, label: "the empty Atlas" });
      await press(page, first);
      const nameBox = page.getByRole("textbox", { name: "Map name" }).locator("visible=true").first();
      await eventually(() => focused(nameBox), { label: "the new map's name field focused" });
      await page.keyboard.type(mapName);
      // Tab to "Add a picture" and press it: the device's file chooser opens.
      const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await (await chooser).setFiles({ name: "gullreach.png", mimeType: "image/png", buffer: solidPng(320, 200, COLOUR) });
      const form = page.locator("form").filter({ has: nameBox }).first();
      await eventually(() => form.locator("img").count(), { timeoutMs: 20_000, label: "the picture uploaded into the form" });
      await nameBox.focus();
      await page.keyboard.press("Enter");
      const surface = page.locator(`${root}[data-testid="atlas-surface"]`).locator("visible=true").first();
      await eventually(() => surface.locator("img").count(), { timeoutMs: 20_000, label: "the new map with its picture" });
      const atlas = (await readDoc(shopId)).maps.find((entry) => entry.name === mapName);
      check(atlas && /^\/(api\/)?uploads?\//.test(atlas.image), `the map holds the uploaded picture: ${atlas?.image}`);
      check((await storedSrc(surface.locator("img"))) === atlas.image, "the Atlas draws that picture");

      // ---- a pin without the pointer, standing for the place ----
      await press(page, page.getByRole("radio", { name: /Place a pin/ }).locator("visible=true").first(), "Space");
      await press(page, page.locator(`${root}[data-testid="atlas-pin-in-middle"]`).locator("visible=true").first());
      const pinOf = async () => (await readDoc(shopId)).pins.find((pin) => pin.mapId === atlas.id);
      await eventually(async () => Boolean(await pinOf()), { label: "a pin saved in the middle" });
      const pinButton = surface.getByRole("button", { name: /^A pin$/ }).first();
      await pinButton.focus();
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      await eventually(async () => Math.abs((await pinOf()).x - 0.6) < 1e-6, { label: "the arrow keys moved the pin across" });
      const card = page.locator(`${root}[data-tour="world-atlas-card"]`).locator("visible=true").first();
      const down = card.getByLabel("Pin: down (percent)");
      await down.focus();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("30");
      await page.keyboard.press("Enter");
      await eventually(async () => Math.abs((await pinOf()).y - 0.3) < 1e-6, { label: "the typed number moved the pin down" });
      await press(page, card.getByRole("button", { name: "Pick an entry" }));
      const find = card.getByRole("textbox", { name: "Find the entry it stands for" });
      await find.focus();
      await page.keyboard.type(placeName);
      const option = card.getByRole("option", { name: placeName });
      await eventually(() => option.count(), { label: "the place offered" });
      await page.keyboard.press("Tab");
      check(await focused(option.first()), "Tab reaches the place in the list");
      await page.keyboard.press("Enter");
      await eventually(async () => (await pinOf()).ref === place.ref, { label: "the pin standing for the place" });
      await t.shot("workshop-pin");

      // ---- the map over the Region, the place placed in it ----
      const review = page.locator(`${root}[data-testid="atlas-region-review"]`).locator("visible=true").first();
      await press(page, page.locator(`${root}[data-testid="atlas-use-as-region"]`).locator("visible=true").first());
      await eventually(() => review.isVisible().catch(() => false), { label: "the backdrop review" });
      await press(page, review.locator('[data-testid="atlas-region-apply"]'));
      await eventually(() => page.locator(`${root}[data-testid="atlas-over-region"]`).locator("visible=true").count(), { label: "the map over the Region" });
      const pinOnMap = surface.getByRole("button", { name: new RegExp(placeName) }).first();
      const placeButton = page.locator(`${root}[data-testid="pin-place"]`).locator("visible=true").first();
      if (!(await placeButton.count())) await t.tap(pinOnMap);
      await press(page, placeButton);
      await eventually(() => review.isVisible().catch(() => false), { label: "the place review" });
      check((await review.innerText()).includes(placeName), "the review names the place");
      await press(page, review.locator('[data-testid="atlas-region-apply"]'));
      await eventually(() => page.locator(`${root}[data-testid="pin-bound"]`).locator("visible=true").count(), { label: "the pin moving with its place" });
      const shopBridge = await (await api.get(`${shop}/world/region`)).json();
      const shopPlaced = shopBridge.pins.find((entry) => entry.locationId === placeId);
      check(shopPlaced?.inStep && shopBridge.backdropIsMap, "in the workshop the place stands under its pin on the Region's picture");

      // ---- the place's battle map, and an encounter on it ----
      const section = card.locator('[data-testid="place-battle-maps"]');
      await eventually(() => section.isVisible().catch(() => false), { label: "the pin's battle maps" });
      await press(page, section.getByRole("button", { name: "Create battle map" }));
      await eventually(async () => (await params()).get("system") === "maps" && Boolean((await params()).get("open")), { timeoutMs: 20_000, label: "the new battle map opened" });
      await eventually(() => editorOpen.count(), { timeoutMs: 30_000, label: "the map editor on the new map" });
      const shopMapId = (await params()).get("open");
      await page.keyboard.press("Escape");
      await t.tap(page.locator(`${root}[data-testid="back-to-world-entry"]`).locator("visible=true").first());
      const onEntry = page.locator(`${root}[data-tour="world-entry"]`).locator("visible=true").first().locator('[data-testid="place-battle-maps"]');
      await eventually(() => onEntry.isVisible().catch(() => false), { timeoutMs: 20_000, label: "the place's battle maps on its entry" });
      await t.tap(onEntry.getByRole("button", { name: "Create encounter" }));
      const fight = onEntry.locator('[data-testid="place-battle-fight"]');
      await t.tap(fight.getByRole("button", { name: "Its first foe" }));
      await t.tap(page.getByRole("menuitemradio", { name: ratName }).locator("visible=true").first());
      await t.tap(fight.getByRole("button", { name: "Make the encounter" }));
      await eventually(async () => (await params()).get("system") === "encounters" && Boolean((await params()).get("open")), { timeoutMs: 20_000, label: "the new encounter opened" });
      const shopFightId = (await params()).get("open");
      const shopFight = (await (await api.get(`${shop}/dm/encounter-templates`)).json()).templates.find((entry) => entry.id === shopFightId);
      check(shopFight?.map?.mapId === shopMapId, "in the workshop the encounter is on the place's battle map");
      await page.keyboard.press("Escape");
      const shopRegion = await (await api.get(`${shop}/overworld`)).json();
      const shopAnchor = shopRegion.locations.find((entry) => entry.id === placeId)?.anchor;

      // ---- into a new campaign, through the lobby's import picker ----
      table = await seatTable(t, `Gullreach table ${stamp}`);
      const campaign = `${base}/api/campaigns/${table.id}`;
      await t.open(`/campaigns/${table.id}`);
      const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
      await startFrom.scrollIntoViewIfNeeded();
      await t.tap(startFrom);
      await t.tap(page.getByRole("menuitemradio", { name: shopTitle }).locator("visible=true").first());
      for (const kind of ["Region map", "Battle maps", "Prepared encounters", "Places", /WorldForge/]) {
        const toggle = page.getByRole("switch", { name: kind }).locator("visible=true").first();
        await eventually(() => toggle.count(), { label: `the ${kind} switch` });
        check((await toggle.getAttribute("aria-checked")) === "true", `${kind} comes with the workshop`);
      }
      const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
      await eventually(() => bring.isEnabled(), { label: "Bring it in enabled" });
      await t.tap(bring);
      await eventually(async () => /Brought \d+ items? across/.test(await page.locator("body").innerText()), { timeoutMs: 30_000, label: "the import's note" });
      await t.shot("imported");
      await table.begin();

      // ---- the campaign's Atlas: the place, its battle map and encounter ----
      const doc = await readDoc(table.id);
      const tableAtlas = doc.maps.find((entry) => entry.name === mapName);
      const tablePin = doc.pins.find((pin) => pin.mapId === tableAtlas?.id);
      check(tableAtlas?.image === atlas.image, `the campaign's Atlas map holds the same picture: ${tableAtlas?.image}`);
      const tablePlaceId = tablePin?.ref?.slice(tablePin.ref.indexOf(":") + 1) ?? "";
      await t.open(`/campaigns/${table.id}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab" });
      await t.tap(panel.locator('[data-tour="world-view-atlas"]').first());
      const listed = panel.getByRole("complementary", { name: "Maps" }).getByRole("button", { name: new RegExp(mapName) }).first();
      await eventually(() => listed.count(), { timeoutMs: 20_000, label: "the map in the campaign's Atlas" });
      check((await listed.getByLabel("Over the Region").count()) === 1, "the map stands over the campaign's Region");
      await t.tap(listed);
      const tableSurface = panel.locator('[data-testid="atlas-surface"]').first();
      await eventually(() => tableSurface.isVisible(), { label: "the map's surface" });
      check((await storedSrc(tableSurface.locator("img"))) === atlas.image, "the campaign's Atlas draws the workshop's picture");
      const tablePinButton = tableSurface.getByRole("button", { name: new RegExp(`${placeName}, moves with its place on the Region`) }).first();
      await eventually(() => tablePinButton.count(), { label: "the pin bound to its place at the campaign" });
      await t.tap(tablePinButton);
      const tableCard = panel.locator('[data-tour="world-atlas-card"]').first();
      check((await tableCard.getByLabel("Pin: across (percent)").inputValue()) === "60" && (await tableCard.getByLabel("Pin: down (percent)").inputValue()) === "30", "the pin stands where it was put in the workshop");
      const tableSection = tableCard.locator('[data-testid="place-battle-maps"]');
      await eventually(() => tableSection.isVisible().catch(() => false), { label: "the place's battle maps at the campaign" });
      const mapRow = tableSection.locator('[data-testid="place-battle-record"][data-kind="map"]');
      const mapWords = await mapRow.innerText();
      check(/no walls or light drawn yet/.test(mapWords) && !/a picture only/.test(mapWords), `the battle map took no picture, walls or light from the Atlas: ${mapWords}`);
      await t.shot("table-atlas");
      await press(page, tableSection.getByRole("button", { name: `Open encounter: ${placeName}` }));
      const roster = page.getByRole("textbox", { name: "Roster" }).locator("visible=true").first();
      await eventually(() => roster.isVisible(), { timeoutMs: 30_000, label: "the encounter's form over the World tab" });
      check((await roster.inputValue()).includes(ratName), `the encounter's roster: ${JSON.stringify(await roster.inputValue())}`);
      const onMap = page.getByRole("button", { name: "On which map" }).locator("visible=true").first();
      check((await onMap.innerText()).includes(placeName), `the encounter is on the place's battle map: ${await onMap.innerText()}`);
      await t.shot("table-encounter");
      await page.keyboard.press("Escape");

      const tableMaps = (await (await api.get(`${campaign}/dm/maps`)).json()).maps;
      const tableMap = tableMaps.find((entry) => entry.name === placeName);
      const tableFight = (await (await api.get(`${campaign}/dm/encounter-templates`)).json()).templates.find((entry) => entry.name === placeName);
      check(tableMap && tableFight?.map?.mapId === tableMap.id, "the campaign's encounter uses the campaign's copy of the battle map");
      check(!tableMap.backdrop && tableMap.backdrop !== atlas.image, "the battle map has no picture of its own, least of all the Atlas's");

      // ---- the campaign's Region: the same picture, the place under its pin ----
      const regionRead = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${table.id}/overworld`) && response.request().method() === "GET", { timeout: 30_000 });
      await openPanelTab(t, "map");
      const region = await (await regionRead).json();
      const canvas = page.locator(`${root}[data-tour="region-canvas"] canvas`).locator("visible=true").first();
      await eventually(() => canvas.count(), { timeoutMs: 30_000, label: "the Region's canvas" });
      await canvas.scrollIntoViewIfNeeded();
      check(region.map.backdropPath === atlas.image, `the Region shows the Atlas map's own picture: ${region.map.backdropPath}`);
      // The picture is one colour: most of the drawn Region is that colour.
      const share = await eventually(async () => {
        const matched = await canvas.evaluate((element, colour) => {
          const context = element.getContext("2d");
          let hits = 0;
          let seen = 0;
          for (let row = 3; row <= 7; row += 1) {
            for (let column = 3; column <= 7; column += 1) {
              const [r, g, b, a] = context.getImageData(Math.floor((element.width * column) / 10), Math.floor((element.height * row) / 10), 1, 1).data;
              seen += 1;
              if (a > 200 && Math.abs(r - colour[0]) < 40 && Math.abs(g - colour[1]) < 40 && Math.abs(b - colour[2]) < 40) hits += 1;
            }
          }
          return hits / seen;
        }, COLOUR);
        return matched >= 0.6 ? matched : false;
      }, { timeoutMs: 20_000, label: "the Region drawn with the Atlas picture" });
      await t.shot("table-region");
      const anchor = region.locations.find((entry) => entry.name === placeName)?.anchor;
      // A 16:10 picture in the Atlas's 16:10 box: a pin's spot on the box is
      // that spot on the picture, and the Region stretches the picture over
      // its grid, so the pin's cell is its fraction of the grid.
      const expected = { x: Math.floor(0.6 * region.map.width), y: Math.floor(0.3 * region.map.height) };
      check(anchor && anchor.x === expected.x && anchor.y === expected.y, `the place stands on the cell under its pin: ${JSON.stringify(anchor)} for ${JSON.stringify(expected)}`);
      check(shopAnchor && shopAnchor.x === anchor.x && shopAnchor.y === anchor.y, `and on the cell it had in the workshop: ${JSON.stringify(shopAnchor)}`);
      const bridge = await (await api.get(`${campaign}/world/region`)).json();
      const bound = bridge.pins.find((entry) => entry.locationId === tablePlaceId);
      check(bridge.map?.id === tableAtlas.id && bridge.backdropIsMap && bound?.inStep, `the campaign's bridge agrees (${Math.round(share * 100)}% of the sampled Region in the picture's colour)`);
    } finally {
      if (table) await table.close();
      if (monsterId) await api.delete(`${shop}/dm/bestiary/${monsterId}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${shopId}`).catch(() => {});
    }
  },
};
