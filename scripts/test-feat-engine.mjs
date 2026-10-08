// The feats' engine hooks, pure (issue #147, src/lib/srd/feat-combat.ts and
// the registry in src/lib/srd/feature-effects.ts): the accuracy-for-damage
// trades, the bonus attacks the Attack action opens, the check riders, the
// death-save, hit-die and concentration feats, the option slots the Adept
// feats open, the counters the feats carry, and a content pack feat's
// numbers read into the feature table.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const combat = await import("../src/lib/srd/feat-combat.ts");
const { parseFeatureEffects, registerFeatRules, clashesWithClassFeature, combatRiders } = await import("../src/lib/srd/feature-effects.ts");
const { populateResources, luckPointsLeft, spendLuckCounter } = await import("../src/lib/srd/class-resources.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const sheet = (...feats) => ({ feats, features: [] });

test("the accuracy-for-damage trade: four feats, four shapes", () => {
  const melee = { weaponAttack: true, ranged: false, heavy: true, proficient: true, proficiencyBonus: 3 };
  const ranged = { ...melee, ranged: true, heavy: false };
  assert.deepEqual(combat.powerAttackFeat(sheet("Great Weapon Master"), melee), { feat: "Great Weapon Master", toHit: -5, disadvantage: false, damage: 10, note: "Great Weapon Master: -5 to hit, +10 damage" });
  const powerful = combat.powerAttackFeat(sheet("Powerful Attacker"), melee);
  assert.equal(powerful.feat, "Powerful Attacker");
  assert.equal(powerful.toHit, 0);
  assert.equal(powerful.disadvantage, true);
  assert.equal(powerful.damage, 10);
  const deadeye = combat.powerAttackFeat(sheet("Deadeye"), ranged);
  assert.equal(deadeye.toHit, -3);
  assert.equal(deadeye.damage, 6);
  assert.match(combat.powerAttackFeat(sheet("Deadeye"), melee).refused, /ranged/);
  assert.match(combat.powerAttackFeat(sheet("Powerful Attacker"), { ...melee, heavy: false }).refused, /heavy melee weapon/);
  assert.match(combat.powerAttackFeat(sheet(), melee).refused, /none of them/);
  assert.equal(combat.shotIgnoresCover(sheet("Deadeye")), true);
  assert.equal(combat.coverFeatName(sheet("Deadeye")), "Deadeye");
});

test("the bonus attacks the Attack action opens, and the routes the feats open for take_action", () => {
  const budget = { oncePerTurn: [combat.POLEARM_READY, combat.ONE_HANDED_ATTACKED], dashed: false, attacksMade: 1 };
  assert.equal(combat.featBonusAttack(sheet("Polearm Master"), budget, { weaponAttack: true, melee: true, weapon: "Glaive" }), "Polearm Master");
  assert.equal(combat.featBonusAttack(sheet("Polearm Master"), budget, { weaponAttack: true, melee: true, weapon: "Longsword" }), null);
  assert.equal(combat.featBonusAttack(sheet("Crossbow Expert"), budget, { weaponAttack: true, melee: false, weapon: "Hand Crossbow" }), "Crossbow Expert");
  assert.equal(combat.featBonusAttack(sheet("Charger"), { ...budget, dashed: true }, { weaponAttack: true, melee: true, weapon: "Longsword" }), "Charger");
  assert.equal(combat.featBonusAttack(sheet("Charger"), budget, { weaponAttack: true, melee: true, weapon: "Longsword" }), null);
  assert.equal(combat.polearmButtDamage("1d10+3"), "1d4+3");
  assert.equal(combat.polearmButtDamage("1d10"), "1d4");
  assert.equal(combat.isPolearm("Quarterstaff"), true);
  assert.deepEqual(combat.featBonusRoute(sheet("Tavern Brawler"), "grapple", { ...budget, oncePerTurn: [combat.TAVERN_GRAPPLE_READY] }, false), { feature: "Tavern Brawler", ki: 0 });
  assert.equal(combat.featBonusRoute(sheet("Tavern Brawler"), "grapple", budget, false), null);
  assert.deepEqual(combat.featBonusRoute(sheet("Shield Master"), "shove", budget, true), { feature: "Shield Master", ki: 0 });
  assert.equal(combat.featBonusRoute(sheet("Shield Master"), "shove", budget, false), null);
  assert.deepEqual(combat.featBonusRoute(sheet("Charger"), "shove", { ...budget, dashed: true }, false), { feature: "Charger", ki: 0 });
  assert.equal(combat.evadesOpportunityAttacksAfterMelee(sheet("Mobile")), "Mobile");
  assert.equal(combat.evadesOpportunityAttacksAfterMelee(sheet("Skirmisher")), "Skirmisher");
  assert.equal(combat.evadesOpportunityAttacksAfterMelee(sheet("Alert")), null);
});

test("the check riders: Tome of Heroes' advantages and Level Up's expertise dice, read from the skill and the reason", () => {
  assert.equal(combat.featCheckRider(sheet("Stalker"), "survival", "tracking the wolf's prints")?.advantage, true);
  assert.equal(combat.featCheckRider(sheet("Stalker"), "survival", "foraging for food"), null);
  assert.equal(combat.featCheckRider(sheet("Combat Thievery"), "sleight_of_hand", undefined)?.die, "1d4");
  assert.equal(combat.featCheckRider(sheet("Empathic"), "insight", "is the merchant lying")?.die, "1d4");
  assert.equal(combat.featCheckRider(sheet("Surgical Combatant"), "medicine", "treat the arrow wound")?.die, "1d4");
  assert.equal(combat.featCheckRider(sheet("Surgical Combatant"), "medicine", "is this herb poisonous"), null);
  assert.equal(combat.featCheckRider(sheet("Monster Hunter"), "arcana", "what are the legends about this creature")?.die, "1d4");
  assert.equal(combat.featCheckRider(sheet("Giant Foe"), "history", "the origins of the hill giants")?.expertise, true);
  assert.equal(combat.featCheckRider(sheet("Forest Denizen"), "athletics", "escape the vines that grappled them")?.advantage, true);
  assert.equal(combat.featCheckRider(sheet("Floriographer"), "investigation", "a hidden message in the bouquet")?.advantage, true);
  assert.equal(combat.actorAdvantage(sheet("Actor"), "deception", "passing himself off as the duke's steward"), true);
  assert.equal(combat.actorAdvantage(sheet("Actor"), "deception", "haggling over the price"), false);
});

test("dying, resting, concentration and saves", () => {
  assert.equal(combat.deathSaveFeat(sheet("Diehard"), { successes: 1, failures: 1 }), "Diehard");
  assert.equal(combat.deathSaveFeat(sheet("Survivor"), { successes: 0, failures: 0 }), "Survivor");
  assert.equal(combat.deathSaveFeat(sheet("Survivor"), { successes: 1, failures: 0 }), null);
  assert.deepEqual(combat.hitDieHealingFloor(sheet("Durable"), 3), { feat: "Durable", floor: 6, extra: 0 });
  assert.deepEqual(combat.hitDieHealingFloor(sheet("Stalwart"), 0), { feat: "Stalwart", floor: 0, extra: 2 });
  assert.equal(combat.hitDieHealingFloor(sheet("Tough"), 3), null);
  assert.deepEqual(combat.concentrationFeat(sheet("War Caster")), { feat: "War Caster", advantage: true, die: null });
  assert.deepEqual(combat.concentrationFeat(sheet("Battle Caster")), { feat: "Battle Caster", advantage: false, die: "1d6" });
  assert.equal(combat.castsWithHandsFull(sheet("Battle Caster")), true);
  assert.equal(combat.damageShakesConcentration(sheet("Spellbreaker"), { weaponAttack: false, melee: false, withinFiveFeet: false }), "Spellbreaker");
  assert.equal(combat.damageShakesConcentration(sheet("Mage Slayer"), { weaponAttack: true, melee: true, withinFiveFeet: true }), "Mage Slayer");
  assert.equal(combat.damageShakesConcentration(sheet("Mage Slayer"), { weaponAttack: true, melee: false, withinFiveFeet: false }), null);
  assert.deepEqual(combat.spellSaveAdvantageReach(sheet("Spellbreaker")), { feat: "Spellbreaker", tiles: 6 });
  assert.deepEqual(combat.spellSaveAdvantageReach(sheet("Mage Slayer")), { feat: "Mage Slayer", tiles: 1 });
  assert.equal(combat.diehardSaveAdvantage(sheet("Diehard"), "CON save vs a day without water (exhaustion)"), true);
  assert.equal(combat.shieldMasterSaveBonus({ feats: ["Shield Master"], features: [], equipment: [{ name: "Shield", equipped: true }] }), 2);
  assert.equal(combat.shieldMasterSaveBonus({ feats: ["Shield Master"], features: [], equipment: [] }), 0);
  assert.equal(combat.helpReachTiles(sheet("Tactical Support")), 6);
  assert.equal(combat.hasMediumArmorMaster(sheet("Medium Armor Expert")), true, "the Level Up twin");
  assert.equal(combat.liftsSmallHeavyPenalty(sheet("Giant Foe")), true);
  assert.equal(combat.drinksAsBonusAction(sheet("Rapid Drinker")), true);
  assert.equal(combat.poisonerIgnoresResistance(sheet("Poisoner"), "poison"), true);
  assert.equal(combat.poisonerIgnoresResistance(sheet("Poisoner"), "fire"), false);
  assert.equal(combat.chefRestDie(sheet("Chef")), "d8");
  assert.equal(combat.standsCheaply(sheet("Athletic")), true, "the Level Up twin of Athlete");
});

test("the option slots and counters the feats carry", () => {
  assert.equal(combat.featOptionSlots(["Martial Adept"], "maneuver"), 2);
  assert.equal(combat.featOptionSlots(["Eldritch Adept"], "invocation"), 1);
  assert.equal(combat.featOptionSlots(["Metamagic Adept"], "metamagic"), 2);
  assert.equal(combat.featOptionSlots(["Martial Adept"], "invocation"), 0);
  const fighter = populateResources([], 5, { cha: 2 }, undefined, undefined, ["Lucky", "Inspiring Leader", "Inner Resilience", "Martial Adept"]);
  assert.deepEqual(fighter.luck_points, { max: 3, used: 0 });
  assert.deepEqual(fighter.inspiring_leader, { max: 6, used: 0 });
  assert.deepEqual(fighter.ki, { max: 3, used: 0 }, "Inner Resilience's ki without a monk's");
  assert.deepEqual(fighter.superiority_dice, { max: 1, used: 0 }, "Martial Adept's one die");
  const monk = populateResources([{ name: "Ki" }], 5, {}, undefined, undefined, ["Inner Resilience"]);
  assert.equal(monk.ki.max, 5 + 3, "a monk's ki plus the feat's three");
  assert.equal(luckPointsLeft(fighter), 3);
  const spent = spendLuckCounter(fighter);
  assert.equal(luckPointsLeft(spent), 2);
  assert.equal(spendLuckCounter({ luck_points: { max: 3, used: 3 } }), null);
  const twin = populateResources([], 5, { cha: 1 }, undefined, undefined, ["Fortunate", "Rallying Speaker"]);
  assert.deepEqual(twin.luck_points, { max: 3, used: 0 });
  assert.deepEqual(twin.inspiring_leader, { max: 6, used: 0 });
});

test("a content pack feat's flat numbers are read into the feature table, except where a class feature shares the name", () => {
  const speed = parseFeatureEffects("Any form of movement you possess is increased by 10 feet.");
  assert.equal(speed.find((effect) => effect.kind === "speed_bonus")?.amount(5), 10);
  const five = parseFeatureEffects("Your Speed increases by 5 feet.");
  assert.equal(five.find((effect) => effect.kind === "speed_bonus")?.amount(5), 5);
  const initiative = parseFeatureEffects("When rolling initiative you gain a +5 bonus.");
  assert.equal(initiative.find((effect) => effect.kind === "initiative_bonus")?.amount, 5);
  const passive = parseFeatureEffects("Increase your passive perception and investigation scores by +5.");
  assert.equal(passive.find((effect) => effect.kind === "passive_bonus")?.amount, 5);
  assert.equal(parseFeatureEffects("Your exertion pool increases by 3.").length, 0);
  assert.equal(registerFeatRules("Swift Combatant", "You are naturally quick. Your Speed increases by 5 feet."), true);
  assert.equal(registerFeatRules("Swift Combatant", "again"), false, "registered once");
  const riders = combatRiders({ class: "fighter", level: 5, features: [{ name: "Swift Combatant" }] });
  assert.equal(riders.speedBonuses.some((entry) => entry.amount === 5), true);
  assert.equal(clashesWithClassFeature("Skirmisher"), true, "the Scout's feature");
  assert.equal(registerFeatRules("Skirmisher", "Any form of movement you possess is increased by 10 feet."), false);
  assert.equal(registerFeatRules("Alert", "Add 5 to initiative."), false, "the static table's own");
});

console.log(`\ntest-feat-engine: ${passed} tests passed.`);
