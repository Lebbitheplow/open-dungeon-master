// M6 journey (audit WF-23): shared and independent worlds, carried as
// bundles to a fresh server and brought into a campaign there. On the run's
// server the lead keeps a shared workshop (Captain Mara with a portrait, the
// Gullhaven Docks battle map with a picture, a hand-built monster in the
// Dock ambush and a homebrew lantern in a chandler's stock) and a chapter
// workshop that draws on it, whose one card picks the shared captain and
// the shared fight. The player keeps an independent workshop that happens
// to use the same names: their own Captain Mara and Gullhaven Docks with
// other pictures, and their own monster of the same name with other rules.
// Each bundle leaves through the Share tool's form, typed by keyboard.
//
// A second server then starts from nothing: its own empty database, its own
// public/uploads (a tree of its own whose code is the run's build), and its
// first account made through setup with the setup code. The three bundles
// come in through the workshop shelf's Open a bundle, the chapter linked to
// the shared workshop that arrived first, and a new campaign there brings
// all three in through the lobby's Start from picker. The finish:
//   - the two worlds' same-named entries stay two: two Captain Maras, two
//     Gullhaven Docks and two Dock ambushes in the campaign, the chapter's
//     card on the shared captain rather than a third copy, and the
//     player's monster kept beside the lead's under its bundle's name;
//   - every picture loads: each portrait and backdrop answers 200 as an
//     image from the fresh server, and its file is in that server's own
//     uploads folder and not in the run's;
//   - the mechanics are reachable from the campaign: each fight's monster
//     resolves to its own stat block in the campaign's search, and the
//     shop's item to the homebrew lantern with its rules.
// The fresh server is stopped and its folder removed at the end.
//
// The single steps are proven elsewhere: the import picker in
// 43-world-use-in-campaign, a bundle's losses in 36-world-file-losses and
// 54-world-pack-omissions, monsters in fights in 40-world-bindings and
// 41-create-chooser, shops in 58-shop-browse. No model is involved: the
// fresh server, like the run's, points its storyteller at a closed port and
// nothing here asks it anything.
//
// Set up through the API, since none of it is the journey: the workshops'
// contents (people, maps, pictures, monsters, items, the fight, the shop,
// the chapter's card), the fresh server's first account (its setup code is
// the operator's step) and the empty campaign there.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { check, eventually, freePort, newContext, seeAllTours, settle, signIn, startServer } from "../lib.mjs";

const TREE = path.resolve(import.meta.dirname, "../../..");

// A real PNG of one flat colour, as a data URL for /api/upload. Different
// shades are different files, so two same-named entries cannot share one.
function pngDataUrl(width, height, shade) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height, shade));
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", rows), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

// What the browser's focus is on, for the keyboard steps.
const focused = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName ?? "",
      role: element?.getAttribute("role") ?? "",
      text: (element?.textContent ?? "").trim().slice(0, 120),
      label: element?.getAttribute("aria-label") ?? "",
      placeholder: element?.getAttribute("placeholder") ?? "",
      checked: element?.getAttribute("aria-checked") ?? "",
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

// A page's failures behind the scenes, as the harness collects them for its
// own page: an uncaught error, or a refused API call.
function watch(page, base, fails, who) {
  page.on("pageerror", (error) => fails.push(`${who} pageerror: ${String(error).slice(0, 300)}`));
  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(base) && url.includes("/api/") && response.status() >= 500) fails.push(`${who} status ${response.status()} ${url.slice(base.length)}`);
  });
}

async function openOn(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  await settle(page);
}

const ok = async (response, what) => {
  check(response.ok(), `${what} (${response.status()} ${(await response.text().catch(() => "")).slice(0, 200)})`);
  return response.json();
};

// One workshop's prep, made through its API by whoever owns it.
async function prep(request, base, { title, monster, cr, shade, item, chapterOf }) {
  const workshop = (await ok(await request.post(`${base}/api/workshops`, { data: { title, description: "" } }), `the workshop ${title}`)).workshop;
  const campaign = `${base}/api/campaigns/${workshop.id}`;
  const made = { id: workshop.id, title };
  if (chapterOf) {
    await ok(await request.patch(`${base}/api/workshops/${workshop.id}`, { data: { commonWorkshopId: chapterOf.id } }), `${title} drawing on ${chapterOf.title}`);
    const card = await ok(
      await request.post(`${campaign}/dm/storyboard`, {
        data: { kind: "event", title: "The harbourmaster's bargain", body: "Captain Mara offers passage if the party clears the docks.", links: { npcId: chapterOf.captain, encounterId: chapterOf.fight } },
      }),
      "the chapter's card",
    );
    check(card.beat?.links?.npcId === chapterOf.captain && card.beat?.links?.encounterId === chapterOf.fight, `the chapter's card picks the shared captain and fight: ${JSON.stringify(card.beat?.links)}`);
    return made;
  }
  made.monsterId = (await ok(await request.post(`${campaign}/dm/bestiary`, { data: { from: "cr", name: monster, cr } }), `the monster ${monster}`)).monster.id;
  const portrait = (await ok(await request.post(`${base}/api/upload`, { data: { dataUrl: pngDataUrl(64, 64, shade), name: "captain.png", type: "image/png" } }), "a portrait")).url;
  const backdrop = (await ok(await request.post(`${base}/api/upload`, { data: { dataUrl: pngDataUrl(400, 200, 255 - shade), name: "docks.png", type: "image/png" } }), "a backdrop")).url;
  const captain = (await ok(await request.post(`${campaign}/dm/npcs`, { data: { draft: { name: "Captain Mara", trait: item ? "Harbourmaster of Saltreach, salt-grey braid." : "Smuggler queen of Driftmoor, one gold tooth." } } }), "Captain Mara")).npc;
  await ok(await request.patch(`${campaign}/dm/npcs/${captain.id}`, { data: { portraitUrl: portrait } }), "Captain Mara's portrait");
  const map = (await ok(await request.post(`${campaign}/dm/maps`, { data: { do: "create", name: "Gullhaven Docks", blank: "rock" } }), "the Gullhaven Docks map")).map;
  await ok(await request.patch(`${campaign}/dm/maps/${map.id}`, { data: { backdropPath: backdrop } }), "the docks' picture");
  const fight = (
    await ok(
      await request.post(`${campaign}/dm/encounter-templates`, {
        // The item is named in the fight's notes, so "What this workshop
        // uses" takes it from the shelf.
        data: { name: "Dock ambush", enemies: `${monster} x2`, notes: item ? `It guards a ${item.name} on the pier.` : "Out of the fog." },
      }),
      "the Dock ambush",
    )
  ).template;
  made.captain = captain.id;
  made.fight = fight.id;
  made.pictures = [portrait, backdrop];
  if (item) {
    made.itemId = (await ok(await request.post(`${base}/api/homebrew`, { data: { kind: "item", name: item.name, data: item.data } }), `the item ${item.name}`)).entry.id;
    await ok(
      await request.post(`${campaign}/shops`, { data: { name: "Tidewright's Chandlery", kind: "general", stock: [{ itemName: item.name, qty: 3, priceCp: 2500, note: "" }] } }),
      "the chandlery",
    );
  }
  return made;
}

// The Share tool's form, by keyboard from the panel's first line: name,
// line, author, what it is inspired by, "What this workshop uses" with an
// arrow key, and Download bundle with Enter. The file is kept at `file`.
async function share(page, base, workshop, manifest, file) {
  await openOn(page, `${base}/workshop/${workshop.id}?system=share`);
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Share this workshop" }) }).locator("visible=true").first();
  await eventually(() => panel.count(), { timeoutMs: 30_000, label: `the Share tool of ${workshop.title}` });
  await panel.getByText(/A bundle is everything you prepared here/).click();
  await page.keyboard.press("Tab");
  check((await focused(page)).placeholder === "The Sunken Vault", `Tab from the panel's first line reaches Name: ${JSON.stringify(await focused(page))}`);
  await page.keyboard.type(manifest.name);
  await page.keyboard.press("Tab");
  await page.keyboard.type(manifest.blurb);
  await page.keyboard.press("Tab");
  await page.keyboard.type(manifest.author);
  await tabTo(page, (element) => element.placeholder.startsWith("Original work"), "Inspired by", 4);
  await page.keyboard.type("Original work");
  await tabTo(page, (element) => element.role === "radio" && element.checked === "true", "the shelf choice", 3);
  await page.keyboard.press("ArrowRight");
  const uses = panel.getByRole("radio", { name: "What this workshop uses" });
  await eventually(async () => (await uses.getAttribute("aria-checked")) === "true", { label: "What this workshop uses chosen by arrow key" });
  // A radio group's arrow key moves focus with the choice (WAI-ARIA radio
  // group). Found by this journey and fixed with it: the focus stayed on
  // the option it unchecked, out of the Tab order, so Space chose it back.
  await eventually(async () => (await focused(page)).text === "What this workshop uses", { label: "the focus moved with the choice" });
  await tabTo(page, (element) => element.tag === "BUTTON" && element.text.includes("Download bundle"), "Download bundle", 10);
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.keyboard.press("Enter");
  await (await download).saveAs(file);
  const shelf = panel.locator('[data-testid="bundle-shelf"]');
  await eventually(() => shelf.count(), { timeoutMs: 20_000, label: "what the export took from the shelf" });
  const bundle = JSON.parse(fs.readFileSync(file, "utf8"));
  check(bundle.manifest?.name === manifest.name, `the bundle carries its name (${bundle.manifest?.name})`);
  return { said: await shelf.innerText(), bundle };
}

// A second server that has never seen this run: an empty database, and a
// tree of its own (the build, code and assets linked in) so that what it
// writes to public/uploads is its own.
async function freshServer(dir, setupCode) {
  const home = path.join(dir, "tree");
  const uploads = path.join(home, "public", "uploads");
  fs.mkdirSync(uploads, { recursive: true });
  const links = [];
  const link = (target, at) => {
    fs.symlinkSync(target, at, "junction");
    links.push(at);
  };
  for (const name of [".next", "node_modules", "src", "addons", "models", "workers"]) {
    if (fs.existsSync(path.join(TREE, name))) link(path.join(TREE, name), path.join(home, name));
  }
  for (const name of fs.readdirSync(path.join(TREE, "public"))) {
    if (["uploads", "generated", "generated-audio"].includes(name)) continue;
    const target = path.join(TREE, "public", name);
    if (fs.statSync(target).isDirectory()) link(target, path.join(home, "public", name));
    else fs.copyFileSync(target, path.join(home, "public", name));
  }
  for (const file of ["package.json", "next.config.ts", "tsconfig.json"]) fs.copyFileSync(path.join(TREE, file), path.join(home, file));
  // startServer hands the child this process's environment as it spawns,
  // before its first await: the setup code is there for that one spawn.
  process.env.ODM_SETUP_CODE = setupCode;
  let pending;
  try {
    pending = startServer({ tree: home, dbPath: path.join(dir, "fresh.sqlite"), key: randomBytes(32).toString("hex"), port: await freePort(), log: path.join(dir, "server.log") });
  } finally {
    delete process.env.ODM_SETUP_CODE;
  }
  let server;
  try {
    server = await pending;
  } catch (error) {
    // The links go before anything removes the folder, so nothing ever
    // walks into the build.
    for (const at of links.reverse()) fs.unlinkSync(at);
    throw error;
  }
  return {
    ...server,
    dir,
    uploads,
    remove: () => {
      // The links first, so removing the folder never walks into the build.
      for (const at of links.reverse()) fs.unlinkSync(at);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

// Open a bundle on the workshop shelf, by keyboard: Tab to the button,
// Enter for the file, Tab to Import it, Enter. Returns the new workshop's id.
async function importBundle(page, base, file, { before } = {}) {
  await openOn(page, `${base}/workshop`);
  await eventually(() => page.getByRole("button", { name: "Open a bundle" }).locator("visible=true").count(), { timeoutMs: 30_000, label: "the shelf's Open a bundle" });
  await page.locator("body").focus();
  await tabTo(page, (element) => element.tag === "BUTTON" && element.text.includes("Open a bundle"), "Open a bundle", 80);
  // On a shelf that already holds workshops the first press or two can open
  // nothing (seen on the third import, as the shelf's list settles); the
  // button keeps focus, so Enter is pressed again, a few times at most.
  let chooser = null;
  for (let attempt = 0; attempt < 4 && !chooser; attempt += 1) {
    const waiting = page.waitForEvent("filechooser", { timeout: 7_500 }).catch(() => null);
    await page.keyboard.press("Enter");
    chooser = await waiting;
  }
  check(Boolean(chooser), `Enter on Open a bundle opens the file picker (focus: ${JSON.stringify(await focused(page))})`);
  await chooser.setFiles(file);
  const confirm = page.getByRole("button", { name: /^\s*Import it\s*$/ }).locator("visible=true").first();
  await eventually(() => confirm.count(), { timeoutMs: 30_000, label: "the bundle's preview" });
  if (before) await before();
  await tabTo(page, (element) => element.tag === "BUTTON" && element.text === "Import it", "Import it", 40);
  await page.keyboard.press("Enter");
  return page;
}

// Start from in the campaign's lobby: the source, then Bring it in. With
// `keys`, every step by keyboard from the field's label.
async function bringIn(page, title, { keys = false, plan } = {}) {
  const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
  await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
  await startFrom.scrollIntoViewIfNeeded();
  if (keys) {
    // The field's own label, above the picker, is where the keyboard starts.
    const field = startFrom.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' block ')][1]");
    await field.getByText("Start from", { exact: true }).first().click();
    await page.keyboard.press("Tab");
    check(await startFrom.evaluate((element) => element === document.activeElement), `Tab from the label reaches Start from: ${JSON.stringify(await focused(page))}`);
    await page.keyboard.press("Enter");
    const item = page.getByRole("menuitemradio", { name: title }).locator("visible=true").first();
    await eventually(() => item.count(), { label: "the picker's menu" });
    for (let index = 0; index < 20 && !(await item.evaluate((element) => element === document.activeElement)); index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    check(await item.evaluate((element) => element === document.activeElement), `the arrow keys reach ${title}`);
    await page.keyboard.press("Enter");
  } else {
    await startFrom.click();
    await page.getByRole("menuitemradio", { name: title }).locator("visible=true").first().click();
  }
  const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
  await eventually(() => bring.isEnabled(), { timeoutMs: 20_000, label: `Bring it in for ${title}` });
  if (plan) await plan();
  if (keys) {
    // The menu hands focus back to Start from; Bring it in is ahead of it.
    await tabTo(page, (element) => element.tag === "BUTTON" && element.text.includes("Bring it in"), "Bring it in", 30);
    await page.keyboard.press("Enter");
  } else {
    await bring.click();
  }
  const note = page.getByText(/Brought \d+ items? across/).locator("visible=true").first();
  await eventually(() => note.count(), { timeoutMs: 30_000, label: `the note after bringing in ${title}` });
  return note.innerText();
}

export default {
  name: "journey-bundle-fresh-server",
  viewports: ["desktop", "phone"],
  // A second server of its own, which the app's shell is not pointed at.
  app: false,
  async run(t) {
    const { page, base, ids, api, viewport } = t;
    const stamp = Date.now().toString(36);
    const outDir = path.dirname(t.shotPath("x"));
    const bundles = path.join(outDir, `journey-bundles-${viewport}-${stamp}`);
    fs.mkdirSync(bundles, { recursive: true });
    const browser = page.context().browser();
    const fails = [];
    // The homebrew shelf is each user's, shared by every run: names of this
    // run's own. The monster's name is the same on both shelves on purpose.
    const monster = `Reef Stalker ${stamp}`;
    const item = { name: `Brinelight Lantern ${stamp}`, data: { desc: "A lantern that burns on seawater and never in the dry.", itemKind: "gear", cost: "25 gp" } };
    const titles = { shared: `Saltreach ${stamp}`, chapter: `Saltreach chapter one ${stamp}`, own: `Driftmoor ${stamp}` };

    const playerContext = await newContext(browser, viewport, { app: false });
    let fresh = null;
    const made = {};
    const shots = {};
    try {
      // ---- the run's server: three workshops ----
      await signIn(playerContext, base, ids.player, ids.password);
      await seeAllTours(playerContext.request, base);
      made.shared = await prep(api, base, { title: titles.shared, monster, cr: 2, shade: 70, item });
      made.chapter = await prep(api, base, { title: titles.chapter, chapterOf: made.shared });
      made.own = await prep(playerContext.request, base, { title: titles.own, monster, cr: 5, shade: 200 });

      // Each bundle through the Share tool's form.
      const files = { shared: path.join(bundles, "shared.json"), chapter: path.join(bundles, "chapter.json"), own: path.join(bundles, "own.json") };
      const sharedOut = await share(page, base, made.shared, { name: titles.shared, blurb: "The harbour every chapter comes back to.", author: "The lead" }, files.shared);
      check(sharedOut.said.includes(monster) && sharedOut.said.includes(item.name), `the shared bundle takes the monster and the lantern its fight names: ${JSON.stringify(sharedOut.said)}`);
      await t.shot("shared-shared");
      const chapterOut = await share(page, base, made.chapter, { name: titles.chapter, blurb: "The docks, cleared or not.", author: "The lead" }, files.chapter);
      check(chapterOut.bundle.dependsOn?.name === titles.shared, `the chapter's bundle names the workshop it draws on: ${JSON.stringify(chapterOut.bundle.dependsOn)}`);
      check((chapterOut.bundle.npcs ?? []).some((npc) => npc.name === "Captain Mara" && npc.shared), "the chapter's bundle carries the shared captain, marked shared");
      const playerPage = await playerContext.newPage();
      shots.player = playerPage;
      watch(playerPage, base, fails, "player");
      const ownOut = await share(playerPage, base, made.own, { name: titles.own, blurb: "A smugglers' harbour of the player's own.", author: "The player" }, files.own);
      check(ownOut.said.includes(monster), `the independent bundle takes the player's own ${monster}: ${JSON.stringify(ownOut.said)}`);
      await playerPage.close();

      // ---- a fresh server ----
      const setupCode = "JRNY-FRSH-SRVR-2026";
      // Once, on a busy machine, a cold fresh server said it was ready and
      // then left its first request unanswered for the harness's 90 s. One
      // more start, in a folder of its own, tells a slow machine from a
      // server that cannot start, and says so in the run's output.
      fresh = await freshServer(path.join(outDir, `fresh-server-${viewport}-${stamp}`), setupCode).catch((error) => {
        console.log(`      the fresh server did not answer (${error.message}); starting it once more`);
        return freshServer(path.join(outDir, `fresh-server-${viewport}-${stamp}-again`), setupCode);
      });
      const freshContext = await newContext(browser, viewport, { app: false });
      fresh.context = freshContext;
      const claimed = await freshContext.request.post(`${fresh.base}/api/auth/register`, { data: { username: "fresh_admin", password: "Fresh-2026-pass", setupCode } });
      check(claimed.status() === 201 && (await claimed.json()).user?.isAdmin, `the fresh server's first account, made with its setup code (${claimed.status()})`);
      await seeAllTours(freshContext.request, fresh.base);
      const there = freshContext.request;
      const freshPage = await freshContext.newPage();
      shots.fresh = freshPage;
      const freshShot = (name) => freshPage.screenshot({ path: t.shotPath(name) }).catch(() => {});
      watch(freshPage, fresh.base, fails, "fresh server");
      check(((await (await there.get(`${fresh.base}/api/workshops`)).json()).workshops ?? []).length === 0, "the fresh server starts with no workshops");
      check(fs.readdirSync(fresh.uploads).length === 0, "and an empty uploads folder");

      // The shared world first, then the chapter (linked to it), then the
      // independent one, whose same-named monster is kept beside.
      const landed = async () => {
        await eventually(async () => /\/workshop\/[^/?#]+/.test(new URL(freshPage.url()).pathname), { timeoutMs: 30_000, label: "the new workshop opened" });
        return new URL(freshPage.url()).pathname.split("/")[2];
      };
      await importBundle(freshPage, fresh.base, files.shared);
      const sharedId = await landed();
      await importBundle(freshPage, fresh.base, files.chapter, {
        before: async () => {
          const link = freshPage.getByRole("button", { name: "Shared records" }).locator("visible=true").first();
          await eventually(() => link.count(), { label: "the chapter's Shared records choice" });
          check((await link.innerText()).includes(titles.shared), `the chapter offers to link to the shared workshop that arrived: ${JSON.stringify(await link.innerText())}`);
          await freshShot("chapter-preview");
        },
      });
      const chapterId = await landed();
      await importBundle(freshPage, fresh.base, files.own);
      const kept = freshPage.getByRole("dialog").locator("visible=true").first();
      await eventually(() => kept.count(), { timeoutMs: 30_000, label: "the notice of what was kept beside" });
      const keptSaid = await kept.innerText();
      check(keptSaid.includes(`${monster} [${titles.own}]`), `the player's monster arrives beside the lead's under its bundle's name: ${JSON.stringify(keptSaid.slice(0, 300))}`);
      await freshShot("kept-beside");
      await kept.getByRole("button", { name: "OK" }).click();
      const ownId = await landed();

      // The three workshops there, each with its own records.
      const npcsOf = async (id) => (await (await there.get(`${fresh.base}/api/campaigns/${id}/dm/npcs`)).json()).npcs ?? [];
      const sharedCast = await npcsOf(sharedId);
      const ownCast = await npcsOf(ownId);
      check(sharedCast.filter((npc) => npc.name === "Captain Mara").length === 1 && ownCast.filter((npc) => npc.name === "Captain Mara").length === 1, "each world's workshop holds its own Captain Mara");
      check((await npcsOf(chapterId)).length === 0, "the chapter holds no copy of the shared captain");
      const board = await (await there.get(`${fresh.base}/api/campaigns/${chapterId}/dm/storyboard`)).json();
      check(board.shared?.common?.id === sharedId, `the chapter draws on the shared workshop that arrived: ${JSON.stringify(board.shared?.common)}`);
      const card = (board.board?.nodes ?? board.board?.beats ?? []).find((node) => node.title === "The harbourmaster's bargain");
      const sharedCaptain = sharedCast.find((npc) => npc.name === "Captain Mara");
      check(card?.links?.npcId === sharedCaptain?.id && !Object.keys(board.broken ?? {}).length, `the chapter's card picks the shared captain there: ${JSON.stringify(card?.links)}`);
      const shelf = ((await (await there.get(`${fresh.base}/api/homebrew?kind=monster`)).json()).entries ?? []).map((entry) => entry.name);
      check(shelf.includes(monster) && shelf.includes(`${monster} [${titles.own}]`), `two monsters of one name stay two on the fresh shelf: ${JSON.stringify(shelf)}`);

      // ---- a campaign on the fresh server ----
      const table = await ok(await there.post(`${fresh.base}/api/campaigns`, { data: { title: `Gullhaven table ${stamp}`, gameSettings: { ttsEnabled: false } } }), "a campaign on the fresh server");
      const campaignId = table.campaign.id;
      const campaign = `${fresh.base}/api/campaigns/${campaignId}`;
      await openOn(freshPage, `${fresh.base}/campaigns/${campaignId}`);
      const notes = [];
      notes.push(await bringIn(freshPage, titles.shared));
      notes.push(await bringIn(freshPage, titles.chapter));
      notes.push(
        await bringIn(freshPage, titles.own, {
          keys: true,
          plan: async () => {
            const numbered = async () => (await freshPage.locator("body").innerText()).match(/\d+ [a-z ]+ entr(?:y|ies) already exists? here by name and will be numbered/g) ?? [];
            await eventually(async () => (await numbered()).length >= 3, { timeoutMs: 20_000, label: "the plan saying the same-named NPC, map and fight will be numbered, before anything lands" }).catch(async (error) => {
              throw new Error(`${error.message}: ${JSON.stringify(await numbered())}`);
            });
            // Found by this journey and fixed with it: one entry "already exist".
            check(
              !(await numbered()).some((line) => / entry already exist here/.test(line)),
              `the plan says one entry "already exist": ${JSON.stringify(await numbered())}`,
            );
            await freshShot("numbered-plan");
          },
        }),
      );
      check(!notes.some((note) => /No monster here answers to/.test(note)), `every fight's monster answers at the table: ${JSON.stringify(notes)}`);
      await freshShot("brought-in");

      // ---- the finish ----
      // The same-named entries stay two, and the chapter added no third.
      const cast = (await (await there.get(`${campaign}/dm/npcs`)).json()).npcs ?? [];
      const maras = cast.filter((npc) => /^Captain Mara( \(\d+\))?$/.test(npc.name));
      check(maras.length === 2, `two Captain Maras at the table: ${JSON.stringify(cast.map((npc) => npc.name))}`);
      check(new Set(maras.map((npc) => npc.trait)).size === 2 && new Set(maras.map((npc) => npc.portraitUrl)).size === 2, "each with its own world's words and portrait");
      const library = await (await there.get(`${campaign}/dm/maps`)).json();
      const docks = (library.maps ?? []).filter((map) => /^Gullhaven Docks( \(\d+\))?$/.test(map.name));
      const backdropOf = (map) => map.backdrop?.path ?? map.backdropPath ?? "";
      check(docks.length === 2 && new Set(docks.map(backdropOf)).size === 2, `two Gullhaven Docks with their own pictures: ${JSON.stringify(docks.map((map) => [map.name, backdropOf(map)]))}`);
      const fights = ((await (await there.get(`${campaign}/dm/encounter-templates`)).json()).templates ?? []).filter((template) => /^Dock ambush( \(\d+\))?$/.test(template.name));
      check(fights.length === 2, `two Dock ambushes: ${JSON.stringify(fights.map((fight) => fight.name))}`);

      // Every picture loads from the fresh server, out of its own folder.
      const ownCaptain = ownCast.find((npc) => npc.name === "Captain Mara");
      const pictures = [...new Set([...maras.map((npc) => npc.portraitUrl), ...docks.map(backdropOf), sharedCaptain?.portraitUrl, ownCaptain?.portraitUrl])];
      for (const url of pictures) {
        check(/^\/uploads\/[^/]+$/.test(url ?? ""), `a picture the fresh server wrote: ${url}`);
        const answer = await there.get(`${fresh.base}${url}`);
        check(answer.status() === 200 && /^image\//.test(answer.headers()["content-type"] ?? ""), `${url} answers ${answer.status()} ${answer.headers()["content-type"]} from the fresh server`);
        check(fs.existsSync(path.join(fresh.uploads, path.basename(url))), `${url} is in the fresh server's own uploads folder`);
        check(!fs.existsSync(path.join(TREE, "public", "uploads", path.basename(url))), `${url} is not in the run's uploads folder`);
      }
      // And the browser draws it: the shared captain's portrait on the Cast.
      const shown = freshPage.locator(`img[src*="${path.basename(sharedCaptain.portraitUrl)}"]`).locator("visible=true");
      await openOn(freshPage, `${fresh.base}/workshop/${sharedId}?system=cast`);
      await eventually(async () => (await shown.count()) > 0 && (await shown.first().evaluate((image) => image.complete && image.naturalWidth > 0)), {
        timeoutMs: 30_000,
        label: "the shared captain's portrait drawn on the fresh server's Cast",
      });
      await freshShot("fresh-cast");

      // The mechanics: each fight's monster is its own stat block in the
      // campaign's search, and the shop's item is the lantern with its rules.
      const rosterNames = fights.flatMap((fight) => (fight.enemies ?? []).map((row) => (typeof row === "string" ? row : row.monster ?? row.name ?? "")));
      check(rosterNames.includes(monster) && rosterNames.includes(`${monster} [${titles.own}]`), `the two fights name the two monsters: ${JSON.stringify(rosterNames)}`);
      const hitPoints = [];
      for (const name of [monster, `${monster} [${titles.own}]`]) {
        const found = await (await there.get(`${fresh.base}/api/content/monsters?campaign=${campaignId}&q=${encodeURIComponent(name)}`)).json();
        const row = (found.results ?? []).find((entry) => entry.name === name);
        check(Boolean(row), `the campaign's search finds ${name}: ${JSON.stringify((found.results ?? []).map((entry) => entry.name))}`);
        check(String(row.slug).startsWith("homebrew:") && Number(row.data?.stats?.maxHp) > 0, `${name} is a stat block with hit points: ${JSON.stringify(row).slice(0, 200)}`);
        hitPoints.push(row.data.stats.maxHp);
      }
      // A challenge 2 monster and a challenge 5 one.
      check(hitPoints[0] < hitPoints[1], `the two monsters keep their own rules: ${JSON.stringify(hitPoints)} hit points`);
      const shops = (await (await there.get(`${campaign}/shops`)).json()).shops ?? [];
      const chandlery = shops.find((shop) => shop.name === "Tidewright's Chandlery");
      check((chandlery?.stock ?? []).some((line) => line.itemName === item.name), `the chandlery stocks the lantern: ${JSON.stringify(chandlery?.stock)}`);
      const items = await (await there.get(`${fresh.base}/api/content/items?campaign=${campaignId}&q=${encodeURIComponent(item.name)}`)).json();
      const lantern = (items.results ?? []).find((row) => row.name === item.name);
      check(lantern && String(lantern.slug ?? "").startsWith("homebrew:"), `the shop's item is the homebrew lantern in the campaign's search: ${JSON.stringify(items.results ?? []).slice(0, 300)}`);
      check(/burns on seawater/.test(lantern.data?.desc ?? "") && lantern.data?.cost === "25 gp" && lantern.data?.itemKind === "gear", `and carries its own words and price: ${JSON.stringify(lantern.data).slice(0, 200)}`);
      check(!fails.length, `behind the scenes: ${fails.slice(0, 5).join("; ")}`);
    } catch (error) {
      // The harness shoots its own page; these are the other two.
      for (const [name, other] of Object.entries(shots)) await other.screenshot({ path: t.shotPath(`failed-${name}`) }).catch(() => {});
      throw error;
    } finally {
      if (fresh) {
        await fresh.context?.close().catch(() => {});
        await fresh.stop();
        fresh.remove();
        check(!fs.existsSync(fresh.dir), `the fresh server's folder is gone (${fresh.dir})`);
      }
      // The run's server as it was: the workshops and the shelf entries.
      if (made.shared?.monsterId) await api.delete(`${base}/api/campaigns/${made.shared.id}/dm/bestiary/${made.shared.monsterId}`).catch(() => {});
      if (made.shared?.itemId) await api.delete(`${base}/api/homebrew/${made.shared.itemId}`).catch(() => {});
      if (made.own?.monsterId) await playerContext.request.delete(`${base}/api/campaigns/${made.own.id}/dm/bestiary/${made.own.monsterId}`).catch(() => {});
      for (const key of ["chapter", "shared"]) if (made[key]) await api.delete(`${base}/api/workshops/${made[key].id}`).catch(() => {});
      if (made.own) await playerContext.request.delete(`${base}/api/workshops/${made.own.id}`).catch(() => {});
      await playerContext.close().catch(() => {});
    }
  },
};
