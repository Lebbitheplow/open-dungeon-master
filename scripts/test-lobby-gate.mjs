// What the lobby is still waiting on before the adventure can open.
//
// The rule this file guards: a DM seat holds no party slot, so it is never
// asked for a character. Counting the DM among the people who owed a sheet is
// what made a human-run table impossible to start at all, and the same
// function now answers for both the Begin button (Lobby.tsx) and the PATCH
// that button calls (api/campaigns/[campaignId]/route.ts), so they cannot
// drift back apart.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { lobbyBlocker, partySlotCount } = await import("../src/lib/dm/viewer.ts");
const { gameSettingsSchema, resolveCompanionMode } = await import(
  "../src/lib/schemas/game-settings.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const aiSeats = { dmMode: "ai", humanDmUserId: null, assistantDmUserId: null };
const humanSeats = { dmMode: "human", humanDmUserId: "gm", assistantDmUserId: null };
const assistedSeats = { dmMode: "assisted", humanDmUserId: "gm", assistantDmUserId: "gm2" };

const seat = (userId, ready, hasSheet) => ({ userId, ready, hasSheet });

test("an AI table opens once every player is ready with a sheet", () => {
  assert.equal(
    lobbyBlocker(aiSeats, [seat("p1", true, true), seat("p2", true, true)]),
    "",
  );
});

test("a player without a character blocks the start", () => {
  assert.equal(
    lobbyBlocker(aiSeats, [seat("p1", true, true), seat("p2", true, false)]),
    "Every player needs a character before the adventure starts.",
  );
});

test("a player who has not readied up blocks the start", () => {
  assert.equal(
    lobbyBlocker(aiSeats, [seat("p1", true, true), seat("p2", false, true)]),
    "Waiting for everyone to ready up.",
  );
});

// The regression. One DM, one player: the smallest human-run table there is,
// and the one a first test of the app is most likely to be.
test("a DM and one player can start, though the DM has no character", () => {
  assert.equal(lobbyBlocker(humanSeats, [seat("gm", true, false), seat("p1", true, true)]), "");
});

test("the DM still has to ready up", () => {
  assert.equal(
    lobbyBlocker(humanSeats, [seat("gm", false, false), seat("p1", true, true)]),
    "Waiting for everyone to ready up.",
  );
});

test("the player at a human-run table still needs a character", () => {
  assert.equal(
    lobbyBlocker(humanSeats, [seat("gm", true, false), seat("p1", true, false)]),
    "Every player needs a character before the adventure starts.",
  );
});

test("a co-DM is exempt from a character too, in assisted mode as in human", () => {
  assert.equal(
    lobbyBlocker(assistedSeats, [
      seat("gm", true, false),
      seat("gm2", true, false),
      seat("p1", true, true),
    ]),
    "",
  );
});

// The old server gate compared a sheet COUNT against a member count, so an
// ally the DM had built made up the numbers for a player who had none. Asking
// seat by seat is what closes that; a companion's sheet belongs to a bot user
// and is never any member's.
test("one player's character cannot stand in for another's", () => {
  assert.equal(
    lobbyBlocker(humanSeats, [
      seat("gm", true, false),
      seat("p1", true, true),
      seat("p2", true, false),
    ]),
    "Every player needs a character before the adventure starts.",
  );
});

test("an empty lobby says so rather than opening", () => {
  assert.equal(lobbyBlocker(aiSeats, []), "The table is empty.");
});

// The other half of "a DM seat is not a player": companion room is measured in
// party slots, so a lone player with a person running the game still gets the
// full companion a solo player gets.
test("auto companions count players, not people at the table", () => {
  const settings = gameSettingsSchema.parse({});
  assert.equal(settings.companions, "auto");
  const members = ["gm", "p1"];
  assert.equal(partySlotCount(humanSeats, members), 1);
  assert.equal(resolveCompanionMode(settings, partySlotCount(humanSeats, members)), "full");
  // Two real players is a party; "auto" gives them scene guests only.
  assert.equal(
    resolveCompanionMode(settings, partySlotCount(humanSeats, ["gm", "p1", "p2"])),
    "guests",
  );
});

console.log(`lobby gate: ${passed} tests passed.`);
