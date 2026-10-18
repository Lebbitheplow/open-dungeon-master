// PR 379 review: the Story AI panel's typed fields follow what another
// window saves. With the panel open in two windows, a Custom art style and
// its two texts picked in one left the other's fields empty, and focusing
// and leaving them there saved the emptiness back over the new texts. The
// untouched fields now show what was saved and send nothing; a field
// someone is typing into keeps their words while the other field, or the
// same one, changes elsewhere, and those words are what its commit saves.
// The rule itself is scripts/test-setting-drafts.mjs.
import { check, eventually, openPanelTab, sleep } from "../lib.mjs";

const FIELDS = ["imageGenerationEnabled", "imageBackend", "artStyle", "artStyleMap", "artStyleScene"];

export default {
  name: "story-settings-drafts",
  viewports: ["desktop"],
  async run(t) {
    const { page, base, ids, api, root } = t;
    const route = `${base}/api/campaigns/${ids.campaignId}/story-settings`;
    const saved = async () => (await (await api.get(route)).json()).settings;
    const save = async (update, what) => check((await api.patch(route, { data: update })).ok(), `${what} saved elsewhere`);
    const before = await saved();
    const restore = Object.fromEntries(FIELDS.map((field) => [field, before[field]]));
    await save({ imageGenerationEnabled: true, imageBackend: "comfyui", artStyle: "setting", artStyleMap: "", artStyleScene: "" }, "a table that paints in the setting's own look");

    // Window A, and window B beside it, each on the Story AI panel.
    const other = await page.context().newPage();
    const b = { ...t, page: other };
    const panelOf = async (w) => {
      await openPanelTab(w, "settings");
      const panel = w.page.locator(`${root}#ss-ai`).locator("visible=true").first();
      await eventually(() => panel.getByRole("button", { name: "Art style" }).count(), { timeoutMs: 30_000, label: "the Art style choice" });
      await panel.scrollIntoViewIfNeeded();
      return panel;
    };
    const patchesFrom = (p) => {
      const sent = [];
      p.on("request", (request) => {
        if (request.method() === "PATCH" && request.url().endsWith("/story-settings")) sent.push(request.postData() ?? "");
      });
      return sent;
    };
    try {
      await t.open(`/campaigns/${ids.campaignId}`);
      const a = await panelOf(t);
      const sentByA = patchesFrom(page);
      await other.goto(`${base}/campaigns/${ids.campaignId}`, { waitUntil: "networkidle", timeout: 120_000 });
      const panelB = await panelOf(b);
      check((await a.locator('input[aria-label="Map style"]').count()) === 0, "window A opens on the setting's own look, with no custom fields");

      // Window B: Custom, and both texts typed and committed.
      await panelB.getByRole("button", { name: "Art style" }).click();
      await other.getByRole("menuitemradio", { name: "Custom" }).locator("visible=true").first().click();
      const mapB = panelB.locator('input[aria-label="Map style"]');
      await eventually(() => mapB.count(), { label: "window B's custom fields" });
      await mapB.fill("realistic terrain");
      await mapB.press("Enter");
      const sceneB = panelB.locator('input[aria-label="Scene style"]');
      await sceneB.fill("grainy film photograph");
      await sceneB.press("Enter");
      await eventually(async () => (await saved()).artStyleScene === "grainy film photograph", { label: "window B's texts saved" });

      // Window A follows: Custom, with both texts showing.
      const map = a.locator('input[aria-label="Map style"]');
      const scene = a.locator('input[aria-label="Scene style"]');
      await eventually(async () => (await map.count()) > 0 && (await map.inputValue()) === "realistic terrain", { label: "window A's map field showing window B's text" });
      await eventually(async () => (await scene.inputValue()) === "grainy film photograph", { label: "window A's scene field showing window B's text" });
      await t.shot("followed");

      // Focusing and leaving window A's untouched fields saves nothing.
      await scene.focus();
      await map.focus();
      await map.blur();
      await sleep(1_500);
      check(sentByA.length === 0, `window A sent nothing for fields nobody typed into (sent ${sentByA.join(" | ")})`);
      let now = await saved();
      check(now.artStyleMap === "realistic terrain" && now.artStyleScene === "grainy film photograph", `both texts survive (map "${now.artStyleMap}", scene "${now.artStyleScene}")`);

      // Typing into the map in A while B changes the scene: A keeps its
      // words, the scene follows, and committing saves only the map.
      await map.fill("ink wash");
      await sceneB.fill("oil on canvas");
      await sceneB.press("Enter");
      await eventually(async () => (await scene.inputValue()) === "oil on canvas", { label: "window A's scene following while its map is typed into" });
      check((await map.inputValue()) === "ink wash", "window A's unsaved map words are kept");
      await map.press("Enter");
      await eventually(async () => (await saved()).artStyleMap === "ink wash", { label: "window A's map words saved" });
      now = await saved();
      check(now.artStyleScene === "oil on canvas", `the scene window B saved is kept (${now.artStyleScene})`);
      await eventually(async () => (await mapB.inputValue()) === "ink wash", { label: "window B's map following window A's commit" });

      // The same field changed in both: the words typed and committed last win.
      await scene.fill("watercolour");
      await save({ artStyleScene: "pencil" }, "the scene");
      await sleep(1_500);
      check((await scene.inputValue()) === "watercolour", "words being typed are not replaced under the typist");
      await scene.press("Enter");
      await eventually(async () => (await saved()).artStyleScene === "watercolour", { label: "the typist's commit saved" });

      // A preset and back: the custom texts changed meanwhile are the ones shown.
      await save({ artStyle: "painted" }, "a preset");
      await eventually(async () => (await map.count()) === 0, { label: "window A's custom fields gone under a preset" });
      await save({ artStyleMap: "chalk lines" }, "a map text under the preset");
      await panelB.getByRole("button", { name: "Art style" }).click();
      await other.getByRole("menuitemradio", { name: "Custom" }).locator("visible=true").first().click();
      await eventually(async () => (await map.count()) > 0 && (await map.inputValue()) === "chalk lines", { label: "window A back on Custom with the newest map text" });
      check((await scene.inputValue()) === "watercolour", "and the scene text it already had");

      // A reload shows the same.
      await t.reload();
      const reloaded = await panelOf(t);
      await eventually(async () => (await reloaded.locator('input[aria-label="Map style"]').inputValue()) === "chalk lines", { label: "the map text after a reload" });
      check((await reloaded.locator('input[aria-label="Scene style"]').inputValue()) === "watercolour", "the scene text after a reload");
    } finally {
      await other.close().catch(() => {});
      await api.patch(route, { data: restore });
    }
  },
};
