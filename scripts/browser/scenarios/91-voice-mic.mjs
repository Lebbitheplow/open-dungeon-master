// Audit 2026-10-26 (F01-F06, F09, F10): the microphone's own gate. On a
// mesh call nothing but this browser's track decides whether the table
// hears a player, and it came up open behind the controls: a saved
// push-to-talk joined transmitting, a microphone picked while muted went
// live under "Unmute", a failed unmute left the track open under the same
// label, and a join still waiting on the permission prompt when the player
// left the page kept the microphone afterwards. A mesh call never started
// its transcript, turning transcription off did not stop the recorder, a
// player alone on the call could not change microphones, and the panel
// offered side rooms that only the SFU has.
//
// The Voice Table (seed.mjs) is a lobby with voice and transcription on and
// the player seated; the server is switched to mesh for the run. The
// microphone is an oscillator, and every track the call would send (the
// microphone stage's output, audio-devices.ts withMicGain) is kept so a
// check reads what would leave this browser. The player holds a seat
// through the API, so the lead's join builds a real peer connection to them.
import { check, eventually, signIn, sleep } from "../lib.mjs";

function rigMedia() {
  if (window.__voiceRig) return;
  const rig = { sent: [], raw: [], recorders: [], pcs: [], asked: 0, hold: null };
  window.__voiceRig = rig;
  const Context = window.AudioContext;
  const destination = Context.prototype.createMediaStreamDestination;
  Context.prototype.createMediaStreamDestination = function () {
    const node = destination.call(this);
    rig.sent.push(node.stream.getAudioTracks()[0]);
    return node;
  };
  const source = new Context();
  navigator.mediaDevices.getUserMedia = async () => {
    rig.asked += 1;
    if (rig.hold) await rig.hold.promise;
    const node = destination.call(source);
    const tone = source.createOscillator();
    tone.connect(node);
    tone.start();
    rig.raw.push(node.stream.getAudioTracks()[0]);
    return node.stream;
  };
  navigator.mediaDevices.enumerateDevices = async () => [
    { kind: "audioinput", deviceId: "first-mic", label: "First microphone", groupId: "a" },
    { kind: "audioinput", deviceId: "second-mic", label: "Second microphone", groupId: "b" },
  ];
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) {
      super(...args);
      rig.pcs.push(this);
    }
  };
  const Recorder = window.MediaRecorder;
  window.MediaRecorder = class extends Recorder {
    constructor(...args) {
      super(...args);
      rig.recorders.push(this);
    }
  };
}

// What this browser is sending, read from the rig.
function micState() {
  const rig = window.__voiceRig;
  if (!rig) return null;
  const newest = rig.sent.at(-1) ?? null;
  const pc = rig.pcs.filter((entry) => entry.signalingState !== "closed").at(-1);
  const sender = pc?.getSenders().find((entry) => entry.track) ?? null;
  return {
    captures: rig.sent.length,
    asked: rig.asked,
    live: rig.sent.filter((track) => track.readyState === "live").length,
    rawLive: rig.raw.filter((track) => track.readyState === "live").length,
    open: newest ? newest.enabled : null,
    peer: Boolean(pc),
    senderIsNewest: sender ? sender.track === newest : null,
    senderOpen: sender ? sender.track.enabled : null,
    recording: rig.recorders.filter((recorder) => recorder.state === "recording").map((recorder) => recorder.stream.getAudioTracks()[0] === newest),
  };
}

export default {
  name: "voice-mic",
  viewports: ["desktop"],
  async run(t) {
    const { page, api, base, ids, root } = t;
    const voice = (route) => `${base}/api/campaigns/${ids.voiceTableId}/voice${route}`;
    const before = await (await api.get(`${base}/api/admin/settings`)).json();
    const previous = {
      voiceChat: { enabled: before.voiceChat?.enabled ?? "", mode: before.voiceChat?.mode ?? "" },
      speech: { sttUrl: before.speech?.sttUrl ?? "", sttModel: before.speech?.sttModel ?? "" },
    };
    const player = await page.context().browser().newContext();
    let heartbeat = null;
    const joins = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/voice\/mesh\/join$/.test(request.url())) joins.push(Date.now());
    });
    try {
      // Transcription waits on a configured Whisper; its rings are answered
      // here and never reach one.
      const switched = await api.patch(`${base}/api/admin/settings`, {
        data: { voiceChat: { enabled: "on", mode: "mesh" }, speech: { sttUrl: "http://127.0.0.1:9", sttModel: "whisper-stand-in" } },
      });
      check(switched.ok(), `switching the server to mesh voice answered ${switched.status()}`);
      await page.route("**/voice/transcript", (route) =>
        route.request().method() === "POST" ? route.fulfill({ json: { ok: true, lines: [] } }) : route.fallback(),
      );
      await signIn(player, base, ids.player, ids.password);
      // The app's shell read the server's capabilities on entering and keeps
      // them for half a minute (src/lib/use-capabilities.ts), so the switch
      // above reaches its screens after that.
      if (t.app) await sleep(31_000);

      await t.open(`/campaigns/${ids.voiceTableId}`);
      await page.evaluate(rigMedia);
      const panel = page.locator(`${root}[data-voice-panel]`).first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the voice panel" });
      const state = () => page.evaluate(micState);
      const named = (name) => panel.getByRole("button", { name, exact: true });
      const until = (fn, label) => eventually(async () => fn(await state()), { label });
      const join = async () => {
        await t.tap(named("Join"));
        await eventually(() => named("Leave voice").count(), { label: "on the call" });
      };
      const leave = async () => {
        await t.tap(named("Leave voice"));
        await eventually(() => named("Join").count(), { label: "off the call" });
      };
      const settings = async () => {
        if ((await named("Microphone settings").getAttribute("aria-expanded")) !== "true") {
          await t.tap(named("Microphone settings"));
        }
      };
      const choose = async (control, option) => {
        await settings();
        await t.tap(named(control));
        await t.tap(page.getByRole("menuitemradio", { name: option }).locator("visible=true").first());
      };

      // ---- alone on the call ----
      await join();
      check((await panel.getAttribute("data-voice-panel")) === "mesh", "the call runs on mesh");
      await eventually(() => panel.getByText("1 on the call").count(), { label: "the panel listing the lead on the call" });
      await until((s) => s.open === true && s.live === 1, "an open microphone, one capture");
      // F05: the mesh call records for its transcript, and says so.
      await until((s) => s.recording.length === 1 && s.recording[0], "a mesh call recording its own microphone");
      check(await panel.getByText("This table is being transcribed").count(), "the panel says the table is transcribed");
      // F09: mesh has no side rooms, so the story lead is not offered one.
      check(!(await panel.getByRole("heading", { name: "Rooms" }).count()), "a mesh call offers no side rooms");
      // F10: alone, the microphone still changes, and the recorder follows.
      await choose("Microphone", "Second microphone");
      await until((s) => s.captures === 2 && s.live === 1 && s.open === true, "the second microphone replacing the first");
      await until((s) => s.recording.length === 1 && s.recording[0], "the recorder on the new microphone");
      // F06: transcription turned off mid-call stops the recorder; back on starts it.
      const off = await api.patch(`${base}/api/campaigns/${ids.voiceTableId}/settings`, { data: { voice: { transcribe: false } } });
      check(off.ok(), `turning transcription off answered ${off.status()}`);
      await until((s) => s.recording.length === 0, "the recorder stopped once transcription is off");
      const on = await api.patch(`${base}/api/campaigns/${ids.voiceTableId}/settings`, { data: { voice: { transcribe: true } } });
      check(on.ok(), `turning transcription on answered ${on.status()}`);
      await until((s) => s.recording.length === 1 && s.recording[0], "the recorder back once transcription is on");
      await leave();
      await until((s) => s.live === 0 && s.rawLive === 0, "every capture stopped after leaving");

      // ---- with the player seated ----
      const seat = await player.request.post(voice("/mesh/join"), { data: {} });
      check(seat.ok(), `the player's seat answered ${seat.status()}`);
      heartbeat = setInterval(() => void player.request.post(voice("/mesh/heartbeat"), { data: {} }).catch(() => {}), 5_000);

      // F01: push-to-talk chosen on the call, then a rejoin: closed until held.
      await join();
      await choose("Microphone mode", "Push to talk");
      await until((s) => s.open === false, "push-to-talk closing the microphone");
      await leave();
      await join();
      await until((s) => s.open === false && s.peer, "a rejoin with saved push-to-talk, closed");
      let s = await state();
      check(s.senderIsNewest && s.senderOpen === false, `the player's connection carries the closed track (${JSON.stringify(s)})`);
      await eventually(
        async () => {
          const { peers } = await (await player.request.get(voice(""))).json();
          return peers?.find((peer) => peer.username === ids.lead)?.muted === true;
        },
        { label: "the roster showing the push-to-talk seat muted" },
      );
      const hold = panel.getByRole("button", { name: /^(Hold|Talking)$/ });
      await hold.hover();
      await page.mouse.down();
      await until((s) => s.open === true, "the microphone open while Hold is held");
      await page.mouse.up();
      await until((s) => s.open === false, "the microphone closed once Hold is let go");

      // F02: a microphone picked while muted stays muted.
      await choose("Microphone mode", "Open mic");
      await until((s) => s.open === true, "open mic again");
      await t.tap(named("Mute"));
      await until((s) => s.open === false, "muted");
      const captures = (await state()).captures;
      await choose("Microphone", "First microphone");
      await until((s) => s.captures === captures + 1 && s.live === 1, "the first microphone replacing the second");
      s = await state();
      check(s.open === false && s.senderIsNewest && s.senderOpen === false, `the new microphone is still muted (${JSON.stringify(s)})`);
      check(await named("Unmute").count(), "the button still offers Unmute");
      await t.tap(named("Unmute"));
      await until((s) => s.open === true && s.senderOpen === true, "unmuted");

      // F03: when the call cannot be told, the microphone stays closed.
      await page.route("**/voice/mesh/state", (route) => route.abort("failed"));
      await t.tap(named("Mute"));
      await until((s) => s.open === false, "muted with the request failing");
      await eventually(() => panel.getByText("Your microphone is off").count(), { label: "the failed mute said" });
      check(await named("Unmute").count(), "the button says muted");
      await t.tap(named("Unmute"));
      await eventually(() => panel.getByText("Could not unmute").count(), { label: "the failed unmute said" });
      s = await state();
      check(s.open === false && (await named("Unmute").count()), `a failed unmute leaves the microphone closed and says so (${JSON.stringify(s)})`);
      await page.unroute("**/voice/mesh/state");
      await t.tap(named("Unmute"));
      await until((s) => s.open === true, "unmuted once the call answers");

      // F04: leaving the page while the permission prompt is up.
      await choose("Microphone mode", "Open mic");
      await leave();
      await page.evaluate(() => {
        let release;
        const promise = new Promise((resolve) => (release = resolve));
        window.__voiceRig.hold = { promise, release };
      });
      const asked = (await state()).asked;
      await t.tap(named("Join"));
      await until((s) => s.asked === asked + 1, "the microphone asked for");
      const joinsBefore = joins.length;
      // Away inside the same document: the lobby's own link on the server's
      // pages, the shell's navigation in the app.
      if (t.app) {
        await page.evaluate(() => window.odmShell.navigation.push("/"));
      } else {
        await t.tap(page.locator(`${root}a`).filter({ hasText: "All campaigns" }).first());
      }
      await eventually(async () => !(await panel.count()), { timeoutMs: 30_000, label: "the lobby left" });
      check(await page.evaluate(() => Boolean(window.__voiceRig)), "the page stayed the same document");
      // The panel leaves the page a frame before the call's own cleanup runs
      // (an effect's, after paint); a prompt answered in between still
      // joined. Answered once the page has had a moment to itself, as
      // hydrated() waits: by then that cleanup has run.
      await page.evaluate(() => new Promise((resolve) => requestIdleCallback(() => resolve(), { timeout: 2_000 })));
      await page.evaluate(() => window.__voiceRig.hold.release());
      await sleep(1_500);
      s = await state();
      check(s.live === 0 && s.rawLive === 0, `a capture granted after leaving is stopped (${JSON.stringify(s)})`);
      check(joins.length === joinsBefore, "nothing joined the call after the page was left");
      const { peers } = await (await player.request.get(voice(""))).json();
      check(!peers?.some((peer) => peer.username === ids.lead), "the lead holds no seat");
      await t.shot("left");
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await player.request.post(voice("/mesh/leave"), { data: {} }).catch(() => {});
      await api.post(voice("/mesh/leave"), { data: {} }).catch(() => {});
      await api.patch(`${base}/api/campaigns/${ids.voiceTableId}/settings`, { data: { voice: { transcribe: true } } }).catch(() => {});
      await api.patch(`${base}/api/admin/settings`, { data: previous }).catch(() => {});
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await player.close().catch(() => {});
    }
  },
};
