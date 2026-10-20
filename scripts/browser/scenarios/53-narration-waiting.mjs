// 2026-10-18: a table watched without a click (three AI players, a human
// who only reads) heard none of its narration. Every file was ready seconds
// after its passage; the browser's autoplay rule held them in the tab until
// the first click there, and the only sign was a struck-through header icon.
// Held narration must be said above the composer and counted on the header
// icon, and one click must play it and clear both. The header's "Enable
// narration audio" press must enable, not mute: it used to toggle mute after
// the page's own pointerdown had already unlocked, which switched narration
// off and dropped everything held.
//
// A stand-in speech server answers the narrate route, so the passage is
// voiced the way a real one is (tts_stream, then tts_ready, live).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { check, eventually } from "../lib.mjs";

const CLIP = path.resolve(import.meta.dirname, "../../../public/dice-box/sounds/dicehit/dicehit_coin1.mp3");

function speechServer() {
  const clip = fs.readFileSync(CLIP);
  const server = http.createServer((request, response) => {
    request.resume();
    if (request.method === "POST" && request.url === "/v1/audio/speech") {
      response.writeHead(200, { "Content-Type": "audio/mpeg" });
      response.end(clip);
      return;
    }
    response.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

export default {
  name: "narration-waiting",
  viewports: ["desktop", "phone"],
  // The page is reloaded and left untouched; the app's shell would need
  // entering again after a reload.
  app: false,
  async run(t) {
    const { page, api, base, ids, viewport } = t;
    const speech = await speechServer();
    const before = await (await api.get(`${base}/api/admin/settings`)).json();
    const previous = { ttsProvider: before.speech?.ttsProvider ?? "", kokoroUrl: before.speech?.kokoroUrl ?? "" };
    try {
      const pointed = await api.patch(`${base}/api/admin/settings`, { data: { speech: { ttsProvider: "kokoro", kokoroUrl: speech.url } } });
      check(pointed.ok(), `pointing narration at the stand-in answered ${pointed.status()}`);
      const listed = await (await api.get(`${base}/api/campaigns/${ids.campaignId}/messages?limit=20`)).json();
      const passage = [...(listed.messages ?? [])].reverse().find((message) => message.authorType === "dm");
      check(Boolean(passage), "the table has a DM passage to voice");

      // Arrives at a page nobody has touched: open it once (tours closed),
      // then reload and keep hands off, since any key or click unlocks.
      const untouched = async () => {
        await t.open(`/campaigns/${ids.campaignId}`);
        await page.reload({ waitUntil: "networkidle" });
        await eventually(() => page.locator('[aria-label^="Enable narration audio"], [aria-label="Narration volume"]').count(), {
          timeoutMs: 30_000,
          label: "the header's narration control after a reload",
        });
        const voiced = await api.post(`${base}/api/campaigns/${ids.campaignId}/messages/${passage.id}/narrate`);
        check(voiced.ok(), `narrating the passage answered ${voiced.status()}`);
      };
      const banner = page.locator(".session-banner").filter({ hasText: "Narration is waiting" });
      // Above the composer, or over the bottom tabs on a phone whose view
      // has no composer (a fight opens on the board): one of them in view.
      const listen = banner.getByRole("button", { name: "Click to listen (1)" }).locator("visible=true");
      let fetched = 0;
      page.on("request", (request) => {
        if (request.url().includes("/generated-audio/")) fetched += 1;
      });

      await untouched();
      await eventually(() => listen.count(), { label: "the held-narration banner with its count" });
      check(fetched === 0, `nothing is fetched to play while held (${fetched} requests)`);
      // The narration icon from sm up; the table menu's button on a phone,
      // where narration lives in that menu.
      const counted = viewport === "desktop" ? "Enable narration audio (1 waiting)" : "Table menu (1 narration waiting)";
      const badged = page.locator(`button[aria-label="${counted}"]`).locator("visible=true");
      check((await badged.count()) === 1, "the header counts the held passage");
      await t.shot("held");
      await listen.first().click();
      await eventually(async () => (await banner.count()) === 0, { label: "the banner leaving after the click" });
      await eventually(() => fetched > 0, { label: "the held passage starting to play" });
      check((await badged.count()) === 0, "the header's count leaves with it");

      if (viewport !== "desktop") return;
      // The header's own enable press plays what was held and leaves
      // narration on.
      await untouched();
      await eventually(() => badged.count(), { label: "the held count on the header again" });
      await badged.first().click();
      await eventually(async () => (await banner.count()) === 0, { label: "the banner leaving after the header press" });
      const muted = await page.evaluate(() => window.localStorage.getItem("odm_tts_muted"));
      check(muted !== "1", `enabling from the header leaves narration on (muted flag ${muted})`);
      check((await page.locator('button[aria-label="Mute narration"]').locator("visible=true").count()) === 1, "the header now offers to mute");
    } finally {
      await api.patch(`${base}/api/admin/settings`, { data: { speech: previous } }).catch(() => {});
      speech.close();
    }
  },
};
