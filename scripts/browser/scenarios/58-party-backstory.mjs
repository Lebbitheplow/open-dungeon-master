// The optional party story (src/lib/dm/party-story.ts): a lobby shows the
// party hook and the shared backstory, both blank until someone writes one.
// The lead saves a backstory and a hook from the card, both land on the
// table, and a reload shows them back. Saving blank clears the backstory, so
// the seeded lobby ends the run as it began for the next viewport.
import { check, eventually } from "../lib.mjs";

const BACKSTORY = "Tavi and Bree were the only two who walked out of the Ashford mill fire.";
const HOOK = "Debtors to the same river guild.";

export default {
  name: "party-backstory",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const campaignUrl = `${base}/api/campaigns/${ids.lobbyId}`;
    const read = async () => (await (await api.get(campaignUrl)).json()).campaign;
    // Viewports share one seeded world: start from blank either way.
    await api.post(`${campaignUrl}/party/backstory`, { data: { do: "save", text: "" } });
    await api.patch(`${campaignUrl}/settings`, { data: { partyHook: "" } });

    await t.open(`/campaigns/${ids.lobbyId}`);
    const card = page.locator(`${root}[data-party-story]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the party story card in the lobby" });
    const box = card.locator('textarea[aria-label="Party backstory"]');
    check((await box.inputValue()) === "", "the backstory starts blank");
    check(await card.locator("[data-party-backstory-save]").isDisabled(), "nothing to save until something is written");
    await card.scrollIntoViewIfNeeded();
    await t.shot("blank");

    await box.fill(BACKSTORY);
    await t.tap(card.locator("[data-party-backstory-save]"));
    await eventually(async () => (await read()).party?.backstory === BACKSTORY, { label: "the backstory saved" });
    check(((await read()).party?.backstoryBy ?? "") === ids.lead, "the save names who made it");

    await t.tap(card.locator("[data-party-hook-edit]"));
    await card.locator('textarea[aria-label="Party hook"]').fill(HOOK);
    await t.tap(card.locator("[data-party-hook-save]"));
    await eventually(async () => (await read()).gameSettings?.partyHook === HOOK, { label: "the hook saved" });

    await t.open(`/campaigns/${ids.lobbyId}`);
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the card after a reload" });
    check((await card.locator('textarea[aria-label="Party backstory"]').inputValue()) === BACKSTORY, "the backstory reads back");
    check((await card.innerText()).includes(HOOK), "the hook reads back");
    await card.scrollIntoViewIfNeeded();
    await t.shot("saved");

    await card.locator('textarea[aria-label="Party backstory"]').fill("");
    await t.tap(card.locator("[data-party-backstory-save]"));
    await eventually(async () => (await read()).party?.backstory === "", { label: "a blank save clears it" });
    await api.patch(`${campaignUrl}/settings`, { data: { partyHook: "" } });
  },
};
