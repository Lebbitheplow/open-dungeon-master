// Issue 548: a made-up world seventeen places in (seed.mjs, Region Table),
// anchored the way the old placement left it and upgraded the way an old
// database is. The region map draws places of
// their own only: the shrine's root cellar and the village hall's approach
// fold into their places. No two names print over each other; the ones with
// no room wait, and zooming in finds room for more of them. Tapping a dot
// names it and says what is inside it. The area list nests each part under
// its place by its short name. The lead files a place under a bigger one
// from the area's menu, and the vault the AI never wrote, added by hand, takes
// its two rooms once they are filed under it.
import { axeViolations, check, eventually, openPanelTab } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true").first();

export default {
  name: "region-map",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport, api, base, touch } = t;
    const campaignId = ids.regionTables[viewport];
    const campaign = `${base}/api/campaigns/${campaignId}`;
    const overworld = async () => (await api.get(`${campaign}/overworld`)).json();
    await t.open(`/campaigns/${campaignId}`);
    await openPanelTab(t, "map");

    const canvas = visible(page.locator(`${root}[data-tour="region-canvas"] canvas`));
    await eventually(async () => Number(await canvas.getAttribute("data-places")) > 0, { timeoutMs: 30_000, label: "the region map drawn" });
    const read = async () => ({
      places: Number(await canvas.getAttribute("data-places")),
      shown: Number(await canvas.getAttribute("data-names-shown")),
      hidden: Number(await canvas.getAttribute("data-names-hidden")),
      view: String(await canvas.getAttribute("data-view")).split(",").map(Number),
    });
    // The very first frame can come before the view is fitted to the places;
    // the counts are read from the fitted one.
    await eventually(async () => (await read()).shown > 0, { label: "the fitted view drawn" });
    const fitted = await read();
    check(fitted.places === 15, `15 places of their own out of 17, the cellar and the hall's approach folded (${fitted.places})`);
    // The first view frames where the places are, not the whole region.
    check(fitted.shown + fitted.hidden <= fitted.places, `names counted for the dots on screen (${fitted.shown} + ${fitted.hidden})`);
    check(fitted.shown >= 8, `most names find room in the first view (${fitted.shown} of ${fitted.places})`);
    await t.shot("fitted");

    // Zooming in spreads the dots apart: the names keep their size, so more fit.
    const zoomIn = visible(page.locator(`${root}button[aria-label="Zoom in"]`));
    for (let step = 0; step < 3; step += 1) {
      await t.tap(zoomIn);
    }
    await eventually(async () => (await read()).view[2] > fitted.view[2] * 1.8, { label: "zoomed in" });
    const zoomed = await read();
    const sideways = await canvas.evaluate((node) => {
      for (let at = node.parentElement; at; at = at.parentElement) {
        if (at.scrollLeft > 0) return `${at.className}`.slice(0, 80);
      }
      return "";
    });
    check(!sideways, `nothing round the map scrolled sideways (${sideways})`);
    check(zoomed.hidden <= fitted.hidden, `zooming in leaves no more names waiting than before (${fitted.hidden} -> ${zoomed.hidden})`);
    await t.shot("zoomed");
    const zoomOut = visible(page.locator(`${root}button[aria-label="Zoom out"]`));
    for (let step = 0; step < 3; step += 1) {
      await t.tap(zoomOut);
    }

    // A tap on a dot names it and says what is inside.
    const tapPlace = async (name) => {
      const data = await overworld();
      const place = data.locations.find((entry) => entry.name === name);
      check(place?.anchor, `${name} has a dot`);
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      const [x, y, zoom] = (await read()).view;
      const at = { x: box.x + x + (place.anchor.x * 16 + 8) * zoom, y: box.y + y + (place.anchor.y * 16 + 8) * zoom };
      if (touch) {
        await page.touchscreen.tap(at.x, at.y);
      } else {
        await page.mouse.click(at.x, at.y);
      }
    };
    const caption = page.locator(`${root}[data-testid="region-place-caption"]`);
    await tapPlace("Hollowroot Vault Entrance Passage");
    await eventually(async () => /Hollowroot Vault Entrance Passage.*the party is here/s.test((await caption.textContent().catch(() => "")) ?? ""), { label: "the caption names the party's place" });
    await tapPlace("Duskleaf Shrine");
    await eventually(async () => /Duskleaf Shrine[\s\S]*Inside: Root Cellar/.test((await caption.textContent().catch(() => "")) ?? ""), { label: "the shrine says what is inside it" });
    // The caption fades in; it is read once it has.
    await eventually(async () => (await caption.evaluate((node) => node.getAnimations().length)) === 0, { label: "the caption settled" });
    await t.shot("caption");

    // The area list nests each part under its place, by its short name.
    const cellar = visible(page.locator(`${root}button[aria-label^="Duskleaf Shrine Root Cellar"]`));
    await eventually(() => cellar.count(), { label: "the cellar in the area list" });
    check(/^\s*Root Cellar/.test((await cellar.textContent()) ?? ""), "the cellar is listed by its short name");
    const shrineText = await visible(page.locator(`${root}li button`, { hasText: /^Duskleaf Shrine/ })).textContent();
    check(/1 inside/.test(shrineText ?? ""), `the shrine's row counts what is inside it (${shrineText})`);

    // The lead files the smithy under the fair from the smithy's own menu.
    const smithy = visible(page.locator(`${root}li button`, { hasText: /^Thornhollow Smithy/ }));
    await t.tap(smithy);
    const actions = visible(page.locator(`${root}button[aria-label="Actions for Thornhollow Smithy"]`));
    await eventually(() => actions.count(), { label: "the smithy's menu" });
    await t.tap(actions);
    const item = visible(page.locator('[role="menuitem"]', { hasText: "Part of a bigger place" }));
    await eventually(() => item.count(), { label: "Part of a bigger place in the menu" });
    await t.tap(item);
    const picker = visible(page.locator('[data-testid="place-part-of"]'));
    await eventually(() => picker.count(), { label: "the place picker" });
    await page.waitForTimeout(900);
    await t.shot("part-of-dialog");
    const violations = await axeViolations(page, '[role="dialog"]');
    check(!violations.length, `the picker passes axe: ${JSON.stringify(violations).slice(0, 400)}`);
    await t.tap(visible(picker.locator('[role="radio"]', { hasText: "Thornhollow Fair" })));
    await eventually(async () => (await overworld()).locations.find((place) => place.name === "Thornhollow Smithy")?.parentName === "Thornhollow Fair", { label: "the smithy filed under the fair" });
    await eventually(async () => (await read()).places === 14, { label: "the map draws the fair alone where the smithy stood beside it" });
    await eventually(async () => /Part of\s*Thornhollow Fair/.test((await visible(page.locator(`${root}p`, { hasText: /^Part of/ })).textContent().catch(() => "")) ?? ""), { label: "the smithy's header says what it is part of" });

    // The vault the AI never wrote, added by hand under Add a place, and its
    // two rooms filed under it: the map draws the vault alone for the three.
    const added = await api.patch(`${campaign}/overworld`, { data: { places: [{ name: "Hollowroot Vault", blurb: "" }] } });
    check(added.ok(), `the vault added (${added.status()})`);
    for (const room of ["Hollowroot Vault Woodland Approach", "Hollowroot Vault Entrance Passage"]) {
      const id = (await overworld()).locations.find((place) => place.name === room).id;
      const filed = await api.patch(`${campaign}/overworld`, { data: { parent: { locationId: id, parentName: "Hollowroot Vault" } } });
      check(filed.ok(), `${room} filed under the vault (${filed.status()})`);
    }
    await eventually(async () => (await read()).places === 13, { label: "the vault's two rooms fold into it on the map" });
    await t.shot("vault-folded");
    const passage = visible(page.locator(`${root}button[aria-label^="Hollowroot Vault Entrance Passage"]`));
    await eventually(async () => /^\s*Entrance Passage/.test((await passage.textContent().catch(() => "")) ?? ""), { label: "the passage listed under the vault by its short name" });
  },
};
