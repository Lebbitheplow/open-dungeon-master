// Issue #622: "Revert this turn" takes back the death saves the clock rolled,
// and the time itself. A hero lies dying outside a fight at a person's table
// (the seed's Clock Table, one per viewport). With the event log open, the GM
// passes a minute from the console and the clock rolls the hero's saves: the
// log shows the time the turn moved on, the saves above it, and the turn's
// revert. A later hand correction of the saves makes the revert ask first,
// and its dialog says what comes back (the sheets and the clock) and what
// stays (world events). Confirmed, the hero's track and the clock are as
// before the turn. Then two quiet hours, a turn that changed no sheet, are
// offered back the same way and revert at once.
import { check, eventually, openPanelTab } from "../lib.mjs";

export default {
  name: "revert-clock-turn",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.clockTables[viewport];
    const campaign = `${base}/api/campaigns/${table.id}`;
    const hero = async () => (await (await api.get(campaign)).json()).sheets.find((sheet) => sheet.id === table.hero);
    // The clock as the console's Calendar reads it.
    const clock = async () => {
      const response = await api.get(`${campaign}/dm/clock`);
      check(response.ok(), `the clock answered ${response.status()}`);
      const { clock: now, reads } = await response.json();
      return { instant: now.instant, reads };
    };
    const invoke = async (name, args) => {
      const response = await api.post(`${campaign}/dm/invoke`, { data: { name, args } });
      check(response.ok(), `${name} answered ${response.status()}: ${await response.text()}`);
    };
    const correct = async (patch) => {
      const response = await api.patch(`${campaign}/sheets/${table.hero}`, { data: patch });
      check(response.ok(), `the correction answered ${response.status()}: ${await response.text()}`);
    };
    // The log's rows, by what they read; a row's revert sits in its own row.
    const row = (pattern) => page.locator(`${root}li`).filter({ hasText: pattern }).locator("visible=true").first();
    const reverts = page.locator(`${root}li button`).filter({ hasText: /Revert this turn/ }).locator("visible=true");
    const reverted = () =>
      page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${table.id}/audit/revert-turn`) && response.request().method() === "POST", {
        timeout: 30_000,
      });

    const before = await hero();
    check(before.currentHp === 0 && before.deathSaves && !before.deathSaves.stable && !before.deathSaves.dead, `the hero is not dying: ${JSON.stringify(before.deathSaves)}`);
    const startedAt = await clock();

    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "story");
    const logTab = page.locator(`${root}button.session-subtab`).filter({ hasText: /^\s*Log\s*$/ }).locator("visible=true").first();
    await eventually(() => logTab.count(), { timeoutMs: 30_000, label: "the Story panel's Log" });
    await t.tap(logTab);

    // ---- a minute the hero bleeds through ----
    await invoke("pass_time", { amount: 1, unit: "minutes", reason: "the party argues over the map" });
    const bled = await hero();
    check(JSON.stringify(bled.deathSaves) !== JSON.stringify(before.deathSaves) || bled.currentHp !== 0, "the minute rolled no death save");
    check((await clock()).instant === startedAt.instant + 1, "the clock did not move a minute");

    // Told live: the minute, the saves above it, the turn's revert on top.
    const minute = row(/Time passes: 1 minute/);
    await eventually(() => minute.count(), { timeoutMs: 30_000, label: "the minute in the event log" });
    await eventually(() => reverts.count(), { label: "the turn's revert" });
    const order = await minute.evaluate((item) => [...item.parentElement.children].map((child) => child.innerText));
    const top = order.findIndex((text) => /Revert this turn/.test(text));
    const at = order.findIndex((text) => /Time passes: 1 minute/.test(text));
    check(top >= 0 && top < at, `the turn's revert is not above its minute: ${order.join(" | ")}`);
    const saves = order.slice(top, at);
    check(saves.length >= 1 && saves.every((text) => text.includes(table.heroName)), `the rows under the turn are not the hero's saves: ${saves.join(" | ")}`);
    await t.shot("turn");

    // The table recounts the saves by hand: the revert now asks first.
    await correct({ currentHp: 0, deathSaves: { successes: 1, failures: 1, stable: false, dead: false }, reason: "The table recounts the saves" });
    const asked = reverted();
    // A failed press is reported as itself, not as the wait it strands.
    asked.catch(() => {});
    await t.tap(reverts.first());
    check((await asked).status() === 409, "the revert did not ask before overwriting the hand correction");
    // The dialog is portalled out of the app's root.
    const dialog = page.getByRole("alertdialog").locator("visible=true").first();
    await eventually(() => dialog.count(), { label: "the revert's confirmation" });
    const words = await dialog.innerText();
    check(/Revert this turn anyway\?/.test(words), `the dialog is not the turn's: ${words}`);
    check(/character sheets and the clock back/.test(words), `the dialog does not say the sheets and the clock come back: ${words}`);
    check(/World events and companions who left stay/.test(words), `the dialog does not say what stays: ${words}`);
    check(/also touched: .*deathSaves/.test(words), `the dialog does not name the newer change: ${words}`);
    await t.shot("confirm");
    const confirmed = reverted();
    confirmed.catch(() => {});
    await t.tap(dialog.getByRole("button", { name: /Undo anyway/ }));
    const answer = await confirmed;
    check(answer.ok(), `the confirmed revert answered ${answer.status()}`);
    check((await answer.json()).clock === "restored", "the revert left the clock where the turn moved it");

    await eventually(async () => JSON.stringify((await hero()).deathSaves) === JSON.stringify(before.deathSaves), { label: "the hero's death saves as before the turn" });
    check((await hero()).currentHp === 0, "the hero is not back at 0 hit points");
    const back = await clock();
    check(back.instant === startedAt.instant && back.reads === startedAt.reads, `the clock reads ${back.reads}, not ${startedAt.reads}`);
    await eventually(async () => (await minute.count()) === 0, { label: "the minute leaving the log once it is back" });
    await eventually(async () => (await reverts.count()) === 0, { label: "the reverted turn's button leaving" });
    await t.shot("reverted");

    // ---- two quiet hours: a turn that only moved the clock ----
    await correct({ currentHp: before.maxHp, deathSaves: null, reason: "Patched up by the fire" });
    const quietAt = await clock();
    await invoke("pass_time", { amount: 2, unit: "hours", reason: "a quiet watch" });
    check((await clock()).instant === quietAt.instant + 120, "the clock did not move two hours");
    const hours = row(/Time passes: 2 hours/);
    await eventually(() => hours.count(), { timeoutMs: 30_000, label: "the two hours in the event log" });
    // No sheet changed, so the revert counts none.
    const quiet = page.locator(`${root}li button`).filter({ hasText: /^\s*Revert this turn\s*$/ }).locator("visible=true").first();
    await eventually(() => quiet.count(), { label: "the quiet turn's revert" });
    await t.shot("clock-only");
    const done = reverted();
    done.catch(() => {});
    await t.tap(quiet);
    const quietAnswer = await done;
    check(quietAnswer.status() === 200, `the quiet turn's revert answered ${quietAnswer.status()}`);
    const quietBody = await quietAnswer.json();
    check(quietBody.reverted === 0 && quietBody.clock === "restored", `the quiet turn's revert said ${JSON.stringify(quietBody)}`);
    check((await page.getByRole("alertdialog").locator("visible=true").count()) === 0, "a revert with nothing to overwrite asked anyway");
    check((await clock()).instant === quietAt.instant, "the two hours stayed spent");
    check((await hero()).currentHp === before.maxHp, "putting the time back touched the hero's sheet");
    await eventually(async () => (await hours.count()) === 0, { label: "the two hours leaving the log" });
    await t.shot("clock-only-reverted");
  },
};
