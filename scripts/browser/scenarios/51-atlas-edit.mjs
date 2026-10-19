// WF-20: the Atlas without a pointer, a refused save, settings and deletes.
// The lead opens the World tab's Atlas on a map with a 2:1 picture. A pin is
// added in the middle and moved with the arrow keys and by typing numbers;
// a region is started with three corners and one corner is typed. A pin's
// name save that the server refuses keeps the typed name with a Try again
// that saves it. Map settings change the box to the picture's own shape
// through a review, with the pins kept on their spots of the picture. A pin
// and then the map are deleted through their reviews, and Undo brings each
// back as it was. The quiet table's maps and pins are put back as they were,
// since every viewport and later scenario shares them.
import zlib from "node:zlib";
import { check, eventually, openPanelTab } from "../lib.mjs";

function pngDataUrl(width, height) {
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
  const rows = zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height, 70));
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", rows), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export default {
  name: "atlas-edit",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const stamp = Date.now().toString(36);
    const mapName = `The salt flats ${stamp}`;
    const campaign = `${base}/api/campaigns/${ids.quietId}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    const uploaded = await api.post(`${base}/api/upload`, { data: { dataUrl: pngDataUrl(400, 200), name: "flats.png", type: "image/png" } });
    check(uploaded.ok(), `a 2:1 picture uploaded (${uploaded.status()})`);
    const art = (await uploaded.json()).url;
    const before = (await (await api.get(`${campaign}/world`)).json()).doc;
    const mapId = `m_${stamp}`;
    const seeded = await api.patch(`${campaign}/world`, {
      data: {
        maps: [{ id: mapId, name: mapName, image: art, parentPinId: "", regions: [] }, ...before.maps],
        pins: [...before.pins, { id: `p_${stamp}`, mapId, x: 0.2, y: 0.3, name: `Cairn ${stamp}`, ref: "", linkedMapId: "", notes: "" }],
      },
    });
    check(seeded.ok(), `an Atlas map with a pin (${seeded.status()})`);
    const read = async () => (await (await api.get(`${campaign}/world`)).json()).doc;
    const mapPins = async () => (await read()).pins.filter((pin) => pin.mapId === mapId);

    try {
      await t.open(`/campaigns/${ids.quietId}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab" });
      await t.tap(panel.locator('[data-tour="world-view-atlas"]').first());
      const listed = panel.getByRole("complementary", { name: "Maps" }).getByRole("button", { name: new RegExp(mapName) }).first();
      await eventually(() => listed.count(), { timeoutMs: 20_000, label: "the map in the list" });
      await t.tap(listed);
      const surface = panel.locator('[data-testid="atlas-surface"]').first();
      await eventually(() => surface.isVisible(), { label: "the map" });

      // A pin without a pointer: added in the middle, moved by keys and numbers.
      await t.tap(panel.getByRole("radio", { name: /Place a pin/ }));
      await t.tap(panel.locator('[data-testid="atlas-pin-in-middle"]'));
      await eventually(async () => (await mapPins()).length === 2, { label: "a second pin saved" });
      const added = (await mapPins()).find((pin) => !pin.name);
      check(added.x === 0.5 && added.y === 0.5, "the new pin stands in the middle");
      const pinButton = surface.getByRole("button", { name: /^A pin$/ }).first();
      await pinButton.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowDown");
      await eventually(async () => {
        const pin = (await mapPins()).find((entry) => entry.id === added.id);
        return Math.abs(pin.x - 0.52) < 1e-6 && Math.abs(pin.y - 0.55) < 1e-6;
      }, { label: "the arrow keys moved the pin" });
      const card = panel.locator('[data-tour="world-atlas-card"]').first();
      const across = card.getByLabel("Pin: across (percent)");
      await eventually(async () => (await across.inputValue()) === "52", { label: "the card's number following the pin" });
      await across.fill("25");
      await across.press("Enter");
      await eventually(async () => Math.abs((await mapPins()).find((entry) => entry.id === added.id).x - 0.25) < 1e-6, { label: "the typed number moved the pin" });

      // A refused save keeps what was typed.
      const name = `Waystone ${stamp}`;
      let refuse = true;
      await page.route(`**/api/campaigns/${ids.quietId}/world`, (request) =>
        refuse && request.request().method() === "PATCH" ? request.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Refused for the test." }) }) : request.continue(),
      );
      const nameBox = card.getByLabel("Name", { exact: true });
      await nameBox.fill(name);
      await nameBox.blur();
      const notSaved = card.locator('[data-testid="atlas-not-saved"]');
      await eventually(() => notSaved.isVisible().catch(() => false), { label: "the card saying it did not save" });
      check((await nameBox.inputValue()) === name, "the typed name is still in the field");
      check(!(await mapPins()).some((pin) => pin.name === name), "nothing was saved");
      await t.shot("not-saved");
      refuse = false;
      await t.tap(notSaved.getByRole("button", { name: "Try again" }));
      await eventually(async () => (await mapPins()).some((pin) => pin.name === name), { label: "Try again saved the name" });
      await page.unroute(`**/api/campaigns/${ids.quietId}/world`);

      // A region by numbers.
      await t.tap(card.getByRole("button", { name: "Close" }));
      await t.tap(panel.getByRole("radio", { name: /Draw a region/ }));
      await t.tap(panel.locator('[data-testid="atlas-region-by-numbers"]'));
      await eventually(async () => (await read()).maps.find((atlas) => atlas.id === mapId).regions.length === 1, { label: "a three-cornered region saved" });
      const corners = panel.locator('[data-testid="region-corners"]').first();
      await t.tap(corners.locator("summary"));
      const corner = corners.getByLabel("Corner 1: across (percent)");
      await corner.fill("10");
      await corner.press("Enter");
      await eventually(async () => Math.abs((await read()).maps.find((atlas) => atlas.id === mapId).regions[0].points[0].x - 0.1) < 1e-6, { label: "the typed corner saved" });
      await t.tap(panel.locator('[data-tour="world-atlas-card"]').first().getByRole("button", { name: "Close" }));

      // Map settings: the picture's own shape, pins kept on the picture.
      const cairnBefore = (await mapPins()).find((pin) => pin.name === `Cairn ${stamp}`);
      await t.tap(panel.locator('[data-testid="atlas-settings-button"]'));
      const settings = panel.locator('[data-testid="atlas-settings"]');
      await eventually(() => settings.isVisible(), { label: "the map settings" });
      await t.tap(settings.locator('[data-testid="atlas-shape-picture"]'));
      await t.tap(settings.locator('[data-testid="atlas-frame-review-button"]'));
      await eventually(() => settings.locator('[data-testid="atlas-frame-review"]').isVisible().catch(() => false), { label: "the frame review" });
      check((await read()).maps.find((atlas) => atlas.id === mapId).frame === undefined, "the review changed nothing");
      await t.shot("frame-review");
      await t.tap(settings.locator('[data-testid="atlas-frame-apply"]'));
      await eventually(async () => (await read()).maps.find((atlas) => atlas.id === mapId).frame?.surface === 2, { label: "the box took the picture's shape" });
      await eventually(async () => {
        const box = await surface.boundingBox();
        return box && Math.abs(box.width / box.height - 2) < 0.02;
      }, { label: "the map drawn in its new box" });
      // In a 16:10 box a 2:1 picture is cropped at the sides; in a 2:1 box it
      // is not, so the cairn moves toward the edge to stay on the picture.
      const cairn = (await mapPins()).find((pin) => pin.id === cairnBefore.id);
      check(Math.abs(0.5 + (cairnBefore.x - 0.5) * 0.8 - cairn.x) < 1e-3 && Math.abs(cairn.y - cairnBefore.y) < 1e-3, `the cairn kept its spot on the picture (${cairn.x}, ${cairn.y})`);
      await t.tap(settings.getByRole("button", { name: "Close the settings" }));

      // A pin deleted through its review, and back with Undo.
      const notice = panel.locator('[data-testid="atlas-region-notice"]');
      await t.tap(surface.getByRole("button", { name: new RegExp(name) }).first());
      await t.tap(panel.locator('[data-testid="atlas-card-delete"]'));
      const review = panel.locator('[data-testid="atlas-delete-review"]');
      await eventually(() => review.isVisible(), { label: "the pin's delete review" });
      check((await mapPins()).length === 2, "the review deleted nothing");
      await t.tap(review.locator('[data-testid="atlas-delete-confirm"]'));
      await eventually(async () => (await mapPins()).length === 1, { label: "the pin deleted" });
      await t.tap(notice.locator('[data-testid="atlas-region-undo"]'));
      await eventually(async () => (await mapPins()).some((pin) => pin.name === name), { label: "the pin back with Undo" });

      // The map deleted through its review, and back with its frame.
      await t.tap(panel.locator('[data-testid="atlas-delete-map"]'));
      await eventually(() => review.isVisible(), { label: "the map's delete review" });
      check(/2 pins go with it/.test(await review.innerText()), "the review counts the map's pins");
      await t.shot("map-delete-review");
      await t.tap(review.locator('[data-testid="atlas-delete-confirm"]'));
      await eventually(async () => !(await read()).maps.some((atlas) => atlas.id === mapId), { label: "the map deleted" });
      await t.tap(notice.locator('[data-testid="atlas-region-undo"]'));
      await eventually(async () => {
        const doc = await read();
        const atlas = doc.maps.find((entry) => entry.id === mapId);
        return atlas?.frame?.surface === 2 && atlas.regions.length === 1 && doc.pins.filter((pin) => pin.mapId === mapId).length === 2;
      }, { label: "the map back with its frame, region and pins" });
    } finally {
      await page.unroute(`**/api/campaigns/${ids.quietId}/world`).catch(() => {});
      await api.patch(`${campaign}/world`, { data: { maps: before.maps, pins: before.pins } });
    }
  },
};
