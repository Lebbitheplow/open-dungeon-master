// WA-05: a workshop write that dies on the connection used to show nothing
// (most had no catch at all, so the press threw into the page and the form
// sat there as if it had worked). Now every one goes through readWrite
// (src/lib/load-state.ts). On desktop and phone, each request below is cut
// off here (route.abort) and must say so in an alert and keep what was
// typed, with no page error:
//
//   - Encounters' Prepare it, Storyboard's Add, Party's Add it, the
//     Storyboard's shared workshop picker and the Plugin tool's Start blank;
//   - a create whose answer is lost after the server made it (the request
//     goes through and the reply is cut) reads the list again and says it
//     was made, and the server holds exactly one, never two.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "workshop-write-failures",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const workshop = async (title) => {
      const made = await api.post(`${base}/api/workshops`, { data: { title, description: "" } });
      check(made.ok(), `the workshop ${title} (${made.status()})`);
      return (await made.json()).workshop;
    };
    const main = await workshop(`Write failures ${stamp}`);
    const shared = await workshop(`Shared cast ${stamp}`);
    const id = main.id;
    await api.post(`${base}/api/profile/tours`, {
      data: { finished: ["encounters", "storyboard", "party", "plugin"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) },
    });
    const campaign = `${base}/api/campaigns/${id}`;
    const alertWith = (text) => page.getByRole("alert").filter({ hasText: text }).locator("visible=true").first();
    const visible = (selector) => page.locator(`${root}${selector}`).locator("visible=true").first();
    // Cuts every request of one method to one address off before it leaves.
    const cut = (pattern, method) =>
      page.route(pattern, (route) => (route.request().method() === method ? route.abort("failed") : route.fallback()));
    // Lets the request reach the server, then cuts the reply off.
    const loseReply = (pattern, method) =>
      page.route(pattern, async (route) => {
        if (route.request().method() !== method) return route.fallback();
        await route.fetch();
        return route.abort("failed");
      });
    try {
      // ---- Encounters: Prepare it ----
      const templates = new RegExp(`/api/campaigns/${id}/dm/encounter-templates$`);
      const fightName = `Bandits at the ford ${stamp}`;
      const fights = async () => ((await (await api.get(`${campaign}/dm/encounter-templates`)).json()).templates ?? []).filter((entry) => entry.name === fightName);
      await t.open(`/workshop/${id}?system=encounters`);
      await eventually(() => visible('[data-tour="encounters-new"]').count(), { timeoutMs: 30_000, label: "the Encounters tool" });
      await t.tap(visible('[data-tour="encounters-new"]'));
      const fightField = page.getByRole("textbox", { name: "Encounter name" }).locator("visible=true").first();
      await eventually(() => fightField.count(), { label: "the encounter editor" });
      await fightField.fill(fightName);
      await page.getByRole("textbox", { name: "Roster" }).locator("visible=true").first().fill("bandit x3");
      await cut(templates, "POST");
      await t.tap(visible('[data-tour="encounters-save"]'));
      await eventually(() => alertWith("the fight is not in the list, so it was not prepared").count(), { timeoutMs: 20_000, label: "Prepare it saying the request never arrived" });
      check((await fightField.inputValue()) === fightName, "the roster's name is kept");
      check((await fights()).length === 0, "nothing was prepared");
      await untilStill(page);
      await t.shot("encounter-cut");
      // The request arrives and the reply is lost: the list is read again.
      await page.unroute(templates);
      await loseReply(templates, "POST");
      await t.tap(visible('[data-tour="encounters-save"]'));
      await eventually(() => page.getByText("Prepared. The server's answer was lost on the way").locator("visible=true").count(), { timeoutMs: 20_000, label: "Prepare it finding the fight it made" });
      check((await fights()).length === 1, `exactly one fight by that name (${(await fights()).length})`);
      await page.unroute(templates);

      // ---- Storyboard: Add, and the shared workshop ----
      const beats = new RegExp(`/api/campaigns/${id}/dm/storyboard$`);
      const cardTitle = `The miller's daughter ${stamp}`;
      const cards = async () => ((await (await api.get(`${campaign}/dm/storyboard`)).json()).board?.nodes ?? []).filter((node) => node.title === cardTitle);
      await t.open(`/workshop/${id}?system=storyboard`);
      const addRow = visible('[data-tour="storyboard-add"]');
      await eventually(() => addRow.count(), { timeoutMs: 30_000, label: "the Storyboard's add row" });
      const cardField = addRow.getByPlaceholder("The miller's daughter has not come home");
      await cardField.fill(cardTitle);
      await cut(beats, "POST");
      await t.tap(addRow.getByRole("button", { name: "Add" }));
      await eventually(() => alertWith("the card is not on the board, so it was not added").count(), { timeoutMs: 20_000, label: "Add saying the request never arrived" });
      check((await cardField.inputValue()) === cardTitle, "the card's words are kept");
      check((await cards()).length === 0, "no card was added");
      await page.unroute(beats);
      await loseReply(beats, "POST");
      await t.tap(addRow.getByRole("button", { name: "Add" }));
      await eventually(() => page.getByText("Added. The server's answer was lost on the way").locator("visible=true").count(), { timeoutMs: 20_000, label: "Add finding the card it made" });
      check((await cards()).length === 1, `exactly one card by that title (${(await cards()).length})`);
      await page.unroute(beats);

      const self = new RegExp(`/api/workshops/${id}$`);
      const drawsOn = page.getByRole("button", { name: "Draws on" }).locator("visible=true").first();
      await eventually(() => drawsOn.count(), { timeoutMs: 15_000, label: "the shared workshop picker" });
      await drawsOn.scrollIntoViewIfNeeded();
      await cut(self, "PATCH");
      await t.tap(drawsOn);
      await t.tap(page.getByRole("menuitemradio", { name: shared.title }).locator("visible=true").first());
      await eventually(() => alertWith("That could not be changed. The server could not be reached.").count(), { timeoutMs: 20_000, label: "the shared workshop saying the request never arrived" });
      const sharedNow = (await (await api.get(`${campaign}/dm/storyboard`)).json()).shared?.common ?? null;
      check(sharedNow === null, "the workshop draws on nothing shared");
      await untilStill(page);
      await t.shot("storyboard-cut");
      await page.unroute(self);

      // ---- Party: Add it ----
      const pregens = new RegExp(`/api/workshops/${id}/pregens$`);
      await t.open(`/workshop/${id}?system=party`);
      const partyAdd = visible('[data-tour="party-add"]');
      await eventually(() => partyAdd.count(), { timeoutMs: 30_000, label: "the Party tool" });
      const library = partyAdd.getByRole("button", { name: "A character from your library" });
      await eventually(() => library.isEnabled(), { timeoutMs: 15_000, label: "the library picker" });
      await t.tap(library);
      const option = page.getByRole("menuitemradio").locator("visible=true").first();
      await eventually(() => option.count(), { label: "a character in the library" });
      const picked = ((await option.innerText()).split("\n")[0] ?? "").trim();
      await t.tap(option);
      await cut(pregens, "POST");
      await t.tap(partyAdd.getByRole("button", { name: /Add it/ }));
      await eventually(() => alertWith("That did not work. The server could not be reached.").count(), { timeoutMs: 20_000, label: "Add it saying the request never arrived" });
      check((await library.innerText()).includes(picked), `the picked character is kept (${picked})`);
      const roster = ((await (await api.get(`${base}/api/workshops/${id}/pregens`)).json()).pregens ?? []).length;
      check(roster === 0, `nobody was filed (${roster})`);
      await page.unroute(pregens);

      // ---- Plugin: Start blank ----
      const draftUrl = `${base}/api/workshops/${id}/plugin`;
      const draftName = `Saltmarch ${stamp}`;
      const named = await api.put(draftUrl, { data: { draft: { ...(await (await api.get(draftUrl)).json()).draft, name: draftName } } });
      check(named.ok(), `a named pack draft (${named.status()})`);
      await t.open(`/workshop/${id}?system=plugin`);
      await eventually(() => visible('[data-tour="plugin-publish"]').count(), { timeoutMs: 30_000, label: "the Plugin tool" });
      await t.tap(visible('[data-tour="plugin-publish"]'));
      const blank = page.getByRole("button", { name: "Start blank" }).locator("visible=true").first();
      await eventually(() => blank.count(), { timeoutMs: 15_000, label: "Start blank" });
      await blank.scrollIntoViewIfNeeded();
      await cut(new RegExp(`/api/workshops/${id}/plugin$`), "DELETE");
      await t.tap(blank);
      await t.tap(page.getByRole("button", { name: "Throw it away" }));
      await eventually(() => alertWith("The draft could not be thrown away. The server could not be reached.").count(), { timeoutMs: 20_000, label: "Start blank saying the request never arrived" });
      check(/The draft on screen is kept/.test(await alertWith("The draft could not be thrown away").innerText()), "the refusal says the draft is kept");
      check(await page.getByText(draftName, { exact: true }).locator("visible=true").count(), "the draft is still on screen");
      check((await (await api.get(draftUrl)).json()).draft.name === draftName, "the server still holds the draft");
      await untilStill(page);
      await t.shot("plugin-cut");

      check(!t.fails.length, `no page error and no server failure: ${t.fails.join(" | ")}`);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${shared.id}`).catch(() => {});
    }
  },
};
