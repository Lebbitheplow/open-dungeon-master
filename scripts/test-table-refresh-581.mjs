// The table's screens hear what changed (found auditing issue 581, a quest
// notice glued to the screen): each write below changed what a seat shows
// without the event that seat listens on, so the screen kept the old state
// until a reload.
//   - move_party tells every seat the new scene, for the line in the header;
//   - an offer the server lapses is resolved on every seat, not left with a
//     live Accept that fails;
//   - a place renamed or removed in the World tab reaches every Map tab, and
//     lore written there or in the Lore panel every Lore panel;
//   - a shop that restocks as the party walks in refreshes an open Market.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-table-refresh-581");
const { subscribe } = await import("../src/lib/events.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertItemProposal, listOpenItemProposals } = await import("../src/lib/db/item-proposals.ts");
const { getCurrentLocation } = await import("../src/lib/db/locations.ts");
const { worldEntryChanged } = await import("../src/lib/workshop/record-events.ts");
const { insertShop } = await import("../src/lib/db/shops.ts");
const { setClockInstant } = await import("../src/lib/db/clock.ts");
const { shopsBlock } = await import("../src/lib/dm/shop-tools.ts");

// Every event a campaign publishes from here on, as { type, payload }.
function hear(campaignId) {
  const heard = [];
  const stop = subscribe(campaignId, (chunk) => {
    const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
    const data = /^data: (.+)$/m.exec(chunk)?.[1];
    heard.push({ type, payload: data ? JSON.parse(data) : null });
  });
  return { heard, stop, of: (type) => heard.filter((event) => event.type === type) };
}

await test("move_party tells every seat the new scene", async () => {
  const world = await openWorld();
  world.addHero({ name: "Kael" });
  const events = hear(world.campaignId);
  const moved = await world.invoke("move_party", { name: "Thornhollow", visionClear: false });
  assert.equal(moved.ok, true, moved.error);
  const updates = events.of("campaign_updated").map((event) => event.payload?.scene ?? event.payload?.campaign?.scene);
  events.stop();
  assert.ok(updates.includes("Thornhollow"), `no campaign_updated carried the scene (${JSON.stringify(updates)})`);
});

await test("an offer that lapses unanswered is resolved on every seat", async () => {
  const world = await openWorld();
  const hero = world.addHero({ name: "Kael" });
  const offer = insertItemProposal({
    campaignId: world.campaignId,
    turnId: null,
    characterId: hero.id,
    userId: world.owner.id,
    toolName: "grant_item",
    argsJson: JSON.stringify({ item: "Rope", qty: 1 }),
    summary: "Rope",
    reason: "",
    seq: 1,
  });
  getDatabase().prepare(`UPDATE item_proposals SET created_at = ? WHERE id = ?`).run("2020-01-01T00:00:00.000Z", offer.id);
  const events = hear(world.campaignId);
  assert.equal(listOpenItemProposals(world.campaignId).length, 0);
  const resolved = events.of("item_proposal_resolved");
  events.stop();
  assert.equal(resolved.length, 1, "the lapse reached no seat");
  assert.equal(resolved[0].payload.proposal.id, offer.id);
  assert.equal(resolved[0].payload.proposal.status, "expired");
});

await test("a place edited or removed in the World tab reaches every Map tab, and lore every Lore panel", async () => {
  const world = await openWorld();
  world.addHero({ name: "Kael" });
  await world.invoke("move_party", { name: "Thornhollow", visionClear: false });
  const place = getCurrentLocation(world.campaignId);
  const events = hear(world.campaignId);
  worldEntryChanged(world.campaignId, `location:${place.id}`);
  worldEntryChanged(world.campaignId, `location:${place.id}`, true);
  worldEntryChanged(world.campaignId, "lore:any");
  events.stop();
  assert.equal(events.of("location_updated")[0]?.payload.location.id, place.id);
  assert.equal(events.of("location_removed")[0]?.payload.locationId, place.id);
  assert.equal(events.of("lore_updated").length, 1);
});

await test("lore written in the Lore panel reaches the other seats", async () => {
  const world = await openWorld();
  world.addHero({ name: "Kael" });
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/lore");
  const events = hear(world.campaignId);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ title: "The flood", body: "The river rose.", category: "history", visibility: "party" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  events.stop();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(events.of("lore_updated").length, 1, "the Lore panel at the other seats never heard of it");
});

await test("a shop that restocks as the party walks in refreshes an open Market", async () => {
  const world = await openWorld();
  world.addHero({ name: "Kael" });
  await world.invoke("move_party", { name: "Thornhollow", visionClear: false });
  const place = getCurrentLocation(world.campaignId);
  insertShop(world.campaignId, { name: "Ma Brindle's", kind: "general", size: "village", markup: 1, stock: [], locationId: place.id, locationName: place.name, restockDays: 1, restockedAt: 0 });
  setClockInstant(world.campaignId, 3 * 1440);
  const events = hear(world.campaignId);
  shopsBlock(world.campaign());
  const once = events.of("shops_updated").length;
  shopsBlock(world.campaign());
  events.stop();
  assert.equal(once, 1, "the restock reached no Market");
  assert.equal(events.of("shops_updated").length, 1, "a shop already stocked is not announced again");
});

finish();
