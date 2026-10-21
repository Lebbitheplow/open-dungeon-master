// Client issue 46: the table's panels move and resize, the arrangement is
// this browser's own and comes back after a reload, Reset always gives the
// table's own arrangement back, and none of it disturbs play: a draft in
// the composer, the board and the side panel's contents carry on through
// every move, and the server never hears of it. A phone keeps its bottom
// bar whatever a wide window arranged.
import { readFileSync } from "node:fs";
import { check, eventually, sleep, openPanelTab, newContext, signIn } from "../lib.mjs";

const KEY = "odm:table-layout:player";

const readLayout = (page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), KEY);
const clearLayouts = (page) =>
  page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("odm:table-layout:") || key === "odm_side_panel_wide") window.localStorage.removeItem(key);
    }
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
// What a reload reads: the saved arrangement again, not the page's memory
// of it (the apps keep their screens across a visit, so a reload there is
// the store forgetting and reading localStorage afresh).
const rereadLayouts = (page) => page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));

const boxOf = (locator) => locator.boundingBox();

// The table's first-visit tour opens a moment after the table does, over
// everything; closed first, so it never takes the first drag as its click.
async function dismissTour(page) {
  const tour = page.locator('[role="dialog"][aria-label="Guided tour"]');
  await eventually(() => tour.count(), { timeoutMs: 4_000 }).catch(() => 0);
  for (let attempt = 0; attempt < 3 && (await tour.count()); attempt += 1) {
    await page.keyboard.press("Escape");
    await sleep(250);
  }
}

async function drag(page, from, dx, dy, steps = 8) {
  const box = await boxOf(from);
  check(Boolean(box), "the thing to drag is on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await sleep(120);
  await page.mouse.up();
  await sleep(300);
}

export default {
  name: "table-layout",
  viewports: ["desktop", "laptop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const layoutCalls = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.includes("/api/") && /layout|arrange/i.test(pathname)) layoutCalls.push(request.url());
    });
    let addonInstalled = true;
    const installFixture = async (target) => {
      await target.addInitScript(() => window.addEventListener("message", (event) => {
        if (event.data?.odm !== 1 || event.data.type !== "camera-state") return;
        const frame = [...document.querySelectorAll("iframe")].find((node) => node.contentWindow === event.source);
        if (frame) frame.dataset.camera = JSON.stringify(event.data);
      }));
      await target.route("**/api/addons", (route) => route.fulfill({ json: {
        supported: true, workshopImporters: [], mapGenerators: [],
        boardViews: addonInstalled ? [undefined, "stage"].map((sessionLayout) => ({ addonId: "portrait-fixture", addonName: "Fixture", addonVersion: "1.0.0", id: sessionLayout ?? "table", title: sessionLayout ? "Fixture session" : "Fixture table", description: "", needsViewData: false, sessionLayout, options: [{ key: "detail", label: "Detail", type: "boolean", default: true }], url: "/api/addons/portrait-fixture/ui/index.html" })) : [],
      } }));
      await target.route("**/api/addons/portrait-fixture/ui/**", (route) => {
        const script = new URL(route.request().url()).pathname.endsWith("board.js");
        const body = readFileSync(new URL(`../../../examples/addons/hello-dungeon/ui/board.${script ? "js" : "html"}`, import.meta.url), "utf8");
        return route.fulfill({ contentType: script ? "text/javascript" : "text/html", body: script ? body : body.replace('<script src="board.js">', `<script>addEventListener('message', e => { if(e.source === parent && e.data?.odm === 1) document.body.dataset.message = e.data.type; });</script><script src="board.js">`) });
      });
    };
    const cameraOf = async (frame) => JSON.parse(await frame.getAttribute("data-camera") ?? "null");
    const checkViewport = async (frame) => {
      await eventually(() => frame.evaluate((node) => {
        const viewport = node.closest(".board-view");
        const a = node.getBoundingClientRect(), b = viewport.getBoundingClientRect();
        const style = getComputedStyle(viewport), scale = b.width / viewport.offsetWidth;
        const left = parseFloat(style.borderLeftWidth) * scale, right = parseFloat(style.borderRightWidth) * scale;
        const top = parseFloat(style.borderTopWidth) * scale, bottom = parseFloat(style.borderBottomWidth) * scale;
        const wrapper = viewport.querySelector(":scope > div[style*='transform-origin']");
        return Math.max(Math.abs(a.x - b.x - left), Math.abs(a.y - b.y - top), Math.abs(a.width - b.width + left + right), Math.abs(a.height - b.height + top + bottom)) < 2 && getComputedStyle(wrapper).transform === "none";
      }), { label: "the session renderer filling its viewport without a flat-board transform" });
    };
    if (viewport === "desktop" && !t.app) await installFixture(page);
    await t.open(`/campaigns/${ids.campaignId}`);
    await dismissTour(page);
    await clearLayouts(page);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    const row = page.locator(`${root}.cine-row`).first();
    const slot = (id) => page.locator(`${root}.tlay-slot[data-pane="${id}"]`).first();
    const composer = page.locator(`${root}[data-tour="composer-input"] textarea`).locator("visible=true").first();
    const menuButton = page.locator(`${root}[data-tour="header-layout"]`);

    if (viewport === "phone") {
      // A saved arrangement from a wide window: Notes in a pane of its own.
      await page.evaluate((key) => {
        const layout = {
          version: 1,
          locked: false,
          chronicle: null,
          floating: [],
          columns: [
            { width: 236, panes: [{ id: "rail", size: 1 }] },
            { width: null, panes: [{ id: "table", size: 1 }] },
            { width: 384, panes: [{ id: "panel", size: 0.5 }, { id: "tab:notes", size: 0.5 }] },
          ],
        };
        window.localStorage.setItem(key, JSON.stringify(layout));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      }, KEY);
      await sleep(800);
      check(!(await menuButton.isVisible().catch(() => false)), "a phone has no layout menu");
      check((await row.getAttribute("data-tlay")) === null, "a phone's row is never rearranged");
      check((await page.locator(`${root}.cine-row [role="separator"]`).count()) === 0, "a phone has no lines to drag");
      check((await page.locator(`${root}.tlay-slot[data-pane="tab:notes"]`).count()) === 0, "no pane of its own on a phone");
      // Notes is in the phone's bar, or under More when the bar is full.
      const how = await openPanelTab(t, "notes");
      check(how === "direct" || how === "more", "Notes is reachable from the phone's bottom bar");
      await eventually(() => page.locator(`${root}.cine-panel`).locator("visible=true").count(), { label: "the phone's panel opening on Notes" });
      await t.shot("phone");
      await clearLayouts(page);
      return;
    }

    // ---- the table's own arrangement, its widths the reader's ----
    check((await row.getAttribute("data-tlay")) === null, "the table's own arrangement draws the flex row it always had");
    const panel = page.locator(`${root}.cine-panel`).first();
    const panelBefore = (await boxOf(panel)).width;
    check(Math.abs(panelBefore - 384) <= 1, `the side panel opens at 24rem (${panelBefore})`);
    await composer.fill("A draft that outlives every move");
    const panelLine = page.locator(`${root}[role="separator"][aria-label="Resize Side panel"]`).first();
    await eventually(() => panelLine.count(), { label: "the line beside the side panel" });
    await drag(page, panelLine, -120, 0);
    const panelAfter = (await boxOf(panel)).width;
    check(Math.abs(panelAfter - (panelBefore + 120)) <= 4, `dragging the line widens the panel by what it moved (${panelBefore} to ${panelAfter})`);
    await eventually(async () => Math.abs(((await readLayout(page))?.columns?.at(-1)?.width ?? 0) - panelAfter) <= 4, {
      label: "the panel's width saved in this browser",
    });
    check((await row.getAttribute("data-tlay")) === null, "a resize keeps the flex row");

    // ---- the fight stage's scroll ----
    const chronicleLine = page.locator(`${root}[role="separator"][aria-label="Resize the chronicle"]`).first();
    if (viewport === "desktop") {
      await eventually(() => chronicleLine.count(), { label: "the line beside the chronicle" });
      const portraits = slot("rail");
      check((await portraits.count()) === 0, "the built-in stage unmounts portraits even with an addon installed");
      await t.tap(page.getByRole("button", { name: "Show the story", exact: true }));
      await eventually(() => portraits.isVisible(), { label: "portraits returning with the story" });
      await t.tap(page.getByRole("button", { name: "Show the board", exact: true }));
      await eventually(async () => (await portraits.count()) === 0, { label: "built-in stage unmounting portraits" });
      check(Math.abs((await boxOf(page.locator(`${root}.cine-chat`).first())).x - (await boxOf(row)).x) <= 1, "hidden portraits reserve no column beside the stage");
      const scroll = page.locator(`${root}.cine-chat-staged > .cine-fight > .cine-chronicle`).first();
      const before = (await boxOf(scroll)).width;
      await drag(page, chronicleLine, 80, 0);
      const after = (await boxOf(scroll)).width;
      check(after > before + 40, `the chronicle widens when its line is dragged (${before} to ${after})`);
      await eventually(async () => (await readLayout(page))?.chronicle > 0, { label: "the chronicle's width saved" });
    }

    // Too far: the table keeps its floor.
    await drag(page, panelLine, -4000, 0, 12);
    const table = page.locator(`${root}.cine-chat`).first();
    check((await boxOf(table)).width >= 355, `the table keeps room for the story (${(await boxOf(table)).width})`);
    check((await composer.inputValue()) === "A draft that outlives every move", "the draft survives resizing");

    // ---- arranging ----
    // The board's picture and the composer are marked, so it can be told
    // afterwards that no move remounted them (a remount is a new element).
    await page.evaluate((prefix) => {
      window.__tlayBoard = document.querySelector(`${prefix}[aria-label^="Board view"] canvas[data-painted-map]`);
      window.__tlayComposer = document.querySelector(`${prefix}[data-tour="composer-input"] textarea`);
    }, root);
    await t.tap(menuButton.first());
    await t.tap(page.getByRole("menuitem", { name: /arrange the table/i }).first());
    await eventually(() => page.locator(`${root}.tlay-arrange`).count(), { label: "the arrange bar" });
    check((await row.getAttribute("data-tlay")) === "custom", "arranging draws each panel in its place");
    if (viewport === "desktop") {
      // Placed, the fight stage keeps its own grid: the scroll beside the board, not above it.
      const scrollBox = await boxOf(page.locator(`${root}.cine-chat-staged > .cine-fight > .cine-chronicle`).first());
      const boardBox = await boxOf(page.locator(`${root}.cine-chat-staged > .cine-fight > .cine-fight-board`).first());
      check(scrollBox.x + scrollBox.width <= boardBox.x + 2, "the staged board stays beside the chronicle while arranging");
    }
    await t.shot("arranging");
    const arrange = page.locator(`${root}.tlay-arrange`).first();
    for (const name of ["Notes", "Story"]) {
      await t.tap(arrange.locator("button").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first());
      await sleep(400);
    }
    await eventually(() => slot("tab:notes").isVisible(), { label: "Notes in a pane of its own" });
    await eventually(() => slot("tab:story").isVisible(), { label: "Story in a pane of its own" });
    check(
      (await page.locator(`${root}.cine-rail [data-tour="tab-notes"]`).count()) === 0,
      "a tab with a pane leaves the side panel's rail",
    );
    check((await slot("tab:notes").locator('[data-tour="tab-notes"]').count()) === 1, "the pane's bar answers the tour's Notes step");
    check((await composer.inputValue()) === "A draft that outlives every move", "the draft survives new panes");

    // The keyboard moves a pane: left joins the table's column, right brings it back.
    const notesGrip = page.locator(`${root}button[aria-label="Move Notes"]`).first();
    const notesX = (await boxOf(slot("tab:notes"))).x;
    await notesGrip.focus();
    await page.keyboard.press("ArrowLeft");
    await eventually(async () => (await boxOf(slot("tab:notes"))).x < notesX - 50, { label: "Notes moving left with the arrow key" });
    check(await notesGrip.evaluate((node) => node === document.activeElement), "the grip keeps focus as its pane moves");
    await page.keyboard.press("ArrowRight");
    await eventually(async () => Math.abs((await boxOf(slot("tab:notes"))).x - notesX) < 2, { label: "Notes back with the other arrow" });

    // Dragging a pane by its grip to the far edge opens a column there.
    const rowBox = await boxOf(row);
    const grip = await boxOf(notesGrip);
    await page.mouse.move(grip.x + 30, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(rowBox.x + rowBox.width - 6, rowBox.y + rowBox.height / 2, { steps: 10 });
    await sleep(200);
    check((await page.locator(`${root}.tlay-drop`).count()) === 1, "the place it would land shows while it is dragged");
    await page.mouse.up();
    await eventually(async () => {
      const saved = await readLayout(page);
      return saved?.columns?.at(-1)?.panes?.[0]?.id === "tab:notes";
    }, { label: "Notes docked in a new column at the end of the row" });
    const notesBox = await boxOf(slot("tab:notes"));
    check(Math.abs(notesBox.x + notesBox.width - (rowBox.x + rowBox.width)) <= 2, "the new column sits at the row's edge");

    // Floating: in the row, and still whole when the window shrinks.
    await t.tap(page.locator(`${root}button[aria-label="Float Story"]`).first());
    await eventually(() => slot("tab:story").getAttribute("data-floating").then((value) => value !== null), { label: "Story afloat" });
    await drag(page, page.locator(`${root}button[aria-label="Move Story"]`).first(), 2000, 2000, 10);
    const size = page.viewportSize();
    await page.setViewportSize({ width: 1100, height: 700 });
    await sleep(700);
    const inside = async () => {
      const rowNow = await boxOf(row);
      const story = await boxOf(slot("tab:story"));
      return story.x >= rowNow.x - 1 && story.y >= rowNow.y - 1 && story.x + story.width <= rowNow.x + rowNow.width + 1 && story.y + story.height <= rowNow.y + rowNow.height + 1;
    };
    check(await inside(), "a floating pane stays inside the row when the window shrinks");
    check((await boxOf(table)).width >= 355, "the table keeps its floor in a small window");
    await page.setViewportSize(size);
    await sleep(500);
    await t.tap(page.locator(`${root}button[aria-label="Dock Story"]`).first());
    await eventually(() => slot("tab:story").getAttribute("data-floating").then((value) => value === null), { label: "Story docked again" });

    // A pane set aside keeps what was typed in it.
    const noteTitle = slot("tab:notes").locator("input").first();
    await noteTitle.fill("A note half written");
    await t.tap(page.locator(`${root}button[aria-label="Hide Notes"]`).first());
    await eventually(() => slot("tab:notes").evaluate((node) => node.hidden), { label: "Notes set aside" });
    await t.tap(arrange.locator("button").filter({ hasText: /show notes/i }).first());
    await eventually(() => slot("tab:notes").evaluate((node) => !node.hidden), { label: "Notes shown again" });
    check((await noteTitle.inputValue()) === "A note half written", "a pane shown again still holds what was typed in it");
    await noteTitle.fill("");
    check(
      await page.evaluate(() => Boolean(window.__tlayComposer?.isConnected && (!window.__tlayBoard || window.__tlayBoard.isConnected))),
      "the board and the composer are the same elements after every move: nothing was remounted",
    );

    // Done: the arrangement stays, the bar goes.
    await t.tap(arrange.getByRole("button", { name: /^\s*done\s*$/i }).first());
    await eventually(async () => (await page.locator(`${root}.tlay-arrange`).count()) === 0, { label: "the arrange bar closing" });
    check((await row.getAttribute("data-tlay")) === "custom", "the arrangement stays after Done");
    check((await composer.inputValue()) === "A draft that outlives every move", "the draft survives the whole arrangement");
    await t.shot("arranged");

    // ---- kept: the same arrangement after a reload ----
    const saved = await readLayout(page);
    if (t.app) {
      await rereadLayouts(page);
    } else {
      await page.reload({ waitUntil: "networkidle" });
      await sleep(1_500);
    }
    await eventually(() => slot("tab:notes").isVisible(), { timeoutMs: 30_000, label: "Notes' pane after the reload" });
    check(JSON.stringify(await readLayout(page)) === JSON.stringify(saved), "the saved arrangement reads back as itself");
    check((await row.getAttribute("data-tlay")) === "custom", "the arrangement is drawn again after the reload");

    // ---- maximize and hide keep what a pane holds ----
    await composer.fill("Still here after a maximize");
    await t.tap(page.locator(`${root}button[aria-label="Maximize Notes"]`).first());
    await eventually(async () => {
      const notes = await boxOf(slot("tab:notes"));
      const rowNow = await boxOf(row);
      return Math.abs(notes.width - rowNow.width) <= 2 && Math.abs(notes.height - rowNow.height) <= 2;
    }, { label: "Notes filling the row" });
    check(await slot("table").evaluate((node) => node.hidden), "the table is out of sight, not gone");
    await page.keyboard.press("Escape");
    await eventually(() => slot("table").evaluate((node) => !node.hidden), { label: "Escape restoring the arrangement" });
    check((await composer.inputValue()) === "Still here after a maximize", "the draft survives a maximize");
    await t.tap(page.locator(`${root}button[aria-label="Hide Notes"]`).first());
    await eventually(() => slot("tab:notes").evaluate((node) => node.hidden), { label: "Notes hidden" });

    // ---- lock, then reset ----
    await t.tap(menuButton.first());
    await t.tap(page.getByRole("menuitemcheckbox", { name: /lock layout/i }).first());
    await sleep(400);
    check((await page.locator(`${root}.cine-row [role="separator"]`).count()) === 0, "a locked arrangement has no lines to drag");
    check((await page.locator(`${root}button[aria-label="Move Notes"], ${root}button[aria-label="Hide Story"]`).count()) === 0, "nor anything that moves or hides a pane");
    await t.tap(menuButton.first());
    check((await page.getByRole("menuitem", { name: /arrange the table/i }).count()) === 0, "locked, the menu offers no arranging");
    await t.tap(page.getByRole("menuitemcheckbox", { name: /lock layout/i }).first());
    await sleep(300);
    await t.tap(menuButton.first());
    await t.tap(page.getByRole("menuitem", { name: /reset layout/i }).first());
    await eventually(async () => (await row.getAttribute("data-tlay")) === null, { label: "Reset bringing back the flex row" });
    check((await page.locator(`${root}.tlay-slot[data-pane^="tab:"]`).count()) === 0, "Reset puts every tab back in the rail");
    check((await page.locator(`${root}.cine-rail [data-tour="tab-notes"]`).count()) === 1, "Notes is back in the rail");
    check(Math.abs((await boxOf(panel)).width - 384) <= 1, "the side panel is at 24rem again");
    check((await composer.inputValue()) === "Still here after a maximize", "the draft survives Reset");
    await composer.fill("");

    if (viewport === "desktop" && !t.app) {
      const addon = page.getByRole("radio", { name: "Fixture table", exact: true });
      const session = page.getByRole("radio", { name: "Fixture session", exact: true });
      const originalSize = page.viewportSize();
      await page.setViewportSize({ ...originalSize, height: 650 });
      await eventually(async () => {
        const box = await boxOf(composer);
        return box && box.y + box.height <= 650;
      }, { label: "native input remaining visible in a short window" });
      check(await page.locator(`${root}.hand`).evaluate(node => getComputedStyle(node).overflowY) === "auto", "native short-window hand still yields space to the input");
      await page.setViewportSize(originalSize);
      await t.tap(addon);
      check((await slot("rail").count()) === 0, "a board-only addon leaves the native session layout alone");
      const nativeLayout = JSON.stringify(await readLayout(page));
      await composer.fill("A draft across presentation changes");
      await page.evaluate((prefix) => { window.__sessionNative = [".cine-chronicle", ".cine-fight-board", ".cine-panel", '[data-tour="composer-input"] textarea', ".hand"].map(s => document.querySelector(prefix + s)); }, root);
      await t.tap(session);
      await eventually(() => row.getAttribute("data-presentation").then(v => v === "stage"), { label: "addon session composition" });
      check(await page.evaluate((prefix) => window.__sessionNative.every((n,i) => n && n === document.querySelector(prefix + [".cine-chronicle", ".cine-fight-board", ".cine-panel", '[data-tour="composer-input"] textarea', ".hand"][i])), root), "native regions, hand and composer keep their DOM identity when the preset activates");
      const party = await boxOf(page.locator(`${root}[data-tour="party-rail"]`));
      const chronicle = await boxOf(page.locator(`${root}.cine-fight > .cine-chronicle`));
      const board = await boxOf(page.locator(`${root}.cine-fight-board`));
      const entry = await boxOf(page.locator(`${root}.session-compose-entry`));
      const hand = await boxOf(page.locator(`${root}.session-compose-hand`));
      const side = await boxOf(page.locator(`${root}.cine-panel`));
      check(Math.abs(party.x - chronicle.x) < 2 && party.y + party.height <= chronicle.y + 1, "Party is above Chronicle in the left column");
      check(board.x >= chronicle.x + chronicle.width && side.x >= board.x + board.width && board.width > side.width, "tabletop dominates the center with native controls at right");
      check(Math.abs(entry.x - chronicle.x) < 2 && entry.y >= chronicle.y + chronicle.height - 1, "native composer sits below Chronicle");
      check(hand.x >= board.x - 1 && hand.y >= board.y + board.height - 1, "native hand stays below the board");
      check(await composer.evaluate(node => node.form === document.querySelector(".hand")?.closest("form")), "hand and typed commands still share the native form");
      const rendered = page.locator(`${root}.cine-fight-board iframe`);
      await eventually(() => cameraOf(rendered), { label: "public example camera report" });
      await checkViewport(rendered);
      const fitted = (await cameraOf(rendered)).zoom;
      await t.tap(page.getByRole("button", { name: "Zoom in", exact: true }));
      await eventually(async () => (await cameraOf(rendered)).zoom > fitted, { label: "native zoom steering the renderer" });
      await t.tap(page.getByRole("button", { name: "Fit the board", exact: true }));
      await eventually(async () => (await cameraOf(rendered)).zoom === 1, { label: "native fit steering the renderer" });
      await t.tap(page.getByRole("button", { name: "Enlarge battle map", exact: true }));
      const enlarged = page.getByRole("dialog").locator("iframe");
      await eventually(() => cameraOf(enlarged), { label: "enlarged public example camera" });
      await checkViewport(enlarged);
      await t.tap(page.getByRole("button", { name: "Close the board", exact: true }));
      // The enlarged board keeps its own copy of the view's controls until
      // its dialog has finished closing; options opened from that copy go
      // with it. Wait for it to be gone, then use the board's own.
      await eventually(async () => (await page.getByRole("dialog").count()) === 0, { label: "the enlarged board closed" });
      await t.tap(page.getByRole("button", { name: "Fixture session options", exact: true }).locator("visible=true"));
      await t.tap(page.getByRole("switch", { name: "Detail", exact: true }));
      await page.keyboard.press("Escape");
      await page.evaluate((prefix) => { window.__sessionParty = document.querySelector(`${prefix}[data-tour="party-rail"]`); window.__sessionFrame = document.querySelector(`${prefix}.cine-fight-board iframe`); }, root);
      await t.tap(page.getByRole("button", { name: "Show the story", exact: true }));
      await eventually(() => page.locator(`${root}.session-transcript`).isVisible(), { label: "native transcript in the center" });
      await t.tap(page.getByRole("button", { name: "Fixture session options", exact: true }).locator("visible=true"));
      check(await page.getByRole("switch", { name: "Detail", exact: true }).getAttribute("aria-checked") === "false", "board and session controls share the same live view options");
      await page.keyboard.press("Escape");
      await t.tap(page.getByRole("button", { name: "Show the board", exact: true }));
      check(await page.evaluate((prefix) => window.__sessionParty === document.querySelector(`${prefix}[data-tour="party-rail"]`) && window.__sessionFrame === document.querySelector(`${prefix}.cine-fight-board iframe`), root), "Party and renderer stay mounted across story/board switching");
      check((await composer.inputValue()) === "A draft across presentation changes", "native composer draft survives presentation changes");
      check(JSON.stringify(await readLayout(page)) === nativeLayout, "the preset does not overwrite the saved native layout");
      await t.shot("addon-session");
      await t.tap(page.getByRole("radio", { name: "Board", exact: true }));
      await eventually(async () => (await slot("rail").count()) === 0, { label: "disabling the addon restoring native unmounting" });
      check((await row.getAttribute("data-presentation")) === null, "native composition returns when disabled");
      await composer.fill("");

      // Activation from native Story must retain the side-panel board owner.
      await t.tap(page.getByRole("button", { name: "Show the story", exact: true }));
      await openPanelTab(t, "battle");
      const storyBoard = page.locator(`${root}.cine-panel .board-panel`).first();
      const storyFrame = storyBoard.locator(".board-view").first();
      await eventually(() => storyFrame.isVisible(), { label: "native Story's side-panel board" });
      // Move the token clear of the native initiative overlay before selecting it.
      await storyFrame.focus();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      await t.tap(storyFrame.getByRole("img", { name: /^Tavi Lockwhisper/ }).first());
      await eventually(() => storyBoard.getByRole("menu", { name: "Actions for Tavi Lockwhisper" }).count(), { label: "native selected token" });
      await t.tap(storyBoard.getByTitle("Point at a tile", { exact: true }));
      await storyFrame.focus();
      await page.keyboard.press("+");
      await page.keyboard.press("ArrowRight");
      const cameraState = () => storyFrame.locator(":scope > div[style*='transform:']").first().evaluate((node) => {
        const m = new DOMMatrix(getComputedStyle(node).transform);
        return { zoom: m.a, x: m.e / node.parentElement.clientWidth, y: m.f / node.parentElement.clientWidth };
      });
      const storyCamera = await cameraState();
      await composer.fill("Story activation draft");
      await page.evaluate((prefix) => { window.__storyBoard = document.querySelector(`${prefix}.cine-panel .board-panel`); window.__storyFrame = window.__storyBoard.querySelector(".board-view"); }, root);
      await t.tap(session);
      await eventually(() => row.getAttribute("data-presentation").then(v => v === "stage"), { label: "session activated from native Story" });
      check(await page.evaluate(() => window.__storyBoard.isConnected && window.__storyFrame.isConnected), "native Story activation keeps the same board and camera frame mounted");
      check(await page.locator(`${root}.board-panel`).count() === 1, "Story activation does not duplicate the native board");
      await checkViewport(storyFrame.locator("iframe"));
      check(await storyBoard.getByRole("menu", { name: "Actions for Tavi Lockwhisper" }).count() === 1 && await storyBoard.getByTitle("Point at a tile", { exact: true }).getAttribute("aria-pressed") === "true", "native selection and local board controls survive activation");
      await openPanelTab(t, "notes");
      check(await page.evaluate(() => window.__storyBoard.isConnected), "the centered board stays mounted when native side controls change tabs");
      await openPanelTab(t, "battle");
      const rightControls = page.locator(`${root}[data-session-region="controls"]`);
      await eventually(() => rightControls.getByText("Tavi Lockwhisper", { exact: true }).first().evaluate((node) => {
        for (let parent = node; parent; parent = parent.parentElement) if (Number(getComputedStyle(parent).opacity) < 0.99) return false;
        return true;
      }), { label: "native character controls visible beside the retained board" });
      const centered = await boxOf(storyBoard);
      const rightBox = await boxOf(rightControls);
      check(centered.x >= (await boxOf(page.locator(`${root}[data-tour="party-rail"]`))).x + 200 && rightBox.x >= centered.x + centered.width, "the retained board occupies the center and native controls remain at right");
      await t.shot("addon-from-story");
      await t.tap(page.getByRole("radio", { name: "Board", exact: true }));
      await eventually(() => row.getAttribute("data-presentation").then(v => v === null), { label: "native Story restored" });
      check(await page.evaluate(() => window.__storyBoard.isConnected && window.__storyFrame.isConnected), "disabling restores the native side-panel board without remounting it");
      await eventually(async () => {
        const c = await cameraState();
        return Math.abs(c.zoom - storyCamera.zoom) < 0.001 && Math.abs(c.x - storyCamera.x) < 0.002 && Math.abs(c.y - storyCamera.y) < 0.002;
      }, { label: "native camera restored after disabling" });
      check(await composer.inputValue() === "Story activation draft", "Story activation and disabling preserve the composer draft");
      check(JSON.stringify(await readLayout(page)) === nativeLayout && await page.evaluate(() => localStorage.getItem("odm:stage-view")) === "story", "native geometry and Story preference survive activation");
      await composer.fill("");
      await t.tap(page.getByRole("button", { name: "Show the board", exact: true }));

      // Previously detached controls keep their owners, drafts and saved geometry.
      await page.evaluate((key) => {
        window.localStorage.setItem(key, JSON.stringify({ version: 1, locked: false, chronicle: null, floating: [{ id: "tab:battle", x: 0.15, y: 0.1, w: 0.6, h: 0.7 }], columns: [{ width: 236, panes: [{ id: "rail", size: 1 }] }, { width: null, panes: [{ id: "table", size: 1 }] }, { width: 384, panes: [{ id: "panel", size: 0.5 }, { id: "tab:notes", size: 0.5 }] }] }));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      }, KEY);
      await eventually(() => slot("tab:battle").isVisible(), { label: "detached battle pane" });
      const detached = JSON.stringify(await readLayout(page));
      await slot("tab:notes").locator("input").first().fill("Detached note draft");
      await page.evaluate((prefix) => { window.__detachedBoard = document.querySelector(`${prefix}.tlay-slot[data-pane="tab:battle"]`); window.__detachedNote = document.querySelector(`${prefix}.tlay-slot[data-pane="tab:notes"] input`); }, root);
      await t.tap(session);
      await eventually(() => row.getAttribute("data-presentation").then(v => v === "stage"), { label: "preset with detached native panes" });
      check(await page.evaluate((prefix) => window.__detachedBoard === document.querySelector(`${prefix}.tlay-slot[data-pane="tab:battle"]`) && window.__detachedNote === document.querySelector(`${prefix}.tlay-slot[data-pane="tab:notes"] input`), root), "detached panes are not reparented or remounted");
      check(await slot("tab:notes").locator("input").first().inputValue() === "Detached note draft", "detached controls keep local drafts");
      check(JSON.stringify(await readLayout(page)) === detached, "detached native geometry is unchanged");
      await t.tap(page.getByRole("radio", { name: "Board", exact: true }));
      await clearLayouts(page);

      await t.tap(session);
      addonInstalled = false;
      await page.reload({ waitUntil: "networkidle" });
      await eventually(() => page.locator(`${root}.cine-chat-staged`).count(), { label: "stage after addon removal" });
      check((await slot("rail").count()) === 0, "a removed addon with a stale saved choice uses native unmounting");

      addonInstalled = true;
      // A projected job fixture exercises the existing status component;
      // it starts no actual AI job and never calls Stop.
      await page.route(`**/api/campaigns/${ids.campaignId}`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...await response.json(), dmStatus: "thinking", dmJob: { id: "layout-job", kind: "turn", stage: "starting", since: Date.now(), startedAt: Date.now(), stopping: false } } });
      });
      await t.open(`/campaigns/${ids.campaignId}`);
      const status = page.locator(`${root}.session-compose-entry .session-status`);
      await eventually(() => status.isVisible(), { label: "native DM status in the session layout" });
      const statusBox = await boxOf(status);
      const liveChronicle = await boxOf(page.locator(`${root}.cine-fight > .cine-chronicle`));
      check(Math.abs(statusBox.x - liveChronicle.x) < 2 && statusBox.y + statusBox.height <= liveChronicle.y + 1, "native DM activity is pinned above Chronicle");
      check((await status.innerText()).includes("DM at work"), "activity uses the native job phrase");
      check(await status.getByRole("button", { name: "Stop the DM" }).count() === 1, "native story authority still controls Stop");
      await page.evaluate(() => { window.__statusNode = document.querySelector(".session-compose-entry .session-status"); });
      await t.shot("chronicle-composer-status");
      await t.tap(page.getByRole("radio", { name: "Board", exact: true }));
      check(await page.evaluate(() => window.__statusNode === document.querySelector(".session-compose-entry .session-status")), "disabling preserves the same native status component");
      check(await status.evaluate(node => getComputedStyle(node).position) === "static", "native status placement returns without an addon");
      await page.unroute(`**/api/campaigns/${ids.campaignId}`);
      await t.tap(session);
      await t.open(`/campaigns/${ids.quietId}`);
      await eventually(() => row.getAttribute("data-presentation").then(v => v === "stage"), { label: "session presentation without a tactical map" });
      const frame = page.frameLocator('iframe[title="Fixture session board view, from Fixture"]');
      await eventually(() => frame.locator("body").getAttribute("data-message").then(v => v === "scene"), { label: "explicit no-map bridge message" });
      await frame.locator("body").evaluate(() => parent.postMessage({ odm: 1, type: "error", message: "Fixture load failed" }, "*"));
      await eventually(() => row.getAttribute("data-presentation").then(v => v === null), { label: "renderer error restoring the native presentation" });
      await eventually(() => page.locator(`${root}.session-transcript`).isVisible(), { label: "mapless failure restoring the native transcript" });

      // A real server camera event reaches a separate player; fallback keeps
      // that player's original native camera rather than the DM's last view.
      const campaign = `${t.base}/api/campaigns/${ids.campaignId}`;
      const playerContext = await newContext(page.context().browser(), "desktop", { app: false });
      try {
        check((await t.api.patch(`${campaign}/settings`, { data: { dmMode: "steered" } })).ok(), "the fixture lead takes the DM seat");
        await signIn(playerContext, t.base, ids.player, ids.password);
        const player = await playerContext.newPage();
        await installFixture(player);
        await player.goto(`${t.base}/campaigns/${ids.campaignId}`, { waitUntil: "networkidle" });
        const native = player.locator(".board-view").first();
        await native.focus();
        await player.keyboard.press("+");
        await player.keyboard.press("ArrowRight");
        const nativeCamera = () => native.locator(":scope > div[style*='transform:']").first().evaluate((node) => {
          const m = new DOMMatrix(getComputedStyle(node).transform);
          return { zoom: m.a, x: m.e / node.parentElement.clientWidth, y: m.f / node.parentElement.clientWidth };
        });
        const before = await nativeCamera();
        await player.getByRole("radio", { name: "Fixture session", exact: true }).click();
        const view = native.locator("iframe");
        await eventually(() => cameraOf(view), { label: "player renderer ready" });
        const steer = async (mode) => check((await t.api.post(`${campaign}/dm/board`, { data: { do: "camera", mode, x: 1, y: 2, zoom: 2 } })).ok(), `DM ${mode} accepted by the native route`);
        await steer("lock");
        await eventually(async () => (await cameraOf(view))?.zoom === 2, { label: "server lock reaching the player's renderer" });
        await native.focus();
        await player.keyboard.press("+");
        check((await cameraOf(view)).zoom === 2, "native local zoom respects the DM lock");
        await steer("free");
        await eventually(() => player.getByText("The DM is steering the view", { exact: false }).count().then(n => n === 0), { label: "server camera release" });
        await player.getByRole("button", { name: "Fit the board", exact: true }).click();
        await eventually(async () => (await cameraOf(view)).zoom === 1, { label: "released renderer accepting local fit" });
        await player.getByRole("radio", { name: "Board", exact: true }).click();
        await eventually(async () => {
          const after = await nativeCamera();
          check(Math.abs(after.zoom - before.zoom) < 0.001 && Math.abs(after.x - before.x) < 0.002 && Math.abs(after.y - before.y) < 0.002, `native camera before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
          return true;
        }, { label: "native camera surviving server steering while hidden" });
      } finally {
        await t.api.patch(`${campaign}/settings`, { data: { dmMode: "ai" } });
        await playerContext.close();
      }
    }

    // Layout preferences never left the browser.
    check(layoutCalls.length === 0, `the arrangement never reaches the server (${layoutCalls.join(", ")})`);
    await clearLayouts(page);
  },
};
