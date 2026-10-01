// The shape of one row of the condition effects registry
// (src/lib/srd/condition-effects.ts): what a named buff or effect condition
// does, as typed riders the engines read. Kept apart so the registry and the
// row files that spread into it (condition-effects-tail.ts, -last.ts,
// -spells.ts) share one type without loading each other.

export type SaveAbilityId = "str" | "dex" | "con" | "int" | "wis" | "cha";

// An attack option a condition grants its holder (Starry Form's Archer,
// Spiritual Weapon). Resolved by pc_attack when the model names it as the
// weapon; to-hit is the sheet's spell attack bonus and the ability modifier
// rides the damage.
export type GrantedAttack = {
  name: string;
  // Damage dice by character level, ascending [level, dice] pairs; the last
  // row at or below the level wins. A single ["1", "1d8"] row is flat.
  diceByLevel: Array<[number, string]>;
  type: string;
  // Casting-ability modifier added to the damage roll.
  abilityToDamage: boolean;
  ranged: boolean;
  bonusAction: boolean;
  // Cast from a higher slot: `dice` more for every `every` slot levels above
  // `baseLevel` (Spiritual Weapon: 1d8 per two levels above 2nd).
  upcast?: { baseLevel: number; every: number; dice: string };
};

export type ConditionEffectRow = {
  id: string;
  // Lowercased names this row answers to. A condition matches when it equals
  // a term or begins with one followed by " (" so parameterized forms
  // ("hunter's mark (goblin)") land on the same row.
  match: string[];
  // One line of rules text for tool results and roll notes.
  summary: string;
  // Flat armor class change (shield of faith +2, haste +2, slow -2).
  acBonus?: number;
  // AC bonus equal to an ability modifier, minimum 0 (Bladesong: +INT).
  acBonusAbility?: SaveAbilityId;
  // Alternative unarmored base AC, full DEX applies (mage armor 13).
  acBase?: number;
  // AC can never sit below this while the condition holds (barkskin 16).
  acFloor?: number;
  // Dice added to the holder's attack rolls / saving throws (bless "1d4").
  attackDie?: string;
  saveDie?: string;
  // A flat bonus to the holder's attack rolls carried in the condition's
  // name, "(+3)": Sacred Weapon's Charisma modifier, fixed when it is used.
  paramAttackBonus?: boolean;
  // Dice subtracted from the holder's attack rolls / saves (bane "1d4").
  attackPenaltyDie?: string;
  savePenaltyDie?: string;
  // Dice added to the holder's ability and skill checks (guidance "1d4").
  checkDie?: string;
  // Flat save modifier, optionally restricted to one ability (slow: -2 DEX).
  saveFlat?: number;
  saveFlatAbility?: SaveAbilityId;
  // Dice added to the holder's initiative rolls (gift of alacrity "1d8").
  initiativeDie?: string;
  // The rider is spent by its first qualifying roll; the engine clears the
  // condition afterwards (guidance, resistance, true strike, zephyr strike).
  // "hit": spent by the first attack that hits, a miss keeps it (the smites:
  // "the next time you hit").
  consumedBy?: "attack" | "save" | "check" | "hit";
  // Advantage on the holder's own attack rolls (true strike).
  attackAdvantage?: boolean;
  // Damage resistances while the condition holds (blade ward, stoneskin).
  resistances?: string[];
  // The resistances cover nonmagical attacks only (Stoneskin): a spell or a
  // magic weapon goes through them.
  nonmagicalOnly?: boolean;
  // The resistance type rides in the condition name's parentheses:
  // "absorb elements (fire)" grants fire resistance.
  paramResistance?: boolean;
  // Advantage / disadvantage on the holder's saves or checks, optionally
  // per-ability (haste: advantage on DEX saves; enlarged: advantage on STR).
  advantageOn?: Array<{ kind: "save" | "check"; ability?: SaveAbilityId }>;
  disadvantageOn?: Array<{ kind: "save" | "check"; ability?: SaveAbilityId }>;
  // Attack rolls AGAINST the holder are made at disadvantage (blur,
  // protected) or advantage (faerie fire).
  attacksAgainstDisadvantage?: boolean;
  attacksAgainstAdvantage?: boolean;
  // Attack rolls against the holder by creatures of these types only are
  // made at disadvantage (Protection from Evil and Good).
  attacksAgainstDisadvantageFrom?: string[];
  // A flat bonus to the holder's checks with one skill (Pass without Trace:
  // +10 Stealth).
  skillBonus?: { skill: string; bonus: number };
  // Movement changes (longstrider +10, haste x2, slow x0.5).
  speedBonus?: number;
  speedMultiplier?: number;
  // One extra action per turn, usable for one weapon attack, Dash,
  // Disengage, Hide, or Use an Object (haste).
  extraAction?: boolean;
  // The holder cannot take reactions (slow).
  noReactions?: boolean;
  // Extra dice the holder's weapon and spell attacks deal on a hit
  // (divine favor +1d4 radiant, hunter's mark +1d6 of the weapon's type,
  // enlarged +1d4). `type` "" = the attack's own damage type. A leading "-"
  // subtracts (reduced).
  onHitDice?: { dice: string; type: string };
  // onHitDice rides weapon attacks only, never a spell attack or a granted
  // one (Divine Favor, Hunter's Mark, Enlarge, the smites).
  weaponOnly?: boolean;
  // onHitDice rides hits on one creature only, the one the caster marked
  // (Hunter's Mark, Hex): conditionMeta.quarry holds its enemyId.
  marksTarget?: boolean;
  // Held by the TARGET: the next attack roll against it spends it (Guiding
  // Bolt's advantage).
  consumedAgainst?: boolean;
  // Concentration saves cannot roll below this total (Starry Form: Dragon).
  concentrationFloor?: number;
  grantedAttack?: GrantedAttack;
  // The holder's own attack rolls are made at disadvantage (Vicious
  // Mockery's sting, Eyebite's sickness, a hand on red-hot metal).
  attackDisadvantage?: boolean;
  // The holder takes no action on its turn (Stinking Cloud's retching,
  // Command's Halt): read by the action guards (src/lib/dm/can-act.ts).
  noAction?: boolean;
  // Conditions the holder cannot be given while this holds (Heroism:
  // frightened), and damage types that do nothing to it (Heroes' Feast:
  // poison).
  conditionImmunities?: string[];
  damageImmunities?: string[];
  // Conditions creatures of these types cannot lay on the holder
  // (Protection from Evil and Good: no charm or fear from a fiend).
  conditionImmunitiesFrom?: { types: string[]; conditions: string[] };
  // Death saving throws are made with advantage (Beacon of Hope).
  deathSaveAdvantage?: boolean;
  // The holder's weapon strikes are magical (Magic Weapon, Shillelagh).
  magicalStrikes?: boolean;
  // The holder cannot cast spells, or cannot attack (Gaseous Form).
  noCasting?: boolean;
  noAttacks?: boolean;
  // Nothing outside can reach the holder: no attack or spell targets it
  // (Resilient Sphere).
  untargetable?: boolean;
  // The holder sees invisible creatures (See Invisibility, True Seeing), and
  // has truesight this far (src/lib/srd/condition-effects-last.ts).
  seesInvisible?: boolean;
  truesightFeet?: number;
  // The holder's jump distances are multiplied (Jump: tripled).
  jumpMultiplier?: number;
  // The holder's speed is this, whatever it was (Gaseous Form's 10-foot
  // flight, Wind Walk's 300).
  speedSet?: number;
};
