// Journey (plan M6, audit WF-23): from an idea to a world outline, a few
// chosen rows made, and the result played in a campaign. A stand-in model
// on a local port answers; no real provider is called.
//
// In a new workshop the author starts at the hub's Create, picks World
// outline and drafts a world from a line. The outline proposes two people,
// two places, a faction, a lore entry, two creatures and an item, with
// links. By keyboard alone the author unticks everything but one person,
// one place and one creature, and makes the ticked three. Only those three
// exist afterwards: the person in the Cast, the place among the places, the
// creature in the Bestiary as a stat block the Bestiary's own check passed,
// with a World entry linked to it, and the two links whose ends were both
// made. The lead then brings the workshop into a new campaign with the
// lobby's import picker, the table opens, and in its World tab the lead
// edits the place's arrival text.
//
// The finish: the campaign holds the three records with their links, the
// creature's entry still finds its stat block for this campaign and the
// campaign's monster search finds it, the edit is the campaign's, and the
// workshop's place reads as it did.
//
// The single steps are proved on their own elsewhere: the outline's counts,
// refusal and Retry in 58-world-outline; the Create chooser in
// 41-create-chooser; a bound stat block in 40-world-bindings; the import
// picker's switches in 43-world-use-in-campaign; the World tab at the table
// in 47-world-at-table; an entry form's save in 35-entry-conflict.
//
// Set up through the API, because none of it is what the journey proves:
// the workshop and the campaign themselves, pointing the workshop at the
// stand-in model, telling the page the server has a text model (it has
// none), and starting the table, which is the lobby's own business
// (53-hero-chooser walks it): with no storyteller on this server the lead
// runs the table as its DM, so the seeded player joins with a ready-made
// hero (removed again from their library at the end). The app's shell
// reads the host's capabilities once at sign-in, so the Outline cannot be
// reached there; this journey runs on the website.
import http from "node:http";
import { check, eventually, freePort, openPanelTab, signIn } from "../lib.mjs";

// The stand-in: an outline, and a creature or an item on request, counted.
function outlineModel(port, stamp) {
  const calls = { outline: 0, creature: 0, item: 0 };
  const outline = {
    premise: "The sea took the low kingdom. The tide-priests ration what dry land is left.",
    people: [
      { name: `Abbess Corra ${stamp}`, summary: "First of the tide-priests.", hiddenTruth: "She sells dry berths." },
      { name: `Tamsin Reed ${stamp}`, summary: "A bone-diver." },
    ],
    places: [
      { name: `The Last Steeple ${stamp}`, summary: "A bell tower standing out of the water." },
      { name: `The Salt Market ${stamp}`, summary: "Rafts lashed together where the square used to be." },
    ],
    factions: [{ name: `The Tide Priesthood ${stamp}`, summary: "They decide who may stand on dry stone." }],
    lore: [{ name: `The Drowning ${stamp}`, type: "Other", summary: "The night the sea came in." }],
    creatures: [
      { name: `Silt Stalker ${stamp}`, summary: "A long-limbed hunter of the drowned streets.", basis: "", cr: 3 },
      { name: `Bell Eel ${stamp}`, summary: "An eel that nests in sunken belfries.", basis: "", cr: 1 },
    ],
    items: [{ name: `Tide Hook ${stamp}`, summary: "A bone gaff the divers fight with.", kind: "weapon" }],
    links: [
      { from: `Abbess Corra ${stamp}`, to: `The Last Steeple ${stamp}`, label: "lives in" },
      { from: `Silt Stalker ${stamp}`, to: `The Last Steeple ${stamp}`, label: "guards" },
      { from: `Tamsin Reed ${stamp}`, to: `The Tide Priesthood ${stamp}`, label: "member of" },
    ],
  };
  const creature = {
    basis: "",
    size: "Large",
    type: "monstrosity",
    cr: 3,
    attacks: [{ name: "Claw", toHit: 5, damage: "2d6+3", type: "slashing" }],
    traits: [],
    desc: "A pale thing that wades the drowned streets at low tide.",
  };
  const item = { itemKind: "weapon", rarity: "uncommon", cost: "40 gp", desc: "A bone gaff.", weapon: { category: "martial", kind: "melee", damage: "1d8 piercing", properties: ["reach"] } };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const system = String(body.messages?.[0]?.content ?? "");
      let content = "Nothing.";
      if (system.includes("You sketch a tabletop world")) {
        calls.outline += 1;
        content = JSON.stringify(outline);
      } else if (system.includes("You design one creature")) {
        calls.creature += 1;
        content = JSON.stringify(creature);
      } else if (system.includes("You design one item")) {
        calls.item += 1;
        content = JSON.stringify(item);
      }
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, calls })));
}

// Presses Tab until `target` holds the focus, the way a keyboard user walks
// a page; fails when it is not reached within `max` presses.
async function tabTo(page, target, label, max = 250) {
  const handle = await target.elementHandle();
  for (let index = 0; index <= max; index += 1) {
    if (await handle.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`${label} was not reached by Tab within ${max} presses`);
}

export default {
  name: "journey-outline-to-campaign",
  viewports: ["desktop", "phone"],
  app: false,
  async run(t) {
    const { page, base, root, api, ids } = t;
    const stamp = Date.now().toString(36);
    const name = {
      abbess: `Abbess Corra ${stamp}`,
      tamsin: `Tamsin Reed ${stamp}`,
      steeple: `The Last Steeple ${stamp}`,
      market: `The Salt Market ${stamp}`,
      priesthood: `The Tide Priesthood ${stamp}`,
      drowning: `The Drowning ${stamp}`,
      stalker: `Silt Stalker ${stamp}`,
      eel: `Bell Eel ${stamp}`,
      hook: `Tide Hook ${stamp}`,
    };
    const shopTitle = `Drowned kingdom ${stamp}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: shopTitle, description: "" } });
    check(made.ok(), "a workshop for the journey");
    const shopId = (await made.json()).workshop.id;
    const shop = `${base}/api/campaigns/${shopId}`;
    const table = await api.post(`${base}/api/campaigns`, { data: { title: `Steeple table ${stamp}`, gameSettings: { ttsEnabled: false } } });
    check(table.ok(), `a campaign to bring it into (${table.status()})`);
    const campaignId = (await table.json()).campaign.id;
    const campaign = `${base}/api/campaigns/${campaignId}`;
    const model = await outlineModel(await freePort(), stamp);
    // The player's own session, for joining the table (48-world-reveal signs
    // a second account in the same way).
    const playerContext = await page.context().browser().newContext();
    let playerLibrary = "";
    const worldOf = async (url) => (await api.get(`${url}/world`)).json();
    const monsters = async () => (await (await api.get(`${shop}/dm/bestiary`)).json()).monsters.filter((monster) => monster.draft.name.includes(stamp));
    const items = async () => ((await (await api.get(`${base}/api/homebrew?kind=item`)).json()).entries ?? []).filter((entry) => entry.name.includes(stamp));
    try {
      const pointed = await api.patch(`${shop}/story-settings`, { data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${model.server.address().port}/v1`, customModel: "outline-stand-in" } });
      check(pointed.ok(), `pointing the workshop at the stand-in answered ${pointed.status()}`);
      // The server has no text model, so the page is told it has one; the
      // workshop's own settings point at the stand-in.
      await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.story = { ...body.story, configured: true };
        await route.fulfill({ response, json: body });
      });

      // ---- Create, World outline, from an idea ----
      await t.open(`/workshop/${shopId}`);
      const create = page.locator(`${root}[data-testid="create-open"]`).locator("visible=true").first();
      await eventually(() => create.isVisible(), { timeoutMs: 30_000, label: "Create on the workshop's hub" });
      await create.click();
      const chooser = page.getByRole("dialog");
      await chooser.locator('[data-testid="create-choice-outline"]').click();
      const draftStep = chooser.locator('[data-testid="create-step"]', { hasText: "Draft a world from an idea" });
      check(await draftStep.isEnabled(), "Draft a world is offered when the server has a text model");
      await draftStep.click();
      await eventually(async () => (await t.url()).searchParams.get("view") === "outline", { timeoutMs: 30_000, label: "the World's Outline view" });
      const idea = page.getByRole("textbox", { name: "Your idea for the world" }).locator("visible=true");
      await eventually(() => idea.isVisible(), { timeoutMs: 30_000, label: "the idea box" });
      await idea.fill("A drowned kingdom where the tide-priests ration dry land.");
      await page.getByRole("button", { name: "Draft an outline" }).click();
      const counts = page.locator(`${root}[data-testid="outline-counts"]`);
      await eventually(() => counts.isVisible(), { timeoutMs: 30_000, label: "the outline" });
      check((await counts.innerText()).includes("2 people · 2 places · 1 faction · 1 lore entry · 2 creatures · 1 item"), `the outline counts what it proposes: ${await counts.innerText()}`);
      await t.shot("outline");

      // ---- by keyboard alone: keep one person, one place, one creature ----
      for (const leave of [name.tamsin, name.market, name.priesthood, name.drowning, name.eel, name.hook]) {
        const tick = page.getByRole("checkbox", { name: `Make ${leave}`, exact: true });
        await tabTo(page, tick, `the tick for ${leave}`);
        await page.keyboard.press("Space");
        await eventually(async () => !(await tick.isChecked()), { label: `${leave} unticked by Space` });
      }
      for (const keep of [name.abbess, name.steeple, name.stalker]) {
        check(await page.getByRole("checkbox", { name: `Make ${keep}`, exact: true }).isChecked(), `${keep} is still ticked`);
      }
      const make = page.locator(`${root}[data-testid="outline-make"]`);
      check((await make.innerText()).includes("(3)"), `the button counts the three kept rows: ${await make.innerText()}`);
      await tabTo(page, make, "Make the ticked");
      await page.keyboard.press("Enter");
      const progress = page.locator(`${root}[data-testid="outline-progress"]`);
      await eventually(async () => /Made all 3\./.test(await progress.innerText().catch(() => "")), { timeoutMs: 90_000, label: "the three rows made" });
      const outlineText = await page.locator(`${root}[data-testid="world-outline"]`).innerText();
      check(new RegExp(`one end was not ticked: ${name.tamsin} member of ${name.priesthood}`).test(outlineText), `the link left out is named: ${outlineText.slice(-400)}`);
      check(model.calls.creature === 1 && model.calls.item === 0, `only the ticked creature was asked for (creature ${model.calls.creature}, item ${model.calls.item})`);
      await t.shot("made");

      // ---- only the ticked records exist, each linked to its record ----
      const world = await worldOf(shop);
      const byName = Object.fromEntries((world.entities ?? []).map((entity) => [entity.name, entity]));
      const names = Object.keys(byName).sort();
      check(JSON.stringify(names) === JSON.stringify([name.abbess, name.stalker, name.steeple].sort()), `only the ticked rows were made: ${JSON.stringify(names)}`);
      const abbess = byName[name.abbess];
      const steeple = byName[name.steeple];
      const stalker = byName[name.stalker];
      check(abbess.shelf === "npc" && steeple.shelf === "location" && stalker.shelf === "lore", `each landed on its shelf (${abbess.shelf}, ${steeple.shelf}, ${stalker.shelf})`);
      const cast = (await (await api.get(`${shop}/dm/npcs`)).json()).npcs.filter((npc) => npc.name.includes(stamp));
      check(cast.length === 1 && cast[0].id === abbess.id, `the Cast holds the one person, as the entry's own record: ${cast.map((npc) => npc.name).join(", ")}`);
      const stored = await monsters();
      check(stored.length === 1 && stored[0].draft.name === name.stalker, `the Bestiary holds the one creature: ${stored.map((monster) => monster.draft.name).join(", ")}`);
      const stats = stored[0].draft.stats;
      check(Number(stats.cr) === 3 && JSON.stringify(stats.attacks ?? []).includes("2d6+3"), `the stat block is the one the Bestiary checked: CR ${stats.cr}, ${JSON.stringify(stats.attacks)}`);
      check((await items()).length === 0, "the unticked item was made");
      const binding = (stalker.bound ?? []).find((record) => record.kind === "monster");
      check(binding?.found && binding.ownId === stored[0].id, `the creature's entry links its stat block: ${JSON.stringify(stalker.bound)}`);
      const linkWords = (doc, entities) => {
        const named = new Map(entities.map((entity) => [entity.ref, entity.name]));
        return (doc.links ?? []).map((link) => `${named.get(link.from)} ${link.label} ${named.get(link.to)}`).sort();
      };
      const wantLinks = [`${name.abbess} lives in ${name.steeple}`, `${name.stalker} guards ${name.steeple}`].sort();
      check(JSON.stringify(linkWords(world.doc, world.entities)) === JSON.stringify(wantLinks), `the links with both ends made: ${JSON.stringify(linkWords(world.doc, world.entities))}`);

      // The made creature's row opens its World entry, which names the stat block.
      const row = page.locator(`${root}[data-testid="outline-task"]`, { hasText: name.stalker });
      check(/in Bestiary/.test(await row.innerText()), "the creature's row says it is in the Bestiary");
      await row.getByRole("button", { name: "World entry" }).click();
      const entryPage = page.locator(`${root}[data-tour="world-entry"]`).locator("visible=true").first();
      await eventually(async () => (await entryPage.locator("h3").first().innerText().catch(() => "")).includes(name.stalker), { timeoutMs: 20_000, label: "the creature's World entry" });
      const record = entryPage.locator('[data-testid="world-bound-record"]').first();
      await eventually(async () => /CR 3/.test(await record.innerText().catch(() => "")), { timeoutMs: 15_000, label: "the entry naming its stat block" });
      check((await record.innerText()).includes(name.stalker), "the entry's stat block is the creature made");
      await page.unroute(/\/api\/capabilities(\?|$)/);

      // ---- into a campaign through the lobby's import ----
      await t.open(`/campaigns/${campaignId}`);
      const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
      await startFrom.scrollIntoViewIfNeeded();
      await t.tap(startFrom);
      await t.tap(page.getByRole("menuitemradio", { name: shopTitle }).locator("visible=true").first());
      const worldSwitch = page.getByRole("switch", { name: /WorldForge/ }).locator("visible=true").first();
      await eventually(async () => (await worldSwitch.getAttribute("aria-checked")) === "true", { timeoutMs: 15_000, label: "WorldForge ticked with the workshop" });
      const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
      await eventually(() => bring.isEnabled(), { label: "Bring it in enabled" });
      await t.tap(bring);
      await eventually(async () => /Brought \d+ items? across/.test(await page.locator("body").innerText()), { timeoutMs: 30_000, label: "the import's note" });
      await t.shot("imported");

      // The lobby's own steps are not this journey's. With no storyteller on
      // this server the lead runs the table as its DM, so a player joins with
      // a ready-made hero, both are ready, and the table begins.
      const inviteCode = (await (await api.get(campaign)).json()).campaign.inviteCode;
      await signIn(playerContext, base, ids.player, ids.password);
      const joined = await playerContext.request.post(`${base}/api/campaigns/join`, { data: { inviteCode } });
      check(joined.ok(), `the player joined (${joined.status()})`);
      const hero = await playerContext.request.post(`${campaign}/sheet/pregen`, { data: { id: "brakk" } });
      check(hero.ok(), `the player's ready-made hero took a seat (${hero.status()}: ${await hero.text()})`);
      playerLibrary = (await hero.json()).sheet.libraryCharacterId ?? "";
      check((await playerContext.request.post(`${campaign}/ready`, { data: { ready: true } })).ok(), "the player is ready");
      check((await api.post(`${campaign}/ready`, { data: { ready: true } })).ok(), "the lead is ready");
      const begun = await api.patch(campaign, { data: { status: "active" } });
      check(begun.ok(), `the table began (${begun.status()}: ${await begun.text()})`);

      // ---- the campaign's World: the records, their links, the monster ----
      const here = await worldOf(campaign);
      const hereByName = Object.fromEntries((here.entities ?? []).map((entity) => [entity.name, entity]));
      check(JSON.stringify(Object.keys(hereByName).sort()) === JSON.stringify(names), `the campaign holds the three records: ${JSON.stringify(Object.keys(hereByName).sort())}`);
      check(JSON.stringify(linkWords(here.doc, here.entities)) === JSON.stringify(wantLinks), `and their links: ${JSON.stringify(linkWords(here.doc, here.entities))}`);
      const hereCast = (await (await api.get(`${campaign}/dm/npcs`)).json()).npcs.filter((npc) => npc.name.includes(stamp));
      check(hereCast.length === 1 && hereCast[0].id === hereByName[name.abbess].id && hereCast[0].id !== abbess.id, "the campaign's Cast holds its own copy of the person, as its entry's record");
      const hereBinding = (hereByName[name.stalker].bound ?? []).find((record) => record.kind === "monster");
      check(hereBinding?.found, `the creature's entry finds its stat block for this campaign: ${JSON.stringify(hereByName[name.stalker].bound)}`);
      const search = await (await api.get(`${base}/api/content/monsters?campaign=${campaignId}&q=${encodeURIComponent(name.stalker)}`)).json();
      check((search.results ?? []).some((row) => row.name === name.stalker), `the campaign's monster search finds the creature: ${JSON.stringify(search.results ?? search).slice(0, 200)}`);

      // ---- at the table, the World tab: the creature, then an edit ----
      await t.open(`/campaigns/${campaignId}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab's panel" });
      const openEntry = async (entryName) => {
        const option = panel.getByRole("option", { name: new RegExp(entryName) }).first();
        await eventually(() => option.count(), { timeoutMs: 20_000, label: `${entryName} in the campaign's wiki` });
        await option.scrollIntoViewIfNeeded();
        await t.tap(option);
        await eventually(() => panel.locator('[data-tour="world-entry"] h3', { hasText: entryName }).first().isVisible(), { timeoutMs: 15_000, label: `${entryName}'s page` });
        return panel.locator('[data-tour="world-entry"]').first();
      };
      const creaturePage = await openEntry(name.stalker);
      const tableRecord = creaturePage.locator('[data-testid="world-bound-record"]').first();
      await eventually(async () => /CR 3/.test(await tableRecord.innerText().catch(() => "")), { timeoutMs: 15_000, label: "the stat block named at the table" });
      check((await tableRecord.getByRole("button", { name: /Add to a fight/ }).count()) === 1, "the table can put the creature into a fight");
      await t.shot("table-creature");
      // Back to the list on a narrow panel, where the entry covers it.
      const back = creaturePage.getByRole("button", { name: "Back to the list" });
      if (await back.isVisible().catch(() => false)) await t.tap(back);
      const placePage = await openEntry(name.steeple);
      check(/A bell tower standing out of the water\./.test(await placePage.innerText()), "the place's text came across");
      await t.tap(placePage.locator('[data-tour="world-edit"]').first());
      const arrival = panel.getByRole("textbox", { name: /^On arrival/ });
      await eventually(() => arrival.isVisible(), { timeoutMs: 15_000, label: "the place's form at the table" });
      const edited = `A bell tower standing out of the water. At this table its bell is cracked ${stamp}.`;
      await arrival.fill(edited);
      await t.tap(panel.locator('form button[type="submit"]').first());
      await eventually(async () => (await panel.locator("form textarea").count()) === 0, { timeoutMs: 15_000, label: "the form closed after saving" });
      await eventually(async () => (await panel.locator('[data-tour="world-entry"]').first().innerText()).includes(`bell is cracked ${stamp}`), { timeoutMs: 15_000, label: "the entry showing the edit" });
      await t.shot("table-edited");

      // ---- the finish: the edit is the campaign's, the workshop's is as it was ----
      const after = await worldOf(campaign);
      const herePlace = after.entities.find((entity) => entity.name === name.steeple);
      check(herePlace?.text === edited, `the campaign's place holds the edit: ${JSON.stringify(herePlace?.text)}`);
      const shopAfter = await worldOf(shop);
      const shopPlace = shopAfter.entities.find((entity) => entity.name === name.steeple);
      check(shopPlace?.text === steeple.text && !shopPlace.text.includes(stamp), `the workshop's place is unchanged: ${JSON.stringify(shopPlace?.text)}`);
      check(JSON.stringify(linkWords(after.doc, after.entities)) === JSON.stringify(wantLinks), "the campaign's links survived the edit");
      check(JSON.stringify(linkWords(shopAfter.doc, shopAfter.entities)) === JSON.stringify(wantLinks), "the workshop's links are unchanged");
    } finally {
      await page.unroute(/\/api\/capabilities(\?|$)/).catch(() => {});
      // The monster is the user's, not the workshop's.
      for (const monster of await monsters().catch(() => [])) await api.delete(`${shop}/dm/bestiary/${monster.id}`).catch(() => {});
      for (const item of await items().catch(() => [])) await api.delete(`${base}/api/homebrew/${item.id}`).catch(() => {});
      await api.delete(campaign).catch(() => {});
      // The ready-made hero was saved to the player's library too.
      if (playerLibrary) await playerContext.request.delete(`${base}/api/characters/${playerLibrary}`).catch(() => {});
      await playerContext.close().catch(() => {});
      await api.delete(`${base}/api/workshops/${shopId}`).catch(() => {});
      model.server.close();
    }
  },
};
