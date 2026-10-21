// The optional party story (src/lib/dm/party-story.ts): a lobby shows the
// shared backstory, blank until someone writes one. The lead saves one from
// the card, it lands on the table, and a reload shows it back. Saving blank
// clears it, so the seeded lobby ends the run as it began for the next
// viewport.
import { check, eventually } from "../lib.mjs";

const BACKSTORY = "Tavi and Bree were the only two who walked out of the Ashford mill fire.";

export default {
  name: "party-backstory",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const campaignUrl = `${base}/api/campaigns/${ids.lobbyId}`;
    const read = async () => (await (await api.get(campaignUrl)).json()).campaign;
    // Viewports share one seeded world: start from blank either way.
    await api.post(`${campaignUrl}/party/backstory`, { data: { do: "save", text: "" } });

    await t.open(`/campaigns/${ids.lobbyId}`);
    const card = page.locator(`${root}[data-party-story]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the party story card in the lobby" });
    const box = card.locator('textarea[aria-label="Party backstory"]');
    check((await box.inputValue()) === "", "the backstory starts blank");
    check(await card.locator("[data-party-backstory-save]").isDisabled(), "nothing to save until something is written");
    await card.scrollIntoViewIfNeeded();
    await t.shot("blank");

    // Finger-sized on every viewport (AGENTS.md: at least 40px).
    const size = await card.locator("[data-party-backstory-save]").boundingBox();
    check(size && size.height >= 40 && size.width >= 40, `Save backstory is at least 40px (${size?.width}x${size?.height})`);

    // Saving disables the button that had focus: focus goes back to the box,
    // and the confirmation lands in a live region a screen reader hears.
    await box.fill(BACKSTORY);
    await t.tap(card.locator("[data-party-backstory-save]"));
    await eventually(async () => (await read()).party?.backstory === BACKSTORY, { label: "the backstory saved" });
    check(((await read()).party?.backstoryBy ?? "") === ids.lead, "the save names who made it");
    await eventually(
      () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Party backstory"),
      { label: "focus back on the backstory after its save" },
    );
    await eventually(async () => /Saved/.test(await card.locator('[data-party-story-status][role="status"]').innerText()), {
      label: "the save announced in the status region",
    });

    await t.open(`/campaigns/${ids.lobbyId}`);
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the card after a reload" });
    check((await card.locator('textarea[aria-label="Party backstory"]').inputValue()) === BACKSTORY, "the backstory reads back");
    await card.scrollIntoViewIfNeeded();
    await t.shot("saved");

    await card.locator('textarea[aria-label="Party backstory"]').fill("");
    await t.tap(card.locator("[data-party-backstory-save]"));
    await eventually(async () => (await read()).party?.backstory === "", { label: "a blank save clears it" });
  },
};
