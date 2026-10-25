// Issue 291: a key the player holds to dictate into the table's message
// box. It is chosen in Settings, where keys that would fight something are
// refused with the reason; its name sits on the composer's mic; holding it
// takes the same speech as holding the mic, and letting go leaves the words
// in the box without sending them. Repeats, a modifier let go first, the
// window losing focus, a press in another field or a dialog, and a release
// before the recognizer is listening each leave nothing recording. The
// harness has no speech-to-text, so the device's own recognizer (what the
// Android app installs) is stood in for, which works the same on the
// server's pages and in the app.
import { check, eventually, sleep, untilStill } from "../lib.mjs";

const SAID = "I search the altar for a hidden catch";

async function installRecognizer(page) {
  await page.evaluate((said) => {
    const state = { starts: 0, stops: 0, cancels: 0, live: false, delay: 0 };
    window.__dictation = state;
    window.odmDictation = {
      async start() {
        state.starts += 1;
        if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
        state.live = true;
      },
      async stop() {
        state.stops += 1;
        state.live = false;
        return said;
      },
      async cancel() {
        state.cancels += 1;
        state.live = false;
      },
    };
    window.dispatchEvent(new Event("odm-dictation"));
  }, SAID);
}

const counts = (page) => page.evaluate(() => ({ ...window.__dictation }));

export default {
  name: "dictation-key",
  viewports: ["desktop"],
  async run(t) {
    const { page, root, ids, api, base } = t;

    // ---- choosing the key ----
    await t.open("/settings");
    const field = page.locator(`${root}[data-dictation-shortcut]`).locator("visible=true").first();
    await eventually(() => field.count(), { timeoutMs: 30_000, label: "the Dictation key setting" });
    const setButton = field.locator("[data-dictation-set]");
    // A key left from an earlier run is cleared first.
    if (await field.locator("[data-dictation-clear]").count()) {
      await t.tap(field.locator("[data-dictation-clear]"));
    }
    await t.tap(setButton);
    await eventually(async () => /Press the keys/.test((await field.textContent()) ?? ""), { label: "the field listening" });
    const problem = field.locator("[data-dictation-problem]");
    await page.keyboard.press("Backquote");
    await eventually(async () => /voice chat's push-to-talk/.test((await problem.textContent().catch(() => "")) ?? ""), { label: "the backtick refused" });
    await page.keyboard.press("Control+KeyC");
    await eventually(async () => /browser or system shortcut/.test((await problem.textContent().catch(() => "")) ?? ""), { label: "Ctrl+C refused" });
    await page.keyboard.press("KeyM");
    await eventually(async () => /types in the message box/.test((await problem.textContent().catch(() => "")) ?? ""), { label: "a bare letter refused" });
    await untilStill(page);
    await t.shot("refused");
    await page.keyboard.press("Alt+KeyM");
    const saved = field.locator('[data-dictation-key="Alt+M"]');
    await eventually(() => saved.count(), { label: "Alt+M saved" });
    check(/Saved on this device/.test((await field.textContent()) ?? ""), "the field says where the key is kept");
    await untilStill(page);
    await t.shot("saved");

    // ---- at the table ----
    const before = await (await api.get(`${base}/api/campaigns/${ids.quietId}/messages?limit=60`)).json();
    await t.open(`/campaigns/${ids.quietId}`);
    const box = page.locator(`${root}[data-tour="composer-input"] textarea`).locator("visible=true").first();
    await eventually(() => box.count(), { timeoutMs: 30_000, label: "the message box" });
    await installRecognizer(page);
    const mic = page.locator(`${root}[data-tour="composer-talk"]`).locator("visible=true").first();
    await eventually(() => mic.count(), { timeoutMs: 15_000, label: "the composer's mic" });
    check((await mic.getAttribute("aria-label")) === "Hold to talk, or hold Alt+M", `the mic names the key (${await mic.getAttribute("aria-label")})`);
    check((await mic.getAttribute("aria-keyshortcuts")) === "Alt+M", "the mic declares the key to assistive tech");
    const badge = page.locator(`${root}kbd[data-dictation-key="Alt+M"]`).locator("visible=true").first();
    check((await badge.count()) === 1, "the key's name sits on the mic");

    // Hold in the box, with words already there: the take runs, a repeat
    // starts nothing more, and the release leaves the words in the box.
    await box.click();
    await box.fill("Look closer.");
    await page.keyboard.down("Alt");
    await page.keyboard.down("KeyM");
    await eventually(async () => (await counts(page)).live, { label: "the take listening while the key is held" });
    check((await badge.getAttribute("data-held")) !== null, "the key's name lights while it is held");
    await untilStill(page);
    await t.shot("held");
    await page.keyboard.down("KeyM");
    await page.keyboard.down("KeyM");
    await page.keyboard.up("KeyM");
    await page.keyboard.up("Alt");
    await eventually(async () => (await box.inputValue()) === `Look closer. ${SAID}`, { label: "the words in the box after the draft" });
    let seen = await counts(page);
    check(seen.starts === 1 && seen.stops === 1 && !seen.live, `one take, ended (${JSON.stringify(seen)})`);
    check((await badge.getAttribute("data-held")) === null, "the key's name dims on release");

    // Alt let go first ends the take; the M still held repeats as typing
    // would, and none of it reaches the box.
    await page.keyboard.down("Alt");
    await page.keyboard.down("KeyM");
    await eventually(async () => (await counts(page)).live, { label: "a second take" });
    await page.keyboard.up("Alt");
    await eventually(async () => !(await counts(page)).live, { label: "the take ended with Alt" });
    await page.keyboard.down("KeyM");
    await page.keyboard.up("KeyM");
    await eventually(async () => (await box.inputValue()) === `Look closer. ${SAID} ${SAID}`, { label: "the second take's words, and no stray m" });

    // The window losing focus ends a take at once.
    await page.keyboard.down("Alt");
    await page.keyboard.down("KeyM");
    await eventually(async () => (await counts(page)).live, { label: "a third take" });
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await eventually(async () => !(await counts(page)).live, { label: "the take ended on blur" });
    await page.keyboard.up("KeyM");
    await page.keyboard.up("Alt");
    await eventually(async () => (await box.inputValue()) === `Look closer. ${SAID} ${SAID} ${SAID}`, { label: "the words of the take the blur ended" });

    // Let go before the recognizer is listening: it is cancelled as it
    // starts, and nothing reaches the box.
    await box.fill("");
    await eventually(async () => (await box.inputValue()) === "", { label: `the box cleared for the next check (${await box.inputValue()})` });
    await page.evaluate(() => {
      window.__dictation.delay = 600;
    });
    seen = await counts(page);
    await page.keyboard.down("Alt");
    await page.keyboard.down("KeyM");
    await page.keyboard.up("KeyM");
    await page.keyboard.up("Alt");
    await eventually(async () => (await counts(page)).cancels === seen.cancels + 1, { label: "the early release cancelling the take" });
    const early = await counts(page);
    check(!early.live && early.cancels === seen.cancels + 1 && early.stops === seen.stops, `an early release left nothing listening (${JSON.stringify(early)})`);
    check((await box.inputValue()) === "", `an early release put nothing in the box (${await box.inputValue()})`);
    await page.evaluate(() => {
      window.__dictation.delay = 0;
    });

    // Another field, and a dialog, keep their keys.
    for (const [kind, html] of [
      ["field", '<input data-other-field aria-label="Other field">'],
      ["dialog", '<div role="dialog" aria-modal="true" data-other-field><button>Inside a dialog</button></div>'],
    ]) {
      seen = await counts(page);
      await page.evaluate((markup) => {
        const host = document.createElement("div");
        host.setAttribute("data-other-host", "");
        host.innerHTML = markup;
        document.body.append(host);
        const target = host.querySelector("[data-other-field]");
        const focusable = target.matches("input") ? target : target.querySelector("button");
        focusable.focus();
        window.__otherPrevented = null;
        window.__otherListener = (event) => {
          if (event.code === "KeyM") window.__otherPrevented = event.defaultPrevented;
        };
        document.addEventListener("keydown", window.__otherListener);
      }, html);
      await page.keyboard.down("Alt");
      await page.keyboard.down("KeyM");
      // Time is the check: held this long, the key would have started a take.
      await sleep(300);
      await page.keyboard.up("KeyM");
      await page.keyboard.up("Alt");
      const after = await counts(page);
      check(after.starts === seen.starts, `the key in another ${kind} started no take`);
      check((await page.evaluate(() => window.__otherPrevented)) === false, `the key in another ${kind} was left to it`);
      await page.evaluate(() => {
        document.removeEventListener("keydown", window.__otherListener);
        document.querySelectorAll("[data-other-host]").forEach((node) => node.remove());
      });
    }

    // The mic button still holds a take by pointer, beside the key.
    seen = await counts(page);
    await mic.hover();
    await page.mouse.down();
    await eventually(async () => (await counts(page)).live, { label: "a take held on the mic button" });
    await page.mouse.up();
    await eventually(async () => (await counts(page)).stops === seen.stops + 1, { label: "the button's take ended" });

    // Nothing was sent: the words wait for Send.
    // Time is the check: a post the take made would land within this while.
    await sleep(500);
    const after = await (await api.get(`${base}/api/campaigns/${ids.quietId}/messages?limit=60`)).json();
    const fresh = (after.messages ?? []).filter((message) => !(before.messages ?? []).some((old) => old.id === message.id));
    check(!fresh.some((message) => message.content?.includes(SAID)), "no dictated words were posted");

    // ---- cleared ----
    await t.open("/settings");
    await eventually(() => field.count(), { timeoutMs: 30_000, label: "the setting again" });
    await t.tap(field.locator("[data-dictation-clear]"));
    await eventually(async () => /None set/.test((await field.textContent()) ?? ""), { label: "the key cleared" });
    await t.open(`/campaigns/${ids.quietId}`);
    await eventually(() => box.count(), { timeoutMs: 30_000, label: "the message box again" });
    await installRecognizer(page);
    await eventually(() => mic.count(), { timeoutMs: 15_000, label: "the mic again" });
    check((await mic.getAttribute("aria-label")) === "Hold to talk", "with no key the mic is as it was");
    check((await page.locator(`${root}kbd[data-dictation-key]`).count()) === 0, "and carries no key name");
  },
};
