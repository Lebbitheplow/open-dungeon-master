// WA-03: the Plugin tool saves itself, and leaving it inside the autosave
// pause used to cancel the save and drop the last edit without a word (it
// registered nothing with the workshop's leave check). Now, on desktop and
// phone:
//
//   - a name typed and a switch to Party at once moves on with no question,
//     and the server holds the name;
//   - with the save refused (the PUT is answered 500 here), the switch asks
//     before leaving; staying keeps the typed name with the refusal
//     announced, and Try again saves it once the server takes it.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "plugin-save-contract",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Save contract ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["plugin", "party"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });
    const draftUrl = `${base}/api/workshops/${id}/plugin`;
    const stored = async () => (await (await api.get(draftUrl)).json()).draft;
    const params = async () => (await t.url()).searchParams;
    const draftRoute = new RegExp(`/api/workshops/${id}/plugin$`);
    try {
      // A named draft, so the tool opens on its tabs rather than the guide.
      const named = await api.put(draftUrl, { data: { draft: { ...(await stored()), name: `Saltmarch ${stamp}` } } });
      check(named.ok(), `a named pack draft (${named.status()})`);

      await t.open(`/workshop/${id}?system=plugin`);
      const name = page.getByRole("textbox", { name: /^Name \*/ }).locator("visible=true").first();
      await eventually(() => name.count(), { timeoutMs: 30_000, label: "the Plugin tool's Name field" });
      const tab = (system) => page.locator(`${root}[data-tour="system-tab-${system}"]`).locator("visible=true").first();
      const ask = page.getByRole("dialog", { name: "Leave without saving?" });

      // ---- a switch inside the autosave pause ----
      const quick = `Quick switch ${stamp}`;
      const started = Date.now();
      await name.fill(quick);
      await t.tap(tab("party"));
      const pressed = Date.now() - started;
      check(pressed < 700, `the switch came inside the 700 ms autosave pause (${pressed} ms)`);
      await eventually(async () => (await params()).get("system") === "party", { timeoutMs: 15_000, label: "the move to Party" });
      check(!(await ask.isVisible().catch(() => false)), "a draft that saved on the way out was asked about");
      const afterSwitch = (await stored()).name;
      check(afterSwitch === quick, `the last edit reached the server (${afterSwitch})`);

      // ---- a save the server refuses ----
      await t.tap(tab("plugin"));
      await eventually(async () => (await name.count()) && (await name.inputValue()) === quick, { timeoutMs: 30_000, label: "the Plugin tool again, with the saved name" });
      await page.route(draftRoute, (route) =>
        route.request().method() === "PUT" ? route.fulfill({ status: 500, json: { error: "The disk is full." } }) : route.fallback(),
      );
      const refused = `Refused save ${stamp}`;
      await name.fill(refused);
      await t.tap(tab("party"));
      await eventually(() => ask.isVisible(), { timeoutMs: 20_000, label: "the question before leaving a draft that did not save" });
      await untilStill(page);
      await t.shot("refused-ask");
      await t.tap(ask.getByRole("button", { name: "Cancel" }));
      await eventually(async () => !(await ask.isVisible().catch(() => false)), { label: "the question closed" });
      check((await params()).get("system") === "plugin", "staying kept the author in the Plugin tool");
      check((await name.inputValue()) === refused, "staying kept the typed name");
      const alert = page.getByRole("alert").filter({ hasText: "The disk is full." }).locator("visible=true").first();
      await eventually(() => alert.count(), { timeoutMs: 15_000, label: "the refusal, announced" });
      check(/Your changes are kept here/.test(await alert.innerText()), "the refusal says the changes are kept");
      const retry = alert.getByRole("button", { name: "Try again" });
      // The kit's own Try again: finger-sized where a finger presses it.
      if (t.touch) {
        const size = await retry.boundingBox();
        check(size && size.height >= 40, `Try again is a 40px target on a phone (${size?.height}px)`);
      }
      await untilStill(page);
      await t.shot("refused-kept");
      check((await stored()).name === quick, "the refused name did not reach the server");

      // Try again once the server takes it.
      await page.unroute(draftRoute);
      await t.tap(retry);
      await eventually(async () => (await stored()).name === refused, { timeoutMs: 15_000, label: "Try again saving the name" });
      await eventually(async () => (await alert.count()) === 0, { timeoutMs: 15_000, label: "the refusal gone once saved" });
      await t.tap(tab("party"));
      await eventually(async () => (await params()).get("system") === "party", { timeoutMs: 15_000, label: "moving on once saved" });
      check(!(await ask.isVisible().catch(() => false)), "a saved draft was asked about");

      // The 500s above were this scenario's own answers, not the server's.
      for (let index = t.fails.length - 1; index >= 0; index -= 1) {
        if (t.fails[index].includes(`/api/workshops/${id}/plugin`) && t.fails[index].startsWith("status 500")) t.fails.splice(index, 1);
      }
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
