// The 2026-10-16 usability pass (docs/app-usability-audit-2026-10-16.md):
// the lobby's table settings in the campaign creator's named groups with a
// search that opens what it finds, the line that says what happens next, the
// three ways to a hero, the phone's More sheet reaching every tab, the
// Settings tab's contents row, the phone header's table menu, Help finding
// "volume" in its own words, and the home's menu inside its frame.
import { check, eventually, openPanelTab, sleep } from "../lib.mjs";

export default {
  name: "usability",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport, api, base } = t;

    // ---- the lobby ----
    await t.open(`/campaigns/${ids.lobbyId}`);
    const panel = page.locator(`${root}[data-table-settings="edit"]`).locator("visible=true").first();
    await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the lobby's table settings" });
    const groups = panel.locator("[data-group]");
    const count = await groups.count();
    check(count >= 10, `the creator's named groups are drawn (${count})`);
    for (let index = 0; index < count; index += 1) {
      const summary = (await groups.nth(index).locator(".cc-group-summary").textContent())?.trim() ?? "";
      check(summary.length > 3, `group ${index} says what is set inside ("${summary}")`);
    }
    const narration = panel.locator('[data-group="narration"]');
    check((await narration.getAttribute("data-open")) === null, "groups start closed");

    // A search by the everyday word opens the group that answers it.
    const find = panel.getByRole("textbox", { name: "Find a table setting" });
    await find.fill("microphone");
    await eventually(async () => (await panel.locator("[data-group]").count()) === 1, { label: "one group answers microphone" });
    const voice = panel.locator('[data-group="voiceChat"]');
    check((await voice.count()) === 1, "it is Live voice chat");
    check((await voice.getAttribute("data-open")) !== null, "and it opens");
    await t.shot("settings-search");
    await find.fill("");
    await eventually(async () => (await panel.locator("[data-group]").count()) === count, { label: "every group back" });

    // What happens next, and the three ways to a hero for a seat with none.
    const next = page.locator(`${root}[data-lobby-next]`).locator("visible=true").first();
    await eventually(() => next.count(), { label: "the lobby's next-step line" });
    check(/choose your hero/i.test(await next.textContent()), "the lead without a hero is told to choose one");
    const routes = page.locator(`${root}[data-hero-routes]`).locator("visible=true").first();
    await eventually(() => routes.count(), { label: "the hero routes" });
    await eventually(async () => (await routes.getAttribute("aria-busy")) === "false", { label: "the routes loaded" });
    for (const route of ["ready", "library", "build"]) {
      check((await routes.locator(`[data-hero-route="${route}"]`).count()) === 1, `the ${route} route is offered`);
    }
    // The lead has heroes in the library (the seed's), so the library is marked.
    const marked = await routes.locator('[data-hero-route="library"]').innerText();
    check(/Suggested/i.test(marked), "a player with heroes is pointed at the library");
    await t.tap(routes.locator('[data-hero-route="ready"]'));
    await eventually(() => page.locator(`${root}[data-tour="pregen-picker"]`).locator("visible=true").count(), {
      label: "the ready-made heroes open",
    });
    await routes.scrollIntoViewIfNeeded();
    await sleep(400);
    await t.shot("hero-routes");

    // ---- the table: every tab reachable, the Settings tab's contents ----
    await t.open(`/campaigns/${ids.campaignId}`);
    const how = await openPanelTab(t, "settings");
    if (viewport === "phone") {
      check(how === "more", "a lead's phone keeps Settings under More");
    } else {
      check(how === "direct", "a desktop rail shows Settings itself");
    }
    const contents = page.locator(`${root}nav[aria-label="Settings sections"]`).locator("visible=true").first();
    await eventually(() => contents.count(), { label: "the Settings tab's contents row" });
    for (const label of ["Campaign", "Table settings", "Story AI", "Rules"]) {
      check((await contents.getByRole("button", { name: label }).count()) === 1, `the contents row names ${label}`);
    }
    await t.shot("settings-tab");

    // A phone's header keeps room for the title: narration, sound, the
    // rulebook and help share one table menu, each row saying what it does.
    const title = await page.locator(`${root}.session-title`).locator("visible=true").first().boundingBox();
    check(title && title.width >= 100, `the campaign title keeps its room in the header (${Math.round(title?.width ?? 0)}px)`);
    if (viewport === "phone") {
      check((await page.locator(`${root}[data-tour="header-help"]`).locator("visible=true").count()) === 0, "a phone's Help sits in the table menu");
      await t.tap(page.locator(`${root}[data-tour="header-menu"]`).locator("visible=true").first());
      const menu = page.getByRole("menu");
      await eventually(() => menu.count(), { label: "the table menu" });
      for (const words of ["Every rule, spell and monster", "How everything works"]) {
        check((await menu.getByText(words).count()) === 1, `the table menu says "${words}"`);
      }
      await sleep(400);
      await t.shot("table-menu");
      await t.tap(menu.getByRole("menuitem", { name: /^Help/ }));
    } else {
      const help = page.locator(`${root}[data-tour="header-help"]`).locator("visible=true").first();
      await eventually(() => help.count(), { label: "the Help button" });
      await t.tap(help);
    }

    // Help finds "volume" in its sections' own words.
    const dialog = page.getByRole("dialog");
    await eventually(() => dialog.count(), { label: "the Help dialog" });
    const search = dialog.getByRole("textbox", { name: "Find a help topic" });
    await search.fill("volume");
    await eventually(async () => (await dialog.getByRole("button", { name: /Voice and narration/ }).count()) > 0, {
      label: "volume finds Voice and narration",
    });
    check(!/Nothing in Help mentions that/.test(await dialog.innerText()), "volume is not a dead end");
    await search.fill("zzzzqx");
    await eventually(async () => /Nothing in Help mentions that/.test(await dialog.innerText()), { label: "an unknown word says so" });
    await t.shot("help-search");
    await page.keyboard.press("Escape");

    // The character builder: your job in a fight comes first, with the
    // backgrounds that suit it, and a line counts the choices left.
    await t.open("/characters/new");
    const playstyle = page.getByRole("radiogroup", { name: "In a fight, what's your job?" }).locator("visible=true").first();
    await eventually(() => playstyle.count(), { timeoutMs: 30_000, label: "the playstyle question on step 1" });
    // The builder keeps every step mounted; the active one's line is the one read.
    const owed = page.locator(`${root}[data-active] [data-owed]`).first();
    await eventually(() => owed.count(), { label: "the choices-left line" });
    check(/choice.? left on this step/.test(await owed.innerText()) && /Name/.test(await owed.innerText()), `the line names what is owed ("${await owed.innerText()}")`);
    await t.tap(playstyle.getByRole("radio", { name: "Hold the line, take the hits" }));
    const hints = page.locator(`${root}[data-background-hints]`).locator("visible=true").first();
    await eventually(() => hints.count(), { label: "backgrounds that suit the playstyle" });
    await page.getByRole("textbox", { name: "Name" }).locator("visible=true").first().fill("Wren Ashdown");
    // No background is picked for the player: one of the suggested ones.
    await t.tap(hints.locator("button").first());
    await eventually(async () => (await page.locator(`${root}[data-active] [data-owed]`).count()) === 0, { label: "the line goes once nothing is owed" });
    await t.shot("builder-playstyle");

    // The workshop hub starts with four tasks; each opens Create on it.
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Usability tasks", description: "" } });
    check(made.ok(), "a workshop for the hub");
    const workshopId = (await made.json()).workshop.id;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-hub", version: 1, how: "ended" }] } });
    await t.open(`/workshop/${workshopId}`);
    const tasks = page.locator(`${root}[data-hub-tasks]`).locator("visible=true").first();
    await eventually(() => tasks.count(), { timeoutMs: 30_000, label: "the hub's task row" });
    check((await tasks.locator("[data-hub-task]").count()) === 4, "four tasks to start with");
    await t.tap(tasks.locator('[data-hub-task="encounter"]'));
    const chooser = page.getByRole("dialog");
    await eventually(() => chooser.locator('[data-testid="create-steps"]').count(), { label: "Create opens on the fight" });
    check(/Encounter/.test(await chooser.innerText()), "the chooser is on Encounter");
    await t.shot("hub-task");
    await page.keyboard.press("Escape");

    // A species of the DM's own takes the Dragonborn's ancestry and breath
    // from the published traits, by name, not typed from memory (a player's
    // "Half-Dragon"), and the editor says what the player will be asked.
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-homebrew", version: 1, how: "ended" }] } });
    await t.open(`/workshop/${workshopId}?system=homebrew`);
    const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
    await eventually(() => kinds.count(), { timeoutMs: 30_000, label: "the homebrew shelf" });
    await t.tap(kinds.getByText(/^Species/).first());
    await t.tap(page.getByRole("button", { name: /New species/ }).locator("visible=true").first());
    const traitSearch = page.getByRole("textbox", { name: "Search the published species traits" }).locator("visible=true").first();
    await eventually(() => traitSearch.count(), { timeoutMs: 20_000, label: "the published-trait search in the species editor" });
    const traitsBox = page.getByRole("textbox", { name: /^Traits/ }).locator("visible=true").first();
    for (const [typed, trait] of [["draconic", "Draconic Ancestry"], ["breath", /^Breath Weapon/]]) {
      await traitSearch.fill(typed);
      const pick = page.locator("[data-species-trait-picker] li button").filter({ hasText: trait }).locator("visible=true").first();
      await eventually(() => pick.count(), { timeoutMs: 20_000, label: `${typed} among the published traits` });
      await t.tap(pick);
    }
    const written = await traitsBox.inputValue();
    check(/\*\*_Draconic Ancestry\._\*\*/.test(written) && /\*\*_Breath Weapon/.test(written), `the traits were written in the book's words: ${JSON.stringify(written.slice(0, 120))}`);
    const note = page.locator(`${root}[data-draconic-note]`).locator("visible=true").first();
    await eventually(async () => /breath weapon's damage and save/.test(await note.innerText().catch(() => "")), { label: "the editor saying the player picks a dragon" });
    // A resistance is picked too, written as the trait name the damage
    // engine reads, and the editor says what the table will resist.
    await page.getByRole("combobox", { name: "Add a resistance" }).locator("visible=true").first().selectOption("fire");
    const resists = page.locator(`${root}[data-species-resists]`).locator("visible=true").first();
    await eventually(async () => /Resists at the table: fire\./.test(await resists.innerText().catch(() => "")), { label: "the editor naming the resistance" });
    check(/\*\*_Fire Resistance\._\*\*/.test(await traitsBox.inputValue()), "the picked resistance is a trait named as the table reads it");
    await t.shot("species-draconic");
    await page.keyboard.press("Escape");

    // The home's menu stays inside the title screen's frame on a short
    // laptop window: the ways in and your places stand side by side.
    if (viewport === "desktop" && !t.app) {
      await page.setViewportSize({ width: 1366, height: 768 });
      await t.open("/");
      const rulebook = page.locator('[data-tour="tile-rulebook"]').first();
      await eventually(() => rulebook.count(), { label: "the home's menu" });
      await sleep(1_500);
      const frame = await page.locator(".ts-first").boundingBox();
      for (const tour of ["tile-rulebook", "tile-join", "tile-workshop"]) {
        const box = await page.locator(`[data-tour="${tour}"]`).first().boundingBox();
        check(box && frame && box.y + box.height <= frame.y + frame.height - 40, `${tour} sits inside the frame (${Math.round(box?.y ?? 0)})`);
      }
      await t.shot("home-laptop");
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
  },
};
