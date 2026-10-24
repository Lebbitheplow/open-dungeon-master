// M6 journey (audit WF-23): a source updated and a campaign edited, then
// brought in again. A workshop's world holds Ferryman Osk; the lead brings
// it into a campaign in play through the Settings tab's Bring in prep. At
// the table, the World tab's entry form (by keyboard) changes Osk's article
// and adds the lead's notes. Back in the workshop, the author changes the
// same entry's hidden truth, and its article too, which the campaign also
// changed. Bring in prep again, from the same workshop. The finish:
//   - the source's change the campaign never touched applies: the hidden
//     truth at the table is the workshop's new one;
//   - the campaign's own edits stand: its article and its notes;
//   - the conflict (both sides changed the article) is reported where the
//     author reads it: the import's note names the entry and the field;
//   - the author can review and reverse it: the entry's page says the
//     campaign's article was kept and shows the import's, with "Use the
//     import's version" and "Keep mine"; the entry form offers the import's
//     version too. Using it puts the import's article on the page, and
//     "Restore mine" puts the campaign's back (src/lib/worldforge/
//     import-kept.ts). Bring in prep still says the article was kept after
//     a reload, and a further import of the same workshop says it again,
//     both read from the entry's own record of it.
//
// The single steps are proven elsewhere: the import picker in
// 43-world-use-in-campaign and 27-setup-prep-and-end, the campaign's World
// tab in 47-world-at-table, an entry form's clash with another author in
// 35-entry-conflict. The merge rules themselves are
// src/lib/worldforge/import-merge.ts and its unit tests. No model is
// involved: the run's server has no storyteller, so the lead runs the
// campaign as its DM.
//
// Set up through the API, since none of it is the journey: the workshop's
// entry as first written, and a campaign in play (made, the player joined
// with a ready-made hero, both ready, started), which the World tab needs.
// The campaign, the player's hero and the workshop are removed at the end.
import { check, eventually, openPanelTab, signIn } from "../lib.mjs";

// What the browser's focus is on, for the keyboard steps.
const focused = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName ?? "",
      text: (element?.textContent ?? "").trim().slice(0, 80),
      tour: element?.getAttribute("data-tour") ?? "",
      type: element?.getAttribute("type") ?? "",
      field: (element?.closest("label")?.querySelector("span")?.textContent ?? "").trim(),
    };
  });

// Tab forward until `test` holds for the focused element.
async function tabTo(page, test, label, max = 60) {
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press("Tab");
    if (test(await focused(page))) return;
  }
  throw new Error(`Tab never reached ${label} (last: ${JSON.stringify(await focused(page))})`);
}

// Bring in prep from the Settings tab: the workshop, then Bring it in.
// Returns the note the picker leaves.
async function bringIn(t, title, { before } = {}) {
  const { page, root } = t;
  await openPanelTab(t, "settings");
  const prep = page.locator(`${root}[data-setup-prep]`).locator("visible=true").first();
  await eventually(() => prep.count(), { timeoutMs: 20_000, label: "Bring in prep in the Settings tab" });
  await prep.scrollIntoViewIfNeeded();
  await t.tap(prep.getByRole("button", { name: "Start from" }));
  await t.tap(page.getByRole("menuitemradio", { name: title }).locator("visible=true").first());
  const bring = prep.getByRole("button", { name: /Bring it in/ });
  await eventually(() => bring.isEnabled(), { timeoutMs: 20_000, label: "Bring it in enabled" });
  if (before) await before(prep);
  await t.tap(bring);
  const note = prep.getByText(/Brought \d+ items? across/);
  await eventually(() => note.count(), { timeoutMs: 30_000, label: "the import's note" });
  return { prep, note: await note.innerText() };
}

export default {
  name: "journey-reimport",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api, ids } = t;
    const stamp = Date.now().toString(36);
    const workshopTitle = `Ferry crossing ${stamp}`;
    const name = "Ferryman Osk";
    const words = {
      article: "Osk poles the ferry across the Grey at dusk and asks no names.",
      truth: "He owes the river hag a drowned man a year.",
      oursArticle: "Osk poles the ferry across the Grey at dusk. Since the party saved his son he waives their fare.",
      oursNotes: "Our table: the son is called Pell.",
      theirsArticle: "Osk poles the ferry across the Grey by lantern light and charges double after dark.",
      theirsTruth: "He sold his shadow to the river hag for safe crossings.",
    };
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });

    // ---- set up: the workshop's entry, and a campaign in play ----
    const made = await api.post(`${base}/api/workshops`, { data: { title: workshopTitle, description: "" } });
    check(made.ok(), `a workshop with a world (${made.status()})`);
    const workshopId = (await made.json()).workshop.id;
    const workshop = `${base}/api/campaigns/${workshopId}`;
    let campaignId = "";
    let playerHero = "";
    const playerContext = await page.context().browser().newContext();
    try {
      const created = await api.post(`${workshop}/world/entities`, { data: { typeId: "t_character", name, tagline: "The ferryman at Greyford." } });
      check(created.ok(), `the workshop's entry (${created.status()})`);
      const sourceRef = (await created.json()).entity.ref;
      const written = await api.patch(`${workshop}/world/entities/${encodeURIComponent(sourceRef)}`, { data: { article: words.article, hiddenTruth: words.truth } });
      check(written.ok(), `its article and hidden truth (${written.status()})`);

      // The run's server has no storyteller, so a new campaign is the lead's
      // to run as its DM (src/app/api/campaigns/route.ts); the player joins
      // with a ready-made hero so the table can start.
      const table = await api.post(`${base}/api/campaigns`, { data: { title: `Greyford table ${stamp}`, gameSettings: { ttsEnabled: false } } });
      check(table.ok(), `a campaign (${table.status()})`);
      campaignId = (await table.json()).campaign.id;
      const campaign = `${base}/api/campaigns/${campaignId}`;
      const { inviteCode } = await (await api.post(`${campaign}/invite`)).json();
      await signIn(playerContext, base, ids.player, ids.password);
      const player = playerContext.request;
      check((await player.post(`${base}/api/campaigns/join`, { data: { inviteCode } })).ok(), "the player joins");
      const seated = await player.post(`${campaign}/sheet/pregen`, { data: { id: "brakk" } });
      check(seated.ok(), `the player's ready-made hero (${seated.status()})`);
      playerHero = (await seated.json()).sheet?.libraryCharacterId ?? "";
      check((await player.post(`${campaign}/ready`, { data: { ready: true } })).ok(), "the player ready");
      check((await api.post(`${campaign}/ready`, { data: { ready: true } })).ok(), "the DM ready");
      const started = await api.patch(campaign, { data: { status: "active" } });
      check(started.ok(), `the campaign in play (${started.status()} ${(await started.text()).slice(0, 160)})`);
      const entryAtTable = async () => {
        const world = await (await api.get(`${campaign}/world`)).json();
        return (world.entities ?? []).find((entity) => entity.name === name) ?? null;
      };

      // ---- the first import ----
      await t.open(`/campaigns/${campaignId}`);
      const first = await bringIn(t, workshopTitle);
      check(!/kept your/.test(first.note), `a first import has nothing to keep: ${first.note}`);
      const brought = await eventually(entryAtTable, { label: `${name} at the table` });
      check(brought.entry?.article === words.article && brought.entry?.hiddenTruth === words.truth, "the entry arrived as the workshop wrote it");

      // ---- the campaign's own edit, by keyboard in the World tab's form ----
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab" });
      const option = panel.getByRole("option", { name: new RegExp(name) }).first();
      await eventually(() => option.count(), { timeoutMs: 20_000, label: `${name} in the wiki` });
      await option.scrollIntoViewIfNeeded();
      await t.tap(option);
      const heading = panel.locator('[data-tour="world-entry"] h3', { hasText: name }).first();
      await eventually(() => heading.isVisible(), { label: "the entry's page" });
      await heading.click();
      await tabTo(page, (element) => element.tour === "world-edit", "the entry's Edit", 30);
      await page.keyboard.press("Enter");
      const form = panel.locator("form").filter({ has: page.locator("input[required]") }).first();
      await eventually(() => form.isVisible(), { timeoutMs: 15_000, label: "the entry form" });
      await tabTo(page, (element) => element.tag === "TEXTAREA" && element.field === "Article", "the Article field");
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(words.oursArticle);
      await tabTo(page, (element) => element.tag === "TEXTAREA" && element.field === "Author's notes", "the Author's notes field");
      await page.keyboard.type(words.oursNotes);
      await tabTo(page, (element) => element.tag === "BUTTON" && element.type === "submit", "Save");
      await page.keyboard.press("Enter");
      await eventually(async () => !(await form.isVisible().catch(() => false)), { timeoutMs: 15_000, label: "the form closed after saving" });
      const ours = await eventually(async () => {
        const entity = await entryAtTable();
        return entity?.entry?.article === words.oursArticle && entity?.entry?.notes === words.oursNotes ? entity : null;
      }, { label: "the campaign's edit saved" });
      check(ours.entry.hiddenTruth === words.truth, "the hidden truth untouched at the table");
      await t.shot("ours");

      // ---- the source's update, in the workshop's form ----
      await t.open(`/workshop/${workshopId}?system=world&entry=${encodeURIComponent(sourceRef)}`);
      await eventually(() => page.locator(`${root}[data-tour="world-entry"] h3`, { hasText: name }).count(), { timeoutMs: 30_000, label: "the workshop's entry" });
      await t.tap(page.locator(`${root}[data-tour="world-edit"]`).locator("visible=true").first());
      const sourceForm = page.locator(`${root}form`).filter({ has: page.locator("input[required]") }).locator("visible=true").first();
      await eventually(() => sourceForm.count(), { timeoutMs: 15_000, label: "the workshop's entry form" });
      await sourceForm.getByLabel(/^Article/).fill(words.theirsArticle);
      await sourceForm.getByLabel(/^Hidden truth/).fill(words.theirsTruth);
      await t.tap(sourceForm.locator('button[type="submit"]'));
      await eventually(async () => (await sourceForm.count()) === 0, { timeoutMs: 15_000, label: "the workshop's form closed after saving" });
      const source = (await (await api.get(`${workshop}/world`)).json()).entities.find((entity) => entity.ref === sourceRef);
      check(source.entry.article === words.theirsArticle && source.entry.hiddenTruth === words.theirsTruth, "the workshop's entry changed");

      // ---- the reimport ----
      await t.open(`/campaigns/${campaignId}`);
      const again = await bringIn(t, workshopTitle, {
        before: async (prep) => {
          // The picker says what an earlier import brought, and that it is
          // kept as the campaign has it.
          await eventually(async () => /came in from here before and stays? as this campaign has/.test(await prep.innerText()), { timeoutMs: 15_000, label: "the plan naming what came in before" });
          const choice = prep.getByRole("button", { name: "Already brought in before" });
          check((await choice.innerText()).includes("Keep them as this campaign has them"), `kept as the campaign has them by default: ${JSON.stringify(await choice.innerText())}`);
        },
      });
      await t.shot("reimported");

      // ---- the finish ----
      const after = await entryAtTable();
      check(after.entry.hiddenTruth === words.theirsTruth, `the source's change the campaign never touched applies: ${JSON.stringify(after.entry.hiddenTruth)}`);
      check(after.entry.article === words.oursArticle, `the campaign's article stands: ${JSON.stringify(after.entry.article)}`);
      check(after.entry.notes === words.oursNotes, `the campaign's notes stand: ${JSON.stringify(after.entry.notes)}`);
      const worlds = (await (await api.get(`${campaign}/world`)).json()).entities.filter((entity) => entity.name.startsWith(name));
      check(worlds.length === 1, `still one ${name} at the table: ${JSON.stringify(worlds.map((entity) => entity.name))}`);
      // The conflict, where the author reads it: the import's note.
      check(again.note.includes(`${name}: kept your article over the import's.`), `the import's note names the conflict: ${JSON.stringify(again.note)}`);

      // At the table, the World tab shows both outcomes.
      await openPanelTab(t, "world");
      const tablePanel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => tablePanel.count(), { timeoutMs: 30_000, label: "the World tab again" });
      // The tab comes back on the entry it had open, or on its list.
      const reopened = tablePanel.getByRole("option", { name: new RegExp(name) }).first();
      const openHeading = tablePanel.locator('[data-tour="world-entry"] h3', { hasText: name }).first();
      await eventually(async () => (await openHeading.isVisible().catch(() => false)) || (await reopened.count()) > 0, { timeoutMs: 20_000, label: `${name} in the World tab again` });
      if (!(await openHeading.isVisible().catch(() => false))) {
        await reopened.scrollIntoViewIfNeeded();
        await t.tap(reopened);
      }
      const entryPage = tablePanel.locator('[data-tour="world-entry"]').first();
      await eventually(async () => {
        const text = await entryPage.innerText().catch(() => "");
        return text.includes(words.oursArticle) && text.includes(words.theirsTruth);
      }, { timeoutMs: 20_000, label: "the entry's page with the campaign's article and the source's hidden truth" });
      await t.shot("entry-after");

      // Review and reverse: the entry says what the reimport kept, and shows
      // the import's version with the two ways out.
      const kept = entryPage.locator('[data-testid="import-kept"]');
      await eventually(() => kept.isVisible(), { timeoutMs: 15_000, label: "the entry's note of what the reimport kept" });
      const keptText = await kept.innerText();
      check(/Article/.test(keptText) && /this campaign's version was kept/.test(keptText) && /the import's version differs/.test(keptText), `the entry says its article was kept over the import's: ${JSON.stringify(keptText.slice(0, 240))}`);
      check(keptText.includes(words.theirsArticle), "the entry shows the import's article");
      check((await kept.getByRole("button", { name: /^Use the import's version/ }).count()) === 1 && (await kept.getByRole("button", { name: /^Keep mine/ }).count()) === 1, "the entry offers Use the import's version and Keep mine");
      await t.tap(tablePanel.locator('[data-tour="world-edit"]').first());
      const tableForm = tablePanel.locator("form").filter({ has: page.locator("input[required]") }).first();
      await eventually(() => tableForm.isVisible(), { timeoutMs: 15_000, label: "the entry form again" });
      const formKept = tableForm.locator('[data-testid="entry-import-kept"]');
      check((await formKept.getByRole("button", { name: /^Use the import's version/ }).count()) === 1, "the entry form offers the import's version");
      check((await formKept.innerText()).includes(words.theirsArticle), "the entry form shows the import's article");
      await t.shot("form-after");
      await t.tap(tableForm.getByRole("button", { name: "Cancel" }));
      await eventually(() => kept.isVisible(), { timeoutMs: 15_000, label: "the entry's page again" });
      // Use the import's version, then Restore mine.
      await t.tap(kept.getByRole("button", { name: /^Use the import's version/ }));
      await eventually(async () => (await entryAtTable())?.entry?.article === words.theirsArticle, { timeoutMs: 15_000, label: "the import's article taken" });
      await eventually(async () => /the import's version is in use/.test(await kept.innerText().catch(() => "")), { timeoutMs: 15_000, label: "the entry saying the import's version is in use" });
      check((await kept.innerText()).includes(words.oursArticle), "the campaign's article is kept beside it to restore");
      // The button pressed is gone: focus stays in the notice, and the new
      // state is said politely.
      const focusInNotice = () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="import-kept"]')));
      const announced = () => kept.locator('[aria-live="polite"]').textContent().catch(() => "");
      await eventually(focusInNotice, { timeoutMs: 5_000, label: "focus in the notice after Use the import's version" });
      check(/Article: the import's version is in use/.test(await announced()), `Use is announced: ${JSON.stringify(await announced())}`);
      await t.shot("import-taken");
      await t.tap(kept.getByRole("button", { name: /^Restore mine/ }));
      await eventually(async () => (await entryAtTable())?.entry?.article === words.oursArticle, { timeoutMs: 15_000, label: "the campaign's article restored" });
      await eventually(async () => /this campaign's version was kept/.test(await kept.innerText().catch(() => "")), { timeoutMs: 15_000, label: "the choice offered again" });
      await eventually(focusInNotice, { timeoutMs: 5_000, label: "focus in the notice after Restore mine" });
      check(/Article: this campaign's version is back/.test(await announced()), `Restore mine is announced: ${JSON.stringify(await announced())}`);
      await t.reload();
      await openPanelTab(t, "settings");
      const prepAfter = page.locator(`${root}[data-setup-prep]`).locator("visible=true").first();
      await eventually(() => prepAfter.count(), { timeoutMs: 20_000, label: "Bring in prep after a reload" });
      // After a reload, Bring in prep still says what was kept, read from
      // the entry's record rather than the last import's answer.
      const standing = prepAfter.locator('[data-testid="import-kept-standing"]');
      await eventually(() => standing.count(), { timeoutMs: 15_000, label: "Bring in prep saying what was kept, after a reload" });
      const standingText = await standing.innerText();
      check(standingText.includes(`${name}: kept your article over the import's.`), `Bring in prep names the kept article after a reload: ${JSON.stringify(standingText.slice(0, 240))}`);
      // A further import of the same workshop says it again while it stands.
      const third = await bringIn(t, workshopTitle);
      check(third.note.includes(`${name}: kept your article over the import's.`), `a further import says the article is still kept: ${JSON.stringify(third.note)}`);
      const last = await entryAtTable();
      check(last.entry.article === words.oursArticle && last.entry.hiddenTruth === words.theirsTruth, "a further import changes nothing");
      check(last.kept?.some((item) => item.key === "article" && item.theirs === words.theirsArticle && !item.taken), `the entry still holds the import's article for the author: ${JSON.stringify(last.kept)}`);
    } finally {
      // Both are this run's own; taken off so the lead's lists stay as the
      // seed left them. Deleting, not ending: an ended campaign writes its
      // sheet's progress back to the seeded library fighter.
      if (campaignId) await api.delete(`${base}/api/campaigns/${campaignId}`).catch(() => {});
      // The ready-made hero also went into the player's library.
      if (playerHero) await playerContext.request.delete(`${base}/api/characters/${playerHero}`).catch(() => {});
      await playerContext.close().catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`);
    }
  },
};
