// A table break: a player pauses the table for a coffee, and every screen
// waits. The lead's page shows the banner with who paused and for how long,
// and a Resume, since the lead may end anyone's break. An in-character move
// is refused while table talk goes through. Narration that lands meanwhile
// is held, and the passage being read when the break began stops; both play
// once the player who paused resumes, in order. Then the lead pauses from
// the header (a phone: the table menu) and resumes from the banner.
//
// The narration is put on the page's own stream: the seeded server has no
// voice, so the scenario wraps EventSource to hand the stream hook a live
// passage, and stubs play() to record what starts instead of sounding it.
import { request } from "playwright-core";
import { check, eventually, sleep } from "../lib.mjs";

// A mono 8-bit WAV of silence, `seconds` long.
function silence(seconds) {
  const rate = 8000;
  const data = rate * seconds;
  const wav = Buffer.alloc(44 + data, 128);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + data, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(data, 40);
  return wav;
}

export default {
  name: "table-break",
  viewports: ["desktop", "phone"],
  app: false,
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const breakUrl = `${base}/api/campaigns/${ids.quietId}/table-break`;
    // Viewports share one seeded world: no break left by an earlier run.
    await api.delete(breakUrl);

    // The passages load a second of silence, so the element holds a real
    // source and nothing reads as a failed passage.
    await page.route("**/narration-*.mp3", (route) => route.fulfill({ contentType: "audio/wav", body: silence(1) }));
    await page.addInitScript(() => {
      window.__odmStreams = [];
      window.__odmPlays = [];
      window.__odmPauses = 0;
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(...args) {
          super(...args);
          window.__odmStreams.push(this);
        }
      };
      HTMLMediaElement.prototype.play = function () {
        window.__odmPlays.push(this.src);
        window.__odmAudio = this;
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        window.__odmPauses += 1;
      };
    });
    const say = (messageId) =>
      page.evaluate((id) => {
        const stream = window.__odmStreams.at(-1);
        stream.dispatchEvent(new MessageEvent("tts_stream", { data: JSON.stringify({ messageId: id, url: `/narration-${id}.mp3` }) }));
      }, messageId);
    const played = () => page.evaluate(() => window.__odmPlays.map((src) => new URL(src).pathname));
    const finishPassage = () => page.evaluate(() => window.__odmAudio?.dispatchEvent(new Event("ended")));

    const playerApi = await request.newContext();
    try {
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      await t.open(`/campaigns/${ids.quietId}`);
      await eventually(() => page.evaluate(() => window.__odmStreams.length > 0), { label: "the table's event stream" });
      // A key press is the gesture that lets narration play.
      await page.keyboard.press("Shift");
      await sleep(300);

      // Narration plays before any break: the stubs are wired.
      await say("before");
      await eventually(async () => (await played()).includes("/narration-before.mp3"), { label: "narration before the break" });
      await finishPassage();
      // A passage is being read when the break begins.
      await say("reading");
      await eventually(async () => (await played()).includes("/narration-reading.mp3"), { label: "the passage being read" });

      // The player pauses the table.
      const stopsBefore = await page.evaluate(() => window.__odmPauses);
      const paused = await playerApi.post(breakUrl);
      check(paused.ok(), `the player's pause answered ${paused.status()}`);
      const banner = page.locator(`${root}.table-break-banner`).locator("visible=true").first();
      await eventually(() => banner.count(), { timeoutMs: 20_000, label: "the break banner on the lead's screen" });
      const text = await banner.innerText();
      check(new RegExp(`Paused by ${ids.player}`, "i").test(text), `the banner names who paused: ${text}`);
      // Under the header, not over it: the seeded table is in a fight, whose
      // initiative ribbon makes the header taller than a fixed offset allowed.
      const header = await page.locator(`${root}.session-header`).locator("visible=true").first().boundingBox();
      await eventually(async () => ((await banner.boundingBox())?.y ?? 0) >= (header?.y ?? 0) + (header?.height ?? 0), {
        label: "the banner below the header's bottom edge",
      });
      check(/Paused for \d+ s/.test(text), `the banner counts the break: ${text}`);
      check((await banner.getByRole("button", { name: "Resume" }).count()) === 1, "the lead is offered Resume");
      await eventually(async () => (await page.evaluate(() => window.__odmPauses)) > stopsBefore, {
        timeoutMs: 5_000,
        label: `the passage being read stopping for the break (stops ${stopsBefore}, played ${(await played()).join(", ")})`,
      });

      // Narration landing during the break waits.
      const before = (await played()).length;
      await say("during");
      await sleep(1_500);
      check((await played()).length === before, `narration started during the break: ${(await played()).join(", ")}`);
      // The clock moves.
      await sleep(1_000);
      check(/Paused for ([2-9]|\d\d) s/.test(await banner.innerText()), "the break clock stands still");
      await t.shot("paused");

      // In character is refused; table talk goes through.
      const move = await api.post(`${base}/api/campaigns/${ids.quietId}/actions`, {
        data: { kind: "do", characterId: ids.ama, content: "I check the altar for traps." },
      });
      check(move.status() === 409, `an in-character move during the break answered ${move.status()}`);
      check(/called a break/.test((await move.json()).error ?? ""), "the refusal says why");
      const talk = await api.post(`${base}/api/campaigns/${ids.quietId}/actions`, {
        data: { kind: "ooc", characterId: ids.ama, content: `back in five (${viewport})` },
      });
      check(talk.status() === 202, `table talk during the break answered ${talk.status()}`);
      await eventually(() => page.getByText(`back in five (${viewport})`).locator("visible=true").count(), {
        label: "the table talk on the lead's screen",
      }).catch(async () => {
        // A phone shows one view at a time: the talk is on the Table view.
        const tableView = page.locator(`${root}.cine-bottombar button`).filter({ hasText: /^\s*Table\s*$/ }).locator("visible=true").first();
        if (await tableView.count()) await t.tap(tableView);
        await eventually(() => page.getByText(`back in five (${viewport})`).locator("visible=true").count(), { label: "the table talk" });
      });

      // The player who paused resumes: the banner goes, and the held
      // narration plays in order, the interrupted passage first.
      const resumed = await playerApi.delete(breakUrl);
      check(resumed.ok(), `the player's resume answered ${resumed.status()}`);
      await eventually(() => banner.count().then((count) => count === 0), { label: "the banner leaving after Resume" });
      await eventually(async () => (await played()).length === before + 1, { label: "the interrupted passage after Resume" });
      check((await played()).at(-1) === "/narration-reading.mp3", `the interrupted passage plays first: ${(await played()).join(", ")}`);
      await finishPassage();
      await eventually(async () => (await played()).at(-1) === "/narration-during.mp3", { label: "the held passage after Resume" });
      await finishPassage();
      await t.shot("resumed");

      // The lead pauses from the header, or the phone's table menu, and
      // ends their own break from the banner.
      if (viewport === "phone") {
        await t.tap(page.locator(`${root}[data-tour="header-menu"]`).locator("visible=true").first());
        await t.tap(page.getByRole("menuitem", { name: /Pause the table/ }));
      } else {
        const pause = page.locator(`${root}[data-tour="header-pause"]`).locator("visible=true").first();
        check((await pause.getAttribute("aria-pressed")) === "false", "the Pause button reads as off before the break");
        await t.tap(pause);
      }
      await eventually(async () => /You paused the table/i.test(await banner.innerText().catch(() => "")), { label: "the lead's own break" });
      await t.shot("lead-paused");
      await t.tap(banner.getByRole("button", { name: "Resume" }));
      await eventually(() => banner.count().then((count) => count === 0), { label: "the lead's break ending" });
      const state = await (await api.get(`${base}/api/campaigns/${ids.quietId}`)).json();
      check(state.tableBreak === null, "a break is left on the table");
    } finally {
      await api.delete(breakUrl).catch(() => {});
      await playerApi.dispose().catch(() => {});
    }
  },
};
