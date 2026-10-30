// Between sessions (issue 586). The lead of a weekly table ends tonight's
// session from the header (a phone: the table menu), through a confirm that
// says nothing is lost and points at End the campaign for good. Every seat
// then waits under a banner that says which session ended and when the
// next is; an in-character move is refused while table talk goes through;
// the schedule (RSVP for everyone) opens from the banner; the home says
// "between sessions" and the date. Start session 2 picks play up where it
// stopped, and the chronicle reads in sessions.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "session-hold",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.weekly[viewport];
    const sessionUrl = `${base}/api/campaigns/${table.id}/session`;
    const playerApi = await request.newContext();
    try {
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      await t.open(`/campaigns/${table.id}`);

      // End the session: the header from sm up, the table menu on a phone.
      if (viewport === "phone") {
        await t.tap(page.locator(`${root}[data-tour="header-menu"]`).locator("visible=true").first());
        await t.tap(page.getByRole("menuitem", { name: /End the session/ }));
      } else {
        const end = page.locator(`${root}[data-session-control="end"]`).locator("visible=true").first();
        await eventually(() => end.count(), { timeoutMs: 30_000, label: "End the session in the header" });
        await t.tap(end);
      }
      const confirm = page.getByRole("dialog").filter({ hasText: /Nothing is lost/ }).locator("visible=true").first();
      await eventually(() => confirm.count(), { label: "the confirm before ending the session" });
      check(/End the campaign/.test(await confirm.textContent()), "the confirm points at End the campaign for good");
      await t.shot("confirm");
      await t.tap(confirm.getByRole("button", { name: "End the session" }));

      const banner = page.locator(`${root}.session-hold-banner`).locator("visible=true").first();
      await eventually(() => banner.count(), { timeoutMs: 20_000, label: "the between-sessions banner" });
      check(/Session 1 is over/.test(await banner.textContent()), `the banner names the session: ${await banner.textContent()}`);
      await eventually(async () => /No next session is set yet/.test(await banner.textContent()), { label: "the banner's next-session line" });
      check((await banner.locator("[data-session-start]").count()) === 1, "the lead is offered Start session 2");
      const state = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      check(state.sessionHold?.number === 1 && state.campaign.status === "active", "the campaign stays in play between sessions");

      // A player alone cannot carry the story on; table talk goes through.
      const move = await playerApi.post(`${base}/api/campaigns/${table.id}/actions`, {
        data: { kind: "do", characterId: table.rider, content: "I ride on alone to the bridge." },
      });
      check(move.status() === 409, `an in-character move between sessions answered ${move.status()}`);
      check(/Session 1 is over/.test((await move.json()).error ?? ""), "the refusal says why");
      const talk = await playerApi.post(`${base}/api/campaigns/${table.id}/actions`, {
        data: { kind: "ooc", characterId: table.rider, content: `same time next week? (${viewport})` },
      });
      check(talk.status() === 202, `table talk between sessions answered ${talk.status()}`);

      // The lead books Friday; the banner and the schedule both say so.
      const friday = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const booked = await api.post(`${base}/api/campaigns/${table.id}/schedule`, { data: { title: "Friday", startsAt: friday, durationMin: 180, note: "" } });
      check(booked.ok(), `booking the next session answered ${booked.status()}`);
      await eventually(async () => /Next session: .+ · 0 coming/.test(await banner.textContent()), { timeoutMs: 20_000, label: "the banner showing the next session" });
      // Settled first: a fresh shot catches the theme and the reveals mid-fade.
      await untilStill(page);
      await t.shot("between");
      // Readable and named in both themes.
      const night = await axeViolations(page, `${root}.session-hold-banner`);
      check(!night.length, `the banner passes axe at night (${night.map((violation) => violation.id).join(", ")})`);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      // Settled first: a fresh shot catches the theme and the reveals mid-fade.
      await untilStill(page);
      await t.shot("between-day");
      const day = await axeViolations(page, `${root}.session-hold-banner`);
      check(!day.length, `the banner passes axe in the day theme (${day.map((violation) => violation.id).join(", ")})`);
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await t.tap(banner.locator("[data-session-schedule]"));
      const schedule = page.getByRole("dialog").filter({ hasText: /Friday/ }).locator("visible=true").first();
      await eventually(() => schedule.count(), { label: "the schedule opened from the banner" });
      await t.shot("schedule");
      await page.keyboard.press("Escape");
      await eventually(() => schedule.count().then((count) => count === 0), { label: "the schedule closing" });

      // The home says where the table stands.
      // The app's home is its own shell, outside the game's root: read the page.
      await t.open("/");
      await eventually(
        async () => {
          const text = (await page.locator("body").textContent()) ?? "";
          return text.includes(table.title) && /between sessions/i.test(text);
        },
        { timeoutMs: 30_000, label: "the weekly table's between-sessions badge on the home" },
      );
      // Settled first: a fresh shot catches the theme and the reveals mid-fade.
      await untilStill(page);
      await t.shot("home");

      // Start session 2: the banner goes, the header offers End again.
      await t.open(`/campaigns/${table.id}`);
      await eventually(() => banner.count(), { timeoutMs: 30_000, label: "the banner after a reload" });
      await t.tap(banner.locator("[data-session-start]"));
      await eventually(() => banner.count().then((count) => count === 0), { timeoutMs: 20_000, label: "the banner leaving on Start" });
      const after = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      check(after.sessionHold === null, "the table is in play again");
      check(after.messages.some((message) => message.content === "Session 1 ends.") && after.messages.some((message) => message.content === "Session 2 begins."), "the chronicle reads in sessions");
      if (viewport !== "phone") {
        await eventually(() => page.locator(`${root}[data-session-control="end"]`).locator("visible=true").count(), { label: "End the session offered again" });
      }
      await t.shot("resumed");
    } finally {
      await api.post(sessionUrl, { data: { action: "start" } }).catch(() => {});
      await playerApi.dispose().catch(() => {});
    }
  },
};
