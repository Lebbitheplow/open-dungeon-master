// Audit 2026-10-26 K01 and F07: sound that follows the table. Issue 539's
// late address was not only narration's: the music player starts every take
// on a new element and calls play() at once, and a sting reuses an element
// from a small pool, so in the apps, where a protected sound reaches its
// element only after a fetch, a cue change or a take's hand-over could
// leave the music paused at zero and a reused sting silent (the client's
// shared/deferred-play.ts now holds play() for the address). Here the Sound
// Table (seed.mjs) starts music, changes cue, skips a take and sounds the
// same sting twice, on the server's pages and, with --app, on the app's
// screens, where the failure lived.
//
// F07: narration volume and "read aloud" changed outside the table's own
// header (the apps' Settings screen, or the account's copy landing late)
// did not reach the passage being read. A long stand-in passage is playing
// when the preference changes, as Settings writes it.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { check, eventually, sleep } from "../lib.mjs";

const LONG_CLIP = path.resolve(import.meta.dirname, "../../../public/ambience/calm.opus");

function speechServer() {
  const clip = fs.readFileSync(LONG_CLIP);
  const server = http.createServer((request, response) => {
    request.resume();
    if (request.method === "POST" && request.url === "/v1/audio/speech") {
      response.writeHead(200, { "Content-Type": "audio/ogg" });
      response.end(clip);
      return;
    }
    if (request.url === "/v1/audio/voices") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ voices: ["af_heart"] }));
      return;
    }
    response.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

// Every media element the page plays, with what it asked for (the app's
// shell keeps the host address in data-odm-src) and how often it started.
function watchMedia() {
  if (window.__odmMedia) return;
  const seen = [];
  window.__odmMedia = seen;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!this.__odmEntry) {
      const entry = { element: this, playing: 0 };
      this.__odmEntry = entry;
      seen.push(entry);
      this.addEventListener("playing", () => (entry.playing += 1));
    }
    return play.apply(this, args);
  };
}

// What each element is doing now, by the address the page gave it.
function mediaNow() {
  return window.__odmMedia.map(({ element, playing }, index) => ({
    index,
    asked: element.getAttribute("data-odm-src") || element.currentSrc || element.src,
    paused: element.paused,
    time: element.currentTime,
    volume: element.volume,
    playing,
  }));
}

export default {
  name: "ambience-takes",
  viewports: ["desktop"],
  async run(t) {
    const { page, api, base, ids, root } = t;
    const table = ids.soundTableId;
    const steer = async (body) => {
      const response = await api.post(`${base}/api/campaigns/${table}/ambience`, { data: body });
      check(response.ok(), `${JSON.stringify(body)} answered ${response.status()}`);
    };
    const media = () => page.evaluate(mediaNow);
    // An element on this address that is running: started, not paused, and
    // past its first moment.
    const running = (pattern, label) =>
      eventually(
        async () => (await media()).find((entry) => pattern.test(entry.asked) && !entry.paused && entry.time > 0.2 && entry.playing > 0),
        { timeoutMs: 20_000, label },
      );

    const speech = await speechServer();
    const before = await (await api.get(`${base}/api/admin/settings`)).json();
    const previous = { ttsProvider: before.speech?.ttsProvider ?? "", kokoroUrl: before.speech?.kokoroUrl ?? "" };
    try {
      await steer({ music: "calm", bed: "none" });
      const plant = () => {
        window.localStorage.setItem("odm_ambience_muted", "0");
        window.localStorage.setItem("odm_tts_muted", "0");
        window.localStorage.setItem("odm_tts_volume", "0.8");
      };
      await page.context().addInitScript(plant);
      await page.context().addInitScript(watchMedia);
      if (t.app) {
        await page.evaluate(plant);
        await page.evaluate(watchMedia);
      }
      await t.open(`/campaigns/${table}`);
      // The gesture the browser wants before sound.
      await page.keyboard.press("Escape");

      const calm = await running(/\/ambience\/calm(-\d+)?\.opus/, "the calm music playing");
      await steer({ music: "tension" });
      const tension = await running(/\/ambience\/tension(-\d+)?\.opus/, "the music changed to tension, playing");
      check(tension.index !== calm.index, "the new cue plays on its own element");

      // The next take, from the Sound panel, as a DM skips one.
      await t.tap(page.locator(`${root}button[aria-label="Sound"]`).locator("visible=true").first());
      const next = page.getByRole("button", { name: "Next music take" }).locator("visible=true").first();
      await eventually(() => next.count(), { label: "the Next music take button" });
      const takes = (await media()).length;
      await t.tap(next);
      await eventually(
        async () => (await media()).slice(takes).find((entry) => /\/ambience\/tension(-\d+)?\.opus/.test(entry.asked) && !entry.paused && entry.time > 0.2),
        { timeoutMs: 20_000, label: "the next take playing" },
      );
      await page.keyboard.press("Escape");

      // A sting, then the same sting again on an element from the pool.
      await steer({ sting: "bell" });
      const bell = await running(/\/ambience\/bell\.opus/, "the bell sounding");
      await eventually(async () => (await media())[bell.index].paused, { timeoutMs: 30_000, label: "the bell finished" });
      await steer({ sting: "bell" });
      await eventually(
        async () => (await media()).some((entry) => /\/ambience\/bell\.opus/.test(entry.asked) && entry.playing > (entry.index === bell.index ? bell.playing : 0) && !entry.paused),
        { timeoutMs: 20_000, label: "the bell sounding a second time" },
      );
      await t.shot("sound");

      // ---- F07: Settings reach the passage being read ----
      const pointed = await api.patch(`${base}/api/admin/settings`, { data: { speech: { ttsProvider: "kokoro", kokoroUrl: speech.url } } });
      check(pointed.ok(), `pointing narration at the stand-in answered ${pointed.status()}`);
      const narrated = await api.patch(`${base}/api/campaigns/${table}/settings`, { data: { ttsEnabled: true } });
      check(narrated.ok(), `turning narration on answered ${narrated.status()}`);
      await steer({ music: "none" });
      const listed = await (await api.get(`${base}/api/campaigns/${table}/messages?limit=5`)).json();
      const passage = (listed.messages ?? []).find((message) => message.authorType === "dm");
      check(passage, "the table has a passage to read");
      const voiced = await api.post(`${base}/api/campaigns/${table}/messages/${passage.id}/narrate`);
      check(voiced.ok(), `voicing the passage answered ${voiced.status()}`);
      await t.reload();
      if (t.app) await page.evaluate(watchMedia);
      await page.keyboard.press("Escape");
      const read = page.locator(`${root}button[aria-label="Read this passage aloud"]`).locator("visible=true").first();
      await eventually(() => read.count(), { timeoutMs: 30_000, label: "the Read aloud button" });
      await t.tap(read);
      const reading = await running(/\/generated-audio\//, "the passage being read");
      check(Math.abs(reading.volume - 0.8) < 0.01, `the passage starts at the saved level (${reading.volume})`);
      // As the apps' Settings write them (src/lib/audio-prefs.ts writeAudioPref).
      const setPref = (key, value) =>
        page.evaluate(
          ([name, stored]) => {
            window.localStorage.setItem(name, stored);
            window.dispatchEvent(new Event("odm-tts-prefs"));
          },
          [key, value],
        );
      await setPref("odm_tts_volume", "0.1");
      await eventually(async () => Math.abs((await media())[reading.index].volume - 0.1) < 0.01, { label: "the new level reaching the passage being read" });
      await setPref("odm_tts_muted", "1");
      await eventually(async () => (await media())[reading.index].paused, { label: "read aloud turned off stopping the passage" });
      await sleep(500);
      check((await media())[reading.index].paused, "the passage stays stopped");
    } finally {
      await api.patch(`${base}/api/admin/settings`, { data: { speech: previous } }).catch(() => {});
      await api.post(`${base}/api/campaigns/${table}/ambience`, { data: { music: "none", bed: "none" } }).catch(() => {});
      speech.close();
    }
  },
};
