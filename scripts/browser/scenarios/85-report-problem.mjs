// Issue 459: "Report a problem" at the table saves one report file to the
// device and opens the bug report form in a new tab, with nothing from the
// report in its address. It is the server admin's alone: it lives in Help
// (the header's Help from sm up, the table menu's Help row on a phone),
// never as a header button of its own, and a player who is not the admin
// finds there who to ask instead, with the table's report route refusing
// them. The page's own errors are kept in the admin's browser (a synthetic
// error event here, so the rig's own page-error watch stays quiet) and go
// in the file with their keys cut out; the transcript is off until ticked,
// and once ticked holds only the reporter's lines and the DM's. The rig
// never reaches GitHub: the form's address is answered here.
import fs from "node:fs";
import { check, eventually, hydrated, newContext, settle, signIn } from "../lib.mjs";

const FORM = "https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=bug_report.yml";

export default {
  name: "report-problem",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport, base } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });

    // An error the page "hit", kept by the recorder the table installs.
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: new Error("scenario boom with ?token=abc123SECRETVALUE") }));
    });

    check((await page.locator(`${root}header [data-report-problem]`).count()) === 0, "the header carries a Report a problem button of its own");
    if (viewport === "desktop") {
      await t.tap(page.locator(`${root}header button[data-tour="header-help"]`).locator("visible=true").first());
    } else {
      await t.tap(page.locator(`${root}button[aria-label^="Table menu"]`).locator("visible=true").first());
      const row = page.locator('[role="menuitem"]', { hasText: "Help" }).locator("visible=true").first();
      await eventually(() => row.count(), { label: "Help in the table menu" });
      await t.tap(row);
    }
    const inHelp = page.locator("[role=dialog] button[data-report-problem]").locator("visible=true").first();
    await eventually(() => inHelp.count(), { timeoutMs: 15_000, label: "Report a problem in Help" });
    await inHelp.scrollIntoViewIfNeeded();
    await t.tap(inHelp);

    const dialog = page.locator("[data-report-problem-dialog]").locator("visible=true").first();
    await eventually(() => dialog.locator("[data-report-part]").count(), { label: "the report's tick boxes" });
    const offered = await dialog.locator("[data-report-part]").evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-report-part"), row.querySelector("input").checked]));
    const ticked = Object.fromEntries(offered);
    // The seeded lead steers an AI table and runs the server.
    for (const part of ["setup", "pageErrors", "turnTimings", "serverLog", "transcript", "turnRecords"]) {
      check(part in ticked, `the lead is offered ${part} (offered ${offered.map(([id]) => id).join(", ")})`);
    }
    check(ticked.transcript === false, "the transcript is ticked before it is asked for");
    check(ticked.turnRecords === false, "the narrator's records are ticked before they are asked for");
    await t.shot("dialog");
    await t.tap(dialog.locator('[data-report-part="transcript"] input'));

    // In the app the app saves the file (window.odmShell.saveReport, the
    // client's share sheet on the phone shell this rig runs) and adds its own
    // facts. Headless Chromium has no share sheet, so the sheet is answered at
    // once, and the text the page handed the app is kept for the checks.
    if (t.app) {
      const offered = await page.evaluate(() => typeof window.odmShell?.saveReport === "function" && typeof window.odmShell?.reportFacts === "function");
      check(offered, "the app offers no way to save the report");
      await page.evaluate(() => {
        navigator.share = async () => {};
        const shell = window.odmShell;
        const save = shell.saveReport;
        shell.saveReport = async (input) => {
          window.__odmReportText = input.text;
          return save.call(shell, input);
        };
      });
    }

    // GitHub is answered here; every wait starts before the click.
    await page.context().route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>form</title>" }));
    const download = t.app ? null : page.waitForEvent("download", { timeout: 30_000 });
    const popup = page.context().waitForEvent("page", { timeout: 30_000 });
    const posted = page.waitForResponse((response) => response.url().includes("/report-bundle") && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(dialog.locator("button[data-report-save]"));
    const answer = await posted;
    check(answer.ok(), `building the report answered ${answer.status()}`);
    const sent = answer.request().postDataJSON();
    check(!("pageErrors" in (sent.parts ?? {})), "the page's errors were sent to the server");

    let report;
    if (download) {
      const file = await download;
      check(/^odm-report-[\d-]+\.json$/.test(file.suggestedFilename()), `the file is named ${file.suggestedFilename()}`);
      report = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
    } else {
      const text = await eventually(() => page.evaluate(() => window.__odmReportText ?? null), { label: "the file handed to the app" });
      report = JSON.parse(text);
      const app = report.setup?.app;
      check(app?.platform === "android" && app.screens === "native" && app.localWorld === false, `the app's facts are wrong: ${JSON.stringify(app)}`);
      check(report.readable.some((line) => line.startsWith("App: Open Dungeon Master")), "the readable lines leave out the app");
      check(!/https?:\/\//.test(JSON.stringify(app)), "the app's facts carry an address");
    }
    check(report.kind === "odm-report", "the file is a report");
    for (const part of ["setup", "pageErrors", "transcript"]) {
      check(report.included.includes(part), `the report holds ${part} (it holds ${report.included.join(", ")})`);
    }
    check(!report.included.includes("turnRecords"), "the narrator's records went in unticked");
    check(report.pageErrors.some((entry) => entry.message.includes("scenario boom")), "the page's error is missing");
    const text = JSON.stringify(report);
    check(!text.includes("abc123SECRETVALUE"), "the error's token reached the report");
    check(report.transcript.every((line) => line.from === "you" || line.from === "dm"), "another player's line reached the transcript");

    const tab = await popup;
    await eventually(() => tab.url().startsWith("https://github.com/"), { label: "the form's tab" });
    check(tab.url() === FORM, `the form opened at ${tab.url()}, with something more in its address`);
    await tab.close();

    const saved = page.locator("[data-report-saved]").locator("visible=true").first();
    await eventually(() => saved.count(), { label: "the saved note" });
    check((await saved.locator("[data-report-form-link]").getAttribute("href")) === FORM, "the note's link is not the form");
    if (t.app) check((await saved.innerText()).includes("to the place you picked"), "the note does not say where the app put the file");
    await t.shot("saved");

    // The seeded player is not the admin: Help tells them who to ask, with
    // no button, and the table's report route refuses them.
    if (viewport === "desktop" && !t.app) {
      const playerContext = await newContext(page.context().browser(), viewport, { app: false });
      try {
        await signIn(playerContext, base, ids.player, ids.password);
        const refused = await playerContext.request.get(`${base}/api/campaigns/${ids.campaignId}/report-bundle`);
        check(refused.status() === 403, `the table's report answered a player ${refused.status()}`);
        const playerPage = await playerContext.newPage();
        await playerPage.goto(`${base}/campaigns/${ids.campaignId}`, { waitUntil: "networkidle", timeout: 120_000 });
        await hydrated(playerPage);
        await settle(playerPage);
        const help = playerPage.locator('header button[data-tour="header-help"]').locator("visible=true").first();
        await eventually(() => help.count(), { timeoutMs: 30_000, label: "the player's Help" });
        await help.click();
        const ask = playerPage.locator("[role=dialog] [data-report-ask-host]").locator("visible=true").first();
        await eventually(() => ask.count(), { timeoutMs: 15_000, label: "who to ask, in the player's Help" });
        check((await playerPage.locator("[role=dialog] [data-report-problem]").count()) === 0, "a player who is not the admin was offered Report a problem");
        await ask.scrollIntoViewIfNeeded();
        await playerPage.screenshot({ path: t.shotPath("player-help") }).catch(() => {});
      } finally {
        await playerContext.close();
      }
    }
  },
};
