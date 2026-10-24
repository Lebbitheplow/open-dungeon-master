// A lasting companion inside the party (issue 503 Phase 4), the pure half
// (src/lib/dm/party-conduct-logic.ts): no slot or potion spent on a
// character it is wary of or worse unless they are dying; a risky order from
// such a commander refused; a mercenary's share before a fight; a devoted
// companion's blow taken once a fight; and the record.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const logic = await import("../src/lib/dm/party-conduct-logic.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const aid = (approval, overrides = {}) => logic.aidRefusal({ companion: "Seren", target: "Kael", approval, dying: false, spend: "slot", ...overrides });

test("wary or worse is the tier wary and below; no standing is no refusal", () => {
  assert.equal(logic.waryOrWorse(-10), true, "wary starts at -24 and runs to -10");
  assert.equal(logic.waryOrWorse(-24), true);
  assert.equal(logic.waryOrWorse(-9), false, "neutral");
  assert.equal(logic.waryOrWorse(-100), true);
  assert.equal(logic.waryOrWorse(null), false);
});

test("a wary companion spends no slot and no potion on that character, with the reason and nothing spent", () => {
  const slot = aid(-15);
  assert.match(slot, /^Seren will not spend a spell slot on Kael: Seren is wary of them \(-15\)\. Only if Kael were dying\. Nothing was spent\.$/);
  assert.match(aid(-40, { spend: "potion" }), /will not spend a potion on Kael: Seren dislikes them \(-40\)/);
  assert.match(aid(-80), /Seren is hostile to them \(-80\)/);
  assert.equal(logic.aidRefusedWords({ target: "Kael", spend: "slot" }), "a spell for Kael");
  assert.equal(logic.aidRefusedWords({ target: "Kael", spend: "potion" }), "a potion for Kael");
});

test("one who is dying is helped whatever the standing; a neutral or better standing is always helped", () => {
  assert.equal(aid(-100, { dying: true }), null);
  assert.equal(aid(-5), null);
  assert.equal(aid(60), null);
  assert.equal(aid(null), null);
});

test("a risky order is refused only when it walks out of a foe's reach and the companion is wary of the commander or worse", () => {
  const order = (approval, provokers) => logic.riskyOrderRefusal({ companion: "Seren", commander: "Kael", approval, provokers });
  assert.match(order(-30, ["Bandit"]), /^Seren will not walk out of Bandit's reach on Kael's word: Seren dislikes them\. .*Nothing moved\.$/);
  assert.match(order(-12, ["Bandit", "Thug"]), /out of Bandit and Thug's reach/);
  assert.equal(order(-30, []), null, "a safe walk stands");
  assert.equal(order(0, ["Bandit"]), null, "a companion not wary follows the order");
});

test("a mercenary wary of the party owes a share of ten gold a level; one who holds no such value, or is not wary, owes none", () => {
  const mercenary = [{ value: "mercenary" }];
  assert.equal(logic.shareOwed({ values: mercenary, worstApproval: -20, level: 3 }), 30);
  assert.equal(logic.shareOwed({ values: mercenary, worstApproval: -20, level: 0 }), 10, "at least one level's");
  assert.equal(logic.shareOwed({ values: mercenary, worstApproval: 5, level: 3 }), null);
  assert.equal(logic.shareOwed({ values: [{ value: "keeps_oaths" }], worstApproval: -80, level: 3 }), null);
  assert.equal(logic.shareOwed({ values: mercenary, worstApproval: null, level: 3 }), null);
});

test("a share is met when the companion's gold has risen by it; the refusal names what is still owed and how to pay", () => {
  const demand = { amount: 30, goldBefore: 12, encounterId: "e1" };
  assert.equal(logic.demandMet(demand, 41), false);
  assert.equal(logic.demandMet(demand, 42), true);
  assert.match(logic.demandRefusal("Varn", demand, 22), /^Varn will not fight until paid their share: 20 gp still owed \(modify_gold: delta -20 on a party member, \+20 on Varn\)\. Nothing was spent\.$/);
});

test("only a devoted companion takes a blow, and once a fight", () => {
  const guard = (approval, usedThisFight = false) => logic.guardRefusal({ companion: "Seren", ally: "Kael", approval, usedThisFight });
  assert.equal(guard(90), null);
  assert.match(guard(70), /^Seren is not devoted to Kael \(close, a trusted friend\): only a devoted companion/);
  assert.match(guard(null), /^Seren is not devoted to Kael: only a devoted/);
  assert.match(guard(90, true), /already taken a blow for a friend this fight: once a fight/);
  assert.equal(logic.GUARD_REACTION, "Take the Blow");
});

test("the record round-trips, and a broken one reads as nothing", () => {
  const conduct = { demand: { amount: 30, goldBefore: 5, encounterId: "e1" }, guardedIn: "e1", refused: { what: "a spell for Kael", at: 600 } };
  assert.deepEqual(logic.parseConduct(JSON.stringify(conduct)), conduct);
  assert.deepEqual(logic.parseConduct(""), logic.NO_CONDUCT);
  assert.deepEqual(logic.parseConduct("{nope"), logic.NO_CONDUCT);
  assert.equal(logic.parseConduct(JSON.stringify({ demand: { amount: 0 } })).demand, null, "a share of nothing is none");
});

console.log(`test-party-conduct: ${passed} passed`);
