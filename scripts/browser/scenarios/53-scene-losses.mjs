// WF-19: a narrative conversion of the storyboard names, scene by scene,
// what it cannot carry, before anything is written. Saving as a WorldForge
// file first lists what each card would lose (here a hook's kind and a
// choice between two routes) and downloads nothing until the author says
// so. Opening a WorldForge file lists what each scene would lose as a card
// (the fixture's opening scene has a cast beyond its point of view) and
// brings nothing in until the author says so.
import fs from "node:fs";
import { check, eventually } from "../lib.mjs";

const FIXTURE = new URL("../../fixtures/worldforge-saltmarch.json", import.meta.url);

export default {
  name: "scene-losses",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Scenes named first", description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const board = `${base}/api/campaigns/${id}/dm/storyboard`;
    const cards = async () => ((await (await api.get(board)).json()).board?.nodes ?? []).length;
    try {
      // A hook leading to a fork with two routes: a WorldForge file holds
      // scenes in a line, so the hook's kind and the second route are lost.
      const add = async (data) => (await (await api.post(board, { data })).json()).beat.id;
      const hook = await add({ kind: "hook", title: "The summons", body: "A letter with the warden's seal." });
      const guild = await add({ kind: "event", title: "Side with the guild", body: "" });
      const wardens = await add({ kind: "event", title: "Trust the wardens", body: "" });
      const routed = await api.patch(`${board}/${hook}`, {
        data: {
          kind: "hook",
          title: "The summons",
          body: "A letter with the warden's seal.",
          edges: [guild, wardens],
          routes: { [guild]: { kind: "choice", label: "if they side with the guild" }, [wardens]: { kind: "choice", label: "if they trust the wardens" } },
        },
      });
      check(routed.ok(), `the routes were drawn: ${routed.status()}`);

      await t.open(`/workshop/${id}?system=world`);
      const save = page.locator(`${root}button`, { hasText: "Save as a WorldForge file" }).first();
      await eventually(() => save.count(), { timeoutMs: 30_000, label: "the save button" });
      let downloads = 0;
      page.on("download", () => {
        downloads += 1;
      });
      await save.click();
      const held = page.locator(`${root}[data-testid="world-export-losses"]`);
      await eventually(() => held.count(), { timeoutMs: 20_000, label: "the export's losses" });
      const said = await held.innerText();
      check(/“The summons” loses/.test(said), `the hook is named: ${JSON.stringify(said.slice(0, 300))}`);
      check(/its kind, “A reason to go”/.test(said), "the hook's kind is named");
      check(/its arrow to “Trust the wardens” \(One route of several: “if they trust the wardens”\)/.test(said), "the lost route is named");
      check(/workshop bundle carries the whole adventure/.test(said), "the bundle is offered for the whole adventure");
      check(downloads === 0, "the file downloaded before the author agreed");
      // The list pops in: the picture waits until it has.
      await eventually(() => held.evaluate((element) => element.getAnimations().every((animation) => animation.playState === "finished")), { timeoutMs: 5_000, label: "the list settled" });
      await t.shot("export-held");
      await held.getByRole("button", { name: "Cancel" }).click();
      await eventually(async () => (await held.count()) === 0, { timeoutMs: 10_000, label: "the list closed" });

      // The other way: a file whose scene names more cast than a card can.
      const file = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
      delete file.media.entityImages.e_mira;
      const input = page.locator(`${root}input[type="file"][accept*="json"]`).first();
      await input.setInputFiles({ name: "saltmarch.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
      const incoming = page.locator(`${root}[data-testid="world-import-losses"]`);
      await eventually(() => incoming.count(), { timeoutMs: 20_000, label: "the import's losses" });
      const scene = incoming.locator('[data-testid="scene-loss"]', { hasText: "The Missing Codes" });
      await eventually(() => scene.count(), { timeoutMs: 10_000, label: "the scene's own losses" });
      check(/its cast beyond its point of view: “Mira Fenn”/.test(await scene.innerText()), "the scene's cast is named");
      check((await cards()) === 3, "a card was written before the author agreed");
      await eventually(() => incoming.evaluate((element) => element.getAnimations().every((animation) => animation.playState === "finished")), { timeoutMs: 5_000, label: "the list settled" });
      await t.shot("import-held");
      await incoming.getByRole("button", { name: "Bring it in anyway" }).click();
      await eventually(async () => (await cards()) === 5, { timeoutMs: 20_000, label: "the scenes brought in" });
      // Each card the file brought names the world and scene it came from.
      const origins = Object.values((await (await api.get(board)).json()).origins ?? {});
      check(origins.length === 2 && origins.every((origin) => origin.kind === "worldforge" && origin.world === "The Saltmarch"), `the scenes' origins: ${JSON.stringify(origins)}`);
    } finally {
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};
