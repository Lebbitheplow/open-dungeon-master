// Issue 539: in the apps, narration was heard once and then went quiet. The
// apps fetch a protected sound with the player's token and hand the element
// its object URL a beat after the page set src, while the narration hook
// calls play() at once. On an element that had already played a passage,
// that play() started the old file again, and the new address, landing a
// moment later, reloaded the element paused: the next passage never sounded,
// replay did nothing, and every passage after it queued behind one that
// would never end. The shell's play() now waits for the address on its way
// (the client's shared/deferred-play.ts). Here passages are read aloud one
// after another on the table's one narration element, on the server's pages
// and, with --app, on the app's screens, where the failure lived.
//
// The hook had a share in it: it took an AbortError it had not caused (a
// new load under its play()) for its own stop and dropped the passage
// unheard. On the server's pages a load forced under one play() stands in
// for that, and the passage must still be heard.
//
// The Replay Table (seed.mjs) is outside a fight, so its passages show their
// read-aloud buttons; a stand-in speech server voices them, as in
// narration-waiting.
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

// Every sound a media element played to its end: the address the page asked
// for (the app's shell keeps it in data-odm-src) and the file the element
// really played. Set before the page's own code on the server's pages, and
// into the app's shell, which is already open.
function watchPlayback() {
  if (window.__odmPlayback) return;
  const log = { ended: [], interruptNext: false };
  window.__odmPlayback = log;
  const proto = HTMLMediaElement.prototype;
  const play = proto.play;
  proto.play = function (...args) {
    if (!this.__odmWatched) {
      this.__odmWatched = true;
      this.addEventListener("ended", () => {
        log.ended.push({ asked: this.getAttribute("data-odm-src") || this.currentSrc, played: this.currentSrc });
      });
    }
    const started = play.apply(this, args);
    // A new load under this play(), as something outside the page may start.
    if (log.interruptNext && this.src.includes("/generated-audio/")) {
      log.interruptNext = false;
      this.load();
    }
    return started;
  };
}

// Words the passage shows, its markdown marks left out.
const opening = (content) => content.replace(/[*_`#>]/g, "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");

export default {
  name: "narration-replay",
  viewports: ["desktop"],
  async run(t) {
    const { page, api, base, ids, root } = t;
    const speech = await speechServer();
    const before = await (await api.get(`${base}/api/admin/settings`)).json();
    const previous = { ttsProvider: before.speech?.ttsProvider ?? "", kokoroUrl: before.speech?.kokoroUrl ?? "" };
    try {
      const pointed = await api.patch(`${base}/api/admin/settings`, { data: { speech: { ttsProvider: "kokoro", kokoroUrl: speech.url } } });
      check(pointed.ok(), `pointing narration at the stand-in answered ${pointed.status()}`);
      const listed = await (await api.get(`${base}/api/campaigns/${ids.replayTableId}/messages?limit=20`)).json();
      const passages = [...(listed.messages ?? [])]
        .filter((message) => message.authorType === "dm" && !message.content.startsWith("(ooc)"))
        .slice(-2);
      check(passages.length === 2, `the table has two DM passages to read aloud (${passages.length})`);
      const [older, newer] = passages;
      // Voiced before the table opens, so its replay buttons play finished
      // files (the road the report took) and no live stream joins in.
      for (const passage of passages) {
        const voiced = await api.post(`${base}/api/campaigns/${ids.replayTableId}/messages/${passage.id}/narrate`);
        check(voiced.ok(), `voicing passage ${passage.id} answered ${voiced.status()}`);
      }

      const plant = () => window.localStorage.setItem("odm_tts_muted", "0");
      await page.context().addInitScript(plant);
      await page.context().addInitScript(watchPlayback);
      if (t.app) {
        await page.evaluate(plant);
        await page.evaluate(watchPlayback);
      }
      await t.open(`/campaigns/${ids.replayTableId}`);

      const heard = () =>
        page.evaluate(() => window.__odmPlayback.ended.filter((entry) => entry.asked.includes("/generated-audio/")));
      const readAloud = async (passage, label) => {
        const count = (await heard()).length;
        const button = page
          .locator(`${root}.session-dm`)
          .filter({ hasText: opening(passage.content) })
          .locator('button[aria-label="Read this passage aloud"]')
          .locator("visible=true")
          .first();
        await eventually(() => button.count(), { timeoutMs: 30_000, label: `the Read aloud button on ${label}` });
        await t.tap(button);
        await eventually(async () => (await heard()).length > count, { timeoutMs: 15_000, label: `${label} heard to its end` });
        const last = (await heard()).at(-1);
        check(last.asked.includes(passage.id), `the passage heard is ${label} (${last.asked})`);
        return last;
      };

      const first = await readAloud(older, "the first passage");
      const second = await readAloud(newer, "the next passage, on the same element");
      check(second.played !== first.played, "the next passage played its own file, not the first one again");
      const again = await readAloud(older, "the first passage, replayed");
      check(again.played !== second.played, "the replay played its own file, not the one before it");
      await t.shot("heard");

      // The app's shell has its own late loads, the subject above; the forced
      // one is for the server's pages.
      if (t.app) return;
      await page.evaluate(() => {
        window.__odmPlayback.interruptNext = true;
      });
      await readAloud(newer, "a passage whose play() a new load interrupted");
      check(!(await page.evaluate(() => window.__odmPlayback.interruptNext)), "the load was forced under that play()");
    } finally {
      await api.patch(`${base}/api/admin/settings`, { data: { speech: previous } }).catch(() => {});
      speech.close();
    }
  },
};
