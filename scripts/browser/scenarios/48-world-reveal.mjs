// WF-10: a secret revealed to the party. A player has the table's lore open
// (Story, Facts); the lead of the AI campaign opens the World tab's Secrets,
// presses Reveal to the party on a secret, rewrites what the party reads and
// confirms. The secret moves to the learned list with the record of the
// telling, and the player's lore shows the new entry without a reload. The
// lead of an AI table is offered no handout, which is the DM seat's. The
// quiet table's secrets and lore are put back as they were, since every
// viewport and later scenario shares them.
import { check, eventually, newContext, openPanelTab, settle, signIn, sleep } from "../lib.mjs";

export default {
  name: "world-reveal",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const stamp = Date.now().toString(36);
    const secretTitle = `The ferryman drowned his brother ${stamp}`;
    const toldTitle = `The ferryman's confession ${stamp}`;
    const toldBody = "Drunk at the ford, the ferryman admits he let his brother drown for the toll money.";
    const campaign = `${base}/api/campaigns/${ids.quietId}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    const before = (await (await api.get(`${campaign}/world`)).json()).doc.secrets;
    const secretId = `sec_${stamp}`;
    const seeded = await api.patch(`${campaign}/world`, {
      data: { secrets: [...before, { id: secretId, title: secretTitle, subject: "", notes: "Only if they ply him with drink.", knownBy: [], partyKnows: false }] },
    });
    check(seeded.ok(), `a secret in the quiet table's world (${seeded.status()})`);
    const browser = page.context().browser();
    const playerContext = await newContext(browser, viewport, { app: false });
    let entryId = "";
    try {
      // The player, reading the table's lore.
      await signIn(playerContext, base, ids.player, ids.password);
      const playerPage = await playerContext.newPage();
      await playerPage.goto(`${base}/campaigns/${ids.quietId}`, { waitUntil: "networkidle", timeout: 120_000 });
      await sleep(1_500);
      await settle(playerPage);
      const storyTab = playerPage.locator('[data-tour="tab-story"]').locator("visible=true").first();
      await eventually(() => storyTab.count(), { timeoutMs: 30_000, label: "the player's Story tab" });
      await (t.touch ? storyTab.tap() : storyTab.click());
      const facts = playerPage.locator("[data-pill-group] button", { hasText: /^\s*Facts\s*$/ }).locator("visible=true").first();
      await eventually(() => facts.count(), { label: "the Facts section" });
      await (t.touch ? facts.tap() : facts.click());
      await eventually(() => playerPage.getByText("World lore").locator("visible=true").count(), { timeoutMs: 20_000, label: "the player's lore list" });
      check((await playerPage.getByText(toldTitle).count()) === 0, "the player has not been told yet");

      // The lead reveals it from the World tab.
      await t.open(`/campaigns/${ids.quietId}`);
      await openPanelTab(t, "world");
      const panel = page.locator(`${root}[data-world-at="table"]`).locator("visible=true").first();
      await eventually(() => panel.count(), { timeoutMs: 30_000, label: "the World tab" });
      await t.tap(panel.locator('[data-tour="world-view-secrets"]').first());
      const card = panel.locator("li", { hasText: secretTitle }).first();
      await eventually(() => card.isVisible().catch(() => false), { timeoutMs: 20_000, label: "the secret's card" });
      await card.scrollIntoViewIfNeeded();
      await t.tap(card.locator('[data-testid="secret-reveal"]'));
      const form = card.locator('[data-testid="secret-reveal-form"]');
      await eventually(() => form.isVisible(), { label: "the reveal form" });
      check((await form.locator('input[type="checkbox"]').count()) === 0, "no handout offered to an AI table's lead");
      const titleBox = form.getByLabel("What the party learns, as a title");
      check((await titleBox.inputValue()) === secretTitle, "the form starts from the secret's title");
      check((await form.getByLabel("What the party reads").inputValue()) === "Only if they ply him with drink.", "and its notes, to be rewritten");
      await titleBox.fill(toldTitle);
      await form.getByLabel("What the party reads").fill(toldBody);
      await t.shot("reveal-form");
      await t.tap(form.locator('[data-testid="secret-reveal-confirm"]'));
      await eventually(async () => /can read/.test(await panel.locator('[data-testid="secret-told"]').innerText().catch(() => "")), { label: "the panel saying the party can read it" });
      const learned = panel.locator("li", { hasText: secretTitle }).locator('[data-testid="secret-revealed"]');
      await eventually(() => learned.isVisible().catch(() => false), { label: "the record of the telling" });
      check((await learned.innerText()).includes(toldTitle), "the record names the lore entry");
      await t.shot("revealed");

      // The player's lore, live.
      await eventually(() => playerPage.getByText(toldTitle).locator("visible=true").count(), { timeoutMs: 20_000, label: "the revealed entry in the player's lore without a reload" });
      const lore = await (await playerContext.request.get(`${campaign}/lore`)).json();
      const entry = (lore.entries ?? []).find((row) => row.title === toldTitle);
      check(entry && entry.body === toldBody, "the player reads the words the lead wrote");
      check(!JSON.stringify(lore).includes("ply him with drink"), "and never the secret's notes");
      entryId = entry?.id ?? "";
      const world = await playerContext.request.get(`${campaign}/world`);
      check(world.status() === 403, `the rest of the world stays closed to the player (${world.status()})`);
    } finally {
      if (!entryId) {
        const lore = await (await api.get(`${campaign}/lore`)).json();
        entryId = (lore.entries ?? []).find((row) => row.title === toldTitle)?.id ?? "";
      }
      if (entryId) await api.delete(`${campaign}/lore/${entryId}`);
      await api.patch(`${campaign}/world`, { data: { secrets: before } });
      await playerContext.close().catch(() => {});
    }
  },
};
