// Threads for a board view (the addon framework's threads permission). A
// 3D engine on several threads needs shared memory, which a browser gives
// only inside a cross-origin isolated page. A server isolates its pages only
// while an addon that is on has been given threads, so a server without one
// is exactly as before, and inside them only that addon's frame is isolated
// (Chromium holds that line per frame; docs/addons.md says where Firefox
// does not).
//
// A fresh server with a development addon that asks for threads, whose page
// reports what it was given. Before the admin's yes nothing changes. After
// it every page sends the two headers and is isolated; the addon's page in a
// frame made the way the table makes it (AddonBoardView.tsx) shares memory
// with a worker it started from a Blob, and the same frame without the
// permission's allow gets none. Switched off, the pages are as before.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { check, eventually, freePort, newContext, startServer } from "../lib.mjs";

const TREE = path.resolve(import.meta.dirname, "../../..");
const ID = "threads-probe";
const SETUP_CODE = "THRD-PRBE-SRVR-2026";

// The page tells its parent whether it is isolated, whether shared memory
// exists, and whether a worker it started from a Blob saw a write to it.
const BOARD = `<!doctype html><script>
(async () => {
  const report = { isolated: self.crossOriginIsolated, shared: typeof SharedArrayBuffer, worker: "none" };
  if (typeof SharedArrayBuffer === "function") {
    const source = "onmessage = (e) => { const cells = new Int32Array(e.data); Atomics.add(cells, 0, 41); postMessage(Atomics.load(cells, 0)); };";
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    report.worker = await new Promise((done) => { worker.onmessage = (e) => done(String(e.data)); worker.onerror = () => done("error"); worker.postMessage(new SharedArrayBuffer(4)); });
  }
  parent.postMessage({ probe: report }, "*");
})();
</script>`;

function writeAddon(dir) {
  const folder = path.join(dir, ID);
  fs.mkdirSync(path.join(folder, "server"), { recursive: true });
  fs.mkdirSync(path.join(folder, "ui"), { recursive: true });
  fs.copyFileSync(path.join(TREE, "examples", "addons", "hello-dungeon", "server", "mcp.mjs"), path.join(folder, "server", "mcp.mjs"));
  fs.writeFileSync(path.join(folder, "server", "main.mjs"), `import { createServer } from "./mcp.mjs";\ncreateServer({ name: "${ID}", version: "1.0.0" }).listen();\n`);
  fs.writeFileSync(path.join(folder, "ui", "board.html"), BOARD);
  fs.writeFileSync(
    path.join(folder, "addon.json"),
    JSON.stringify({
      id: ID,
      name: "Threads probe",
      version: "1.0.0",
      apiVersion: 1,
      description: "Reports whether its board view may share memory.",
      author: "tests",
      license: "MIT",
      runtime: { kind: "node", entry: "server/main.mjs" },
      permissions: ["threads"],
      contributes: { boardViews: [{ id: "probe", title: "Probe", entry: "ui/board.html" }] },
    }),
  );
  return folder;
}

export default {
  name: "board-view-threads",
  viewports: ["desktop"],
  app: false,
  async run(t) {
    const { page, viewport } = t;
    const dir = path.join(path.dirname(t.shotPath("x")), `threads-server-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const addon = writeAddon(dir);
    const key = randomBytes(32).toString("hex");
    const port = await freePort();
    // startServer hands the child this process's environment as it spawns.
    const start = () => {
      const env = { ODM_SETUP_CODE: SETUP_CODE, ODM_ADDON_DEV_DIRS: addon, ADDONS_DIR: path.join(dir, "addons") };
      Object.assign(process.env, env);
      try {
        return startServer({ tree: TREE, dbPath: path.join(dir, "threads.sqlite"), key, port, log: path.join(dir, "server.log") });
      } finally {
        for (const name of Object.keys(env)) delete process.env[name];
      }
    };
    let server = await start();
    const context = await newContext(page.context().browser(), viewport, { app: false });
    try {
      const { base } = server;
      const admin = context.request;
      const made = await admin.post(`${base}/api/auth/register`, { data: { username: "threads_admin", password: "Threads-2026-pass", setupCode: SETUP_CODE } });
      check(made.status() === 201, `the server's first account (${made.status()})`);
      const policyOf = async (pathname) => {
        const response = await admin.get(`${base}${pathname}`, { maxRedirects: 0 });
        return [response.headers()["cross-origin-opener-policy"] ?? null, response.headers()["cross-origin-embedder-policy"] ?? null];
      };
      for (const pathname of ["/", "/workshop"]) {
        check(JSON.stringify(await policyOf(pathname)) === "[null,null]", `${pathname} is not isolated while no addon has threads`);
      }

      const accepted = await admin.patch(`${base}/api/admin/addons/${ID}`, { data: { enabled: true, accept: ["threads"] } });
      check(accepted.ok(), `the admin switches it on and accepts threads (${accepted.status()})`);
      for (const pathname of ["/", "/workshop"]) {
        check(JSON.stringify(await policyOf(pathname)) === '["same-origin","credentialless"]', `${pathname} is isolated once an addon has threads`);
      }
      const offered = await (await admin.get(`${base}/api/addons`)).json();
      check(offered.boardViews.find((view) => view.addonId === ID)?.threads === true, "its board view is offered with threads");

      const browserPage = await context.newPage();
      await browserPage.goto(`${base}/`);
      await eventually(() => browserPage.evaluate(() => document.readyState === "complete"), { label: "the home page" });
      check(await browserPage.evaluate(() => self.crossOriginIsolated), "the page itself is cross-origin isolated");
      // A frame made the way the table makes one, with and without the permission's allow.
      const frameReport = (allow) =>
        browserPage.evaluate(
          ({ src, allow }) =>
            new Promise((done) => {
              const frame = document.createElement("iframe");
              frame.setAttribute("sandbox", "allow-scripts");
              frame.setAttribute("credentialless", "");
              frame.setAttribute("allow", allow);
              frame.src = src;
              const onMessage = (event) => {
                if (event.source !== frame.contentWindow || !event.data?.probe) return;
                removeEventListener("message", onMessage);
                frame.remove();
                done(event.data.probe);
              };
              addEventListener("message", onMessage);
              document.body.append(frame);
              setTimeout(() => done(null), 15_000);
            }),
          { src: `${offered.boardViews.find((view) => view.addonId === ID).url}`, allow },
        );
      const threaded = await frameReport("cross-origin-isolated");
      check(threaded?.isolated === true && threaded.shared === "function", `the addon's frame is isolated and has shared memory (${JSON.stringify(threaded)})`);
      check(threaded.worker === "41", `a worker it started from a Blob saw its write (${threaded.worker})`);
      const plain = await frameReport("");
      check(plain && plain.isolated === false && plain.shared === "undefined", `without the allow the same frame gets none (${JSON.stringify(plain)})`);
      await browserPage.close();

      // A restart reads it back from what the server remembers, before the first page.
      await server.stop();
      server = await start();
      check(JSON.stringify(await policyOf("/")) === '["same-origin","credentialless"]', "after a restart the pages are isolated from the first one");

      const off = await admin.patch(`${base}/api/admin/addons/${ID}`, { data: { enabled: false } });
      check(off.ok(), `switched off (${off.status()})`);
      check(JSON.stringify(await policyOf("/")) === "[null,null]", "switched off, the pages are as before");
    } finally {
      await context.close();
      await server.stop();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  },
};
