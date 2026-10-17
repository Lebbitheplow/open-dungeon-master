// "Reveal to the party" (audit WF-10, plan M3): a secret of a campaign's
// world told to the table on purpose. The words the story authority writes
// become a lore entry every player reads; the secret is marked learned with
// the record of when and where. A world brought in from a workshop is a copy,
// so the workshop's own secret, and its lore, are left exactly as they were.
// A player reads the revealed entry and still nothing else of the world.
import assert from "node:assert/strict";
import { call, seats } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-reveal");

const world = await openWorld({ gameSettings: { dmMode: "human" } });
const seat = await seats(world);
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");
const { getWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { listLoreEntries } = await import("../src/lib/db/lore.ts");
const { latestEventOfType } = await import("../src/lib/events.ts");
const { readDoc, remapDoc } = await import("../src/lib/worldforge/model.ts");

const worldRoute = await world.route("campaigns/[campaignId]/world");
const entitiesRoute = await world.route("campaigns/[campaignId]/world/entities");
const loreRoute = await world.route("campaigns/[campaignId]/lore");
const revealRoute = await world.route("campaigns/[campaignId]/world/secrets/[secretId]/reveal");

const NOTES = "Comes out if the party searches the tower. The DM's own reminder.";

// A workshop of the DM's with a world: the warden, a lore entry the party
// may read, and two secrets the party does not know.
const workshop = createWorkshop(seat.dm.id, { title: "Harbour workshop" });
world.signIn(seat.dm);
const warden = await call(entitiesRoute, "POST", { typeId: "t_character", name: "The Warden" }, { campaignId: workshop.id });
assert.equal(warden.status, 200, JSON.stringify(warden.json));
const history = await call(entitiesRoute, "POST", { typeId: "t_other", name: "Harbour history", text: "The harbour was built on a drowned town." }, { campaignId: workshop.id });
assert.equal(history.status, 200, JSON.stringify(history.json));
const wardenRef = warden.json.entity.ref;
const secrets = [
  { id: "sec_codes", title: "The warden sold the codes", subject: wardenRef, notes: NOTES, knownBy: [wardenRef], partyKnows: false },
  { id: "sec_bell", title: "The bell rings for the drowned", subject: "", notes: "", knownBy: [], partyKnows: false },
];
const seeded = await call(worldRoute, "PATCH", { secrets }, { campaignId: workshop.id });
assert.equal(seeded.status, 200, JSON.stringify(seeded.json));
const workshopBefore = JSON.stringify(getWorldDoc(workshop.id).secrets);
const workshopLoreBefore = listLoreEntries(workshop.id).map((entry) => entry.title).sort();

// The world brought into the campaign, as Use in campaign does.
const imported = runContentImport({ sourceId: workshop.id, campaignId: world.campaignId, selection: ["world"], houseRulesMode: "replace" });
assert.ok(!("error" in imported), imported.error);
const copied = (title) => getWorldDoc(world.campaignId).secrets.find((secret) => secret.title === title);
const codes = copied("The warden sold the codes");
const bell = copied("The bell rings for the drowned");
assert.ok(codes && bell, "the secrets came across with the world");

const reveal = (user, secretId, body, campaignId = world.campaignId) => {
  world.signIn(user);
  return call(revealRoute, "POST", body, { campaignId, secretId });
};
const told = { title: "The warden's ledger", body: "A ledger in the tower shows the warden sold the harbour codes to smugglers." };

await test("nobody but the story authority can reveal a secret", async () => {
  for (const user of [seat.player, seat.lead, seat.bare]) {
    const refused = await reveal(user, codes.id, told);
    assert.equal(refused.status, 403, `${user.username}: ${refused.status}`);
  }
  assert.equal(copied(codes.title).partyKnows, false, "a refused reveal changed nothing");
  assert.equal(listLoreEntries(world.campaignId).some((entry) => entry.title === told.title), false);
});

await test("the party is told in words the DM wrote, and nothing is sent without them", async () => {
  const empty = await reveal(seat.dm, codes.id, { title: "", body: "" });
  assert.equal(empty.status, 400);
  const missing = await reveal(seat.dm, "sec_nowhere", told);
  assert.equal(missing.status, 404);
  assert.equal(copied(codes.title).partyKnows, false);
});

let entry;
await test("revealing marks the secret learned in this campaign and records where the party read it", async () => {
  const answer = await reveal(seat.dm, codes.id, told);
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  entry = answer.json.entry;
  assert.equal(entry.title, told.title);
  assert.equal(entry.body, told.body);
  assert.equal(entry.visibility, "party");
  assert.equal(entry.audience ?? null, null, "the whole table reads it");
  const secret = copied(codes.title);
  assert.equal(secret.partyKnows, true);
  assert.equal(secret.revealedAs, `lore:${entry.id}`);
  assert.ok(Number.isFinite(Date.parse(secret.revealedAt)), secret.revealedAt);
  // The editor's view carries the record too, with the entry it names.
  const view = answer.json.doc.secrets.find((row) => row.id === codes.id);
  assert.equal(view.revealedAs, `lore:${entry.id}`);
  assert.ok(answer.json.entities.some((entity) => entity.ref === `lore:${entry.id}`));
  // The keepers and the DM's notes stay on the secret, not in the entry.
  assert.deepEqual(secret.knownBy, codes.knownBy);
  assert.equal(secret.notes, NOTES);
});

await test("the source workshop keeps its secret and its lore exactly as they were", async () => {
  assert.equal(JSON.stringify(getWorldDoc(workshop.id).secrets), workshopBefore);
  assert.deepEqual(listLoreEntries(workshop.id).map((row) => row.title).sort(), workshopLoreBefore);
  const source = getWorldDoc(workshop.id).secrets.find((secret) => secret.id === "sec_codes");
  assert.equal(source.partyKnows, false);
  assert.equal("revealedAt" in source, false);
  assert.equal("revealedAs" in source, false);
});

await test("a player reads the revealed entry and nothing else of the world", async () => {
  world.signIn(seat.player);
  const lore = await call(loreRoute, "GET", undefined, { campaignId: world.campaignId });
  assert.equal(lore.status, 200);
  const read = lore.json.entries.find((row) => row.id === entry.id);
  assert.ok(read, "the revealed entry is in the player's lore");
  assert.equal(read.body, told.body);
  const said = JSON.stringify(lore.json);
  assert.doesNotMatch(said, /searches the tower|DM's own reminder/, "the secret's notes never reach a player");
  assert.doesNotMatch(said, /rings for the drowned/, "nor a secret still kept");
  const refused = await call(worldRoute, "GET", undefined, { campaignId: world.campaignId });
  assert.equal(refused.status, 403);
});

await test("a secret is told once; a second reveal names the first", async () => {
  const again = await reveal(seat.dm, codes.id, told);
  assert.equal(again.status, 409);
  assert.equal(listLoreEntries(world.campaignId).filter((row) => row.title === told.title).length, 1);
});

await test("only the DM seat puts the entry on every screen; an AI campaign's lead reveals without it", async () => {
  const ai = await openWorld();
  ai.signIn(ai.owner);
  await call(worldRoute, "PATCH", { secrets: [{ id: "sec_ai", title: "The ferryman is a ghost", subject: "", notes: "", knownBy: [], partyKnows: false }] }, { campaignId: ai.campaignId });
  const shown = await call(revealRoute, "POST", { ...told, title: "The ferryman", show: true }, { campaignId: ai.campaignId, secretId: "sec_ai" });
  assert.equal(shown.status, 403, "no DM seat at an AI table, so no handout");
  assert.equal(getWorldDoc(ai.campaignId).secrets[0].partyKnows, false, "and nothing was revealed");
  const plain = await call(revealRoute, "POST", { title: "The ferryman", body: "He has been dead a hundred years." }, { campaignId: ai.campaignId, secretId: "sec_ai" });
  assert.equal(plain.status, 200, JSON.stringify(plain.json));

  const withHandout = await reveal(seat.dm, bell.id, { title: "The drowned bell", body: "It rings for the town under the harbour.", show: true });
  assert.equal(withHandout.status, 200, JSON.stringify(withHandout.json));
  const handout = latestEventOfType(world.campaignId, ["handout_shown"]);
  assert.ok(handout && JSON.stringify(handout).includes(withHandout.json.entry.id), "the handout shows the revealed entry");
});

await test("a workshop has no party to tell", async () => {
  const refused = await reveal(seat.dm, "sec_bell", told, workshop.id);
  assert.equal(refused.status, 400);
  assert.equal(JSON.stringify(getWorldDoc(workshop.id).secrets), workshopBefore);
});

await test("the reveal record is read through the model's floor and follows a copy", async () => {
  const row = { id: "s1", title: "T", subject: "", notes: "", knownBy: [], partyKnows: true };
  const kept = readDoc({ secrets: [{ ...row, revealedAt: "2026-10-17T10:00:00.000Z", revealedAs: "lore:abc" }] }).secrets[0];
  assert.equal(kept.revealedAt, "2026-10-17T10:00:00.000Z");
  assert.equal(kept.revealedAs, "lore:abc");
  const junk = readDoc({ secrets: [{ ...row, revealedAt: "yesterday-ish", revealedAs: "not a ref" }] }).secrets[0];
  assert.equal("revealedAt" in junk, false);
  assert.equal("revealedAs" in junk, false);
  const plain = readDoc({ secrets: [row] }).secrets[0];
  assert.deepEqual(Object.keys(plain).sort(), ["id", "knownBy", "notes", "partyKnows", "subject", "title"], "a secret never revealed reads as it always has");
  // A copy renumbers the entry it was told in, or drops the record's link
  // when that entry did not come along.
  const doc = readDoc({ secrets: [{ ...row, revealedAt: "2026-10-17T10:00:00.000Z", revealedAs: "lore:abc" }] });
  assert.equal(remapDoc(doc, (ref) => (ref === "lore:abc" ? "lore:xyz" : ref)).secrets[0].revealedAs, "lore:xyz");
  const gone = remapDoc(doc, () => null).secrets[0];
  assert.equal("revealedAs" in gone, false);
  assert.equal(gone.revealedAt, "2026-10-17T10:00:00.000Z");
});

finish();
