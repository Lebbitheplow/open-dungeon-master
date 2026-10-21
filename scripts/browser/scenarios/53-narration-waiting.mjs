// 2026-10-18: a table watched without a click (three AI players, a human
// who only reads) heard none of its narration. Every file was ready seconds
// after its passage; the browser's autoplay rule held them in the tab until
// the first click there, and the only sign was a struck-through header icon.
// Held narration must be said above the composer and counted on the header
// icon, and one click must play it and clear both. That click plays only the
// newest held passage: an hour of watching would otherwise play back as ten
// minutes of stale scenes, so the older ones are left to their replay
// buttons and never fetched. The header's "Enable
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
      const passages = [...(listed.messages ?? [])]
        .filter((message) => message.authorType === "dm" && !message.content.startsWith("(ooc)"))
        .slice(-2);
      check(passages.length === 2, `the table has two DM passages to voice (${passages.length})`);
      const [older, newer] = passages;

      // A passage voiced before the reloaded page's event stream is open
      // never reaches it (tts_stream and tts_ready are not replayed), and
      // the header's control is drawn before the stream connects. Each page
      // load counts its stream's opens, so the scenario narrates only once
      // the table can hear it.
      await page.addInitScript(() => {
        const Native = window.EventSource;
        window.EventSource = class extends Native {
          constructor(...args) {
            super(...args);
            this.addEventListener("open", () => {
              window.__odmStreamOpens = (window.__odmStreamOpens ?? 0) + 1;
            });
          }
        };
      });
      // Arrives at a page nobody has touched: open it once (tours closed),
      // then reload and keep hands off, since any key or click unlocks.
      const untouched = async () => {
        await t.open(`/campaigns/${ids.campaignId}`);
        await page.reload({ waitUntil: "networkidle" });
        await eventually(() => page.locator('[aria-label^="Enable narration audio"], [aria-label="Narration volume"]').count(), {
          timeoutMs: 30_000,
          label: "the header's narration control after a reload",
        });
        await eventually(() => page.evaluate(() => (window.__odmStreamOpens ?? 0) > 0), {
          timeoutMs: 30_000,
          label: "the table's event stream open after the reload",
        });
        // One after the other, so the newer one is the last to arrive. A
        // passage voiced while the stream is still settling (it can reopen
        // once on a loaded machine) is not replayed, so each is voiced again
        // until the banner shows the page heard it.
        await voiceUntilHeld(older, "A passage arrived");
        await voiceUntilHeld(newer, "2 passages arrived");
      };
      const voiceUntilHeld = async (passage, said) => {
        const heard = () => banner.filter({ hasText: said }).count();
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const voiced = await api.post(`${base}/api/campaigns/${ids.campaignId}/messages/${passage.id}/narrate`);
          check(voiced.ok(), `narrating passage ${passage.id} answered ${voiced.status()}`);
          if (await eventually(heard, { timeoutMs: 6_000, label: `"${said}"` }).catch(() => false)) return;
        }
        await eventually(heard, { label: `the banner saying "${said}"` });
      };
      const banner = page.locator(".session-banner").filter({ hasText: "Narration is waiting" });
      // Above the composer, or over the bottom tabs on a phone whose view
      // has no composer (a fight opens on the board): one of them in view.
      const listen = banner.getByRole("button", { name: "Click to listen", exact: true }).locator("visible=true");
      // Audio fetched to play, by message: /generated-audio/<campaign>/<message>.mp3
      let fetched = [];
      page.on("request", (request) => {
        const match = request.url().match(/\/generated-audio\/[^/]+\/([^/.?]+)/);
        if (match) fetched.push(match[1]);
      });
      // The newest passage plays and the older one never does: the coin clip
      // is well under a second, so anything queued behind it would be fetched
      // within the pause.
      const onlyNewest = async (label) => {
        await eventually(() => fetched.includes(newer.id), { label: `the newest held passage starting to play ${label}` });
        await page.waitForTimeout(2_500);
        check(!fetched.includes(older.id), `the older held passage is not played ${label} (fetched ${fetched.join(", ")})`);
      };

      await untouched();
      await eventually(() => listen.count(), { label: "the held-narration banner" });
      await eventually(() => banner.filter({ hasText: "2 passages arrived" }).count(), { label: "the banner counting both passages" });
      check(
        (await banner.filter({ hasText: "Click to hear the newest; the others have replay buttons." }).locator("visible=true").count()) > 0,
        "the banner says a click plays the newest",
      );
      check(fetched.length === 0, `nothing is fetched to play while held (${fetched.length} requests)`);
      // The narration icon from sm up; the table menu's button on a phone,
      // where narration lives in that menu.
      const counted = viewport === "desktop" ? "Enable narration audio (2 waiting)" : "Table menu (2 narrations waiting)";
      const badged = page.locator(`button[aria-label="${counted}"]`).locator("visible=true");
      check((await badged.count()) === 1, "the header counts both held passages");
      await t.shot("held");
      await listen.first().click();
      await eventually(async () => (await banner.count()) === 0, { label: "the banner leaving after the click" });
      check((await badged.count()) === 0, "the header's count leaves with it");
      await onlyNewest("after the banner's click");

      if (viewport !== "desktop") return;
      // The header's own enable press plays what was held and leaves
      // narration on.
      fetched = [];
      await untouched();
      await eventually(() => badged.count(), { label: "the held count on the header again" });
      await badged.first().click();
      await eventually(async () => (await banner.count()) === 0, { label: "the banner leaving after the header press" });
      await onlyNewest("after the header press");
      const muted = await page.evaluate(() => window.localStorage.getItem("odm_tts_muted"));
      check(muted !== "1", `enabling from the header leaves narration on (muted flag ${muted})`);
      check((await page.locator('button[aria-label="Mute narration"]').locator("visible=true").count()) === 1, "the header now offers to mute");
    } finally {
      await api.patch(`${base}/api/admin/settings`, { data: { speech: previous } }).catch(() => {});
      speech.close();
    }
  },
};
