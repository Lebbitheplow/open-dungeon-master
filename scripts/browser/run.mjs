// Browser regression run: the built server on a seeded database, driven by
// a real Chromium through the scenarios in scripts/browser/scenarios.
//
// The unit suites render with renderToStaticMarkup, which runs no effects,
// so a dialog that steals a DOM node, a scroll that stops following, a
// poll that stops polling or a preference read wrong at load never shows
// there. Each scenario here is one of those classes of fault, written the
// first time it bit (its header names the issue or PR), so it cannot come
// back unseen. Every scenario also runs on the app's native screens when
// the client's shell is given, since the apps compile these same pages.
//
//   npm run build && npm run test:browser
//   node scripts/browser/run.mjs --only board,chronicle      (a few)
//   node scripts/browser/run.mjs --app ../open-dungeon-master-client/mobile/www
//   node scripts/browser/run.mjs --base http://127.0.0.1:3005 --ids /tmp/x/ids.json
//   node scripts/browser/run.mjs --viewports desktop,phone --keep
//
// Needs a Chromium: `npx playwright-core install chromium` once, or
// ODM_BROWSER=<path to a Chrome>. Writes screenshots of every failure and
// the server's log under the run folder it prints.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { removeTempDir } from "../lib/remove-temp-dir.mjs";
import { enterApp, freePort, launchBrowser, newContext, pageHarness, seeAllTours, serveFolder, signIn, startServer } from "./lib.mjs";

const { values: args } = parseArgs({
  options: {
    only: { type: "string", default: "" },
    app: { type: "string", default: "" },
    base: { type: "string", default: "" },
    ids: { type: "string", default: "" },
    viewports: { type: "string", default: "" },
    keep: { type: "boolean", default: false },
    out: { type: "string", default: "" },
  },
});

const tree = path.resolve(import.meta.dirname, "../..");
const outDir = args.out || fs.mkdtempSync(path.join(os.tmpdir(), "odm-browser-"));
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, "server.log");

// ---- the world and the server ----
let ids;
let server = null;
let base = args.base;
if (base) {
  if (!args.ids) throw new Error("--base needs --ids <ids.json> from a seed of that server's database");
  ids = JSON.parse(fs.readFileSync(args.ids, "utf8"));
} else {
  if (!fs.existsSync(path.join(tree, ".next", "BUILD_ID"))) {
    throw new Error("No build under .next: run `npm run build` first (the scenarios drive the production server).");
  }
  const seeded = spawnSync(process.execPath, [path.join(import.meta.dirname, "seed.mjs"), outDir], {
    cwd: tree,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CONTENT_DB_PATH: process.env.CONTENT_DB_PATH ?? path.join(tree, "data", "content", "open5e.sqlite") },
  });
  if (seeded.status !== 0) {
    throw new Error(`seed failed:\n${seeded.stdout}\n${seeded.stderr}`);
  }
  ids = JSON.parse(fs.readFileSync(path.join(outDir, "ids.json"), "utf8"));
  const port = await freePort();
  server = await startServer({
    tree,
    dbPath: path.join(outDir, "world.sqlite"),
    key: fs.readFileSync(path.join(outDir, "key"), "utf8").trim(),
    port,
    log: logFile,
  });
  base = server.base;
}

// ---- the app's shell, when given ----
const app = Boolean(args.app);
let shell = null;
if (app) {
  const www = path.resolve(args.app);
  if (!fs.existsSync(path.join(www, "index.html"))) {
    throw new Error(`${www} holds no index.html: build the client's mobile shell first (cd mobile && node scripts/build-www.mjs)`);
  }
  shell = await serveFolder(www, await freePort());
}

// ---- the scenarios ----
const scenarioDir = path.join(import.meta.dirname, "scenarios");
const wanted = args.only ? args.only.split(",").map((name) => name.trim()).filter(Boolean) : null;
const scenarios = [];
for (const file of fs.readdirSync(scenarioDir).filter((name) => name.endsWith(".mjs")).sort()) {
  const scenario = (await import(pathToFileURL(path.join(scenarioDir, file)).href)).default;
  if (!scenario?.name || typeof scenario.run !== "function") {
    throw new Error(`${file} does not export a scenario ({ name, run })`);
  }
  if (wanted && !wanted.some((name) => scenario.name.includes(name))) continue;
  // A measurement, not a check (54-large-world-measure.mjs): it runs only
  // when --only names it in full.
  if (scenario.onlyWhenNamed && !wanted?.includes(scenario.name)) continue;
  if (app && scenario.app === false) continue;
  scenarios.push(scenario);
}
const viewportFilter = args.viewports ? args.viewports.split(",") : null;

const browser = await launchBrowser({ app });
const results = [];
const started = Date.now();
try {
  for (const scenario of scenarios) {
    const viewports = (scenario.viewports ?? ["desktop"]).filter((name) => !viewportFilter || viewportFilter.includes(name));
    for (const viewport of viewports) {
      const tag = `${scenario.name}-${viewport}${app ? "-app" : ""}`;
      const context = await newContext(browser, viewport, { app });
      const page = await context.newPage();
      const apiContext = await browser.newContext();
      const harness = pageHarness({ page, base, ids, app, viewport, outDir, tag, api: apiContext.request });
      const t0 = Date.now();
      try {
        await signIn(apiContext, base, ids.lead, ids.password);
        // The lead has seen every tour at its current version; tours-account
        // walks its own accounts, and a scenario about a tour replays it.
        await seeAllTours(apiContext.request, base);
        if (app) {
          await enterApp(page, shell.base, base, ids, harness.touch);
        } else {
          await signIn(context, base, ids.lead, ids.password);
        }
        await scenario.run(harness);
        if (harness.fails.length) {
          throw new Error(`behind the scenes: ${harness.fails.slice(0, 5).join("; ")}`);
        }
        results.push({ tag, ok: true, ms: Date.now() - t0 });
        console.log(`ok    ${tag} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      } catch (error) {
        await harness.shot("failed");
        results.push({ tag, ok: false, ms: Date.now() - t0, error: String(error?.message ?? error) });
        // The whole message: a scenario that gathers its problems lists them
        // on the lines after the first, and CI keeps no report to read them in.
        console.log(`FAIL  ${tag}: ${String(error?.message ?? error)}`);
      } finally {
        // A route handler still waiting on its route.fetch when the page
        // closes rejects with "socket hang up", outside any scenario's await,
        // and that ended the whole run after workshop-tours had passed.
        await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
        await context.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
        await apiContext.close().catch(() => {});
        await context.close().catch(() => {});
      }
    }
  }
} finally {
  await browser.close().catch(() => {});
  if (shell) await shell.stop();
  if (server) await server.stop();
}

const failed = results.filter((result) => !result.ok);
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ base, app, results }, null, 2));
console.log(
  `\n${results.length - failed.length} of ${results.length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s` +
    (failed.length ? `; screenshots and server.log in ${outDir}` : args.keep ? `; run folder kept at ${outDir}` : ""),
);
if (!failed.length && !args.keep && !args.out) {
  removeTempDir(outDir);
}
process.exit(failed.length ? 1 : 0);
