// WF-23 journey: an artifact to a usable item to a shop, and into a
// player's hands. In a workshop the lead opens a World Artifact that reads
// "Lore only", makes an item from it, gives the item its mechanics in the
// Homebrew editor (a magic cloak that adds 2 to armour class while worn),
// stocks it on a shop's shelf in the Market at the workshop's own place,
// and brings the workshop into a campaign of their own as its human
// Dungeon Master. The finish is a second user, ids.player, at that table:
// the shop they browse at the party's place lists the item at its cost
// (asking that plus the shop's markup); they buy it, and on their own sheet
// it arrives worn, their armour class reads 2 higher, drops by 2 when they
// take it off and rises again when they put it back on, and its card says
// what it is, how rare and what it is worth: the mechanics survived the
// import. The artifact's article is lore the party reads; its hidden truth,
// the DM's alone, came along for the DM (the World tab shows it) and never
// reaches the player: not on their page, not in any answer their page
// reads from the server, and the world's route stays closed to them.
//
// The shop's tile itself names the item and its price, and nothing of
// what it does: the mechanics are read where the player holds it.
//
// The single steps are earlier scenarios': world-bindings (40) links an item
// to an artifact and finds it in the shop's picker, world-use-in-campaign
// (43) brings a workshop in, shop-browse (58) opens a market at the table,
// world-at-table (47) and world-reveal (48) keep the world from players.
// This one chains them and looks at the campaign's end. No storyteller is
// asked anything: the table has a person in the DM seat, and no model is
// called.
//
// Set up through the API, as none of it is the journey: the workshop with
// its place and the artifact (with its hidden truth), the campaign with the
// lead in the DM seat, the player seated with a ready-made hero, the start
// of the adventure, the party standing at the place (the shop opens to
// players only where the party is), and coin in the player's purse.
// Keyboard only: the item's kind, rarity and where it is worn picked from
// their lists with the arrow keys and Enter, its cost and bonus typed into
// their fields, its effect added with Enter; the shop's stock picker
// searched, its match reached with Tab and taken with Enter; and, on the
// player's sheet, the cloak taken off and put back on with Enter, its card
// opened with Enter and closed with Escape, and the sheet closed with
// Escape.
import { check, eventually, newContext, openPanelTab, settle, signIn } from "../lib.mjs";

const PLACE = "Saltmere";
const SHOP = "The Salt Counter";
const BONUS = 2;
const PRICE = "25 gp";
const PRICE_CP = 2_500;

// Picks a choice from a kit Select by keyboard: focus, Enter opens the list,
// the arrow keys walk it, Enter takes the highlighted row.
async function pickByKeys(page, trigger, choice) {
  // Named before it opens: an open list hides the rest of the page from
  // the accessibility tree, and the trigger with it.
  const name = await trigger.getAttribute("aria-label");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await eventually(() => menu.isVisible(), { label: `the list under ${name}` });
  const highlighted = menu.locator("[data-highlighted]");
  const now = async () => (await highlighted.innerText().catch(() => "")).trim();
  for (let step = 0; step < 30; step += 1) {
    if ((await now()) === choice) break;
    const before = await now();
    await page.keyboard.press("ArrowDown");
    await eventually(async () => (await now()) !== before, { timeoutMs: 3_000, label: "the highlight moving" }).catch(() => {});
  }
  check((await now()) === choice, `the arrow keys reach ${choice} (${await now()})`);
  await page.keyboard.press("Enter");
  await eventually(async () => (await trigger.innerText()).includes(choice), { label: `${choice} picked` });
}

// Types into a field the keyboard reached, replacing what was there.
async function typeInto(page, field, text) {
  await field.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

const { formatPrice } = await import("../../../src/lib/srd/currency.ts");

export default {
  name: "journey-artifact-to-shop",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api, ids, viewport } = t;
    const stamp = Date.now().toString(36);
    const ARTIFACT = `Mantle of the Drowned ${stamp}`;
    const TRUTH = `It is the sea hag's own skin, and she is coming for it (${stamp}).`;
    const params = async () => (await t.url()).searchParams;
    const heading = (name) => page.locator(`${root}[data-tour="world-entry"] h3`, { hasText: name });
    const bound = page.locator(`${root}[data-testid="world-bound"]`);
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["world", "homebrew", "lore"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });

    const shopTitle = `Harbour market prep ${stamp}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: shopTitle, description: "" } });
    check(made.ok(), "a workshop for the journey");
    const workshopId = (await made.json()).workshop.id;
    const table = await api.post(`${base}/api/campaigns`, { data: { title: `Harbour market ${stamp}`, startingLevel: 3, gameSettings: { ttsEnabled: false, dmMode: "human" } } });
    check(table.ok(), `a campaign the lead runs as its DM (${table.status()})`);
    const campaign = (await table.json()).campaign;
    const campaignId = campaign.id;
    const browser = page.context().browser();
    const playerContext = await newContext(browser, viewport, { app: false });
    let itemId = "";
    let playerLibraryId = "";
    let playerPage = null;
    try {
      // ---- setup: the place, the artifact, and a player seated and ready ----
      const entities = `${base}/api/campaigns/${workshopId}/world/entities`;
      check((await api.post(entities, { data: { typeId: "t_location", name: PLACE, text: "A fishing town under the sea wall." } })).ok(), "the workshop's place");
      const artifact = (
        await (await api.post(entities, { data: { typeId: "t_artifact", name: ARTIFACT, text: "A grey-green cloak that is always damp, found on the drowned ferry.", hiddenTruth: TRUTH } })).json()
      ).entity;
      check(Boolean(artifact?.ref), "the artifact's article");
      await signIn(playerContext, base, ids.player, ids.password);
      const player = playerContext.request;
      const code = campaign.inviteCode ?? (await (await api.get(`${base}/api/campaigns/${campaignId}`)).json()).campaign?.inviteCode;
      check(Boolean(code), "the table's invite code");
      check((await player.post(`${base}/api/campaigns/join`, { data: { inviteCode: code } })).ok(), "the player joins the table");
      const seated = await player.post(`${base}/api/campaigns/${campaignId}/sheet/pregen`, { data: { id: "kara" } });
      check(seated.ok(), `the player takes a ready-made hero (${seated.status()})`);
      const hero = (await seated.json()).sheet;
      playerLibraryId = hero?.libraryCharacterId ?? "";
      check((await player.post(`${base}/api/campaigns/${campaignId}/ready`, { data: { ready: true } })).ok(), "the player is ready");
      check((await api.post(`${base}/api/campaigns/${campaignId}/ready`, { data: { ready: true } })).ok(), "the DM is ready");

      // ---- the artifact: lore only, then an item made from it ----
      await t.open(`/workshop/${workshopId}?system=world&entry=${encodeURIComponent(artifact.ref)}`);
      await eventually(() => heading(ARTIFACT).count(), { timeoutMs: 30_000, label: "the artifact's article" });
      check((await page.locator(`${root}[data-testid="world-lore-only"]`).count()) === 1, "the artifact reads Lore only");
      await t.tap(bound.getByRole("button", { name: "An item" }));
      await t.tap(bound.getByRole("button", { name: /Make a new one/ }));
      await eventually(async () => (await page.locator(`${root}[data-testid="world-lore-only"]`).count()) === 0, { timeoutMs: 15_000, label: "lore only no longer" });
      const record = bound.locator('[data-testid="world-bound-record"]').first();
      await eventually(async () => (await record.innerText().catch(() => "")).includes(ARTIFACT), { label: "the item linked" });
      const items = async () => ((await (await api.get(`${base}/api/homebrew?kind=item`)).json()).entries ?? []);
      itemId = (await items()).find((entry) => entry.name === ARTIFACT)?.id ?? "";
      check(Boolean(itemId), "the item is on the lead's own shelf");

      // ---- the item's mechanics, by keyboard ----
      await t.tap(record.getByRole("button", { name: "Open" }));
      await eventually(async () => (await params()).get("system") === "homebrew", { timeoutMs: 20_000, label: "the item open in Homebrew" });
      const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Kind", exact: true }) });
      await eventually(() => editor.isVisible(), { timeoutMs: 20_000, label: "the item's editor" });
      await pickByKeys(page, editor.getByRole("button", { name: "Kind", exact: true }), "Magic item");
      await pickByKeys(page, editor.getByRole("button", { name: "Rarity", exact: true }), "uncommon");
      await pickByKeys(page, editor.getByRole("button", { name: "Worn on", exact: true }), "Shoulders (a cloak or cape)");
      await typeInto(page, editor.getByLabel("Cost", { exact: true }), PRICE);
      const addEffect = editor.getByRole("button", { name: /Add an effect/ });
      await addEffect.focus();
      await page.keyboard.press("Enter");
      const amount = editor.getByRole("spinbutton", { name: "Amount", exact: true });
      await eventually(() => amount.isVisible(), { label: "an AC bonus to set" });
      check(/AC bonus/.test(await editor.getByRole("button", { name: "Effect kind" }).innerText()), "the effect is an AC bonus");
      await typeInto(page, amount, String(BONUS));
      await page.keyboard.press("Tab");
      await t.shot("item");
      await t.tap(editor.getByRole("button", { name: "Save", exact: true }));
      const saved = await eventually(
        async () => {
          const entry = (await items()).find((row) => row.id === itemId);
          const data = entry?.data ?? {};
          const effects = data.effects ?? [];
          return data.itemKind === "magic_item" && data.cost === PRICE && data.wornOn === "cloak" && effects.some((effect) => effect.kind === "ac_bonus" && effect.amount === BONUS) ? entry : null;
        },
        { timeoutMs: 15_000, label: "the item saved as a cloak of AC +2 at 25 gp" },
      );
      check(saved.data.rarity === "uncommon", `and uncommon (${saved.data.rarity})`);

      // ---- the item on a shop's shelf, at the workshop's place ----
      await t.open(`/workshop/${workshopId}?system=lore`);
      const openShop = page.getByRole("button", { name: /Open a shop/ }).locator("visible=true").first();
      await eventually(() => openShop.count(), { timeoutMs: 30_000, label: "the workshop's Market" });
      await openShop.scrollIntoViewIfNeeded();
      await t.tap(openShop);
      await page.getByRole("textbox", { name: "Shop name" }).fill(SHOP);
      await t.tap(page.getByRole("button", { name: "Where it stands" }));
      await t.tap(page.getByRole("menuitemradio", { name: PLACE }));
      await t.tap(page.getByRole("switch", { name: "Stock the shelves from the content pack" }));
      await t.tap(page.getByRole("button", { name: "Open it" }));
      // A bare shop opens straight into its shelf.
      const picker = page.locator(`[aria-label="Edit ${SHOP}"]`).getByRole("textbox", { name: "Add an item from the catalog" });
      await eventually(() => picker.isVisible(), { timeoutMs: 20_000, label: "the shelf's stock picker" });
      // The picker by keyboard: typed, Tab to the first match, Enter.
      await typeInto(page, picker, ARTIFACT);
      const shopEditor = page.locator(`[aria-label="Edit ${SHOP}"]`);
      const match = shopEditor.getByRole("button", { name: new RegExp(`^${ARTIFACT}`) }).first();
      await eventually(() => match.isVisible(), { timeoutMs: 15_000, label: "the item among the catalog's matches" });
      await page.keyboard.press("Tab");
      check(await match.evaluate((element) => element === document.activeElement), "Tab reaches the match");
      await page.keyboard.press("Enter");
      const lineItem = page.getByRole("textbox", { name: "Line 1 item" });
      await eventually(async () => (await lineItem.inputValue().catch(() => "")) === ARTIFACT, { label: "the item on line 1" });
      const linePrice = await page.getByRole("textbox", { name: "Line 1 price" }).inputValue();
      check(linePrice === formatPrice(PRICE_CP), `at the item's own cost (${linePrice})`);
      await t.shot("shelf");
      await t.tap(page.getByRole("button", { name: "Save the shop" }));
      const shelf = async (request, id) => ((await (await request.get(`${base}/api/campaigns/${id}/shops`)).json()).shops ?? []);
      await eventually(async () => (await shelf(api, workshopId)).some((shop) => shop.name === SHOP && shop.stock.some((line) => line.itemName === ARTIFACT)), { label: "the shelf saved" });

      // ---- the workshop into the campaign ----
      await t.open(`/campaigns/${campaignId}`);
      const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
      await startFrom.scrollIntoViewIfNeeded();
      await t.tap(startFrom);
      await t.tap(page.getByRole("menuitemradio", { name: shopTitle }).locator("visible=true").first());
      for (const kind of ["Market", "Places", /WorldForge/]) {
        const toggle = page.getByRole("switch", { name: kind }).locator("visible=true").first();
        await eventually(() => toggle.count(), { timeoutMs: 15_000, label: `the ${kind} switch` });
        check((await toggle.getAttribute("aria-checked")) === "true", `${kind} comes along`);
      }
      const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
      await eventually(() => bring.isEnabled(), { label: "Bring it in enabled" });
      await t.tap(bring);
      await eventually(async () => /Brought \d+ items? across/.test(await page.locator("body").innerText()), { timeoutMs: 20_000, label: "the import's note" });

      // The adventure opens (the lobby's Begin route), the party stands at
      // the place, and the player has coin to spend.
      const begun = await api.patch(`${base}/api/campaigns/${campaignId}`, { data: { status: "active" } });
      check(begun.ok(), `the adventure begins (${begun.status()}: ${await begun.text()})`);
      const invoke = (name, args) => api.post(`${base}/api/campaigns/${campaignId}/dm/invoke`, { data: { name, args } });
      const moved = await invoke("move_party", { name: PLACE, visionClear: false });
      check(moved.ok(), `the party stands in ${PLACE} (${await moved.text()})`);
      const paid = await invoke("modify_gold", { characterId: hero.id, delta: 50, reason: "wages" });
      check(paid.ok(), `the player has coin (${await paid.text()})`);

      // ---- the DM's end: the item, its link, and the hidden truth kept ----
      await t.open(`/campaigns/${campaignId}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the DM's World tab" });
      const option = panel.getByRole("option", { name: new RegExp(ARTIFACT) }).first();
      await eventually(() => option.count(), { timeoutMs: 20_000, label: "the artifact in the campaign's wiki" });
      await option.scrollIntoViewIfNeeded();
      await t.tap(option);
      const page$ = panel.locator('[data-tour="world-entry"]').first();
      await eventually(async () => (await page$.innerText().catch(() => "")).includes(TRUTH), { timeoutMs: 20_000, label: "the hidden truth, for the DM" });
      check((await panel.locator('[data-testid="world-lore-only"]').count()) === 0, "the artifact is still an item at the table, not lore only");
      check(/Your own item/.test(await panel.locator('[data-testid="world-bound-record"]').first().innerText()), "linked to the DM's own item");
      await t.shot("dm-world");

      // ---- the player's end: the shop, the purchase, the cloak worn ----
      playerPage = await playerContext.newPage();
      // What goes wrong behind the player's page, and every answer it reads
      // from the server, searched for the hidden truth.
      const playerFails = [];
      const leaks = [];
      playerPage.on("pageerror", (error) => playerFails.push(String(error).slice(0, 200)));
      playerPage.on("response", async (response) => {
        const url = response.url();
        if (!url.startsWith(base) || !url.includes("/api/")) return;
        if (response.status() >= 500) playerFails.push(`status ${response.status()} ${url.slice(base.length)}`);
        if (!/json/.test(response.headers()["content-type"] ?? "")) return;
        const body = await response.text().catch(() => "");
        if (body.includes("sea hag")) leaks.push(url.slice(base.length));
      });
      await playerPage.goto(`${base}/campaigns/${campaignId}`, { waitUntil: "networkidle", timeout: 120_000 });
      await settle(playerPage);
      const seen = { ...t, page: playerPage, root: "", tap: (locator) => (t.touch ? locator.tap() : locator.click()) };
      await openPanelTab(seen, "party");
      const marketTab = playerPage.locator(".session-subtab").filter({ hasText: "Market" }).locator("visible=true").first();
      await eventually(() => marketTab.count(), { timeoutMs: 20_000, label: "the player's Market" });
      await seen.tap(marketTab);
      const shop = playerPage.locator("[data-shop-id]").filter({ hasText: SHOP }).locator("visible=true").first();
      await eventually(() => shop.count(), { timeoutMs: 20_000, label: `${SHOP} open to the player at ${PLACE}` });
      const ware = shop.locator("li").filter({ hasText: ARTIFACT }).first();
      await eventually(() => ware.count(), { label: "the item on the shelf the player sees" });
      // The list price is the item's cost; the shop's own markup makes the asking price.
      const theirShelf = (await shelf(player, campaignId)).find((entry) => entry.name === SHOP);
      const line = theirShelf?.stock.find((entry) => entry.itemName === ARTIFACT);
      check(line?.priceCp === PRICE_CP, `the shelf lists it at its cost, ${PRICE} (${line?.priceCp} cp)`);
      check((await ware.innerText()).includes(formatPrice(line.askingCp)), `and the player reads the asking price, ${formatPrice(line.askingCp)} (${await ware.innerText()})`);
      await playerPage.screenshot({ path: t.shotPath("player-shop") }).catch(() => {});
      await seen.tap(ware.getByRole("button", { name: "Buy" }));
      const carried = async () => ((await (await player.get(`${base}/api/campaigns/${campaignId}/sheet`)).json()).sheet?.equipment ?? []).find((row) => row.name === ARTIFACT);
      const bought = await eventually(carried, { timeoutMs: 15_000, label: "the item in the player's pack" });
      // The table turns a find over on a plate for a few seconds, and the
      // plate takes Escape while it shows (Moments.tsx): the keyboard waits
      // for it to go before it closes anything.
      const plate = playerPage.locator(".moment-loot");
      await eventually(async () => (await plate.count()) === 0, { timeoutMs: 15_000, label: "the find's plate gone" });
      // The mechanics are the item's own, read back where the player holds it.
      const effects = bought.gear?.magic?.effects ?? [];
      check(effects.some((effect) => effect.kind === "ac_bonus" && effect.amount === BONUS), `the cloak in the pack adds ${BONUS} to AC: ${JSON.stringify(bought.gear ?? null)}`);
      check(bought.gear?.wornOn === "cloak", `and is worn as a cloak (${bought.gear?.wornOn})`);

      // The player's own sheet: the cloak among their gear, and the armour
      // class they read moving by exactly its bonus as it comes off and goes
      // back on. A bought cloak arrives worn.
      await openPanelTab(seen, "party");
      const roster = playerPage.locator(".session-subtab").filter({ hasText: "Roster" }).locator("visible=true").first();
      if (await roster.count()) await seen.tap(roster);
      const card = playerPage.locator(".party-card-heading").filter({ hasText: hero.name }).locator("visible=true").first();
      await eventually(() => card.count(), { timeoutMs: 20_000, label: "the player's own card" });
      await seen.tap(card);
      const sheetDialog = playerPage.getByRole("dialog").filter({ hasText: ARTIFACT }).first();
      await eventually(() => sheetDialog.isVisible(), { timeoutMs: 20_000, label: "the player's sheet, the cloak among the gear" });
      const shownAc = async () => Number((await sheetDialog.innerText()).match(/Armou?r class\s*(\d+)/i)?.[1]);
      const wearing = playerPage.getByRole("button", { name: /^(wear|worn)$/ });
      const gearRow = sheetDialog.locator("li, div").filter({ hasText: ARTIFACT }).filter({ has: wearing }).last();
      const toggle = gearRow.getByRole("button", { name: /^(wear|worn)$/ });
      const acBefore = Number(hero.ac);
      await eventually(async () => (await toggle.innerText()).trim() === "worn" && (await shownAc()) === acBefore + BONUS, { timeoutMs: 15_000, label: `the sheet reading AC ${acBefore + BONUS} with the cloak worn` });
      // Off and on again from the keyboard: the toggle focused, Enter pressed.
      const press = async () => {
        await toggle.focus();
        await playerPage.keyboard.press("Enter");
      };
      await press();
      await eventually(async () => (await toggle.innerText()).trim() === "wear" && (await shownAc()) === acBefore, { timeoutMs: 15_000, label: `AC back to ${acBefore} with the cloak off (${await shownAc()})` });
      await press();
      await eventually(async () => (await toggle.innerText()).trim() === "worn" && (await shownAc()) === acBefore + BONUS, { timeoutMs: 15_000, label: `AC ${acBefore + BONUS} again with it back on` });
      await playerPage.screenshot({ path: t.shotPath("player-worn") }).catch(() => {});

      // The item's own card, from its ⓘ by keyboard: what it is, how rare,
      // and what it is worth all came along with it.
      const about = sheetDialog.getByRole("button", { name: `What is ${ARTIFACT}?` }).first();
      await about.focus();
      await playerPage.keyboard.press("Enter");
      const itemCard = playerPage.getByRole("dialog").filter({ hasText: /value/i }).filter({ hasText: ARTIFACT });
      await eventually(() => itemCard.isVisible().catch(() => false), { label: "the item's card" });
      const said = await itemCard.innerText();
      check(/Magic item/.test(said) && /uncommon/i.test(said) && said.includes(PRICE), `the card reads a magic item, uncommon, worth ${PRICE}: ${JSON.stringify(said)}`);
      await playerPage.keyboard.press("Escape");
      await eventually(async () => (await itemCard.count()) === 0, { label: "the item's card closed by Escape" });
      await playerPage.keyboard.press("Escape");
      await eventually(async () => (await playerPage.getByRole("dialog").count()) === 0, { label: "the sheet closed by Escape" });

      // ---- what the player reads of the artifact, and never its hidden truth ----
      const story = playerPage.locator('[data-tour="tab-story"]').locator("visible=true").first();
      await eventually(() => story.count(), { timeoutMs: 20_000, label: "the player's Story tab" });
      await seen.tap(story);
      const factsPill = playerPage.locator("[data-pill-group] button", { hasText: /^\s*Facts\s*$/ }).locator("visible=true").first();
      await eventually(() => factsPill.count(), { label: "the Facts section" });
      await seen.tap(factsPill);
      await eventually(() => playerPage.getByText(ARTIFACT).locator("visible=true").count(), { timeoutMs: 20_000, label: "the artifact among the lore the party reads" });
      await playerPage.screenshot({ path: t.shotPath("player-lore") }).catch(() => {});
      check(!(await playerPage.locator("body").innerText()).includes("sea hag"), "the player's page never shows the hidden truth");
      const lore = await (await player.get(`${base}/api/campaigns/${campaignId}/lore`)).json();
      const entry = (lore.entries ?? []).find((row) => row.title === ARTIFACT);
      check(entry && /always damp/.test(entry.body), "the party reads the artifact's article");
      check(!JSON.stringify(lore).includes("sea hag"), "and never its hidden truth");
      check((await player.get(`${base}/api/campaigns/${campaignId}/world`)).status() === 403, "and the world's route stays closed to the player");
      check(!leaks.length, `nor any answer the player's page read: ${leaks.join(", ")}`);
      check(!playerFails.length, `the player's page ran clean: ${playerFails.join("; ")}`);
    } catch (error) {
      // The harness shoots the lead's page; the player's is shot here.
      if (playerPage) await playerPage.screenshot({ path: t.shotPath("player-failed") }).catch(() => {});
      throw error;
    } finally {
      await api.delete(`${base}/api/campaigns/${campaignId}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
      if (itemId) await api.delete(`${base}/api/homebrew/${itemId}`).catch(() => {});
      if (playerLibraryId) await playerContext.request.delete(`${base}/api/characters/${playerLibraryId}`).catch(() => {});
      await playerContext.close().catch(() => {});
    }
  },
};
