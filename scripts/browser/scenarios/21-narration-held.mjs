// Issue 275: on a server whose speech is switched off (setup's text only,
// Admin > Speech), the lobby showed "Narration on" with a voice picked,
// over a note that the server had no narration. The row now reads Off and
// holds its switch while the server's speech is off, and the voice picker
// stays away; with speech back (the harness's own server names Kokoro), the
// table's switch is its own again. The server's answer is stood in for
// here, so the same table is seen both ways.
import { check, eventually, openSettingsGroup } from "../lib.mjs";

export default {
  name: "narration-held",
  viewports: ["desktop"],
  // The stand-in is a browser-level route, which the app's patched fetch
  // bypasses.
  app: false,
  async run(t) {
    const { page, base, ids, api } = t;
    const settings = `${base}/api/campaigns/${ids.lobbyId}/settings`;
    const previous = await (await api.get(`${base}/api/campaigns/${ids.lobbyId}`)).json();
    const wasOn = Boolean(previous.campaign?.gameSettings?.ttsEnabled);
    check((await api.patch(settings, { data: { ttsEnabled: true } })).ok(), "the lobby's narration switch is set on for the check");
    try {
      await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.tts = { configured: false, reachable: false, provider: "off", place: "" };
        await route.fulfill({ response, json: body });
      });
      await t.open(`/campaigns/${ids.lobbyId}`);
      // The row lives in the table settings' Narration group.
      await openSettingsGroup(t, "narration");
      const row = page.locator(`[role="switch"][aria-label="Narration"]`);
      await eventually(() => row.count(), { timeoutMs: 30_000, label: "the lobby's Narration switch" });
      await eventually(async () => /Off on this server/.test(await page.locator("body").innerText()), { label: "the row saying the server holds it" });
      check(await row.isDisabled(), "with the server's speech off, the switch is held");
      check((await row.getAttribute("aria-checked")) === "false", "and reads off, whatever the table's own switch says");
      const words = await page.locator("body").innerText();
      check(/Off on this server/.test(words), "the row says the server is why");
      check(/Narration is switched off on this server/.test(words), "the note under the row explains where it is switched on");
      check((await page.locator(`[aria-label="Narration voice"]`).count()) === 0, "no voice is offered for narration that cannot happen");
      await row.scrollIntoViewIfNeeded();
      await t.shot("held");

      // The server's own answer (speech named, not answering): the table's
      // switch is its own, on, and the voice picker is back.
      await page.unroute(/\/api\/capabilities(\?|$)/);
      await t.open(`/campaigns/${ids.lobbyId}`);
      await openSettingsGroup(t, "narration");
      await eventually(() => row.count(), { timeoutMs: 30_000, label: "the lobby's Narration switch, speech named" });
      await eventually(async () => !(await row.isDisabled()), { label: "the switch the table's own" });
      check(!(await row.isDisabled()), "with speech named on the server, the switch is the table's own");
      check((await row.getAttribute("aria-checked")) === "true", "and reads on, as the table set it");
      await eventually(() => page.locator(`[aria-label="Narration voice"]`).count(), { timeoutMs: 15_000, label: "the voice picker" });
      await row.scrollIntoViewIfNeeded();
      await t.shot("own");
    } finally {
      await api.patch(settings, { data: { ttsEnabled: wasOn } });
    }
  },
};
