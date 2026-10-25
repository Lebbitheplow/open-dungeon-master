// Issue 460: Admin > Usage > Narrator quality shows the AI's turns as rates,
// one row per backend class and DM mode, with the tools tables corrected
// most, and "Export narrator quality" saves those rows as one file with
// every id hashed and no names. The seed holds a table of three finished AI
// turns, one the guard rewrote and one the lead undid a change of
// (scripts/browser/seed.mjs, Quality Table).
import { createHash } from "node:crypto";
import fs from "node:fs";
import { check, eventually } from "../lib.mjs";

const hashed = (id) => createHash("sha256").update(`odm-narrator-quality:${id}`).digest("hex").slice(0, 16);

export default {
  name: "narrator-quality",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open("/admin");
    const usage = page.locator(`${root}[role="radio"]`).filter({ hasText: /^Usage$/ }).locator("visible=true").first();
    await eventually(() => usage.count(), { timeoutMs: 30_000, label: "the Usage section" });
    await usage.scrollIntoViewIfNeeded();
    await t.tap(usage);

    const card = page.locator(`${root}[data-narrator-quality]`).first();
    await eventually(() => card.locator("[data-quality-group]").count(), { timeoutMs: 30_000, label: "the narrator quality rows" });
    await card.scrollIntoViewIfNeeded();
    const groups = await card.locator("[data-quality-group]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-quality-group")));
    check(groups.includes("local:ai"), `the seeded turns' row is missing (rows: ${groups.join(", ")})`);
    check(new Set(groups).size === groups.length, "a backend class and DM mode shows twice");
    const local = card.locator('[data-quality-group="local:ai"]').first();
    check(/apply damage \(\d+\)/.test(await local.locator("[data-quality-tools]").innerText()), "the corrected tool is not named");
    check(/^\d+%$/.test((await local.locator("[data-quality-clean]").innerText()).trim()), "the clean rate is not a percentage");
    // The table scrolls inside its card; the page itself never does.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 1, `the page scrolls sideways by ${overflow}px`);
    await t.shot("card");

    // Every wait starts before the click. Inside the apps the page hands the
    // file to the app's download relay (the client's download shim), which
    // this rig has no native side for, so there the rows are read from the
    // export's answer and the same checks run on them.
    const download = t.app ? null : page.waitForEvent("download", { timeout: 30_000 });
    const answered = page.waitForResponse((response) => response.url().includes("/api/admin/narrator-quality?export=1"), { timeout: 30_000 });
    await t.tap(card.locator("button[data-narrator-quality-export]"));
    const answer = await answered;
    check(answer.ok(), "the export answered with an error");
    let exported;
    if (download) {
      const file = await download;
      check(/^odm-narrator-quality-[\d-]+\.json$/.test(file.suggestedFilename()), `the file is named ${file.suggestedFilename()}`);
      exported = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
    } else {
      exported = await answer.json();
    }
    check(exported.kind === "odm-narrator-quality", "the file is not a narrator quality export");
    const text = JSON.stringify(exported);
    for (const id of ids.qualityTurnIds) {
      check(!text.includes(id), "a raw turn id reached the export");
      check(exported.turns.some((turn) => turn.turn === hashed(id)), "a seeded turn is missing from the export");
    }
    check(!text.includes("Quality Table"), "a table's name reached the export");
    const undone = exported.turns.find((turn) => turn.turn === hashed(ids.qualityTurnIds[1]));
    check(undone?.corrections?.[0]?.kind === "sheet_undo" && undone.clean === false, "the undone turn's fix is missing");
    const rewritten = exported.turns.find((turn) => turn.turn === hashed(ids.qualityTurnIds[2]));
    check(rewritten?.guard === "rewritten" && rewritten.clean === false, "the rewritten turn reads clean");
  },
};
