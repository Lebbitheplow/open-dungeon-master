// PR 381 follow-up: the save does not judge again a feat the stored
// character already held, and the builder's pickers now agree. Sable's
// Dexterity is 8 and both her feats want 13: taken off its card, each can be
// put back from the search and from "Browse every feat", the race's feat on
// the Ancestry step and the improvement's on Ability scores, and the
// edit saves. A feat she never held is still refused while she falls short.
import { check, eventually, sleep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}a, ${root}button`).filter({ hasText: text }).locator("visible=true");

export default {
  name: "held-feats",
  viewports: ["desktop"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    await t.open(`/characters/${ids.heldFeats}`);
    await t.tap(await eventually(async () => {
      const edit = visible(page, root, /^\s*Edit build\s*$/);
      return (await edit.count()) ? edit.first() : null;
    }, { label: "the Edit build button" }));
    await page.locator(`${root}[data-finish-summary]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });

    const goTo = async (label) => {
      const diamond = page.locator(`${root}button[aria-label$=": ${label}"]`).locator("visible=true").first();
      await eventually(() => diamond.count(), { label: `the ${label} step's diamond` });
      await t.tap(diamond);
      const current = page.locator(`${root}button[aria-current="step"]`).locator("visible=true").first();
      await eventually(async () => (await current.getAttribute("aria-label"))?.endsWith(`: ${label}`), { label: `on the ${label} step` });
    };
    const searched = async (scope, query, name) => {
      await scope.getByPlaceholder("Search feats (e.g. alert, tough)").fill(query);
      const row = scope.locator("li button").filter({ hasText: name }).locator("visible=true").first();
      await eventually(() => row.count(), { label: `${name} in the search` });
      return row;
    };
    const browsed = async (scope, query, name) => {
      await t.tap(scope.getByRole("button", { name: "Browse every feat" }).first());
      await scope.getByLabel("Narrow the browsed list").fill(query);
      // The list's one section opens when pressed, as its other rows do.
      const section = scope.getByRole("button", { name: "All feats" }).locator("visible=true").first();
      await eventually(() => section.count(), { label: "the All feats section" });
      if ((await section.getAttribute("aria-expanded")) !== "true") await t.tap(section);
      const row = scope.locator("li button").filter({ hasText: name }).locator("visible=true").first();
      await eventually(() => row.count(), { label: `${name} in the browsed list` });
      return row;
    };
    // Off its card (where a feat never held is still refused), back from
    // the search, off again, back from the list.
    const putBack = async (scope, name, query, never, neverQuery) => {
      const remove = scope.getByRole("button", { name: `Remove ${name}` });
      await eventually(() => remove.count(), { label: `${name} on its card` });
      await t.tap(remove.first());
      await refused(scope, never, neverQuery);
      const fromSearch = await searched(scope, query, name);
      check((await fromSearch.getAttribute("aria-disabled")) === null, `${name}, held, is offered again in the search`);
      await t.tap(fromSearch);
      await eventually(() => remove.count(), { label: `${name} back on its card from the search` });
      await t.tap(remove.first());
      const fromList = await browsed(scope, query, name);
      check((await fromList.getAttribute("aria-disabled")) === null, `${name}, held, is offered again in the browsed list`);
      await t.tap(fromList);
      await eventually(() => remove.count(), { label: `${name} back on its card from the list` });
    };
    const refused = async (scope, name, query) => {
      const row = await searched(scope, query, name);
      check((await row.getAttribute("aria-disabled")) === "true", `${name}, never held, is still refused`);
      await scope.getByPlaceholder("Search feats (e.g. alert, tough)").fill("");
    };

    // The race's feat.
    await goTo("Ancestry");
    const racial = page.locator(`${root}[data-builder-target="racialFeat"]`).locator("visible=true").first();
    await racial.scrollIntoViewIfNeeded();
    await putBack(racial, "Skulker", "Skulk", "Inspiring Leader", "Inspiring");
    await t.shot("racial-feat");

    // The improvement's feat.
    await goTo("Abilities");
    const improvement = page.locator(root ? root.trim() : "body").first();
    await putBack(improvement, "Defensive Duelist", "Defensive", "Inspiring Leader", "Inspiring");
    await t.shot("improvement-feat");

    // The edit saves, both feats kept and the scores as they were.
    const save = visible(page, root, /^Save changes$/);
    await eventually(async () => (await save.count()) > 0 && (await save.first().isEnabled()), { label: "Save changes" });
    await t.tap(save.first());
    await sleep(500);
    await eventually(async () => {
      const response = await api.get(`${base}/api/characters/${ids.heldFeats}`);
      const sheet = (await response.json()).character?.sheet;
      return sheet && sheet.feats.includes("Skulker") && sheet.feats.includes("Defensive Duelist") && sheet.abilities.dex === 8 && (await t.url()).pathname.includes(`/characters/${ids.heldFeats}`) && !(await page.url()).includes("/edit");
    }, { timeoutMs: 30_000, label: "the edit saved with both held feats" });
  },
};
