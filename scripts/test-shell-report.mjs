// Report a problem inside the apps (src/lib/shell-report.ts, issue #459):
// the app saves the file itself and adds what only it knows, under
// "Version and setup" and nowhere else; an app without the door (older
// apps, the web view) gets the browser's download; backing out of the
// app's dialog is not a save; and nothing the app says beyond its known
// facts reaches the file.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-shell-report");
const { cleanAppFacts, saveReportFile, withAppFacts, withShellFacts } = await import("../src/lib/shell-report.ts");

const FACTS = {
  version: "0.22.0",
  installKind: "android",
  platform: "android",
  arch: "",
  os: "Linux; Android 15; Pixel 8",
  runtime: "WebView",
  screens: "native",
  localWorld: false,
};

function bundle(withSetup = true) {
  return {
    kind: "odm-report",
    format: 1,
    createdAt: "2026-10-24T10:00:00.000Z",
    madeFrom: "table",
    included: withSetup ? ["setup"] : [],
    ...(withSetup
      ? {
          setup: {
            version: "0.30.0",
            build: "0.30.0",
            commit: "",
            platform: "linux",
            arch: "x64",
            node: "v22",
            deviceWorld: false,
            narrator: { backend: "openai", model: "m" },
          },
        }
      : {}),
    readable: withSetup
      ? ["Open Game Master report, made now from a table.", "Version 0.30.0 on linux x64, Node v22.", "Narrator: openai, model m."]
      : ["Open Game Master report, made now from a table."],
  };
}

function withShell(shell, run) {
  const before = globalThis.window;
  globalThis.window = { odmShell: shell };
  return Promise.resolve(run()).finally(() => {
    globalThis.window = before;
  });
}

await test("The app's facts go under Version and setup, with a line after the server's.", () => {
  const made = withAppFacts(bundle(), FACTS);
  assert.deepEqual(made.setup.app, FACTS);
  assert.equal(made.setup.version, "0.30.0");
  const app = made.readable.findIndex((line) => line.startsWith("App: "));
  assert.match(made.readable[app], /^App: Open Game Master 0\.22\.0 \(android\) on android, .*native screens, at a server elsewhere\.$/);
  assert.match(made.readable[app - 1], /^Server: linux x64/);
  assert.equal(made.readable[app + 1], "Narrator: openai, model m.");
});

await test("The desktop app's local AI goes in by model and state, a line each, cut short.", () => {
  const story = "gpt-oss-20b (gptoss20b), running";
  const made = withAppFacts(bundle(), { ...FACTS, platform: "linux", installKind: "AppImage", localStory: story, localImages: `ComfyUI stopped (${"x".repeat(400)})` });
  assert.equal(made.setup.app.localStory, story);
  assert.equal(made.setup.app.localImages.length, 300);
  assert.ok(made.readable.includes(`The app's local story AI: ${story}.`));
  assert.ok(made.readable.some((line) => line.startsWith("The app's local image AI: ComfyUI stopped")));
  // An app that sends no local AI lines adds no empty ones.
  assert.ok(!("localStory" in withAppFacts(bundle(), FACTS).setup.app));
});

await test("A report with Version and setup unticked carries nothing about the app.", () => {
  const made = withAppFacts(bundle(false), FACTS);
  assert.equal(made.setup, undefined);
  assert.ok(!JSON.stringify(made).includes("Pixel"));
});

await test("Only the known facts reach the file, each cut short.", () => {
  const clean = cleanAppFacts({ ...FACTS, hostOrigin: "http://192.0.2.4:3000", lanUrl: "http://192.0.2.4", os: "x".repeat(500), localWorld: "yes" });
  assert.deepEqual(Object.keys(clean).sort(), Object.keys(FACTS).sort());
  assert.equal(clean.os.length, 120);
  assert.equal(clean.localWorld, false);
  assert.equal(cleanAppFacts(null), null);
  assert.equal(cleanAppFacts(["x"]), null);
  assert.equal(cleanAppFacts({ screens: "native" }), null);
});

await test("In an app the app saves the file, with its facts in it, and says where.", async () => {
  const saves = [];
  const shell = {
    platform: "desktop",
    showServers() {},
    reportFacts: async () => ({ ...FACTS, platform: "linux", installKind: "AppImage", localWorld: true }),
    saveReport: async (input) => {
      saves.push(input);
      return { saved: true, name: "renamed.json", where: "~/Downloads" };
    },
  };
  const result = await withShell(shell, async () => saveReportFile(await withShellFacts(bundle()), "odm-report-2026-10-24-10-00-00.json"));
  assert.deepEqual(result, { saved: true, name: "renamed.json", where: "~/Downloads" });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].name, "odm-report-2026-10-24-10-00-00.json");
  const file = JSON.parse(saves[0].text);
  assert.equal(file.kind, "odm-report");
  assert.equal(file.setup.app.installKind, "AppImage");
  assert.equal(file.setup.app.localWorld, true);
  assert.ok(file.readable.some((line) => line.includes("at the world this device hosts")));
});

await test("Backing out of the app's save dialog is not a save.", async () => {
  const shell = { platform: "android", showServers() {}, saveReport: async () => ({ saved: false, name: "", where: "" }) };
  const result = await withShell(shell, () => saveReportFile(bundle(), "odm-report-x.json"));
  assert.equal(result.saved, false);
});

await test("An app that cannot describe itself still saves the file, without the app's part.", async () => {
  const saves = [];
  const shell = {
    platform: "android",
    showServers() {},
    reportFacts: async () => {
      throw new Error("no");
    },
    saveReport: async (input) => {
      saves.push(input);
      return { saved: true, name: input.name, where: "the place you picked" };
    },
  };
  const result = await withShell(shell, async () => saveReportFile(await withShellFacts(bundle()), "odm-report-x.json"));
  assert.equal(result.where, "the place you picked");
  assert.equal(JSON.parse(saves[0].text).setup.app, undefined);
});

await test("An app without the door gets the browser's download, as before.", async () => {
  const clicked = [];
  const before = globalThis.document;
  globalThis.document = {
    createElement: () => ({ click() { clicked.push(this.download); }, remove() {} }),
    body: { appendChild() {} },
  };
  try {
    const result = await withShell({ platform: "desktop", showServers() {} }, () => saveReportFile(bundle(), "odm-report-x.json"));
    assert.deepEqual(result, { saved: true, name: "odm-report-x.json", where: "" });
    assert.deepEqual(clicked, ["odm-report-x.json"]);
  } finally {
    globalThis.document = before;
  }
});

finish();
