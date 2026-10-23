// WF-23 journey: a creature article to a real monster to a prepared
// encounter to a running fight. In a workshop the lead opens a World article
// about a creature called "Bandit", makes its stat block from the article,
// rewrites that block (hit points, armour class, the attack's own name, and
// its creature type, which the Bestiary says is the picture every list and
// the board draw for it until it has a portrait: there is no portrait to
// give a monster), puts that exact monster into a new fight, brings the
// workshop into a campaign of their own as its human Dungeon Master, and
// deploys the fight from the DM console's prepared encounters.
//
// "Bandit" is on purpose: the genre's bestiary has its own Bandit, a
// humanoid with other numbers, and a fight told "Bandit" by name raises
// that one. The finish: the running fight's one combatant fights as the
// linked stat block, with its 77 hit points, armour class 17, its Tidal
// Lash in the DM's hand of cards and its construct type, in the fight's
// list as well as behind it; the player at the table sees the same foe and
// none of its numbers. Its face is its own type's, the construct plate, in
// the fight's list and everywhere else on the table: a stat block somebody
// wrote is drawn by its type, never by a plate its name happens to match
// (src/lib/placeholders.ts). This journey found it wearing the rulebook
// bandit's plate.
//
// The single steps are earlier scenarios': world-bindings (40) and
// create-chooser (41) make and link a stat block and add it to a fight,
// world-use-in-campaign (43) brings a workshop in. This one chains them and
// looks at the table. No storyteller is asked anything: the table has a
// person in the DM seat, and no model is called.
//
// Set up through the API, as none of it is the journey: the workshop, the
// article, the campaign (at level 3, where one CR 1 foe is a fight the
// engine allows) with the lead in the DM seat, and a second user
// (ids.player) seated with a ready-made hero and ready, since a human-run
// table opens only with a player at it; the adventure then begins by the
// route the lobby's Begin button calls. The stat block shares its name with
// the rulebook's, so it is deleted at the end with the workshop and the
// campaign. Keyboard only: the block's armour class and hit points typed
// into their fields, and its creature type picked from the list with the
// arrow keys and Enter.
import { check, eventually, newContext, openPanelTab, signIn } from "../lib.mjs";

const CREATURE = "Bandit";
const HP = 77;
const AC = 17;
const ATTACK = "Tidal Lash";

export default {
  name: "journey-creature-to-fight",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api, ids, viewport } = t;
    const stamp = Date.now().toString(36);
    const params = async () => (await t.url()).searchParams;
    const heading = (name) => page.locator(`${root}[data-tour="world-entry"] h3`, { hasText: name });
    const bound = page.locator(`${root}[data-testid="world-bound"]`);
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["world", "bestiary", "encounters"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });

    const shopTitle = `Sea wall prep ${stamp}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: shopTitle, description: "" } });
    check(made.ok(), "a workshop for the journey");
    const workshopId = (await made.json()).workshop.id;
    const tableTitle = `Sea wall table ${stamp}`;
    const table = await api.post(`${base}/api/campaigns`, { data: { title: tableTitle, startingLevel: 3, gameSettings: { ttsEnabled: false, dmMode: "human" } } });
    check(table.ok(), `a campaign the lead runs as its DM (${table.status()})`);
    const campaign = (await table.json()).campaign;
    const campaignId = campaign.id;
    const browser = page.context().browser();
    const playerContext = await newContext(browser, viewport, { app: false });
    let monsterId = "";
    let playerLibraryId = "";
    try {
      // ---- setup: the article, and a player seated and ready ----
      const article = (
        await (
          await api.post(`${base}/api/campaigns/${workshopId}/world/entities`, {
            data: { typeId: "t_other", name: CREATURE, text: "Barnacled iron in a brigand's coat, it walks out of the surf at low tide and robs the sea wall." },
          })
        ).json()
      ).entity;
      check(Boolean(article?.ref), "the creature's article");
      await signIn(playerContext, base, ids.player, ids.password);
      const player = playerContext.request;
      const code = campaign.inviteCode ?? (await (await api.get(`${base}/api/campaigns/${campaignId}`)).json()).campaign?.inviteCode;
      check(Boolean(code), "the table's invite code");
      check((await player.post(`${base}/api/campaigns/join`, { data: { inviteCode: code } })).ok(), "the player joins the table");
      const seated = await player.post(`${base}/api/campaigns/${campaignId}/sheet/pregen`, { data: { id: "kara" } });
      check(seated.ok(), `the player takes a ready-made hero (${seated.status()})`);
      playerLibraryId = (await seated.json()).sheet?.libraryCharacterId ?? "";
      check((await player.post(`${base}/api/campaigns/${campaignId}/ready`, { data: { ready: true } })).ok(), "the player is ready");
      check((await api.post(`${base}/api/campaigns/${campaignId}/ready`, { data: { ready: true } })).ok(), "the DM is ready");

      // ---- the article: a stat block made from it ----
      await t.open(`/workshop/${workshopId}?system=world&entry=${encodeURIComponent(article.ref)}`);
      await eventually(() => heading(CREATURE).count(), { timeoutMs: 30_000, label: "the creature's article" });
      await t.tap(bound.getByRole("button", { name: "A stat block" }));
      await t.tap(bound.getByRole("button", { name: /Make a new one/ }));
      const record = bound.locator('[data-testid="world-bound-record"]').first();
      await eventually(async () => (await record.innerText().catch(() => "")).includes(CREATURE), { timeoutMs: 15_000, label: "the new stat block linked" });
      const bestiary = async () => ((await (await api.get(`${base}/api/campaigns/${workshopId}/dm/bestiary`)).json()).monsters ?? []);
      const linkedRef = (await (await api.get(`${base}/api/campaigns/${workshopId}/world`)).json()).entities?.find((entry) => entry.ref === article.ref)?.entry?.bindings?.find((binding) => binding.kind === "monster")?.ref ?? "";
      monsterId = linkedRef.replace(/^homebrew:/, "");
      check(linkedRef.startsWith("homebrew:") && (await bestiary()).some((monster) => monster.id === monsterId), `the article links a stat block of the lead's own (${linkedRef})`);

      // ---- the stat block, made this creature's own ----
      await t.tap(record.getByRole("button", { name: "Open" }));
      const linked = page.locator('[data-testid="linked-entries"]');
      await eventually(() => linked.isVisible(), { timeoutMs: 20_000, label: "the stat block open in the Bestiary" });
      check((await params()).get("system") === "bestiary", "the stat block opened in the Bestiary");
      const editor = page.getByRole("dialog").filter({ has: linked });
      // Typed, not clicked: focus lands in the field and the keys do the rest.
      for (const [label, value] of [["AC", AC], ["Hit points", HP]]) {
        const field = editor.getByRole("spinbutton", { name: label, exact: true });
        await field.focus();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type(String(value));
        await page.keyboard.press("Enter");
        await eventually(async () => (await field.inputValue()) === String(value), { label: `${label} reads ${value}` });
      }
      // The type is the token: picked from its list by the arrow keys.
      const type = editor.getByRole("button", { name: "Type", exact: true });
      await type.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await eventually(() => menu.isVisible(), { label: "the creature types" });
      const highlighted = menu.locator("[data-highlighted]");
      const now = async () => (await highlighted.innerText().catch(() => "")).trim();
      let picked = false;
      for (let step = 0; step < 20 && !picked; step += 1) {
        const before = await now();
        await page.keyboard.press("ArrowDown");
        // Each press moves the highlight a row once the menu has drawn it.
        await eventually(async () => (await now()) !== before, { timeoutMs: 3_000, label: "the highlight moving" }).catch(() => {});
        picked = (await now()) === "Construct";
      }
      check(picked, `the arrow keys reach Construct (${await highlighted.innerText().catch(() => "nothing highlighted")})`);
      await page.keyboard.press("Enter");
      await eventually(async () => /Construct/.test(await type.innerText()), { label: "the block is a construct" });
      const attackName = editor.getByPlaceholder("Bite").first();
      await attackName.fill(ATTACK);
      await t.shot("block");
      await t.tap(editor.getByRole("button", { name: "Save the block" }));
      const block = await eventually(
        async () => {
          const monster = (await bestiary()).find((entry) => entry.id === monsterId);
          const stats = monster?.draft?.stats;
          return stats && stats.ac === AC && stats.maxHp === HP && stats.type === "construct" && stats.attacks?.[0]?.name === ATTACK ? stats : null;
        },
        { timeoutMs: 15_000, label: "the block saved with its own numbers, attack and type" },
      );

      // ---- that exact monster into a new fight ----
      await t.tap(linked.getByRole("button", { name: CREATURE }));
      await eventually(() => heading(CREATURE).count(), { timeoutMs: 20_000, label: "back on the article from the stat block" });
      const again = bound.locator('[data-testid="world-bound-record"]').first();
      await t.tap(again.getByRole("button", { name: /Add to a fight/ }));
      await t.tap(again.getByRole("button", { name: "Add it" }));
      await eventually(async () => (await params()).get("system") === "encounters" && Boolean((await params()).get("open")), { timeoutMs: 15_000, label: "the fight opened in Encounters" });
      const roster = page.getByRole("textbox", { name: "Roster" });
      await eventually(() => roster.isVisible(), { timeoutMs: 20_000, label: "the fight's editor" });
      // "Bandit" by name is the genre bestiary's: the roster holds the stat
      // block's own reference instead.
      check((await roster.inputValue()).includes(linkedRef), `the roster names that exact stat block: ${JSON.stringify(await roster.inputValue())}`);
      await page.keyboard.press("Escape");

      // ---- the workshop into the campaign ----
      await t.open(`/campaigns/${campaignId}`);
      const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
      await startFrom.scrollIntoViewIfNeeded();
      await t.tap(startFrom);
      await t.tap(page.getByRole("menuitemradio", { name: shopTitle }).locator("visible=true").first());
      const fights = page.getByRole("switch", { name: "Prepared encounters" }).locator("visible=true").first();
      await eventually(() => fights.count(), { timeoutMs: 15_000, label: "the Prepared encounters switch" });
      check((await fights.getAttribute("aria-checked")) === "true", "the fight is ticked to come along");
      const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
      await eventually(() => bring.isEnabled(), { label: "Bring it in enabled" });
      await t.tap(bring);
      await eventually(async () => /Brought \d+ items? across/.test(await page.locator("body").innerText()), { timeoutMs: 20_000, label: "the import's note" });
      const templates = (await (await api.get(`${base}/api/campaigns/${campaignId}/dm/encounter-templates`)).json()).templates ?? [];
      const fight = templates.find((entry) => (entry.enemies ?? []).some((enemy) => enemy.monster === linkedRef));
      check(Boolean(fight), `the campaign holds the fight with that stat block: ${JSON.stringify(templates.map((entry) => [entry.name, entry.enemies]))}`);

      // The adventure opens: the route the lobby's Begin button calls.
      const begun = await api.patch(`${base}/api/campaigns/${campaignId}`, { data: { status: "active" } });
      check(begun.ok(), `the adventure begins (${begun.status()}: ${await begun.text()})`);

      // ---- the prepared fight, deployed at the table ----
      await t.open(`/campaigns/${campaignId}`);
      await openPanelTab(t, "dm");
      const consoleTabs = page.locator(`${root}[data-tour="dm-console-tabs"]`).locator("visible=true").first();
      await eventually(() => consoleTabs.count(), { timeoutMs: 30_000, label: "the DM console" });
      await t.tap(consoleTabs.getByRole("button", { name: "Maps" }));
      const row = page.locator(`${root}li`).filter({ hasText: fight.name }).filter({ has: page.getByRole("button", { name: "Deploy", exact: true }) }).locator("visible=true").first();
      await eventually(() => row.count(), { timeoutMs: 20_000, label: "the prepared fight in the console" });
      await row.scrollIntoViewIfNeeded();
      await t.tap(row.getByRole("button", { name: "Deploy", exact: true }));
      // The table turns to the fight at once, so the console's own note is
      // gone by the time it could be read: the fight itself is the answer,
      // or the console's refusal.
      const view = async (request) => (await (await request.get(`${base}/api/campaigns/${campaignId}/encounter`)).json()).encounter;
      const refusal = page.locator(`${root}p.motion-shake`).locator("visible=true");
      const running = await eventually(
        async () => {
          if (await refusal.count()) throw new Error(`the console refused: ${await refusal.first().innerText()}`);
          return view(api);
        },
        { timeoutMs: 30_000, label: "the running fight" },
      );
      await t.shot("deployed");

      // ---- the finish: that monster, its numbers, its attack, its token ----
      const enemies = running.enemies ?? [];
      check(enemies.length === 1, `one combatant from the roster: ${JSON.stringify(enemies.map((enemy) => enemy.name))}`);
      const foe = enemies[0];
      check(foe.slug === linkedRef, `the combatant fights as the linked stat block (${foe.slug})`);
      check(foe.maxHp === HP && foe.currentHp === HP && foe.ac === AC, `with its own hit points and armour class (${foe.currentHp}/${foe.maxHp}, AC ${foe.ac})`);
      check(foe.type === "construct", `and its own creature type (${foe.type})`);
      check((foe.actions?.attacks ?? []).some((attack) => attack.name === ATTACK), `and its own attack: ${JSON.stringify((foe.actions?.attacks ?? []).map((attack) => attack.name))}`);

      // What the DM is handed to play it: its numbers and its attack, by name.
      // On a phone the fight opens over the table; the bar's Table cell is
      // where the hand sits, above the message box.
      if (viewport === "phone") {
        await t.tap(page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: "Table" }).first());
      }
      const card = page.locator(`${root}button.hand-card`).filter({ hasText: ATTACK }).locator("visible=true");
      await eventually(() => card.count(), { timeoutMs: 30_000, label: `the DM's hand holding ${ATTACK}` });
      check((await card.first().innerText()).includes(block.attacks[0].damage), `the card rolls the block's own damage, ${block.attacks[0].damage} (${await card.first().innerText()})`);
      const handFoe = page.locator(`${root}button`).filter({ hasText: CREATURE }).filter({ hasText: `${HP}/${HP} hp` }).locator("visible=true");
      await eventually(() => handFoe.count(), { label: `the hand naming ${CREATURE} at ${HP}/${HP} hp` });
      check((await handFoe.first().innerText()).includes(`AC ${AC}`), `and AC ${AC} (${await handFoe.first().innerText()})`);

      // The fight's list in the Party tab: the numbers, and the face it wears.
      await openPanelTab(t, "party");
      const line = page.locator(`${root}li`).filter({ hasText: CREATURE }).filter({ hasText: /CR\s/ }).locator("visible=true").first();
      await eventually(() => line.count(), { timeoutMs: 30_000, label: "the combatant in the fight's list" });
      await eventually(async () => (await line.innerText()).includes(`${HP}/${HP} AC ${AC}`), { label: `the list reading ${HP}/${HP} AC ${AC}` });
      await t.shot("combatant");
      const faces = await page.locator(`${root}img[src*="/monster/"]`).evaluateAll((images) => [...new Set(images.map((image) => image.getAttribute("src")))]);
      const face = (await line.locator("img").first().getAttribute("src")) ?? "";
      check(/\/monster\/construct\.webp$/.test(face), `the construct wears its own type's plate in the fight: ${face} (all: ${JSON.stringify(faces)})`);
      check(!faces.some((src) => /\/monster\/(bandit|humanoid)\.webp/.test(src)), `nowhere on the table does it wear the bandit's or a humanoid's plate: ${JSON.stringify(faces)}`);

      // The player at the same table sees the foe, never its numbers.
      const told = await view(player);
      const theirs = (told?.enemies ?? [])[0];
      check(theirs && theirs.name === foe.name && theirs.type === "construct", "the player sees the same foe by its own type");
      check(theirs.maxHp === undefined && theirs.ac === undefined && theirs.actions === undefined, "and is told none of its numbers");
    } finally {
      await api.delete(`${base}/api/campaigns/${campaignId}`).catch(() => {});
      if (monsterId) await api.delete(`${base}/api/campaigns/${workshopId}/dm/bestiary/${monsterId}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
      if (playerLibraryId) await playerContext.request.delete(`${base}/api/characters/${playerLibraryId}`).catch(() => {});
      await playerContext.close().catch(() => {});
    }
  },
};
