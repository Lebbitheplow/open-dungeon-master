// WF-09, the Atlas side: an Atlas map with a picture twice as wide as it is
// tall stands over the playable Region, and a pin on it places its place.
// The lead opens the World tab's Atlas, sees the map drawn in its 16:10 box,
// presses Use as Region backdrop and confirms the review; the map is marked
// Over the Region and the Region shows the same uploaded file. The pin's
// card offers Place in Region; its review names the place, and once placed
// the pin is marked as moving with it. Undo takes the placing back (the pin
// released, the place where it stood), and placing again then releasing
// leaves the place where it is. On a desktop a dragged bound pin says its
// place moved too, and Undo puts the pin back. Stop using as the Region,
// with the picture taken off, ends with the Region as it was. The quiet
// table's maps, pins and Region picture are put back as they were, since
// every viewport and later scenario shares them.
import zlib from "node:zlib";
import { check, eventually, openPanelTab } from "../lib.mjs";

// A real PNG of the given size, as a data URL for /api/upload.
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
  const rows = zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height, 90));
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", rows), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export default {
  name: "atlas-region",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const stamp = Date.now().toString(36);
    const placeName = `Gullwatch ${stamp}`;
    const mapName = `The long coast ${stamp}`;
    const campaign = `${base}/api/campaigns/${ids.quietId}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });

    const uploaded = await api.post(`${base}/api/upload`, { data: { dataUrl: pngDataUrl(400, 200), name: "coast.png", type: "image/png" } });
    check(uploaded.ok(), `a 2:1 picture uploaded (${uploaded.status()})`);
    const art = (await uploaded.json()).url;
    const before = (await (await api.get(`${campaign}/world`)).json()).doc;
    const regionBefore = (await (await api.get(`${campaign}/overworld`)).json()).map;
    const made = await api.post(`${campaign}/world/entities`, { data: { typeId: "t_location", name: placeName, text: "A gull-haunted watchtower." } });
    check(made.ok(), `a place in the quiet table's world (${made.status()})`);
    const ref = (await made.json()).entity.ref;
    const locationId = ref.slice(ref.indexOf(":") + 1);
    const mapId = `m_${stamp}`;
    const pinId = `p_${stamp}`;
    const seeded = await api.patch(`${campaign}/world`, {
      data: {
        maps: [{ id: mapId, name: mapName, image: art, parentPinId: "", regions: [] }, ...before.maps.map((atlas) => ({ ...atlas }))],
        pins: [...before.pins, { id: pinId, mapId, x: 0.8, y: 0.7, name: "", ref, linkedMapId: "", notes: "" }],
      },
    });
    check(seeded.ok(), `an Atlas map with a pin on the place (${seeded.status()})`);
    const bridge = async () => (await api.get(`${campaign}/world/region`)).json();
    const anchorOf = async () => ((await (await api.get(`${campaign}/overworld`)).json()).locations ?? []).find((place) => place.id === locationId)?.anchor ?? null;

    try {
      await t.open(`/campaigns/${ids.quietId}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab" });
      await t.tap(panel.locator('[data-tour="world-view-atlas"]').first());
      const listed = panel.getByRole("complementary", { name: "Maps" }).getByRole("button", { name: new RegExp(mapName) }).first();
      await eventually(() => listed.count(), { timeoutMs: 20_000, label: "the map in the Atlas's list" });
      await t.tap(listed);
      const surface = panel.locator('[data-testid="atlas-surface"]').first();
      await eventually(() => surface.isVisible(), { label: "the map's surface" });
      const box = await surface.boundingBox();
      check(box && Math.abs(box.width / box.height - 1.6) < 0.02, `the map is drawn in the 16:10 box its pins were placed in (${box && (box.width / box.height).toFixed(3)})`);

      // Use as Region backdrop, reviewed first.
      await t.tap(panel.locator('[data-testid="atlas-use-as-region"]'));
      const review = panel.locator('[data-testid="atlas-region-review"]');
      await eventually(() => review.isVisible(), { label: "the backdrop review" });
      check(/players will see this map's art/.test(await review.innerText()), "the review says the players will see the art");
      check((await bridge()).map === null, "nothing changed while the review is open");
      await t.shot("backdrop-review");
      await t.tap(review.locator('[data-testid="atlas-region-apply"]'));
      await eventually(() => panel.locator('[data-testid="atlas-over-region"]').isVisible().catch(() => false), { label: "the Over the Region badge" });
      const over = await bridge();
      check(over.map?.id === mapId && over.backdropIsMap && over.backdropPath === art, "the Region shows the map's own uploaded file");
      check(over.map.frame.image === 2, "the picture's shape was measured");

      // Place in Region from the pin's card, reviewed first.
      const pin = surface.getByRole("button", { name: new RegExp(placeName) }).first();
      await t.tap(pin);
      await t.tap(panel.locator('[data-testid="pin-place"]'));
      await eventually(() => review.isVisible(), { label: "the place review" });
      check((await review.innerText()).includes(placeName), "the review names the place");
      const anchorBefore = await anchorOf();
      await t.tap(review.locator('[data-testid="atlas-region-apply"]'));
      await eventually(() => panel.locator('[data-testid="pin-bound"]').isVisible().catch(() => false), { label: "the pin marked as moving with its place" });
      check((await pin.getAttribute("data-bound")) === "true", "the pin on the map is drawn as bound");
      const placed = (await bridge()).pins.find((entry) => entry.pinId === pinId);
      check(placed?.inStep, "the place stands under its pin on the Region");
      await t.shot("placed");

      // Undo: the pin is released and the place goes back.
      const notice = panel.locator('[data-testid="atlas-region-notice"]');
      if (anchorBefore && (anchorBefore.x !== placed.anchor.x || anchorBefore.y !== placed.anchor.y)) {
        await t.tap(notice.locator('[data-testid="atlas-region-undo"]'));
        await eventually(async () => /Undone/.test(await notice.innerText().catch(() => "")), { label: "the placing undone" });
        check((await bridge()).pins.length === 0, "after Undo the pin is released");
        const back = await anchorOf();
        check(back && back.x === anchorBefore.x && back.y === anchorBefore.y, "and the place is back where it stood");
        await t.tap(pin);
        await t.tap(panel.locator('[data-testid="pin-place"]'));
        await eventually(() => review.isVisible(), { label: "the place review again" });
        await t.tap(review.locator('[data-testid="atlas-region-apply"]'));
        await eventually(() => panel.locator('[data-testid="pin-bound"]').isVisible().catch(() => false), { label: "placed again" });
      }

      // A dragged bound pin takes its place along, and Undo puts it back.
      if (!t.touch) {
        const at = await pin.boundingBox();
        const surfaceBox = await surface.boundingBox();
        await page.mouse.move(at.x + at.width / 2, at.y + at.height - 4);
        await page.mouse.down();
        await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.3, surfaceBox.y + surfaceBox.height * 0.4, { steps: 8 });
        await page.mouse.up();
        await eventually(async () => /Region marker moved with it/.test(await notice.innerText().catch(() => "")), { label: "the notice that the place moved too" });
        const moved = (await bridge()).pins.find((entry) => entry.pinId === pinId);
        check(moved?.inStep && (moved.anchor.x !== placed.anchor.x || moved.anchor.y !== placed.anchor.y), "the place moved with its pin");
        await t.shot("pin-moved");
        await t.tap(notice.locator('[data-testid="atlas-region-undo"]'));
        await eventually(async () => {
          const now = (await bridge()).pins.find((entry) => entry.pinId === pinId);
          return now && now.anchor.x === placed.anchor.x && now.anchor.y === placed.anchor.y;
        }, { label: "the pin and its place back where they were" });
        const doc = (await (await api.get(`${campaign}/world`)).json()).doc;
        const back = doc.pins.find((entry) => entry.id === pinId);
        check(Math.abs(back.x - 0.8) < 1e-6 && Math.abs(back.y - 0.7) < 1e-6, "the pin is exactly where it was");
      }

      // Release: nothing moves.
      const kept = await anchorOf();
      if (!(await panel.locator('[data-testid="pin-release"]').isVisible().catch(() => false))) await t.tap(pin);
      await t.tap(panel.locator('[data-testid="pin-release"]'));
      await eventually(() => panel.locator('[data-testid="pin-place"]').isVisible().catch(() => false), { label: "the pin released" });
      const released = await anchorOf();
      check(released && released.x === kept.x && released.y === kept.y, "releasing left the place where it was");

      // Stop using as the Region, with the picture taken off.
      await t.tap(panel.locator('[data-testid="atlas-region-unlink"]'));
      await eventually(() => review.isVisible(), { label: "the unlink review" });
      await t.tap(review.locator('[data-testid="atlas-region-clear"]'));
      await t.tap(review.locator('[data-testid="atlas-region-apply"]'));
      await eventually(() => panel.locator('[data-testid="atlas-use-as-region"]').isVisible().catch(() => false), { label: "the map offered as a backdrop again" });
      const after = await bridge();
      check(after.map === null && after.backdropPath === "", "the map no longer stands over the Region, and its picture is off");
    } finally {
      await api.delete(`${campaign}/world/region/backdrop`);
      await api.patch(`${campaign}/world`, { data: { maps: before.maps, pins: before.pins } });
      await api.patch(`${campaign}/overworld`, { data: { backdropPath: regionBefore.backdropPath ?? "" } });
      await api.delete(`${campaign}/world/entities/${encodeURIComponent(ref)}`);
    }
  },
};
