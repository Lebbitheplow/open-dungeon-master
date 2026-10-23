// What every browser scenario leans on: a built server on a throwaway
// database, a Chromium the scenarios drive, a signed-in session, and the
// same scenario run either against the server's own pages or against the
// app's native screens (the client's mobile shell, which compiles those
// pages with Preact). See run.mjs for how a run is put together.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, { timeoutMs, label }) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await sleep(500);
  }
  throw new Error(`${label} did not answer within ${timeoutMs / 1000}s (${last})`);
}

// The production server (`next start`) on the built tree, against the seeded
// database. The build must exist already: CI builds before it runs this.
export async function startServer({ tree, dbPath, key, port, log }) {
  const nextBin = path.join(tree, "node_modules", "next", "dist", "bin", "next");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    SQLITE_DB_PATH: dbPath,
    DB_ENCRYPTION_KEY: key,
    APP_PUBLIC_URL: `http://127.0.0.1:${port}`,
    VOICE_ENABLED: "false",
    // No model, no pictures, no speech: the scenarios look at the pages, not
    // at a storyteller. An empty provider fell back to the shipped default,
    // the llama-server address 127.0.0.1:8001, so on a machine running one
    // the admin pages probed it and a posted action queued a real turn there
    // (issue 414). The storyteller is set up but on a closed port, as on CI
    // where nothing listens: an action that would call it fails the same way.
    // No model is named, which admin-speed reads as "Name the model first".
    DEFAULT_TEXT_PROVIDER: "custom",
    OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:9/v1",
    OPENAI_API_KEY: "",
    // No speech-to-text either, whatever this machine runs on :8870: a
    // scenario that dictates stands in the device's own recognizer, the same
    // here as on CI.
    STT_URL: "off",
  };
  const out = fs.openSync(log, "a");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: tree,
    env,
    stdio: ["ignore", out, out],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/api/auth/providers`, { timeoutMs: 90_000, label: "the server" });
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return {
    base,
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }),
  };
}

// The app's shell as plain web files (client mobile/www), served the way
// the rigs in look-at-the-client-apps serve it. A path outside the folder
// is refused; everything is served as-is with a guessed content type.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg" };
export async function serveFolder(folder, port) {
  const root = path.resolve(folder);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${port}`, stop: () => new Promise((resolve) => server.close(() => resolve())) };
}

export async function launchBrowser({ app }) {
  const { chromium } = await import("playwright-core");
  const executablePath = process.env.ODM_BROWSER || chromium.executablePath();
  if (!fs.existsSync(executablePath)) {
    throw new Error(
      `No Chromium at ${executablePath}. Run \`npx playwright-core install chromium\` once (or point ODM_BROWSER at a Chrome).`,
    );
  }
  return chromium.launch({
    executablePath,
    args: [
      "--no-sandbox",
      // The app's screens call the host from another origin, as the real
      // apps do from their own origin; the shell's own CORS story is the
      // apps' to prove, not this harness's.
      ...(app ? ["--disable-web-security", "--disable-features=BlockInsecurePrivateNetworkRequests"] : []),
    ],
  });
}

export const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, touch: false },
  laptop: { width: 1366, height: 768, touch: false },
  phone: { width: 412, height: 892, touch: true },
};

export async function newContext(browser, viewport, { app, toursSeen = true }) {
  const size = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    colorScheme: "dark",
    hasTouch: size.touch,
    isMobile: size.touch && app,
    reducedMotion: "no-preference",
  });
  // The first-visit tours open a moment after their page does, over
  // whatever a scenario is about to press. On a slow load (the app's screens
  // on a busy machine) the tour came after settle()'s Escapes and took the
  // click: offer-settled's Accept and board-enlarged's figure failed that
  // way. Every tour counts as seen before any page loads: the browser's old
  // per-tour flag (legacyKey in src/lib/tours/account-logic.ts), which the
  // first account to load carries to its record. Only tours-account is about
  // the tour itself, and it asks for contexts without the flags.
  if (!toursSeen) return context;
  await context.addInitScript((keys) => {
    try {
      for (const key of keys) localStorage.setItem(key, "done");
    } catch {
      // A page with no storage shows its tour, and settle() closes it.
    }
  }, ["table-player", "table-dm", "workshop-shelf", "workshop-hub"].map((id) => `odm:tour:${id}`));
  return context;
}

// Signs the server's own session in: a cookie the pages then carry.
export async function signIn(context, base, username, password) {
  const response = await context.request.post(`${base}/api/auth/login`, { data: { username, password } });
  if (!response.ok()) {
    throw new Error(`sign-in as ${username} answered ${response.status()}`);
  }
}

// Records every tour as finished on the signed-in account, at the version
// the registry holds now (src/lib/tours/registry.ts). The browser's old
// per-tour flags (newContext) only ever carry version 1, so a tour revised
// to a higher version opened again over every scenario's first click. A
// scenario that marks a tour finished at version 1 changes nothing: the
// account keeps the higher version (mergeLedgers).
export async function seeAllTours(request, base) {
  const { TOUR_IDS, tourVersion } = await import("../../src/lib/tours/registry.ts");
  const finished = TOUR_IDS.map((id) => ({ id, version: tourVersion(id), how: "ended" }));
  const response = await request.post(`${base}/api/profile/tours`, { data: { finished } });
  if (!response.ok()) {
    throw new Error(`marking the tours seen answered ${response.status()}`);
  }
}

// Closes whatever greets a page: the welcome tour, a "got it", a dialog.
export async function settle(page) {
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(150);
  }
  const gotIt = page.getByRole("button", { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click({ timeout: 2_000 }).catch(() => {});
}

// Everything a scenario sees of its page, in one object, so a scenario reads
// the same whether it is on the server's page or the app's screen:
// `root` prefixes every selector (the app confines the game to .game-root),
// `open(path)` lands on a page, `fails` collects what went wrong behind the
// scenes (a page error, a refused API call) for the health checks.
export function pageHarness({ page, base, ids, app, viewport, outDir, tag, api }) {
  const fails = [];
  page.on("pageerror", (error) => fails.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(base) && url.includes("/api/") && response.status() >= 500) {
      fails.push(`status ${response.status()} ${url.slice(base.length)}`);
    }
  });
  const root = app ? ".game-root " : "";
  const touch = VIEWPORTS[viewport].touch;
  return {
    page,
    base,
    ids,
    app,
    viewport,
    root,
    fails,
    touch,
    // The lead's own API session (a cookie), apart from the page's: the
    // app's screens carry a bearer token the page's request client lacks.
    api,
    tap: (locator) => (touch && app ? locator.tap() : locator.click()),
    shot: (name) => page.screenshot({ path: path.join(outDir, `${tag}-${name}.png`), fullPage: false }).catch(() => {}),
    // Where a shot of that name goes, for a clipped screenshot of one part.
    shotPath: (name) => path.join(outDir, `${tag}-${name}.png`),
    // Where the page is: the address bar on the server; in the app, whose
    // window stays on index.html, the shell's own navigation.
    url: async () => {
      if (!app) return new URL(page.url());
      const where = await page.evaluate(() => window.odmShell?.navigation?.location?.() ?? null);
      return new URL(`${where?.pathname ?? "/"}${where?.search ?? ""}`, base);
    },
    // A refresh: the browser's on the server; in the app, the shell's own
    // (reloading index.html would restart the app at its home).
    reload: async () => {
      if (!app) {
        await page.reload();
        return;
      }
      await page.evaluate(() => window.odmShell?.navigation?.reload?.());
      await sleep(1_500);
    },
    // On the server, a URL; in the app, the shell's own navigation (the
    // runner has already signed in and entered the host).
    open: async (route) => {
      if (!app) {
        await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 120_000 });
        await sleep(1_500);
        await settle(page);
        return;
      }
      await appNavigate(page, route, ids, touch);
    },
  };
}

// The app's native screens: add the host, sign in, press Enter, then walk
// to a route by the shell's own links (the previous rigs did this by hand).
export async function enterApp(page, shellBase, host, ids, touch) {
  const tap = (locator) => (touch ? locator.tap() : locator.click());
  await page.goto(`${shellBase}/index.html`, { waitUntil: "networkidle", timeout: 120_000 });
  await sleep(2_000);
  await page.keyboard.press("Escape");
  const close = page.locator('[aria-label*="lose" i]').first();
  if (await close.count()) await close.click({ timeout: 2_000 }).catch(() => {});
  await tap(page.getByRole("button", { name: /add a server/i }).first());
  await sleep(800);
  await page.locator('input[type="text"]').first().fill(host);
  await tap(page.getByRole("button", { name: /^continue$/i }));
  await sleep(3_000);
  await page.locator('input[type="text"]').last().fill(ids.lead);
  await page.locator('input[type="password"]').first().fill(ids.password);
  await tap(page.getByRole("button", { name: /^sign in$/i }).last());
  await sleep(4_000);
  // A fresh sign-in reads the host's tables at once, so the home's hero is
  // the latest table ("Enter the world") rather than the host ("Enter").
  await tap(page.getByRole("button", { name: /^enter(?: the world)?$/i }).first());
  await page.waitForSelector(".game-root", { timeout: 60_000 });
  await sleep(2_000);
  await settle(page);
}

async function appNavigate(page, route, ids, touch) {
  const tap = (locator) => (touch ? locator.tap() : locator.click());
  // The shell's own navigation, the contract the host's pages use inside the
  // apps (window.odmShell, the server's src/lib/shell-host.ts).
  const push = (target) =>
    page.evaluate((to) => {
      const navigation = window.odmShell?.navigation;
      if (!navigation) throw new Error("the app's shell navigation is not there");
      navigation.push(to);
    }, target);
  // A campaign opens from its tile on the app's home, the way a player opens
  // it (from inside a campaign, by going home first); anything else is pushed
  // on the shell's router (client src/renderer/game/index.tsx ROUTES).
  const campaign = route.match(/^\/campaigns\/([^/?]+)/)?.[1];
  if (campaign) {
    // A campaign a scenario made itself is not in the seed's list: its title
    // comes from the host, so the app opens that table and not the lobby.
    const made = async () =>
      page.evaluate(
        (id) =>
          fetch(`/api/campaigns/${id}`)
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => data?.campaign?.title ?? null)
            .catch(() => null),
        campaign,
      );
    const title =
      ids.titles?.[campaign] ??
      (campaign === ids.campaignId ? ids.title : campaign === ids.lobbyId ? ids.lobbyTitle : ((await made()) ?? ids.lobbyTitle));
    // A title is matched as written: "Closing Table (desktop)" has
    // parentheses a pattern would read as a group.
    const tile = page
      .locator(".game-root a, .game-root button")
      .filter({ hasText: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
      .first();
    if (!(await tile.isVisible().catch(() => false))) {
      await push("/");
      await sleep(2_000);
    }
    await tile.waitFor({ state: "visible", timeout: 30_000 });
    await tap(tile);
    // A page under the campaign (its character chooser, its table): once the
    // campaign is open, push the full route on the shell's router, the way
    // the lobby's own links do.
    const rest = route.slice(`/campaigns/${campaign}`.length);
    if (rest && !rest.startsWith("?")) {
      await sleep(2_000);
      await push(route);
    }
  } else {
    await push(route);
  }
  await sleep(4_000);
  await settle(page);
}

// A plain assertion that names what it looked at, for a readable report.
export function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function eventually(fn, { timeoutMs = 15_000, every = 250, label = "condition" } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(every);
  }
  throw new Error(`${label} did not hold within ${timeoutMs / 1000}s${last instanceof Error ? `: ${last.message}` : ""}`);
}

// Opens a side-panel tab the way a person would on this viewport: its rail
// or bottom-bar cell when it has one, otherwise More and the tab's row in
// the sheet More opens (the phone bar keeps five tabs, src/lib/dm/
// table-tabs.ts phoneBarSplit). The sheet is portalled, so its row is
// looked for on the whole page.
export async function openPanelTab(t, tab, { timeoutMs = 30_000 } = {}) {
  const { page, root } = t;
  const direct = page.locator(`${root}[data-tour="tab-${tab}"]`).locator("visible=true").first();
  const more = page.locator(`${root}[data-tour="tab-more"]`).locator("visible=true").first();
  await eventually(async () => (await direct.count()) > 0 || (await more.count()) > 0, {
    timeoutMs,
    label: `the ${tab} tab or More`,
  });
  if (await direct.count()) {
    await t.tap(direct);
    return "direct";
  }
  await t.tap(more);
  const row = page.locator(`[data-more-tab="${tab}"]`).locator("visible=true").first();
  await eventually(() => row.count(), { label: `${tab} under More` });
  await t.tap(row);
  return "more";
}

// Opens one of the table settings' named groups (src/app/campaigns/
// [campaignId]/table-settings-groups.ts) if it is closed. A closed group's
// rows are mounted but hidden, so a check that reads or presses them opens
// the group first, as a person would.
export async function openSettingsGroup(t, id, { timeoutMs = 30_000 } = {}) {
  const { page, root } = t;
  const group = page.locator(`${root}[data-table-settings] [data-group="${id}"]`).locator("visible=true").first();
  await eventually(() => group.count(), { timeoutMs, label: `the ${id} settings group` });
  if ((await group.getAttribute("data-open")) === null) {
    await t.tap(group.locator(".cc-group-toggle").first());
  }
  await eventually(async () => (await group.getAttribute("data-open")) !== null, { label: `the ${id} group open` });
  return group;
}

const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

// axe-core (WCAG 2.1 A and AA rules) over one part of the page: its serious
// and critical violations, or one saying nothing was checked.
export async function axeViolations(page, selector) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) {
    await page.addScriptTag({ content: axeSource });
  }
  return page.evaluate(async (scope) => {
    const root = document.querySelector(scope);
    if (!root) return [{ id: "missing-root", impact: "critical", help: `no ${scope}`, nodes: [] }];
    const result = await window.axe.run(root, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    // A run that checked nothing passes nothing either: say so, rather than
    // pass in silence.
    if (!result.passes.length) {
      return [{ id: "nothing-checked", impact: "critical", help: "axe checked no rule here", nodes: [scope] }];
    }
    // Under forced colors Chromium draws text in the forced colour but reports
    // its -webkit-text-fill-color as the author's, which axe reads: a gold
    // button's dark text, measured against the black behind it, though the
    // page shows the forced white. A contrast failure stands only if the
    // colour actually drawn fails as well.
    const forced = window.matchMedia("(forced-colors: active)").matches;
    const channels = (value) => (String(value).match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const hexChannels = (hex) => [1, 3, 5].map((at) => parseInt(String(hex).slice(at, at + 2), 16));
    const luminance = ([r, g, b]) =>
      [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, at) => sum + v * [0.2126, 0.7152, 0.0722][at], 0);
    const drawnPasses = (node) => {
      const data = node.any?.[0]?.data;
      const el = document.querySelector(node.target.join(" "));
      if (!forced || !el || !data?.bgColor) return false;
      const fg = luminance(channels(getComputedStyle(el).color));
      const bg = luminance(hexChannels(data.bgColor));
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      return ratio >= Number.parseFloat(data.expectedContrastRatio ?? "4.5");
    };
    for (const violation of result.violations.filter((entry) => entry.id === "color-contrast")) {
      violation.nodes = violation.nodes.filter((node) => !drawnPasses(node));
    }
    return result.violations
      .filter((violation) => violation.nodes.length)
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
      }));
  }, selector);
}
