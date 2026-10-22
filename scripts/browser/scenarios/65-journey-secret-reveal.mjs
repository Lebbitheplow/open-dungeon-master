// M6 of the WorldForge plan (audit WF-23), journey 5: a secret written in a
// workshop and revealed in a campaign. In a new workshop whose world holds
// a place, a settled lore entry, a lore entry still in draft and a secret
// kept for later, the author writes a timeline event at the place and a
// secret about it, from the keyboard. The workshop is brought into a new
// campaign through the lobby's import picker, the seeded player is seated
// at it, and once play begins the DM's World tab shows the event as canon
// and the draft as a draft. The DM reveals the secret to the party from the
// keyboard, in the party's own words.
//
// The finish: the player's lore holds exactly the lore the DM's World marks
// canon, the revealed secret among it in the words the DM wrote, and never
// the draft entry, the secret's own notes or the secret still kept; the
// rest of the world (its timeline included) stays closed to the player. The
// workshop's world is unchanged: its secret is still unrevealed and its
// entries, events, secrets and lore are as they were before the import.
//
// The single steps are proven in 43-world-use-in-campaign (the import
// picker), 47-world-at-table (who sees the World tab) and 48-world-reveal
// (a reveal on the seeded quiet table); this chains them from a fresh
// workshop and checks both seats and the workshop at the end. No model is
// called: the campaign has a person in the DM seat. Setup through the API
// is only what the journey is not about: the workshop's entries and the
// kept secret, the campaign, and the player seated and readied so the table
// can begin.
import { check, eventually, newContext, openPanelTab, settle, signIn } from "../lib.mjs";

// A campaign a person runs, with the seeded player seated on a ready-made
// hero and everyone ready, so the lead can begin it after the import. The
// player's context is sized for this viewport, for their own page later.
async function seatTable(t, title) {
  const { page, base, ids, api, viewport } = t;
  const made = await api.post(`${base}/api/campaigns`, { data: { title, gameSettings: { ttsEnabled: false, dmMode: "human" } } });
  check(made.ok(), `a campaign the lead runs (${made.status()})`);
  const campaign = (await made.json()).campaign;
  const player = await newContext(page.context().browser(), viewport, { app: false });
  await signIn(player, base, ids.player, ids.password);
  const joined = await player.request.post(`${base}/api/campaigns/join`, { data: { inviteCode: campaign.inviteCode } });
  check(joined.ok(), `the player joined by the invite code (${joined.status()})`);
  const hero = await player.request.post(`${base}/api/campaigns/${campaign.id}/sheet/pregen`, { data: { id: "brakk" } });
  check(hero.status() === 201, `the player took a ready-made hero (${hero.status()})`);
  const library = (await hero.json()).sheet?.libraryCharacterId ?? "";
  for (const request of [player.request, api]) {
    const ready = await request.post(`${base}/api/campaigns/${campaign.id}/ready`, { data: { ready: true } });
    check(ready.ok(), `a seat readied (${ready.status()})`);
  }
  return {
    id: campaign.id,
    player,
    begin: async () => {
      const begun = await api.patch(`${base}/api/campaigns/${campaign.id}`, { data: { status: "active" } });
      check(begun.ok(), `the lead began the campaign (${begun.status()}: ${await begun.text()})`);
    },
    close: async () => {
      await api.delete(`${base}/api/campaigns/${campaign.id}`).catch(() => {});
      if (library) await player.request.delete(`${base}/api/characters/${library}`).catch(() => {});
      await player.close().catch(() => {});
    },
  };
}

const focused = (locator) => locator.evaluate((element) => element === document.activeElement).catch(() => false);

// Reaches a control without the pointer and presses it with the keyboard.
async function press(page, locator, key = "Enter") {
  await locator.focus();
  await page.keyboard.press(key);
}

// What a workshop's world and lore are, for "unchanged": the records, not
// the document's bookkeeping.
async function workshopState(api, shop) {
  const { doc } = await (await api.get(`${shop}/world`)).json();
  const lore = (await (await api.get(`${shop}/lore`)).json()).entries ?? [];
  return JSON.stringify({
    entries: doc.entries,
    events: doc.events,
    secrets: doc.secrets,
    links: doc.links,
    lore: lore.map((entry) => ({ id: entry.id, title: entry.title, body: entry.body, visibility: entry.visibility })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export default {
  name: "journey-secret-reveal",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = Date.now().toString(36);
    const shopTitle = `Ferry secrets ${stamp}`;
    const placeName = `Hollow Ford ${stamp}`;
    const tollName = `The Ferry Toll ${stamp}`;
    const draftName = `The bell under the ford ${stamp}`;
    const eventTitle = `The ferry rope is cut ${stamp}`;
    const eventBody = "In the flood spring the ferry's rope parts at midstream and the crossing is lost for a season.";
    const secretTitle = `The ferryman cut the rope ${stamp}`;
    const secretNotes = "He was paid in smuggled salt; it comes out if they find his ledger.";
    const keptTitle = `A causeway under the ford ${stamp}`;
    const keptNotes = "The smugglers mark it with reeds at low tide.";
    const toldTitle = `What the ferryman confessed ${stamp}`;
    const toldBody = "Cornered at the ford, the ferryman admits he cut the rope himself for a purse.";
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });

    const made = await api.post(`${base}/api/workshops`, { data: { title: shopTitle, description: "" } });
    check(made.ok(), "a workshop for the journey");
    const shopId = (await made.json()).workshop.id;
    const shop = `${base}/api/campaigns/${shopId}`;
    let table = null;
    try {
      const types = (await (await api.get(`${shop}/world`)).json()).doc.types;
      const loreType = types.find((type) => type.shelf === "lore").id;
      const entry = async (data) => {
        const response = await api.post(`${shop}/world/entities`, { data });
        check(response.ok(), `the entry ${data.name} (${response.status()})`);
        return (await response.json()).entity;
      };
      const place = await entry({ typeId: "t_location", name: placeName, text: "A ford below the ferry, waist-deep in summer." });
      await entry({ typeId: loreType, name: tollName, text: "The ferryman takes a copper a head, two after dark." });
      const draft = await entry({ typeId: loreType, name: draftName, text: "Some say a temple bell lies under the ford and rings before a drowning." });
      const drafted = await api.patch(`${shop}/world/entities/${encodeURIComponent(draft.ref)}`, { data: { canon: "draft" } });
      check(drafted.ok(), `the bell's entry is still a draft (${drafted.status()})`);
      const kept = await api.patch(`${shop}/world`, { data: { secrets: [{ id: `sec_kept_${stamp}`, title: keptTitle, subject: place.ref, notes: keptNotes, knownBy: [], partyKnows: false }] } });
      check(kept.ok(), `a secret kept for later (${kept.status()})`);
      const readDoc = async (id) => (await (await api.get(`${base}/api/campaigns/${id}/world`)).json()).doc;

      // ---- the workshop: a timeline event at the place, from the keyboard ----
      await t.open(`/workshop/${shopId}?system=world&view=timeline`);
      const newEvent = page.locator(`${root}[data-tour="world-new-event"]`).locator("visible=true").first();
      await eventually(() => newEvent.count(), { timeoutMs: 30_000, label: "the workshop's timeline" });
      await press(page, newEvent);
      const what = page.getByRole("textbox", { name: "What happened", exact: true }).locator("visible=true").first();
      await eventually(() => focused(what), { label: "the event's title focused" });
      await page.keyboard.type(eventTitle);
      await page.keyboard.press("Tab");
      check(await focused(page.getByRole("spinbutton", { name: "Year" }).first()), "Tab reaches the year");
      await page.keyboard.type("1203");
      const eventForm = page.locator("form").filter({ has: what }).first();
      await eventForm.getByRole("textbox", { name: "What happened, in full" }).focus();
      await page.keyboard.type(eventBody);
      await press(page, eventForm.getByRole("button", { name: "Add" }));
      await eventForm.getByRole("textbox", { name: "Find who or where" }).focus();
      await page.keyboard.type(placeName);
      await page.keyboard.press("Tab");
      check(await focused(eventForm.getByRole("option", { name: placeName }).first()), "Tab reaches the place in the list");
      await page.keyboard.press("Enter");
      await eventually(() => eventForm.getByRole("button", { name: `Take ${placeName} off` }).count(), { label: "the place on the event" });
      check((await eventForm.getByRole("radio", { name: "canon" }).getAttribute("aria-checked")) === "true", "a new event starts as canon");
      await what.focus();
      await page.keyboard.press("Enter");
      const eventOf = async (id) => (await readDoc(id)).events.find((event) => event.title === eventTitle);
      await eventually(async () => (await eventOf(shopId))?.refs?.includes(place.ref), { label: "the event saved at the place" });
      check((await eventOf(shopId)).canon === "canon" && (await eventOf(shopId)).when.yearNum === 1203, "the event is canon, in year 1203");

      // ---- the workshop: a secret about the place, from the keyboard ----
      await press(page, page.locator(`${root}[data-tour="world-view-secrets"]`).locator("visible=true").first());
      const newSecret = page.locator(`${root}[data-tour="world-new-secret"]`).locator("visible=true").first();
      await eventually(() => newSecret.count(), { label: "the workshop's secrets" });
      await press(page, newSecret);
      const secretBox = page.getByRole("textbox", { name: "The secret" }).locator("visible=true").first();
      await eventually(() => focused(secretBox), { label: "the secret's title focused" });
      await page.keyboard.type(secretTitle);
      await page.keyboard.press("Tab");
      await page.keyboard.type(secretNotes);
      const secretForm = page.locator("form").filter({ has: secretBox }).first();
      await press(page, secretForm.getByRole("button", { name: "Pick" }));
      await secretForm.getByRole("textbox", { name: "Find whom it is about" }).focus();
      await page.keyboard.type(placeName);
      await page.keyboard.press("Tab");
      check(await focused(secretForm.getByRole("option", { name: placeName }).first()), "Tab reaches the place in the list");
      await page.keyboard.press("Enter");
      await eventually(() => secretForm.getByRole("button", { name: `Take ${placeName} off` }).count(), { label: "the secret about the place" });
      await secretBox.focus();
      await page.keyboard.press("Enter");
      const secretOf = async (id) => (await readDoc(id)).secrets.find((secret) => secret.title === secretTitle);
      await eventually(async () => (await secretOf(shopId))?.subject === place.ref, { label: "the secret saved" });
      check((await secretOf(shopId)).notes === secretNotes && !(await secretOf(shopId)).partyKnows, "the secret holds its notes and the party does not know it");
      await t.shot("workshop-secrets");
      const before = await workshopState(api, shop);

      // ---- into a new campaign, through the lobby's import picker ----
      table = await seatTable(t, `Ferry table ${stamp}`);
      const campaign = `${base}/api/campaigns/${table.id}`;
      await t.open(`/campaigns/${table.id}`);
      const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
      await startFrom.scrollIntoViewIfNeeded();
      await t.tap(startFrom);
      await t.tap(page.getByRole("menuitemradio", { name: shopTitle }).locator("visible=true").first());
      for (const kind of ["World lore", "Places", /WorldForge/]) {
        const toggle = page.getByRole("switch", { name: kind }).locator("visible=true").first();
        await eventually(() => toggle.count(), { label: `the ${kind} switch` });
        check((await toggle.getAttribute("aria-checked")) === "true", `${kind} comes with the workshop`);
      }
      const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
      await eventually(() => bring.isEnabled(), { label: "Bring it in enabled" });
      await t.tap(bring);
      await eventually(async () => /Brought \d+ items? across/.test(await page.locator("body").innerText()), { timeoutMs: 30_000, label: "the import's note" });
      await table.begin();

      // ---- the DM's World: the event canon, the draft a draft ----
      await t.open(`/campaigns/${table.id}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the DM's World tab" });
      await t.tap(panel.locator('[data-tour="world-view-timeline"]').first());
      const eventRow = panel.getByRole("list", { name: "Timeline" }).locator("li", { hasText: eventTitle }).first();
      await eventually(() => eventRow.isVisible().catch(() => false), { timeoutMs: 20_000, label: "the event on the campaign's timeline" });
      const eventWords = await eventRow.innerText();
      check(eventWords.includes(eventBody) && !/\b(draft|alternate|retired)\b/i.test(eventWords), `the DM's timeline holds the event as canon: ${eventWords}`);
      await t.tap(panel.locator('[data-tour="world-view-wiki"]').first());
      const draftOption = panel.getByRole("option", { name: new RegExp(draftName) }).first();
      await eventually(() => draftOption.count(), { timeoutMs: 20_000, label: "the draft entry in the DM's wiki" });
      await draftOption.scrollIntoViewIfNeeded();
      await t.tap(draftOption);
      const header = panel.locator('[data-tour="world-entry"] header').first();
      await eventually(async () => (await header.innerText().catch(() => "")).includes(draftName), { label: "the draft entry's page" });
      check(/\bdraft\b/i.test(await header.innerText()), "the DM's World marks the entry as a draft");
      await t.shot("dm-draft");

      // ---- the reveal, from the keyboard ----
      await t.tap(panel.locator('[data-tour="world-view-secrets"]').first());
      const card = panel.locator("li", { hasText: secretTitle }).first();
      await eventually(() => card.isVisible().catch(() => false), { timeoutMs: 20_000, label: "the secret's card at the table" });
      await card.scrollIntoViewIfNeeded();
      await press(page, card.locator('[data-testid="secret-reveal"]'));
      const form = card.locator('[data-testid="secret-reveal-form"]');
      await eventually(() => form.isVisible(), { label: "the reveal form" });
      const titleBox = form.getByLabel("What the party learns, as a title");
      await eventually(() => focused(titleBox), { label: "the reveal's title focused" });
      check((await form.getByLabel("What the party reads").inputValue()) === secretNotes, "the form starts from the secret's notes, to be rewritten");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(toldTitle);
      await page.keyboard.press("Tab");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(toldBody);
      const reveal = form.locator('[data-testid="secret-reveal-confirm"]');
      for (let step = 0; step < 4 && !(await focused(reveal)); step += 1) await page.keyboard.press("Tab");
      check(await focused(reveal), "Tab reaches Reveal");
      await t.shot("reveal-form");
      await page.keyboard.press("Enter");
      await eventually(async () => /can read/.test(await panel.locator('[data-testid="secret-told"]').innerText().catch(() => "")), { label: "the panel saying the party can read it" });
      const learned = panel.locator("li", { hasText: secretTitle }).locator('[data-testid="secret-revealed"]');
      await eventually(() => learned.isVisible().catch(() => false), { label: "the record of the telling" });
      check((await learned.innerText()).includes(toldTitle), "the record names the lore entry the party reads");
      check(await panel.locator("li", { hasText: keptTitle }).first().isVisible(), "the kept secret is still the DM's");
      await t.shot("revealed");

      // ---- the player's lore ----
      const playerPage = await table.player.newPage();
      await playerPage.goto(`${base}/campaigns/${table.id}`, { waitUntil: "networkidle", timeout: 120_000 });
      await settle(playerPage);
      const storyTab = playerPage.locator('[data-tour="tab-story"]').locator("visible=true").first();
      await eventually(() => storyTab.count(), { timeoutMs: 30_000, label: "the player's Story tab" });
      await (t.touch ? storyTab.tap() : storyTab.click());
      const facts = playerPage.locator("[data-pill-group] button", { hasText: /^\s*Facts\s*$/ }).locator("visible=true").first();
      await eventually(() => facts.count(), { label: "the Facts section" });
      await (t.touch ? facts.tap() : facts.click());
      await eventually(() => playerPage.getByText("World lore").locator("visible=true").count(), { timeoutMs: 20_000, label: "the player's lore list" });
      await eventually(() => playerPage.getByText(toldTitle).locator("visible=true").count(), { timeoutMs: 20_000, label: "the revealed secret in the player's lore" });
      await eventually(() => playerPage.getByText(tollName).locator("visible=true").count(), { label: "the settled lore in the player's lore" });
      const seen = await playerPage.locator("body").innerText();
      for (const [words, what] of [[draftName, "the draft entry"], [secretNotes, "the secret's notes"], [keptTitle, "the kept secret"], [keptNotes, "the kept secret's notes"], [secretTitle, "the secret's own title"]]) {
        check(!seen.includes(words), `the player's page never shows ${what}`);
      }
      await playerPage.screenshot({ path: t.shotPath("player-lore") }).catch(() => {});

      // The two seats agree: the player's lore is exactly the lore the DM's
      // World marks canon, and the revealed entry reads as the DM wrote it.
      const lore = (await (await table.player.request.get(`${campaign}/lore`)).json()).entries ?? [];
      const world = await (await api.get(`${campaign}/world`)).json();
      const canonLore = world.entities.filter((entity) => entity.shelf === "lore" && entity.entry.canon === "canon").map((entity) => entity.name).sort();
      const playerLore = lore.map((row) => row.title).sort();
      check(JSON.stringify(playerLore) === JSON.stringify(canonLore), `the player's lore ${JSON.stringify(playerLore)} is the DM's canon lore ${JSON.stringify(canonLore)}`);
      check(canonLore.includes(toldTitle) && canonLore.includes(tollName) && !canonLore.includes(draftName), "which holds the revealed secret and the settled lore, not the draft");
      check(lore.find((row) => row.title === toldTitle)?.body === toldBody, "the player reads the words the DM wrote");
      const leaked = JSON.stringify(lore);
      check(!leaked.includes(secretNotes) && !leaked.includes(keptTitle) && !leaked.includes(keptNotes), "and nothing of the secret's notes or the kept secret");
      check(world.doc.events.some((event) => event.title === eventTitle && event.canon === "canon"), "the DM's World keeps the event as canon");
      const closed = await table.player.request.get(`${campaign}/world`);
      check(closed.status() === 403 && !(await closed.text()).includes(eventTitle), `the rest of the world, its timeline too, stays closed to the player (${closed.status()})`);

      // ---- the workshop is as it was ----
      check((await workshopState(api, shop)) === before, "the workshop's entries, events, secrets and lore are unchanged");
      const still = await secretOf(shopId);
      check(still && !still.partyKnows && !still.revealedAt && !still.revealedAs, "the workshop's secret is still unrevealed");
      await t.open(`/workshop/${shopId}?system=world&view=secrets`);
      const open = page.locator(`${root}li`, { hasText: secretTitle }).locator("visible=true").first();
      await eventually(() => open.count(), { timeoutMs: 30_000, label: "the workshop's secret" });
      check((await open.locator('[data-testid="secret-revealed"]').count()) === 0, "the workshop's secret carries no telling");
      check((await page.getByText("Learned by the party").locator("visible=true").count()) === 0, "nothing in the workshop is learned by a party");
      await t.shot("workshop-after");
    } finally {
      if (table) await table.close();
      await api.delete(`${base}/api/workshops/${shopId}`).catch(() => {});
    }
  },
};
