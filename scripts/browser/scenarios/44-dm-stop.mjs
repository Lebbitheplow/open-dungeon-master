// Issue 383: a DM turn stuck short of an answer sat on "DM at work" forever,
// with nothing said and no way out. The status line now names the step the
// DM is on and how long it has been there, and the lead's Stop ends the turn
// with the halted notice and its Retry. The Server log tab shows what the
// server wrote about it, and the AI group of Table settings holds the
// narration length and style notes (the model half of the issue).
//
// The table's storyteller is a model this scenario starts and never lets
// answer, so the turn waits on it until Stop.
import http from "node:http";
import { check, eventually, freePort, openSettingsGroup, openPanelTab } from "../lib.mjs";

function silentModel(port) {
  const held = new Set();
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url?.endsWith("/chat/completions")) {
      held.add(res);
      res.on("close", () => held.delete(res));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        close: () => {
          for (const res of held) res.destroy();
          server.close();
        },
      }),
    ),
  );
}

export default {
  name: "dm-stop",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const campaignId = ids.stopTables[viewport];
    const port = await freePort();
    const model = await silentModel(port);
    try {
      const pointed = await api.patch(`${base}/api/campaigns/${campaignId}/story-settings`, {
        data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "silent-test-model" },
      });
      check(pointed.ok(), `pointing the table at the silent model answered ${pointed.status()}`);

      await t.open(`/campaigns/${campaignId}`);
      const acted = await api.post(`${base}/api/campaigns/${campaignId}/actions`, {
        data: { content: "I hail the ferryman.", kind: "do" },
      });
      check(acted.ok(), `the action answered ${acted.status()}`);

      // The step and its clock, and the lead's Stop.
      const status = page.locator(`${root}.session-status`).locator("visible=true").first();
      await eventually(async () => /Waiting on the model/.test((await status.textContent()) ?? ""), {
        timeoutMs: 30_000,
        label: "the status line naming the step",
      });
      await eventually(async () => /\d+s/.test((await status.textContent()) ?? ""), {
        timeoutMs: 15_000,
        label: "the status line's clock",
      });
      const stop = status.getByRole("button", { name: "Stop the DM" });
      check((await stop.count()) === 1, "the lead is offered Stop");
      await t.shot("waiting");

      await t.tap(stop);
      const banner = page.locator(`${root}*`).filter({ hasText: /^DM halted, context preserved$/ }).locator("visible=true").first();
      await eventually(() => banner.count(), { timeoutMs: 30_000, label: "the halted notice" });
      const notice = page.getByText(/the lead stopped this turn/i).locator("visible=true").first();
      await eventually(() => notice.count(), { label: "the notice saying the lead stopped it" });
      const retry = page.getByRole("button", { name: /Retry the turn/ }).locator("visible=true").first();
      await eventually(() => retry.count(), { label: "Retry on the notice" });
      await eventually(async () => (await status.count()) === 0, { label: "the status line gone once stopped" });
      await notice.scrollIntoViewIfNeeded().catch(() => undefined);
      await t.shot("stopped");

      // The AI group holds the narration length and the style notes.
      await openPanelTab(t, "settings");
      const group = await openSettingsGroup(t, "ai");
      const length = group.locator('[data-settings-row="narration-length"]');
      const notes = group.locator('[data-settings-row="style-notes"] textarea');
      await eventually(() => length.count(), { label: "the narration length row" });
      check((await notes.count()) === 1, "the style notes box is there");
      await notes.fill("Keep the pacing slow.");
      await notes.blur();
      await eventually(async () => {
        const response = await api.get(`${base}/api/campaigns/${campaignId}`);
        const data = await response.json();
        return data.campaign?.gameSettings?.styleNotes === "Keep the pacing slow.";
      }, { label: "the style notes saved" });
      await length.scrollIntoViewIfNeeded().catch(() => undefined);
      await t.shot("style");

      // What the server wrote about it, read from the admin panel.
      if (!t.app) {
        await t.open("/admin");
        await t.tap(page.getByRole("radio", { name: /Server log/ }).or(page.getByRole("tab", { name: /Server log/ })).or(page.getByRole("button", { name: /Server log/ })).first());
        const line = page.getByText(/stopping the turn job while waiting on the model/).first();
        await eventually(() => line.count(), { timeoutMs: 15_000, label: "the stop in the server log" });
        // Seven tabs overflow the row, which then scrolls: the gold pill must
        // still sit on the tab it marks once the display font has landed.
        await eventually(
          () =>
            page.evaluate(() => {
              const active = document.querySelector('[role="radiogroup"][aria-label="Admin section"] [aria-checked="true"]');
              const pill = active?.parentElement?.querySelector(".seg-pill");
              if (!active || !pill) return false;
              const a = active.getBoundingClientRect();
              const p = pill.getBoundingClientRect();
              return Math.abs(a.left - p.left) < 2 && Math.abs(a.width - p.width) < 2;
            }),
          { label: "the tab pill on the Server log tab" },
        );
        await t.shot("server-log");
      }
    } finally {
      await api.patch(`${base}/api/campaigns/${campaignId}/story-settings`, { data: { textProvider: "none" } }).catch(() => undefined);
      model.close();
    }
  },
};
