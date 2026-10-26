// WA-04: the Plugin tool's Download and Pull read the server's copy of the
// draft, and both used to go ahead after the save before them failed: the
// file held the older draft, and Pull put the older draft back on screen
// over the author's edit. Now, on desktop and phone, with the save refused
// (the PUT is answered 500 here):
//
//   - Download says the draft on screen is not saved, builds nothing (no
//     export request, no file), and keeps the edit;
//   - Pull says it waits for the save, pulls nothing (no pull request), and
//     the name on screen is the one typed;
//   - once the server takes the save, Download hands over the file named
//     for the typed name.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "plugin-export-after-refused-save",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Refused export ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-plugin", version: 1, how: "ended" }] } });
    const draftUrl = `${base}/api/workshops/${id}/plugin`;
    const stored = async () => (await (await api.get(draftUrl)).json()).draft;
    const draftRoute = new RegExp(`/api/workshops/${id}/plugin$`);
    // What the page asked the server to build or pull, and what it downloaded.
    const posts = { export: 0, pull: 0 };
    const downloads = [];
    const onRequest = (request) => {
      const where = new URL(request.url()).pathname;
      if (request.method() !== "POST") return;
      if (where === `/api/workshops/${id}/plugin/export`) posts.export += 1;
      if (where === `/api/workshops/${id}/plugin/pull`) posts.pull += 1;
    };
    const onDownload = (download) => downloads.push(download);
    page.on("request", onRequest);
    page.on("download", onDownload);
    try {
      // A draft ready to export, so a refusal below is the save's and not the checks'.
      const ready = { ...(await stored()), name: `Saltmarch ${stamp}`, blurb: "A harbour town under a chain.", inspiredBy: "My own.", theme: "Salt, lamplight and tolls." };
      const named = await api.put(draftUrl, { data: { draft: ready } });
      check(named.ok(), `a ready pack draft (${named.status()})`);
      const precheck = await api.post(`${draftUrl}/export`, { data: {} });
      check(precheck.ok(), `the seeded draft exports (${precheck.status()}: ${(await precheck.text()).slice(0, 200)})`);

      await t.open(`/workshop/${id}?system=plugin`);
      const name = page.getByRole("textbox", { name: /^Name \*/ }).locator("visible=true").first();
      await eventually(() => name.count(), { timeoutMs: 30_000, label: "the Plugin tool's Name field" });
      await page.route(draftRoute, (route) =>
        route.request().method() === "PUT" ? route.fulfill({ status: 500, json: { error: "The disk is full." } }) : route.fallback(),
      );
      const typed = "Unsaved new audit world";
      await name.fill(typed);

      // ---- Download after a refused save ----
      await t.tap(page.locator(`${root}[data-tour="plugin-publish"]`).locator("visible=true").first());
      const download = page.getByRole("button", { name: "Download the pack" }).locator("visible=true").first();
      await eventually(() => download.isEnabled(), { timeoutMs: 15_000, label: "Download the pack, ready" });
      await t.tap(download);
      const notBuilt = page.getByRole("alert").filter({ hasText: "nothing was built from the older copy" }).locator("visible=true").first();
      await eventually(() => notBuilt.count(), { timeoutMs: 20_000, label: "Download saying the draft is not saved" });
      check(posts.export === 0, `nothing was asked to be built (${posts.export} export requests)`);
      check(downloads.length === 0, "no file was downloaded");
      check((await stored()).name === `Saltmarch ${stamp}`, "the server still holds the older draft");
      await untilStill(page);
      await t.shot("download-refused");

      // ---- Pull after a refused save ----
      await t.tap(page.locator(`${root}[data-tour="plugin-pull"]`).locator("visible=true").first());
      const notPulled = page.getByRole("alert").filter({ hasText: "Pull waits for the draft to save" }).locator("visible=true").first();
      await eventually(() => notPulled.count(), { timeoutMs: 20_000, label: "Pull saying it waits for the save" });
      check(posts.pull === 0, `nothing was pulled (${posts.pull} pull requests)`);
      await eventually(() => page.getByText(typed, { exact: true }).locator("visible=true").count(), { label: "the typed name still on screen" });
      check(await page.getByText("An unnamed world").count() === 0, "the header still names the world");
      await untilStill(page);
      await t.shot("pull-refused");

      // ---- the server takes the save: Download hands over the typed draft ----
      await page.unroute(draftRoute);
      // Inside the apps the page hands the file to the app's download relay
      // (the client's download shim), which this rig has no native side for:
      // there the pack is read from the export's answer (as 86 does).
      const file = t.app ? null : page.waitForEvent("download", { timeout: 30_000 });
      const built = page.waitForResponse((response) => /\/plugin\/export$/.test(new URL(response.url()).pathname), { timeout: 30_000 });
      await t.tap(download);
      const answer = await built;
      check(answer.ok(), `the export answered ${answer.status()}`);
      if (file) {
        const got = await file;
        check(got.suggestedFilename() === "unsaved_new_audit_world.json", `the file is named for the typed name (${got.suggestedFilename()})`);
      } else {
        const pack = await answer.json().catch(() => ({}));
        const name = pack.pack?.name ?? pack.name;
        check(name === typed, `the pack built is the typed draft (${name})`);
      }
      check(posts.export === 1, `one build once saved (${posts.export})`);
      check((await stored()).name === typed, "the server holds the typed name");

      // The 500s above were this scenario's own answers, not the server's.
      for (let index = t.fails.length - 1; index >= 0; index -= 1) {
        if (t.fails[index].includes(`/api/workshops/${id}/plugin`) && t.fails[index].startsWith("status 500")) t.fails.splice(index, 1);
      }
    } finally {
      page.off("request", onRequest);
      page.off("download", onDownload);
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
