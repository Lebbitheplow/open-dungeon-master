// PR 270: a player agent is seated from the app's own screens. A connection
// that may play one campaign offers a receiver file filled in for the
// player's character there; the address check says whether this server
// sends to it, and an admin's "Allow it" link lands on Admin > Player
// agents (by a ?section= query, which the apps' router carries where it
// drops a #hash), where the address is allowed live. The rig puts the
// receiver list back and revokes the connection on the way out.
import { check, eventually, sleep } from "../lib.mjs";

const ADDRESS = "https://my-pc.example.ts.net:8443";

export default {
  name: "player-receiver",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids } = t;
    const cleared = await api.put(`${base}/api/admin/player-webhooks`, { data: { origins: [] } });
    check(cleared.ok(), `clearing the receiver addresses answered ${cleared.status()}`);
    const agentName = `Receiver ${t.viewport}${t.app ? " app" : ""}`;
    try {
      // Settings > Connected agents: Read and Play for the fight's campaign.
      await t.open("/settings");
      const connect = page.locator(`${root}button`).filter({ hasText: /Connect an agent/ }).locator("visible=true").first();
      await eventually(() => connect.count(), { timeoutMs: 30_000, label: "Connect an agent" });
      await connect.scrollIntoViewIfNeeded();
      await t.tap(connect);
      await page.locator(`${root}input[placeholder="Claude Code on my laptop"]`).locator("visible=true").first().fill(agentName);
      await t.tap(page.locator(`${root}button[aria-label="Limit to one campaign"]`).locator("visible=true").first());
      const option = page
        .getByRole("option", { name: ids.title })
        .or(page.getByRole("menuitemradio", { name: ids.title }))
        .locator("visible=true")
        .first();
      await eventually(() => option.count(), { label: "the campaign in the limit menu" });
      await t.tap(option);
      await t.tap(page.locator(`${root}button`).filter({ hasText: /^\s*Connect\s*$/ }).locator("visible=true").first());

      // The receiver panel, filled in for the character the lead plays there.
      const panel = page.locator(`${root}div.rounded-xl.border`).filter({ hasText: /agent on its turn \(Codex\)/ }).last();
      await eventually(() => panel.count(), { timeoutMs: 20_000, label: "the receiver panel under the token" });
      check(/has not allowed any receiver address yet/.test(await panel.innerText()), "with nothing allowed, the panel says so");
      const address = panel.locator('input[placeholder="https://my-pc.example.ts.net:8443"]');
      await address.fill(ADDRESS);
      await address.blur();
      await eventually(async () => /does not send to https:\/\/my-pc\.example\.ts\.net:8443 yet/.test(await panel.innerText()), {
        label: "the check saying this server does not send there",
      });
      check(/tailscale funnel --bg --https=8443 http:\/\/127\.0\.0\.1:8787/.test(await panel.textContent()), "the Funnel line for a Tailscale address");
      check(/--setup PATH\/receiver-tavi_lockwhisper-/.test(await panel.textContent()), "the setup line names the character's file");
      await t.shot("receiver");

      // The admin's link opens Admin > Player agents in view.
      const allow = panel.locator("a").filter({ hasText: /Allow it under Admin/ });
      await t.tap(allow);
      const section = page.locator(`${root}#admin-player-agents`);
      await eventually(() => section.count(), { timeoutMs: 30_000, label: "Admin > Player agents" });
      await eventually(
        async () => {
          const box = await section.boundingBox();
          const height = page.viewportSize()?.height ?? 0;
          return box !== null && box.y >= -4 && box.y < height * 0.6;
        },
        { label: "the section brought into view" },
      );
      await t.shot("admin-section");

      // Allowed there: a pasted path is dropped, plain http refused, live at once.
      const field = section.locator('input[placeholder="https://my-pc.example.ts.net:8443"]');
      await field.fill("http://my-pc.example.ts.net:8443");
      await t.tap(section.locator("button").filter({ hasText: /Allow/ }).first());
      await eventually(async () => /Give the receiver's HTTPS address/.test(await section.innerText()), { label: "plain http refused" });
      await field.fill(`${ADDRESS}/odm-player`);
      await t.tap(section.locator("button").filter({ hasText: /Allow/ }).first());
      await eventually(async () => (await section.locator("code").allTextContents()).includes(ADDRESS), { label: "the origin listed" });
      const saved = await (await api.get(`${base}/api/admin/player-webhooks`)).json();
      check(JSON.stringify(saved.origins) === JSON.stringify([ADDRESS]), `saved as its origin: ${JSON.stringify(saved.origins)}`);
      const asked = await (await api.post(`${base}/api/profile/agents/receiver-check`, { data: { url: ADDRESS } })).json();
      check(asked.allowed === true && asked.url === `${ADDRESS}/odm-player`, "the receiver check now says yes, at the receiver's path");
      await t.tap(section.locator("button").filter({ hasText: /Remove/ }).first());
      await eventually(async () => /No receiver addresses yet, so no player agent is sent a webhook/.test(await section.innerText()), { label: "removed again" });
    } finally {
      await api.put(`${base}/api/admin/player-webhooks`, { data: { origins: [] } }).catch(() => undefined);
      const listed = await (await api.get(`${base}/api/profile/agents`)).json().catch(() => ({}));
      for (const grant of listed.grants ?? []) {
        if (grant.name === agentName) await api.delete(`${base}/api/profile/agents/${grant.id}`).catch(() => undefined);
      }
      await sleep(100);
    }
  },
};
