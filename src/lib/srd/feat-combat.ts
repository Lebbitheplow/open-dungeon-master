// What the combat feats do at the table, read from sheet.feats (issue #125:
// Great Weapon Master, Sharpshooter, Spell Sniper, Elemental Adept, Gunner,
// Crossbow Expert's shot in melee, Mage Slayer, Defensive Duelist, Dungeon
// Delver were words on the sheet and nothing more). Pure: the attack and
// cast engines ask these and apply the answers.
import { featTwinOf, holdsFeat } from "@/lib/srd/feat-effects";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

type FeatHolder = { feats?: string[]; features?: Array<{ name: string }> };
type ChoiceHolder = FeatHolder & { featChoices?: Record<string, { damageType?: string } | undefined> | null };

// The once-per-turn key a melee crit or kill leaves on the budget, which
// lets Great Weapon Master's bonus-action attack through (pc-attack-options.ts).
export const GREAT_WEAPON_MASTER_READY = "great weapon master";

export const ELEMENTAL_ADEPT_TYPES = ["acid", "cold", "fire", "lightning", "thunder"];

// ---- the power attack: accuracy traded for damage ----

export const POWER_ATTACK_TO_HIT = -5;
export const POWER_ATTACK_DAMAGE = 10;

export type PowerAttack = {
  feat: string;
  // The trade: a flat penalty to hit, or the roll at disadvantage.
  toHit: number;
  disadvantage: boolean;
  damage: number;
  note: string;
};

// Which feat lets this attack trade accuracy for damage, or why none does.
// Great Weapon Master: a heavy melee weapon the character is proficient
// with, -5 to hit for +10. Sharpshooter: a ranged weapon, the same trade.
// Level Up's Powerful Attacker: a heavy weapon, the roll at disadvantage
// for +10. Level Up's Deadeye: a ranged weapon, the proficiency bonus off
// the roll for twice it on the damage (issue #147).
export function powerAttackFeat(
  sheet: FeatHolder,
  attack: { weaponAttack: boolean; ranged: boolean; heavy: boolean; proficient: boolean; proficiencyBonus?: number },
): PowerAttack | { refused: string } {
  const gwm = holdsFeat(sheet, "Great Weapon Master");
  const sharp = holdsFeat(sheet, "Sharpshooter");
  const powerful = holdsFeat(sheet, "Powerful Attacker");
  const deadeye = holdsFeat(sheet, "Deadeye");
  if (!gwm && !sharp && !powerful && !deadeye) {
    return { refused: "the accuracy-for-damage trade belongs to Great Weapon Master or Powerful Attacker (a heavy melee weapon) and Sharpshooter or Deadeye (a ranged weapon), and this character has none of them." };
  }
  if (!attack.weaponAttack) {
    return { refused: "the accuracy-for-damage trade is for weapon attacks; a spell attack cannot take it." };
  }
  if (attack.ranged) {
    if (sharp) {
      return { feat: "Sharpshooter", toHit: POWER_ATTACK_TO_HIT, disadvantage: false, damage: POWER_ATTACK_DAMAGE, note: "Sharpshooter: -5 to hit, +10 damage" };
    }
    if (deadeye) {
      if (!attack.proficient) {
        return { refused: "Deadeye's trade needs a ranged weapon the character is proficient with." };
      }
      const bonus = attack.proficiencyBonus ?? 2;
      return { feat: "Deadeye", toHit: -bonus, disadvantage: false, damage: 2 * bonus, note: `Deadeye: the proficiency bonus (+${bonus}) comes off the roll, twice it (+${2 * bonus}) goes on the damage` };
    }
    return { refused: "Great Weapon Master's and Powerful Attacker's trades are for melee attacks with a heavy weapon; a ranged attack needs Sharpshooter or Deadeye." };
  }
  if (!gwm && !powerful) {
    return { refused: "Sharpshooter's and Deadeye's trades are for ranged weapon attacks; a melee attack needs Great Weapon Master or Powerful Attacker." };
  }
  if (!attack.heavy || !attack.proficient) {
    return { refused: `${gwm ? "Great Weapon Master" : "Powerful Attacker"}'s trade needs a heavy melee weapon the character is proficient with.` };
  }
  return gwm
    ? { feat: "Great Weapon Master", toHit: POWER_ATTACK_TO_HIT, disadvantage: false, damage: POWER_ATTACK_DAMAGE, note: "Great Weapon Master: -5 to hit, +10 damage" }
    : { feat: "Powerful Attacker", toHit: 0, disadvantage: true, damage: POWER_ATTACK_DAMAGE, note: "Powerful Attacker: the attack roll at disadvantage, +10 damage" };
}

// ---- range, cover and loading ----

// Sharpshooter: no disadvantage at long range, and half or three-quarters
// cover is no cover, on ranged weapon attacks.
export function shotIgnoresLongRange(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Sharpshooter");
}

// Level Up's Deadeye ignores cover the same way.
export function shotIgnoresCover(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Sharpshooter") || holdsFeat(sheet, "Deadeye");
}

export function coverFeatName(sheet: FeatHolder): string {
  return holdsFeat(sheet, "Sharpshooter") ? "Sharpshooter" : "Deadeye";
}

// ---- casting with weapons in hand, and concentration ----

// War Caster, and Level Up's Battle Caster: somatic components with a
// weapon or shield in each hand.
export function castsWithHandsFull(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "War Caster") || holdsFeat(sheet, "Battle Caster");
}

// What a feat adds to the Constitution save to keep concentration: War
// Caster's advantage, or Battle Caster's 1d6 expertise die.
export function concentrationFeat(sheet: FeatHolder): { feat: string; advantage: boolean; die: string | null } | null {
  if (holdsFeat(sheet, "War Caster")) {
    return { feat: "War Caster", advantage: true, die: null };
  }
  if (holdsFeat(sheet, "Battle Caster")) {
    return { feat: "Battle Caster", advantage: false, die: "1d6" };
  }
  return null;
}

// Mage Slayer: a melee weapon hit within 5 feet puts the target's
// concentration save at disadvantage. Level Up's Spellbreaker: any damage
// the character deals does.
export function damageShakesConcentration(sheet: FeatHolder, attack: { weaponAttack: boolean; melee: boolean; withinFiveFeet: boolean }): string | null {
  if (holdsFeat(sheet, "Spellbreaker")) {
    return "Spellbreaker";
  }
  if (holdsFeat(sheet, "Mage Slayer") && attack.weaponAttack && attack.melee && attack.withinFiveFeet) {
    return "Mage Slayer";
  }
  return null;
}

// How far a caster may stand for the character's save against its spell
// to be at advantage: Mage Slayer within 5 feet (1 tile), Spellbreaker's
// magic resistance within 30 feet (6 tiles). Null without either.
export function spellSaveAdvantageReach(sheet: FeatHolder): { feat: string; tiles: number } | null {
  if (holdsFeat(sheet, "Spellbreaker")) {
    return { feat: "Spellbreaker", tiles: 6 };
  }
  if (holdsFeat(sheet, "Mage Slayer")) {
    return { feat: "Mage Slayer", tiles: 1 };
  }
  return null;
}

// ---- the attack action's followers: bonus attacks, marks and riders ----

// Keys the turn budget carries for the feats (src/lib/dm/action-budget.ts
// oncePerTurn): what the Attack action opened, what a hit opened, and what
// a once-a-turn rider has already done.
export const POLEARM_READY = "polearm master:attack-action";
export const ONE_HANDED_ATTACKED = "crossbow expert:one-handed-attack";
export const TAVERN_GRAPPLE_READY = "tavern brawler:hit";
export const MOBILE_ATTACKED = "mobile:";
export const BRUTAL_ATTACK_USED = "brutal attack:used";
export const PIERCER_USED = "piercer:used";
export const SLASHER_USED = "slasher:used";
export const CRUSHER_USED = "crusher:used";

const POLEARMS = ["glaive", "halberd", "pike", "quarterstaff", "spear"];

export function isPolearm(weapon: string | undefined): boolean {
  const name = (weapon ?? "").trim().toLowerCase();
  return POLEARMS.some((polearm) => name.includes(polearm));
}

// Which feat grants this bonus-action weapon attack now, or null: Polearm
// Master's butt-end strike after an Attack action with a polearm, Crossbow
// Expert's hand crossbow shot after an Attack action with a one-handed
// weapon, Charger's melee attack after a Dash.
export function featBonusAttack(
  sheet: FeatHolder,
  budget: { oncePerTurn: string[]; dashed: boolean },
  attack: { weaponAttack: boolean; melee: boolean; weapon: string | undefined },
): string | null {
  if (!attack.weaponAttack) {
    return null;
  }
  if (attack.melee && holdsFeat(sheet, "Polearm Master") && budget.oncePerTurn.includes(POLEARM_READY) && isPolearm(attack.weapon)) {
    return "Polearm Master";
  }
  if (holdsFeat(sheet, "Crossbow Expert") && budget.oncePerTurn.includes(ONE_HANDED_ATTACKED) && /hand crossbow/i.test(attack.weapon ?? "")) {
    return "Crossbow Expert";
  }
  if (attack.melee && holdsFeat(sheet, "Charger") && budget.dashed) {
    return "Charger";
  }
  return null;
}

// What a sheet with one of these feats can be told when its bonus attack
// is refused.
export function featBonusAttackHint(sheet: FeatHolder): string {
  const hints: string[] = [];
  if (holdsFeat(sheet, "Polearm Master")) hints.push("Polearm Master's butt-end strike follows an Attack action with a glaive, halberd, pike, quarterstaff or spear.");
  if (holdsFeat(sheet, "Crossbow Expert")) hints.push("Crossbow Expert's hand crossbow shot follows an Attack action with a one-handed weapon, with a hand crossbow in hand.");
  if (holdsFeat(sheet, "Charger")) hints.push("Charger's bonus attack follows a Dash this turn.");
  return hints.length ? ` ${hints.join(" ")}` : "";
}

// Polearm Master's butt end: 1d4 bludgeoning with the weapon's modifier.
export function polearmButtDamage(damageExpression: string): string {
  const modifier = /([+-]\d+)$/.exec(damageExpression.replace(/\s+/g, ""))?.[1] ?? "";
  return `1d4${modifier}`;
}

// Mobile (and Level Up's Skirmisher): a creature attacked in melee this
// turn makes no opportunity attack against them for the rest of it.
export function evadesOpportunityAttacksAfterMelee(sheet: FeatHolder): string | null {
  if (holdsFeat(sheet, "Mobile")) {
    return "Mobile";
  }
  return (sheet.feats ?? []).some((feat) => feat.trim().toLowerCase() === "skirmisher") ? "Skirmisher" : null;
}

// Sentinel (and Level Up's Guarded Warrior): an opportunity attack that
// hits leaves the creature's speed at 0 for the turn, and a creature within
// 5 feet that attacks someone else draws a reaction attack.
export function hasSentinel(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Sentinel");
}

// Polearm Master: a creature entering the reach of the polearm provokes an
// opportunity attack too.
export function polearmReachOpportunity(sheet: FeatHolder, weapon: string | undefined): boolean {
  return holdsFeat(sheet, "Polearm Master") && isPolearm(weapon);
}

// Brutal Attack (Level Up): once a turn, a melee weapon's damage is rolled
// again and the better kept.
export function brutalAttackApplies(sheet: FeatHolder, attack: { weaponAttack: boolean; melee: boolean }, oncePerTurn: string[] | null): boolean {
  return holdsFeat(sheet, "Brutal Attack") && attack.weaponAttack && attack.melee && oncePerTurn !== null && !oncePerTurn.includes(BRUTAL_ATTACK_USED);
}

// Stunning Sniper (Tome of Heroes): a ranged weapon critical hit may stun
// the target until the start of the shooter's next turn instead of doubling
// the damage; the shooter says so before the roll (stunShot).
export function stunningSniperApplies(sheet: FeatHolder, attack: { weaponAttack: boolean; ranged: boolean }): boolean {
  return holdsFeat(sheet, "Stunning Sniper") && attack.weaponAttack && attack.ranged;
}

// Piercer, Slasher, Crusher: what a hit of the damage type leaves, once a
// turn, and what a critical hit of it adds.
export type DamageTypeFeat = "Piercer" | "Slasher" | "Crusher";
export function damageTypeFeat(sheet: FeatHolder, damageType: string | null | undefined): DamageTypeFeat | null {
  const type = (damageType ?? "").trim().toLowerCase();
  if (type === "piercing" && holdsFeat(sheet, "Piercer")) return "Piercer";
  if (type === "slashing" && holdsFeat(sheet, "Slasher")) return "Slasher";
  if (type === "bludgeoning" && holdsFeat(sheet, "Crusher")) return "Crusher";
  return null;
}

// Tavern Brawler (and Street Fighter): the unarmed strike deals 1d4, and a
// hit with an unarmed strike or an improvised weapon opens a bonus-action
// grapple.
export function brawlerUnarmed(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Tavern Brawler");
}

// The bonus-action route a feat opens for a take_action action: Tavern
// Brawler's grapple after its hit, Shield Master's shove after the Attack
// action with a shield, Charger's shove after a Dash.
export function featBonusRoute(
  sheet: FeatHolder,
  action: string,
  budget: { oncePerTurn: string[]; attacksMade: number; dashed: boolean } | null,
  shield: boolean,
): { feature: string; ki: number } | null {
  if (!budget) {
    return null;
  }
  if (action === "grapple" && holdsFeat(sheet, "Tavern Brawler") && budget.oncePerTurn.includes(TAVERN_GRAPPLE_READY)) {
    return { feature: "Tavern Brawler", ki: 0 };
  }
  if (action === "shove" && holdsFeat(sheet, "Shield Master") && budget.attacksMade > 0 && shield) {
    return { feature: "Shield Master", ki: 0 };
  }
  if (action === "shove" && holdsFeat(sheet, "Charger") && budget.dashed) {
    return { feature: "Charger", ki: 0 };
  }
  return null;
}

// Giant Foe (Tome of Heroes): a Small character's heavy weapon costs no
// disadvantage.
export function liftsSmallHeavyPenalty(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Giant Foe");
}

// Skulker (and Level Up's Stealth Expert): a ranged attack that misses
// does not reveal where they hide, and dim light costs their Perception
// nothing; they may hide while only lightly obscured.
export function hasSkulker(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Skulker");
}

// Actor (and Level Up's Thespian): advantage on Deception and Performance
// checks made while passing as someone else, read from the check's reason.
export function actorAdvantage(sheet: FeatHolder, skill: string, reason: string | undefined): boolean {
  return (
    holdsFeat(sheet, "Actor") &&
    (skill === "deception" || skill === "performance") &&
    /\bimperson|\bdisguis|\bpass(?:ing|es)? (?:yourself |themselves |herself |himself )?(?:off )?as\b|\bpretend|\bpos(?:e|ing) as\b|\bmimic|\bin character\b|\bsomeone else\b/i.test(reason ?? "")
  );
}

// What a feat adds to a skill check, read from the skill and the check's
// reason: Level Up's expertise die (+1d4) on the checks it names, and
// Tome of Heroes' advantages. Null when none applies.
export type CheckRider = { feat: string; die?: string; advantage?: boolean; expertise?: boolean; note: string };
export function featCheckRider(sheet: FeatHolder, skill: string, reason: string | undefined): CheckRider | null {
  const why = (reason ?? "").toLowerCase();
  const says = (pattern: RegExp) => pattern.test(why);
  if (holdsFeat(sheet, "Stalker") && skill === "survival" && says(/\btrack/)) {
    return { feat: "Stalker", advantage: true, note: "Stalker: advantage on Survival to track a creature seen in the last day" };
  }
  if (holdsFeat(sheet, "Forest Denizen") && (skill === "athletics" || skill === "acrobatics") && says(/\bescap|\bbreak free|\bgrappl|\brestrain/) && says(/\bvine|\bplant|\bvegetat|\broot|\bbeast|\bbranch|\bweb/)) {
    return { feat: "Forest Denizen", advantage: true, note: "Forest Denizen: advantage on escaping vegetation or a beast's hold" };
  }
  if (holdsFeat(sheet, "Floriographer") && (skill === "investigation" || skill === "insight") && says(/\bhidden|\bsecret|\bsubtle|\bsignal|\brune|\bcode|\bcipher|\bmessage/)) {
    return { feat: "Floriographer", advantage: true, note: "Floriographer: advantage to notice a hidden message of a visual kind" };
  }
  if (holdsFeat(sheet, "Combat Thievery") && skill === "sleight_of_hand") {
    return { feat: "Combat Thievery", die: "1d4", note: "Combat Thievery: an expertise die (+1d4) on Sleight of Hand" };
  }
  if (holdsFeat(sheet, "Empathic") && skill === "insight") {
    return { feat: "Empathic", die: "1d4", note: "Empathic: an expertise die (+1d4) on Insight against a creature" };
  }
  if (holdsFeat(sheet, "Surgical Combatant") && skill === "medicine" && says(/\bdiagnos|\btreat|\bwound|\bstabili|\bheal|\binjur/)) {
    return { feat: "Surgical Combatant", die: "1d4", note: "Surgical Combatant: an expertise die (+1d4) on Medicine to diagnose or treat" };
  }
  if (holdsFeat(sheet, "Monster Hunter") && ["arcana", "nature", "religion", "history", "survival"].includes(skill) && says(/\blore|\blegend|\bcreature|\bmonster|\bbeast|\bweakness|\bidentify/)) {
    return { feat: "Monster Hunter", die: "1d4", note: "Monster Hunter: an expertise die (+1d4) to learn a creature's legends and lore" };
  }
  if (holdsFeat(sheet, "Crafting Expert") && says(/\bcraft|\brepair|\bmaintain|\bforge|\bbrew|\bbuild/)) {
    return { feat: "Crafting Expert", die: "1d4", note: "Crafting Expert: an expertise die (+1d4) to craft, maintain or repair" };
  }
  if (holdsFeat(sheet, "Ace Driver") && says(/\bdriv|\bpilot|\bvehicle|\bwagon|\bcart|\bship|\bboat|\bsteer|\bhelm/)) {
    return { feat: "Ace Driver", die: "1d4", note: "Ace Driver: an expertise die (+1d4) to drive or pilot a vehicle" };
  }
  if (holdsFeat(sheet, "Giant Foe") && skill === "history" && says(/\bgiant|\bogre|\btroll|\bettin|\bcyclops|\bfirbolg|\bgoliath/)) {
    return { feat: "Giant Foe", expertise: true, note: "Giant Foe: counts as proficient with doubled proficiency on History about giants" };
  }
  return null;
}

// Diehard (Tome of Heroes): advantage on saving throws against effects
// that cause exhaustion, read from what the save is against.
export function diehardSaveAdvantage(sheet: FeatHolder, about: string): boolean {
  return holdsFeat(sheet, "Diehard") && /\bexhaust/i.test(about);
}

// Survivor (Level Up): Medicine checks to stabilize them have advantage.
export function survivorTended(target: FeatHolder): boolean {
  return holdsFeat(target, "Survivor");
}

// Tactical Support (Level Up): Help on an attack reaches a creature within
// 30 feet of the helper rather than 5.
export function helpReachTiles(sheet: FeatHolder): number {
  return holdsFeat(sheet, "Tactical Support") ? 6 : 1;
}

// The pick-list slots a feat opens (src/lib/srd/options.ts): Martial
// Adept's two maneuvers, Eldritch Adept's invocation, Metamagic Adept's two
// Metamagic options.
export function featOptionSlots(feats: string[] | undefined, kind: string, campaignId?: string): number {
  const held = (name: string) => (feats ?? []).some((feat) => featTwinOf(feat, campaignId) === name);
  if (kind === "maneuver" && held("martial adept")) return 2;
  if (kind === "invocation" && held("eldritch adept")) return 1;
  if (kind === "metamagic" && held("metamagic adept")) return 2;
  return 0;
}

// Inner Resilience (Tome of Heroes): three ki points, for Patient Defense
// and Step of the Wind, without the monk's own.
// Athlete: standing from prone costs 5 feet, climbing costs no extra.
export function climbsFreely(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Athlete");
}

export function standsCheaply(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Athlete");
}

// ---- dying, drinking, resting, armor ----

// Advantage on a death save: Tome of Heroes' Diehard on every one, Level
// Up's Survivor on the first one of a fall.
export function deathSaveFeat(sheet: FeatHolder, track: { successes: number; failures: number }): string | null {
  if (holdsFeat(sheet, "Diehard")) {
    return "Diehard";
  }
  if (holdsFeat(sheet, "Survivor") && track.successes + track.failures === 0) {
    return "Survivor";
  }
  return null;
}

// Rapid Drinker (Tal'Dorei): a potion is drunk as a bonus action.
export function drinksAsBonusAction(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Rapid Drinker");
}

// Poisoner: a weapon is coated as a bonus action, and poison damage the
// character deals ignores resistance to it.
export function coatsAsBonusAction(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Poisoner");
}

export function poisonerIgnoresResistance(sheet: FeatHolder, damageType: string | null | undefined): boolean {
  return holdsFeat(sheet, "Poisoner") && (damageType ?? "").trim().toLowerCase() === "poison";
}

// Chef: during a short rest, every creature that spends a Hit Die regains
// an extra 1d8 from the cook's meal.
export function chefRestDie(sheet: FeatHolder): string | null {
  return holdsFeat(sheet, "Chef") ? "d8" : null;
}

// What a feat does to the hit points a spent hit die heals: Durable floors
// each die at twice the Constitution modifier (at least 2); Level Up's
// Stalwart adds twice the modifier (at least 2) to each.
export function hitDieHealingFloor(sheet: FeatHolder, conMod: number): { feat: string; floor: number; extra: number } | null {
  const twice = Math.max(2, 2 * conMod);
  // Stalwart is not Durable's twin: it adds where Durable floors.
  if (holdsFeat(sheet, "Stalwart")) {
    return { feat: "Stalwart", floor: 0, extra: twice };
  }
  if (holdsFeat(sheet, "Durable")) {
    return { feat: "Durable", floor: twice, extra: 0 };
  }
  return null;
}

// Shield Master (and Level Up's Shield Focus): the shield's AC bonus goes
// on Dexterity saves against effects that target only the character, and a
// successful Dexterity save against such an effect costs the reaction to
// take no damage (cast-at-player.ts).
export function shieldMasterSaveBonus(sheet: FeatHolder & { equipment?: Array<{ name: string; equipped?: boolean }> }): number {
  if (!holdsFeat(sheet, "Shield Master")) {
    return 0;
  }
  const worn = (sheet.equipment ?? []).some((item) => /\bshield\b/i.test(item.name) && item.equipped !== false);
  return worn ? 2 : 0;
}

// Medium Armor Master (and Level Up's Medium Armor Expert): medium armor
// takes 3 of the Dexterity modifier rather than 2, and imposes no
// disadvantage on Stealth.
export function hasMediumArmorMaster(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Medium Armor Master");
}

// Spell Sniper: an attack-roll spell's range doubles and it ignores half
// and three-quarters cover.
export function spellIgnoresCover(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Spell Sniper");
}

export function spellRangeFactor(sheet: FeatHolder): number {
  return holdsFeat(sheet, "Spell Sniper") ? 2 : 1;
}

// Crossbow Expert and Gunner: a hostile creature within 5 feet imposes no
// disadvantage on ranged attack rolls, and the loading property is ignored.
export function shootsFreelyInMelee(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Crossbow Expert") || holdsFeat(sheet, "Gunner");
}

// ---- Elemental Adept ----

// The feature a feat's damage-type pick is written as on the sheet
// ("Elemental Adept: fire"), the way a draconic ancestry or a Spell Mastery
// pick is: the table's copy of a sheet keeps no featChoices.
const ELEMENT_FEATURE = /^elemental adept:\s*(acid|cold|fire|lightning|thunder)$/i;

export function elementalAdeptFeatureName(damageType: string): string {
  return `Elemental Adept: ${damageType.trim().toLowerCase()}`;
}

export function elementalAdeptFeatureOf(featureName: string): string | null {
  return ELEMENT_FEATURE.exec(featureName.trim())?.[1]?.toLowerCase() ?? null;
}

// The damage type the character's Elemental Adept names, or null: from the
// feature the sheet holds, or from the builder's picks before the sheet is
// made.
export function elementalAdeptType(sheet: ChoiceHolder): string | null {
  if (!holdsFeat(sheet, "Elemental Adept")) {
    return null;
  }
  for (const feature of sheet.features ?? []) {
    const element = elementalAdeptFeatureOf(feature.name);
    if (element) {
      return element;
    }
  }
  const picked = (sheet.featChoices?.["elemental adept"]?.damageType ?? "").trim().toLowerCase();
  return ELEMENTAL_ADEPT_TYPES.includes(picked) ? picked : null;
}

// Whether a spell's damage of this type gets the feat: resistance ignored
// and every 1 on its dice counted as a 2.
export function elementalAdeptApplies(sheet: ChoiceHolder, damageType: string | null | undefined): boolean {
  const adept = elementalAdeptType(sheet);
  return Boolean(adept && damageType && damageType.trim().toLowerCase() === adept);
}

// The dice expression with a floor of 2 on every die ("8d6+2" to
// "8d6f2+2"); a term that already carries a floor keeps the higher.
export function floorDamageDice(expression: string): string {
  return expression
    .split(/(?=[+-])/)
    .map((term) => {
      const match = /^([+-]?\d{1,3}d\d{1,3}(?:k[hl]\d{1,3})?(?:r\d{1,3})?)(?:f(\d{1,3}))?$/i.exec(term.trim());
      if (!match) {
        return term;
      }
      const floor = Math.max(2, Number(match[2] ?? 0));
      return `${match[1]}f${floor}`;
    })
    .join("");
}

// ---- reactions and traps ----

export function hasMageSlayer(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Mage Slayer");
}

export function hasDungeonDelver(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Dungeon Delver");
}

// Dungeon Delver: advantage to notice secret doors and traps, read from
// what the hidden thing is said to be.
export function dungeonDelverNotices(sheet: FeatHolder, about: string | undefined): boolean {
  return hasDungeonDelver(sheet) && /\btraps?\b|\b(?:secret|hidden|concealed) (?:door|passage|panel|compartment)s?\b/i.test(about ?? "");
}

// Defensive Duelist: wielding a finesse weapon the character is proficient
// with, the reaction adds the proficiency bonus to AC against one melee
// attack that hit. Null when the feat or the weapon is missing.
export function defensiveDuelistBonus(
  sheet: FeatHolder & { equipment?: Array<{ name: string; equipped?: boolean }>; proficiencies?: { weapons: string[] } },
  proficiencyBonus: number,
): number | null {
  if (!holdsFeat(sheet, "Defensive Duelist")) {
    return null;
  }
  const lower = (value: string) => value.trim().toLowerCase();
  const wielded = (sheet.equipment ?? []).some((item) => {
    if (item.equipped !== true) {
      return false;
    }
    const weapon = SRD_WEAPONS.find((entry) => lower(item.name).includes(lower(entry.name)));
    return Boolean(weapon?.properties?.includes("finesse"));
  });
  return wielded ? proficiencyBonus : null;
}

// The one-word tag the DM prompt hangs on a feat the server applies, so
// the model routes it through the right tool instead of narrating it.
export function featEngineTag(feat: string, campaignId?: string): string | null {
  const name = featTwinOf(feat, campaignId);
  if (["great weapon master", "sharpshooter", "powerful attacker", "deadeye"].includes(name)) return "[pc_attack powerAttack]";
  if (["defensive duelist", "mage slayer", "sentinel"].includes(name)) return "[use_reaction]";
  if (["polearm master", "crossbow expert", "charger"].includes(name)) return "[pc_attack bonusAttack feature]";
  if (name === "stunning sniper") return "[pc_attack stunShot]";
  if (["tavern brawler", "shield master"].includes(name)) return "[take_action bonus]";
  if ([
    "spell sniper", "elemental adept", "gunner", "crossbow expert", "dungeon delver", "war caster", "tough", "mobile", "heavy armor master",
    "alert", "observant", "lucky", "dual wielder", "resilient", "battle caster", "spellbreaker", "diehard", "survivor", "rapid drinker",
    "durable", "medium armor master", "skirmisher", "mobile", "brutal attack", "piercer", "slasher", "crusher", "giant foe", "skulker", "actor", "grappler",
  ].includes(name)) return "[server]";
  if (["fey touched", "shadow touched", "magic initiate", "ritual caster"].includes(name)) return "[cast tools]";
  return null;
}
