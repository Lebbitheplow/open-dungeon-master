// Coin, as the stored sheets and the party record hold it.
//
// SRD 5.1: 1 pp = 10 gp, 1 gp = 2 ep = 10 sp = 100 cp. ODM stores a purse as
// whole gold plus 0 to 99 copper under it (src/lib/srd/currency.ts), so the
// true value is gold x 100 + copper and every write has to leave the copper
// inside 0 to 99 and the purse at or above empty.
//
// ODM's documented rule for modify_gold: a loss larger than the purse
// empties it and reports the shortfall rather than refusing (currency.ts
// addCopper, "the caller is told how much was short"). The paths that are a
// price being paid refuse instead and must leave the sheet as it was:
// purchase, the common purse's deposit and withdraw.
//
// Nothing here may create or destroy a coin: a hoard split by party_award
// reaches the sheets whole, and coin moved between a purse and the common
// purse leaves the party's total where it was.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-currency");
const { getParty, setParty } = await import("../src/lib/db/party.ts");
const { emptyParty } = await import("../src/lib/dm/party-logic.ts");

const world = await openWorld();
const heroes = [1, 2, 3, 4].map(() => world.addHero({ class: "fighter", level: 3 }));
const [hero] = heroes;
const copperOf = (id) => {
  const sheet = world.sheet(id);
  return sheet.gold * 100 + sheet.copper;
};
const purse = (id, gold, copper = 0) => world.patch(id, { gold, copper });
const partyCopper = () => heroes.reduce((sum, entry) => sum + copperOf(entry.id), 0);
const act = (name, args) => world.invoke(name, { characterId: hero.id, reason: "test", ...args });
const wellFormed = () => {
  for (const entry of heroes) {
    const sheet = world.sheet(entry.id);
    assert.ok(Number.isInteger(sheet.gold) && sheet.gold >= 0, `gold ${sheet.gold}`);
    assert.ok(Number.isInteger(sheet.copper) && sheet.copper >= 0 && sheet.copper <= 99, `copper ${sheet.copper}`);
  }
};

// ---- denominations ----

// SRD 5.1, "Coinage", in copper.
const COIN = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

await test("each denomination lands on the sheet at the SRD's rate", async () => {
  for (const [coin, worth] of Object.entries(COIN)) {
    for (const count of [1, 7, 23]) {
      purse(hero.id, 0, 0);
      const paid = await act("modify_gold", { delta: 1, coins: `${count} ${coin}` });
      assert.equal(paid.ok, true, paid.error);
      assert.equal(copperOf(hero.id), count * worth, `${count} ${coin}`);
      wellFormed();
    }
  }
});

await test("the coins' names are read like their codes, and a mixed purse adds up", async () => {
  const cases = [
    ["340 silver", 3400],
    ["2 platinum", 2000],
    ["3 electrum", 150],
    ["12 gold pieces", 1200],
    ["9 copper", 9],
    ["2 pp 5 sp", 2050],
    ["1 pp 2 gp 3 ep 4 sp 5 cp", 1000 + 200 + 150 + 40 + 5],
  ];
  for (const [coins, worth] of cases) {
    purse(hero.id, 0, 0);
    await act("modify_gold", { delta: 1, coins });
    assert.equal(copperOf(hero.id), worth, coins);
  }
});

await test("a whole-gold change is worth 100 copper a piece, up and down", async () => {
  purse(hero.id, 10, 50);
  await act("modify_gold", { delta: 5 });
  assert.deepEqual([world.sheet(hero.id).gold, world.sheet(hero.id).copper], [15, 50]);
  await act("modify_gold", { delta: -15 });
  assert.deepEqual([world.sheet(hero.id).gold, world.sheet(hero.id).copper], [0, 50]);
});

await test("spending in copper borrows from the gold above it and leaves the remainder well formed", async () => {
  purse(hero.id, 3, 5);
  await act("modify_gold", { delta: -1, coins: "8 cp" });
  assert.deepEqual([world.sheet(hero.id).gold, world.sheet(hero.id).copper], [2, 97]);
  await act("modify_gold", { delta: -1, coins: "19 sp 7 cp" });
  assert.deepEqual([world.sheet(hero.id).gold, world.sheet(hero.id).copper], [1, 0]);
  wellFormed();
});

await test("ODM's rule: a loss larger than the purse empties it, reports the shortfall, and never goes below nothing", async () => {
  purse(hero.id, 30, 40);
  const lost = await act("modify_gold", { delta: -100 });
  assert.equal(lost.ok, true);
  assert.equal(copperOf(hero.id), 0);
  assert.ok(lost.result.short);
  const again = await act("modify_gold", { delta: -1, coins: "1 cp" });
  assert.equal(copperOf(hero.id), 0);
  assert.ok(again.ok === false || again.result.short);
  wellFormed();
});

await test("a change of nothing is refused", async () => {
  purse(hero.id, 12, 0);
  assert.equal((await act("modify_gold", { delta: 0 })).ok, false);
  assert.equal(copperOf(hero.id), 1200);
});

await test("A purse holds at most 1,000,000 gold (createSheetSchema and patchSheetSchema).", async () => {
  purse(hero.id, 999999, 0);
  await act("modify_gold", { delta: 100000 });
  const held = world.sheet(hero.id).gold;
  purse(hero.id, 0, 0);
  assert.ok(held <= 1000000, `the purse holds ${held} gold`);
});

// ---- a price paid ----

const pack = (equipment) => world.patch(hero.id, { equipment });
const held = (name) => world.sheet(hero.id).equipment.find((item) => item.name === name)?.qty ?? 0;

await test("a purchase moves the gold and the goods together", async () => {
  purse(hero.id, 50, 0);
  pack([]);
  const bought = await act("purchase", { item: "Rope", price: 1, qty: 3, action: "buy" });
  assert.equal(bought.ok, true, bought.error);
  assert.equal(world.sheet(hero.id).gold, 47);
  assert.equal(held("Rope"), 3);
});

await test("a purchase the purse cannot cover is refused, to the last gold piece, and nothing moves", async () => {
  purse(hero.id, 29, 99);
  pack([{ name: "Torch", qty: 1 }]);
  const refused = await act("purchase", { item: "Longsword", price: 15, qty: 2, action: "buy" });
  assert.equal(refused.ok, false);
  assert.equal(copperOf(hero.id), 2999);
  assert.deepEqual(world.sheet(hero.id).equipment.map((item) => item.name), ["Torch"]);
  purse(hero.id, 30, 0);
  assert.equal((await act("purchase", { item: "Longsword", price: 15, qty: 2, action: "buy" })).ok, true);
  assert.equal(copperOf(hero.id), 0);
});

await test("selling what is not carried is refused and pays nothing", async () => {
  purse(hero.id, 5, 0);
  pack([{ name: "Torch", qty: 1 }]);
  const refused = await act("purchase", { item: "Crown", price: 500, qty: 1, action: "sell" });
  assert.equal(refused.ok, false);
  assert.equal(copperOf(hero.id), 500);
  assert.equal(held("Torch"), 1);
});

await test("a sale pays the price for each one sold", async () => {
  purse(hero.id, 0, 0);
  pack([{ name: "Gem", qty: 5 }]);
  const sold = await act("purchase", { item: "Gem", price: 10, qty: 2, action: "sell" });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(world.sheet(hero.id).gold, 20);
  assert.equal(held("Gem"), 3);
});

await test("selling more of an item than the character holds is refused, and nothing is paid", async () => {
  purse(hero.id, 0, 0);
  pack([{ name: "Gem", qty: 2 }]);
  const sold = await act("purchase", { item: "Gem", price: 10, qty: 5, action: "sell" });
  const paid = world.sheet(hero.id).gold;
  assert.ok(sold.ok === false || paid === 20, `two gems at 10 gold each paid ${paid} gold`);
  // Refused means unchanged: the gems stay and no coin arrives.
  assert.equal(sold.ok, false);
  assert.equal(paid, 0);
  assert.equal(held("Gem"), 2);
  const two = await act("purchase", { item: "Gem", price: 10, qty: 2, action: "sell" });
  assert.equal(two.ok, true, two.error);
  assert.equal(world.sheet(hero.id).gold, 20);
  assert.equal(held("Gem"), 0);
});

// ---- a hoard split ----

await test("a hoard split by party_award reaches the sheets whole, whatever the remainder", async () => {
  for (const size of [1, 2, 3, 4]) {
    const sharers = heroes.slice(0, size);
    for (const hoard of [1, 2, 3, 7, 10, 100, 101, 999]) {
      heroes.forEach((entry) => purse(entry.id, 0, 0));
      const awarded = await world.invoke("party_award", {
        characterIds: sharers.map((entry) => entry.id),
        delta: hoard,
        reason: "test",
      });
      assert.equal(awarded.ok, true, awarded.error);
      assert.equal(partyCopper(), hoard * 100, `${hoard} gold between ${size}`);
      const shares = sharers.map((entry) => world.sheet(entry.id).gold);
      assert.ok(Math.max(...shares) - Math.min(...shares) <= size - 1, `${hoard} between ${size}: ${shares}`);
      assert.ok(shares.slice(1).every((share) => share === Math.floor(hoard / size)));
      wellFormed();
    }
  }
});

await test("an item in the spoils goes to one character, once", async () => {
  heroes.forEach((entry) => world.patch(entry.id, { equipment: [] }));
  await world.invoke("party_award", { characterIds: heroes.map((entry) => entry.id), name: "Silver Chalice", qty: 1, reason: "test" });
  const holders = heroes.filter((entry) => world.sheet(entry.id).equipment.some((item) => item.name === "Silver Chalice"));
  assert.deepEqual(holders.map((entry) => entry.id), [hero.id]);
});

await test("an award of nothing to anyone is refused", async () => {
  assert.equal((await world.invoke("party_award", { characterIds: [hero.id], reason: "test" })).ok, false);
  assert.equal((await world.invoke("party_award", { characterIds: ["nobody"], delta: 50, reason: "test" })).ok, false);
});

// ---- the common purse and the shared pack ----

const everything = () => partyCopper() + getParty(world.campaignId).copper;
const stash = (args) => world.invoke("party_stash", { characterId: hero.id, reason: "test", ...args });

await test("coin put in the common purse leaves the character's, and the total stands", async () => {
  setParty(world.campaignId, emptyParty());
  heroes.forEach((entry) => purse(entry.id, 10, 0));
  purse(hero.id, 12, 34);
  const before = everything();
  assert.equal((await stash({ do: "deposit", coins: "5 gp 50 cp" })).ok, true);
  assert.equal(copperOf(hero.id), 1234 - 550);
  assert.equal(getParty(world.campaignId).copper, 550);
  assert.equal(everything(), before);
  assert.equal((await stash({ do: "withdraw", amount: 2 })).ok, true);
  assert.equal(copperOf(hero.id), 1234 - 550 + 200);
  assert.equal(everything(), before);
  wellFormed();
});

await test("a deposit the character cannot cover and a withdrawal the purse cannot cover are refused, with nothing moved", async () => {
  setParty(world.campaignId, { ...emptyParty(), copper: 300 });
  purse(hero.id, 1, 0);
  const before = everything();
  assert.equal((await stash({ do: "deposit", coins: "1 gp 1 cp" })).ok, false);
  assert.equal((await stash({ do: "withdraw", coins: "3 gp 1 cp" })).ok, false);
  assert.equal(copperOf(hero.id), 100);
  assert.equal(getParty(world.campaignId).copper, 300);
  assert.equal(everything(), before);
  assert.equal((await stash({ do: "deposit", amount: 0 })).ok, false);
});

await test("an item stowed in the shared pack and taken out again is counted once throughout", async () => {
  setParty(world.campaignId, emptyParty());
  pack([{ name: "Rope", qty: 3 }]);
  const count = () => held("Rope") + (getParty(world.campaignId).inventory.find((item) => item.name === "Rope")?.qty ?? 0);
  assert.equal((await stash({ do: "stow", name: "Rope", qty: 2 })).ok, true);
  assert.equal(held("Rope"), 1);
  assert.equal(count(), 3);
  // Asking for more than is held moves what there is, no more.
  assert.equal((await stash({ do: "stow", name: "Rope", qty: 9 })).ok, true);
  assert.equal(count(), 3);
  assert.equal((await stash({ do: "take", name: "Rope", qty: 50 })).ok, true);
  assert.equal(held("Rope"), 3);
  assert.equal(count(), 3);
  assert.equal((await stash({ do: "take", name: "Rope" })).ok, false);
  assert.equal((await stash({ do: "stow", name: "Anchor" })).ok, false);
  assert.equal(count(), 3);
});

await test("after every operation in this file each purse is whole gold and 0 to 99 copper", () => {
  wellFormed();
});

world.close();
finish();
