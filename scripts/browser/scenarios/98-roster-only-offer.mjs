// Audit WA-07 (docs/workshop-complete-audit-2026-10-26.md): a workshop
// holding only a pregen ticked "Offer to players" could not offer it to a
// table. Offers read the table's source workshop off the prep it copied,
// and there was no prep to copy, so the Start from picker said the
// workshop was empty and would not bring it in. The lead makes such a
// workshop and a table, and the table's lobby now shows the workshop's
// Party line, brings it in with nothing to copy, and says the pregen is
// offered there.
import { check, eventually } from "../lib.mjs";

const sheet = (name) => ({
  name,
  race: "human",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "N",
  abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 },
  maxHp: 12,
  ac: 18,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["perception", "survival", "athletics", "intimidation"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Chain Mail", qty: 1 }, { name: "Shield", qty: 1 }],
  gold: 10,
  copper: 0,
  feats: [],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  notes: "",
  backstory: "",
});

export default {
  name: "roster-only-offer",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const hero = `Roster Hero ${stamp}`;
    const made = await api.post(`${base}/api/characters`, { data: { level: 1, role: "pc", sheet: sheet(hero) } });
    check(made.ok(), `a library character (${made.status()}: ${(await made.text()).slice(0, 200)})`);
    const characterId = (await made.json()).character.id;
    const shop = await api.post(`${base}/api/workshops`, { data: { title: `Roster only ${stamp}`, description: "" } });
    check(shop.ok(), "a workshop for the roster");
    const workshopId = (await shop.json()).workshop.id;
    let campaignId = "";
    try {
      const filed = await api.post(`${base}/api/workshops/${workshopId}/pregens`, { data: { characterId } });
      check(filed.ok(), `the character filed on the workshop's roster (${filed.status()})`);
      const offered = await api.patch(`${base}/api/workshops/${workshopId}/pregens`, { data: { characterId, offered: true } });
      check(offered.ok(), `Offer to players ticked (${offered.status()})`);
      const table = await api.post(`${base}/api/campaigns`, { data: { title: `Roster table ${stamp}`, gameSettings: { ttsEnabled: false } } });
      check(table.ok(), `a table to bring it into (${table.status()})`);
      campaignId = (await table.json()).campaign.id;

      await t.open(`/campaigns/${campaignId}`);
      const startFrom = page.getByRole("button", { name: "Start from" }).locator("visible=true").first();
      await eventually(() => startFrom.count(), { timeoutMs: 30_000, label: "the import picker" });
      await startFrom.scrollIntoViewIfNeeded();
      await t.tap(startFrom);
      await t.tap(page.getByRole("menuitemradio", { name: `Roster only ${stamp}` }).locator("visible=true").first());

      const party = page.locator('[data-testid="import-party"]').locator("visible=true").first();
      await eventually(() => party.isVisible(), { timeoutMs: 15_000, label: "the workshop's Party line" });
      const said = (await party.innerText()).replace(/\s+/g, " ");
      check(said.includes(hero) && /1 pregen offered/.test(said), `the Party line names the pregen (${said})`);
      check(!/has no campaign prep to copy/.test(await page.locator("body").innerText()), "the workshop is not called empty");
      await t.shot("party-line");

      const bring = page.getByRole("button", { name: /Bring it in/ }).locator("visible=true").first();
      await eventually(() => bring.isEnabled(), { timeoutMs: 15_000, label: "Bring it in enabled with nothing to copy" });
      await t.tap(bring);
      await eventually(async () => (await page.locator("body").innerText()).includes(`Offered to players here: ${hero}.`), {
        timeoutMs: 20_000,
        label: "the note saying the pregen is offered here",
      });
      check(!/Brought 0/.test(await page.locator("body").innerText()), "no Brought 0 items");
      await t.shot("offered-note");
    } finally {
      if (campaignId) await api.delete(`${base}/api/campaigns/${campaignId}`);
      await api.delete(`${base}/api/workshops/${workshopId}`);
      await api.delete(`${base}/api/characters/${characterId}`);
    }
  },
};
