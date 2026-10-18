// Issue 231: a player chooses which battle cards stay in the visible Hand.
// The layout decides where a card sits, never whether it can be played: the
// cards are still dealt from the sheet and the live turn (hand.ts). Pinned
// here: the fan follows the chosen order, a card past the last seat is
// refused in words with the selection intact, Escape and Stand up take a
// seat for the moment without erasing the choice, lost cards leave no broken
// seat and gained ones are marked, and the layout is saved per character
// through the real route (another player's or a companion's is refused).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { standInStoryteller } from "./lib/stand-in-storyteller.mjs";

// An AI-run table through the routes needs a storyteller set up (the routes
// refuse one otherwise, and seat a person when none is named); this one never
// answers.
standInStoryteller();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-hand-layout-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

const { deriveHand, FRESH_TURN, HAND_FAN_CAP } = await import("../src/lib/battlemap/hand.ts");
const {
  HAND_SEATS,
  addToHand,
  arrangeHand,
  missingFromHand,
  moveInHand,
  normalizeHandLayout,
  removeFromHand,
  seatPicked,
  splitHand,
  startingLayout,
} = await import("../src/lib/battlemap/hand-layout.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, markSheetAsCompanion } = await import("../src/lib/db/sheets.ts");

const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const handRoute = await route("campaigns/[campaignId]/sheet/hand");
const campaignsRoute = await route("campaigns");
const joinRoute = await route("campaigns/join");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

function sheet(overrides = {}) {
  return {
    id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Lys", race: "human", class: "wizard", subclass: "", background: "", alignment: "", gender: "",
    level: 4, xp: 0,
    abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    maxHp: 26, currentHp: 26, tempHp: 0, ac: 12, acOverride: false, speed: 30,
    hitDice: { die: "d6", total: 4, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["daggers", "quarterstaffs"] },
    equipment: [{ name: "Component pouch", qty: 1 }, { name: "Quarterstaff", qty: 1 }, { name: "Dagger", qty: 1 }],
    gold: 0, copper: 0, feats: [], features: [],
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } },
      prepared: ["Fire Bolt", "Healing Word", "Hold Person", "Detect Magic"],
      known: [],
    },
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}

// What the content pack says of each spell; a spell card is dealt from it.
const FACTS = {
  "fire bolt": { level: 0, school: "evocation", castingTime: "1 action", range: "120 feet", concentration: false, desc: "Make a ranged spell attack. On a hit, the target takes 1d10 fire damage.", higherLevel: "" },
  "healing word": { level: 1, school: "evocation", castingTime: "1 bonus action", range: "60 feet", concentration: false, desc: "A creature regains hit points equal to 1d4 + your spellcasting ability modifier.", higherLevel: "" },
  "hold person": { level: 2, school: "enchantment", castingTime: "1 action", range: "60 feet", concentration: true, desc: "The target must succeed on a Wisdom saving throw or be paralyzed.", higherLevel: "" },
  "detect magic": { level: 1, school: "divination", castingTime: "1 action", range: "Self", concentration: true, desc: "You sense the presence of magic within 30 feet of you.", higherLevel: "" },
  shield: { level: 1, school: "abjuration", castingTime: "1 reaction, which you take when you are hit by an attack", range: "Self", concentration: false, desc: "An invisible barrier of magical force appears and protects you.", higherLevel: "" },
};
const deal = (from, turn = FRESH_TURN) => deriveHand(from, turn, { spells: FACTS });
const cards = deal(sheet());
const ids = (list) => list.map((card) => card.id);
const card = (id) => cards.find((entry) => entry.id === id);

await test("with no layout the hand is the automatic split, unchanged", () => {
  assert.ok(cards.length > HAND_FAN_CAP, `${cards.length} cards`);
  const auto = arrangeHand(cards, null);
  assert.deepEqual({ fan: auto.fan, more: auto.more }, splitHand(cards));
  assert.equal(auto.arranged, false);
});

await test("the fan follows the player's chosen cards and order; every other card is in More", () => {
  const chosen = ["spell:hold person", "basic:dash", "spell:fire bolt"];
  const { fan, more, arranged } = arrangeHand(cards, { fan: chosen, known: ids(cards) });
  assert.equal(arranged, true);
  assert.deepEqual(ids(fan), [...chosen, "basic:end-turn"]);
  assert.equal(fan.length + more.length, cards.length, "every card is reachable from the fan or More");
  assert.ok(more.every((entry) => !chosen.includes(entry.id)));
  // A chosen card keeps its own state: placement never makes one playable.
  const spent = deal(sheet(), { ...FRESH_TURN, actionUsed: true });
  const held = arrangeHand(spent, { fan: chosen, known: ids(spent) }).fan.find((entry) => entry.id === "spell:hold person");
  assert.ok(held.disabled, "a chosen card that the turn stops is shown stopped");
});

await test("adding past the last seat is refused in words and the selection stays as it was", () => {
  let layout = { fan: [], known: ids(cards) };
  const seatable = cards.filter((entry) => entry.id !== "basic:end-turn");
  for (const entry of seatable.slice(0, HAND_SEATS)) {
    const next = addToHand(layout, entry);
    assert.ok("layout" in next);
    layout = next.layout;
  }
  assert.equal(layout.fan.length, HAND_SEATS);
  assert.equal(HAND_SEATS, HAND_FAN_CAP - 1);
  const extra = seatable[HAND_SEATS];
  const refused = addToHand(layout, extra);
  assert.ok("error" in refused);
  assert.match(refused.error, /full/);
  assert.match(refused.error, /Move a card to More first/);
  assert.equal(layout.fan.length, HAND_SEATS, "nothing was pushed out");
  assert.ok("error" in addToHand({ fan: [], known: [] }, card("basic:end-turn")), "End turn keeps its own seat");
  // Moving one out makes room, and the order can be changed.
  const freed = removeFromHand(layout, layout.fan[0]);
  assert.ok("layout" in addToHand(freed, extra));
  const moved = moveInHand(layout, layout.fan[2], -1);
  assert.equal(moved.fan[1], layout.fan[2]);
  assert.deepEqual(moveInHand(layout, layout.fan[0], -1), layout, "the first seat cannot move further left");
});

await test("Escape or Stand up takes a seat for now without erasing the choice", () => {
  const prone = deal(sheet({ conditions: ["prone"] }));
  const full = prone.filter((entry) => entry.id !== "basic:end-turn" && entry.id !== "basic:stand-up").slice(0, HAND_SEATS);
  const layout = { fan: ids(full), known: ids(prone) };
  const { fan, displaced } = arrangeHand(prone, layout);
  assert.equal(fan[0].id, "basic:stand-up");
  assert.equal(fan.length, HAND_FAN_CAP);
  assert.deepEqual(ids(displaced), [full[full.length - 1].id], "the last chosen card waits in More");
  assert.equal(layout.fan.length, HAND_SEATS, "the saved choice is untouched");
  // Standing again, the chosen card is back in its seat.
  const standing = deal(sheet());
  assert.deepEqual(ids(arrangeHand(standing, layout).fan).slice(0, HAND_SEATS), layout.fan);
});

await test("a lost card leaves no broken seat and a gained one is marked new", () => {
  const layout = { fan: ["spell:hold person", "spell:detect magic", "basic:dash"], known: ids(cards) };
  // Detect Magic no longer prepared; Shield newly prepared.
  const changed = deal(sheet({ spellcasting: { ...sheet().spellcasting, prepared: ["Fire Bolt", "Healing Word", "Hold Person", "Shield"] } }));
  const { fan, fresh } = arrangeHand(changed, layout);
  assert.deepEqual(ids(fan), ["spell:hold person", "basic:dash", "basic:end-turn"]);
  assert.deepEqual(missingFromHand(layout, changed), ["spell:detect magic"]);
  assert.ok(ids(fresh).includes("spell:shield"));
  // Arranging again remembers everything held now, so nothing reads as new.
  const again = startingLayout(changed, layout);
  assert.deepEqual(arrangeHand(changed, again).fresh, []);
});

await test("starting to arrange begins from the fan the player sees", () => {
  const start = startingLayout(cards, null);
  assert.deepEqual(start.fan, ids(splitHand(cards).fan).filter((id) => id !== "basic:end-turn"));
});

await test("a card picked from More takes a free seat, or the last before End turn", () => {
  const few = arrangeHand(cards, { fan: ["basic:dash"], known: ids(cards) });
  const extra = few.more[0];
  assert.deepEqual(ids(seatPicked(few.fan, extra)), ["basic:dash", extra.id, "basic:end-turn"]);
  const auto = splitHand(cards);
  const shown = seatPicked(auto.fan, auto.more[0]);
  assert.equal(shown.length, HAND_FAN_CAP);
  assert.equal(shown[HAND_FAN_CAP - 2].id, auto.more[0].id);
  assert.equal(shown[HAND_FAN_CAP - 1].id, "basic:end-turn");
});

await test("a stored layout is read within bounds", () => {
  assert.equal(normalizeHandLayout(null), null);
  assert.equal(normalizeHandLayout({ known: [] }), null);
  const read = normalizeHandLayout({ fan: ["a:1", "a:1", "basic:end-turn", 7, "", ...Array.from({ length: 20 }, (_, i) => `b:${i}`)] });
  assert.equal(read.fan.length, HAND_SEATS);
  assert.equal(read.fan[0], "a:1");
  assert.ok(!read.fan.includes("basic:end-turn"));
});

// ---- the route ----

const lead = createUser("lead", "x", { isAdmin: true });
const player = createUser("player", "x");
const other = createUser("other", "x");

function as(user) {
  globalThis.__odmTestToken = mintSession(user.id).token;
}
async function call(mod, method, body, params = {}) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

as(lead);
const campaignId = (await call(campaignsRoute, "POST", { title: "Hands", gameSettings: { multiCharacter: "all_active" } })).json.campaign.id;
for (const user of [player, other]) {
  as(user);
  assert.equal((await call(joinRoute, "POST", { inviteCode: getCampaignById(campaignId).inviteCode })).status, 200);
}
const base = sheet();
// The stored fields only: createSheet gives the row its own id and owner.
const strip = (full) => {
  const rest = { ...full };
  delete rest.id;
  delete rest.campaignId;
  delete rest.userId;
  return rest;
};
const lys = createSheet(campaignId, player.id, 4, strip({ ...base, name: "Lys" }));
const brother = createSheet(campaignId, player.id, 4, strip({ ...base, name: "Corin" }));
const theirs = createSheet(campaignId, other.id, 4, strip({ ...base, name: "Mara" }));
const ally = markSheetAsCompanion(createSheet(campaignId, player.id, 4, strip({ ...base, name: "Pip" })).id, "party", "");

await test("a layout is saved for one character, survives a reload, and leaves the others alone", async () => {
  as(player);
  const chosen = ["spell:hold person", "basic:dash"];
  const saved = await call(handRoute, "PUT", { characterId: lys.id, layout: { fan: chosen, known: ids(cards) } }, { campaignId });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.layout.fan, chosen);
  assert.deepEqual(getSheetById(lys.id).handLayout.fan, chosen);
  assert.equal(getSheetById(brother.id).handLayout, undefined, "the player's other character keeps the automatic hand");
  assert.equal(getSheetById(theirs.id).handLayout, undefined);
  // Nothing else on the sheet moved.
  assert.equal(getSheetById(lys.id).updatedAt, lys.updatedAt);
  assert.equal(getSheetById(lys.id).currentHp, lys.currentHp);
  // Back to automatic.
  const reset = await call(handRoute, "PUT", { characterId: lys.id, layout: null }, { campaignId });
  assert.equal(reset.status, 200);
  assert.equal(getSheetById(lys.id).handLayout, undefined);
});

await test("another player's character, or an ally the DM plays, is not the player's to arrange", async () => {
  as(player);
  const layout = { fan: ["basic:dash"], known: [] };
  assert.equal((await call(handRoute, "PUT", { characterId: theirs.id, layout }, { campaignId })).status, 404);
  assert.equal((await call(handRoute, "PUT", { characterId: ally.id, layout }, { campaignId })).status, 404);
  assert.equal(getSheetById(theirs.id).handLayout, undefined);
  assert.equal(getSheetById(ally.id).handLayout, undefined);
});

await test("the route refuses a layout past the seats with the capacity sentence", async () => {
  as(player);
  const tooMany = Array.from({ length: HAND_SEATS + 1 }, (_, index) => `basic:x${index}`);
  const refused = await call(handRoute, "PUT", { characterId: lys.id, layout: { fan: tooMany, known: [] } }, { campaignId });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /Move a card to More first/);
  assert.equal(getSheetById(lys.id).handLayout, undefined);
});

console.log(`${passed} hand layout checks passed`);
removeTempDir(dir);
