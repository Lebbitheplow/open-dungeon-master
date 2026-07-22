// What a named buff or effect condition actually DOES, as data.
//
// Conditions have always been the sheet's carrier for ongoing effects
// (raging, dodging, "bardic inspiration (d8)"), but every row of mechanics
// lived as hand-written special cases in condition-logic.ts. This registry
// generalizes the pattern: a condition name resolves to typed riders the
// engines read, so Bless is a real +1d4 on attack rolls and saves, Shield of
// Faith is a real +2 AC, and Starry Form's Archer is a real attack, applied
// by cast_buff / use_resource and enforced everywhere dice are rolled.
//
// Pure and dependency-light (like condition-logic.ts and feature-effects.ts)
// so scripts/test-condition-effects.mjs can exercise every branch. The SRD
// standard conditions (poisoned, restrained...) stay in condition-logic.ts;
// this table carries the named effects layered on top, and nothing here
// duplicates a name handled there.

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
  // condition afterwards (guidance, resistance, true strike, the smites).
  consumedBy?: "attack" | "save" | "check";
  // Advantage on the holder's own attack rolls (true strike).
  attackAdvantage?: boolean;
  // Damage resistances while the condition holds (blade ward, stoneskin).
  resistances?: string[];
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
  // Concentration saves cannot roll below this total (Starry Form: Dragon).
  concentrationFloor?: number;
  grantedAttack?: GrantedAttack;
};

// Druid level for Starry Form's die upgrade and similar leveled attacks is
// read from the holder's sheet level by the consumer; the table stores the
// steps.
export const CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    id: "blessed",
    match: ["blessed", "bless"],
    summary: "Bless: +1d4 on attack rolls and saving throws.",
    attackDie: "1d4",
    saveDie: "1d4",
  },
  {
    id: "baned",
    match: ["baned", "bane"],
    summary: "Bane: -1d4 on attack rolls and saving throws.",
    attackPenaltyDie: "1d4",
    savePenaltyDie: "1d4",
  },
  {
    id: "shield_of_faith",
    match: ["shield of faith"],
    summary: "Shield of Faith: +2 AC.",
    acBonus: 2,
  },
  {
    id: "shielded",
    match: ["shielded", "shield spell"],
    summary: "Shield: +5 AC until the start of their next turn.",
    acBonus: 5,
  },
  {
    id: "mage_armor",
    match: ["mage armor"],
    summary: "Mage Armor: base AC 13 + DEX while wearing no armor.",
    acBase: 13,
  },
  {
    id: "barkskin",
    match: ["barkskin"],
    summary: "Barkskin: AC cannot drop below 16.",
    acFloor: 16,
  },
  {
    id: "hasted",
    match: ["hasted", "haste"],
    summary:
      "Haste: +2 AC, advantage on DEX saves, doubled speed, and one extra action each turn (one weapon attack, Dash, Disengage, Hide, or Use an Object).",
    acBonus: 2,
    advantageOn: [{ kind: "save", ability: "dex" }],
    speedMultiplier: 2,
    extraAction: true,
  },
  {
    id: "polymorphed",
    match: ["polymorphed", "polymorph"],
    summary:
      "Polymorph: transformed into a beast; the form's stat block replaces their own (the server tracks it as a transformation), they cannot speak or cast, and damage past the form's hit points reverts them.",
  },
  {
    id: "slowed",
    match: ["slowed", "slow"],
    summary:
      "Slow: -2 AC and DEX saves, speed halved, no reactions, and an action OR a bonus action each turn, not both.",
    acBonus: -2,
    saveFlat: -2,
    saveFlatAbility: "dex",
    speedMultiplier: 0.5,
    noReactions: true,
  },
  {
    id: "blade_ward",
    match: ["blade ward", "blade-warded"],
    summary:
      "Blade Ward: resistance to bludgeoning, piercing, and slashing damage from weapon attacks until the end of their next turn.",
    resistances: ["bludgeoning", "piercing", "slashing"],
  },
  {
    id: "stoneskin",
    match: ["stoneskin"],
    summary: "Stoneskin: resistance to nonmagical bludgeoning, piercing, and slashing damage.",
    resistances: ["bludgeoning", "piercing", "slashing"],
  },
  {
    id: "blurred",
    match: ["blurred", "blur"],
    summary: "Blur: attack rolls against them are made at disadvantage unless the attacker sees through illusions.",
    attacksAgainstDisadvantage: true,
  },
  {
    id: "faerie_fire",
    match: ["faerie fire", "outlined in faerie fire"],
    summary: "Faerie Fire: attack rolls against them have advantage, and they cannot benefit from being invisible.",
    attacksAgainstAdvantage: true,
  },
  {
    id: "guidance",
    match: ["guidance", "guided"],
    summary: "Guidance: +1d4 on one ability check, then the spell ends.",
    checkDie: "1d4",
    consumedBy: "check",
  },
  {
    id: "resistance_spell",
    match: ["resistance (spell)", "spell resistance", "warded (resistance)"],
    summary: "Resistance: +1d4 on one saving throw, then the spell ends.",
    saveDie: "1d4",
    consumedBy: "save",
  },
  {
    id: "true_strike",
    match: ["true strike", "true-striking"],
    summary: "True Strike: advantage on their next attack roll against the target, then the spell ends.",
    attackAdvantage: true,
    consumedBy: "attack",
  },
  {
    id: "divine_favor",
    match: ["divine favor"],
    summary: "Divine Favor: weapon attacks deal +1d4 radiant damage.",
    onHitDice: { dice: "1d4", type: "radiant" },
  },
  {
    id: "hunters_mark",
    match: ["hunter's mark", "hunters mark"],
    summary:
      "Hunter's Mark: +1d6 weapon damage against the marked quarry, and advantage on Perception and Survival checks to find it.",
    onHitDice: { dice: "1d6", type: "" },
  },
  {
    id: "hexed_caster",
    match: ["hexing", "hex on"],
    summary:
      "Hex: attacks against the hexed target deal +1d6 necrotic damage, and it has disadvantage on checks with the chosen ability.",
    onHitDice: { dice: "1d6", type: "necrotic" },
  },
  {
    id: "enlarged",
    match: ["enlarged", "enlarge"],
    summary:
      "Enlarged: one size bigger, advantage on Strength checks and saves, and weapon attacks deal +1d4 damage.",
    advantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
    onHitDice: { dice: "1d4", type: "" },
  },
  {
    id: "reduced",
    match: ["reduced", "reduce"],
    summary:
      "Reduced: one size smaller, disadvantage on Strength checks and saves, and weapon attacks deal -1d4 damage.",
    disadvantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
    onHitDice: { dice: "-1d4", type: "" },
  },
  {
    id: "longstrider",
    match: ["longstrider"],
    summary: "Longstrider: +10 feet of speed.",
    speedBonus: 10,
  },
  {
    id: "protected",
    match: ["protected"],
    summary:
      "Protected: attack rolls against them are made at disadvantage until the start of their protector's next turn.",
    attacksAgainstDisadvantage: true,
  },
  {
    id: "heroism",
    match: ["heroism"],
    summary:
      "Heroism: immune to being frightened, and they gain temporary hit points equal to the caster's spellcasting modifier at the start of each of their turns.",
  },
  {
    id: "mirror_image",
    match: ["mirror image", "mirror images"],
    summary:
      "Mirror Image: three duplicates; an attack that would hit may strike a duplicate instead (d20: 6+ with three, 8+ with two, 11+ with one), destroying it.",
  },
  {
    id: "starry_form_archer",
    match: ["starry form: archer", "starry form (archer)"],
    summary:
      "Starry Form (Archer): as a bonus action, a luminous arrow strikes one enemy: a ranged spell attack for 1d8 + WIS radiant (2d8 at druid level 10). Resolve it with pc_attack, weapon 'Starry Form: Archer'.",
    grantedAttack: {
      name: "Starry Form: Archer",
      diceByLevel: [
        [1, "1d8"],
        [10, "2d8"],
      ],
      type: "radiant",
      abilityToDamage: true,
      ranged: true,
      bonusAction: true,
    },
  },
  {
    id: "starry_form_chalice",
    match: ["starry form: chalice", "starry form (chalice)"],
    summary:
      "Starry Form (Chalice): whenever they cast a healing spell with a slot, they or a creature within 30 feet also regains 1d8 + WIS hit points.",
  },
  {
    id: "starry_form_dragon",
    match: ["starry form: dragon", "starry form (dragon)"],
    summary:
      "Starry Form (Dragon): a concentration save or an Intelligence/Wisdom check treats a d20 roll of 9 or lower as a 10.",
    concentrationFloor: 10,
  },
  {
    id: "absorb_elements",
    match: ["absorb elements"],
    summary:
      "Absorb Elements: resistance to the absorbed damage type (named in the condition) until the start of their next turn, and their first melee hit next turn deals +1d6 of that type.",
    paramResistance: true,
  },
  {
    id: "armor_of_agathys",
    match: ["armor of agathys"],
    summary:
      "Armor of Agathys: while its temporary hit points last, a creature that hits them with a melee attack takes 5 cold damage per slot level (apply with damage_enemy).",
  },
  {
    id: "gift_of_alacrity",
    match: ["gift of alacrity"],
    summary: "Gift of Alacrity: +1d8 on initiative rolls.",
    initiativeDie: "1d8",
  },
  {
    id: "zephyr_strike",
    match: ["zephyr strike"],
    summary:
      "Zephyr Strike: their movement provokes no opportunity attacks; their next weapon attack has advantage and deals +1d8 force, then the charge is spent (the spell's speed burst rides that turn).",
    attackAdvantage: true,
    onHitDice: { dice: "1d8", type: "force" },
    consumedBy: "attack",
  },
  {
    id: "kinetic_jaunt",
    match: ["kinetic jaunt"],
    summary:
      "Kinetic Jaunt: +10 feet of speed, movement provokes no opportunity attacks, and they can move through other creatures' spaces.",
    speedBonus: 10,
  },
  {
    id: "warding_wind",
    match: ["warding wind"],
    summary:
      "Warding Wind: a 10-foot wind aura deafens those inside, is difficult terrain for others, and gives ranged weapon attacks into or out of it disadvantage.",
  },
  {
    id: "shadow_blade",
    match: ["shadow blade"],
    summary:
      "Shadow Blade: a conjured finesse blade dealing 2d8 psychic; attack with pc_attack, weapon 'Shadow Blade' (advantage against targets in dim light or darkness).",
    grantedAttack: {
      name: "Shadow Blade",
      diceByLevel: [[1, "2d8"]],
      type: "psychic",
      abilityToDamage: true,
      ranged: false,
      bonusAction: false,
    },
  },
  {
    id: "crusaders_mantle",
    match: ["crusader's mantle", "crusaders mantle"],
    summary: "Crusader's Mantle: their weapon attacks deal +1d4 radiant damage.",
    onHitDice: { dice: "1d4", type: "radiant" },
  },
  {
    id: "elemental_weapon",
    match: ["elemental weapon"],
    summary:
      "Elemental Weapon: the touched weapon is magical, +1 to attack rolls, and deals +1d4 of the chosen element.",
    attackDie: "1",
    onHitDice: { dice: "1d4", type: "" },
  },
  {
    id: "flame_arrows",
    match: ["flame arrows"],
    summary: "Flame Arrows: ammunition drawn from the quiver deals +1d6 fire damage on a hit (twelve pieces).",
    onHitDice: { dice: "1d6", type: "fire" },
  },
  {
    id: "spirit_shroud",
    match: ["spirit shroud"],
    summary:
      "Spirit Shroud: their hits within 10 feet deal +1d8 radiant, necrotic, or cold damage; enemies starting their turn nearby lose 10 feet of speed and cannot regain hit points.",
    onHitDice: { dice: "1d8", type: "radiant" },
  },
  {
    id: "thunderous_smite",
    match: ["thunderous smite"],
    summary:
      "Thunderous Smite: the next weapon hit deals +2d6 thunder and forces a STR save or the target is pushed 10 feet and knocked prone; the charge is spent on the swing.",
    onHitDice: { dice: "2d6", type: "thunder" },
    consumedBy: "attack",
  },
  {
    id: "wrathful_smite",
    match: ["wrathful smite"],
    summary:
      "Wrathful Smite: the next weapon hit deals +1d6 psychic and forces a WIS save or the target is frightened; the charge is spent on the swing.",
    onHitDice: { dice: "1d6", type: "psychic" },
    consumedBy: "attack",
  },
  {
    id: "searing_smite",
    match: ["searing smite"],
    summary:
      "Searing Smite: the next weapon hit deals +1d6 fire and ignites the target (1d6 fire at the start of its turns, CON save ends); the charge is spent on the swing.",
    onHitDice: { dice: "1d6", type: "fire" },
    consumedBy: "attack",
  },
  {
    id: "blinding_smite",
    match: ["blinding smite"],
    summary:
      "Blinding Smite: the next weapon hit deals +3d8 radiant and forces a CON save or the target is blinded; the charge is spent on the swing.",
    onHitDice: { dice: "3d8", type: "radiant" },
    consumedBy: "attack",
  },
  {
    id: "staggering_smite",
    match: ["staggering smite"],
    summary:
      "Staggering Smite: the next weapon hit deals +4d6 psychic and forces a WIS save or the target reels (disadvantage on attacks and checks, no reactions, for a turn); the charge is spent on the swing.",
    onHitDice: { dice: "4d6", type: "psychic" },
    consumedBy: "attack",
  },
  {
    id: "banishing_smite",
    match: ["banishing smite"],
    summary:
      "Banishing Smite: the next weapon hit deals +5d10 force, banishing the target if that leaves it at 50 HP or fewer; the charge is spent on the swing.",
    onHitDice: { dice: "5d10", type: "force" },
    consumedBy: "attack",
  },
  {
    id: "blazing_stride",
    match: ["blazing stride", "ashardalon's stride", "ashardalons stride"],
    summary:
      "Blazing Stride: +20 feet of speed, no opportunity attacks against them, and creatures they pass within 5 feet of take 1d6 fire damage (once each per turn; apply with damage_enemy).",
    speedBonus: 20,
  },
  {
    id: "aura_of_purity",
    match: ["aura of purity"],
    summary:
      "Aura of Purity: resistance to poison damage, immunity to disease, and advantage on saves against blinding, charm, deafness, fright, paralysis, poison, and stunning.",
    resistances: ["poison"],
  },
  {
    id: "guardian_primal_beast",
    match: ["guardian of nature: primal beast", "guardian of nature (primal beast)"],
    summary:
      "Guardian of Nature (Primal Beast): +10 feet of speed, 120-foot darkvision, advantage on Strength checks and saves, and attacks deal +1d6 force.",
    speedBonus: 10,
    advantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
    onHitDice: { dice: "1d6", type: "force" },
  },
  {
    id: "guardian_great_tree",
    match: ["guardian of nature: great tree", "guardian of nature (great tree)"],
    summary:
      "Guardian of Nature (Great Tree): advantage on Constitution saves and on Dexterity- and Wisdom-based attacks, and the ground within 15 feet is difficult terrain for enemies (the temporary hit points were granted at casting).",
    advantageOn: [{ kind: "save", ability: "con" }],
    attackAdvantage: true,
  },
  {
    id: "shadow_of_moil",
    match: ["shadow of moil"],
    summary:
      "Shadow of Moil: resistance to radiant damage, attacks against them are at disadvantage, and a melee hit against them costs the attacker 2d8 necrotic (apply with damage_enemy).",
    resistances: ["radiant"],
    attacksAgainstDisadvantage: true,
  },
  {
    id: "arcane_hand",
    match: ["arcane hand", "bigby's hand", "bigbys hand"],
    summary:
      "Arcane Hand: as a bonus action the hand strikes (Clenched Fist via pc_attack, weapon 'Arcane Hand', 4d8 force), shoves, grapples, or blocks.",
    grantedAttack: {
      name: "Arcane Hand",
      diceByLevel: [[1, "4d8"]],
      type: "force",
      abilityToDamage: false,
      ranged: false,
      bonusAction: true,
    },
  },
  {
    id: "circle_of_power",
    match: ["circle of power"],
    summary:
      "Circle of Power: advantage on saving throws against spells and magical effects, and a successful save for half damage means none instead.",
    advantageOn: [{ kind: "save" }],
  },
  {
    id: "far_step",
    match: ["far step"],
    summary: "Far Step: a bonus action teleports them up to 60 feet each turn.",
  },
  {
    id: "swift_quiver",
    match: ["swift quiver"],
    summary:
      "Swift Quiver: a bonus action makes two attacks with a weapon fed by the quiver (resolve each with pc_attack).",
  },
  {
    id: "holy_weapon",
    match: ["holy weapon"],
    summary:
      "Holy Weapon: the weapon is magical, sheds bright light, and deals +2d8 radiant on a hit; it can burst when the spell is ended early.",
    onHitDice: { dice: "2d8", type: "radiant" },
  },
  {
    id: "intellect_fortress",
    match: ["intellect fortress"],
    summary:
      "Intellect Fortress: resistance to psychic damage and advantage on Intelligence, Wisdom, and Charisma saving throws.",
    resistances: ["psychic"],
    advantageOn: [
      { kind: "save", ability: "int" },
      { kind: "save", ability: "wis" },
      { kind: "save", ability: "cha" },
    ],
  },
  {
    id: "platinum_shield",
    match: ["platinum shield", "fizban's platinum shield"],
    summary:
      "Platinum Shield: half cover (+2 AC), resistance to acid, cold, fire, lightning, and poison, and Evasion on Dexterity saves.",
    acBonus: 2,
    resistances: ["acid", "cold", "fire", "lightning", "poison"],
  },
  {
    id: "primordial_ward",
    match: ["primordial ward"],
    summary:
      "Primordial Ward: resistance to acid, cold, fire, lightning, and thunder damage; a reaction can trade it all for one turn of immunity to a triggering type.",
    resistances: ["acid", "cold", "fire", "lightning", "thunder"],
  },
  {
    id: "otherworldly_guise",
    match: ["otherworldly guise", "tasha's otherworldly guise"],
    summary:
      "Otherworldly Guise: immune to two damage types (fire/poison or radiant/necrotic), immune to charm and fright, flying 40 feet, spellcasting modifier added to AC, and two attacks per Attack action.",
  },
  {
    id: "arcane_transformation",
    match: ["arcane transformation", "tenser's transformation", "tensers transformation"],
    summary:
      "Arcane Transformation: advantage on weapon attacks, +2d12 force on weapon hits, an extra attack per Attack action, no spellcasting, and a CON save against exhaustion when it ends (the 50 temporary hit points were granted at casting).",
    attackAdvantage: true,
    onHitDice: { dice: "2d12", type: "force" },
  },
  {
    id: "crown_of_stars",
    match: ["crown of stars"],
    summary:
      "Crown of Stars: seven motes; a bonus action hurls one (pc_attack, weapon 'Crown of Stars', 4d12 radiant). Track spent motes in the narration.",
    grantedAttack: {
      name: "Crown of Stars",
      diceByLevel: [[1, "4d12"]],
      type: "radiant",
      abilityToDamage: false,
      ranged: true,
      bonusAction: true,
    },
  },
  {
    id: "blade_of_disaster",
    match: ["blade of disaster"],
    summary:
      "Blade of Disaster: a bonus action moves the rift-blade and makes two melee spell attacks (pc_attack, weapon 'Blade of Disaster', 4d12 force each; crits on 18+ and a crit triples the dice).",
    grantedAttack: {
      name: "Blade of Disaster",
      diceByLevel: [[1, "4d12"]],
      type: "force",
      abilityToDamage: false,
      ranged: false,
      bonusAction: true,
    },
  },
  {
    id: "sanctuary",
    match: ["sanctuary"],
    summary:
      "Sanctuary: a creature targeting them with an attack or harmful spell must first succeed on a Wisdom save or lose the attempt and pick elsewhere. Ends if the warded creature attacks or casts a harmful spell.",
  },
  {
    id: "expeditious_retreat",
    match: ["expeditious retreat"],
    summary: "Expeditious Retreat: they can Dash as a bonus action on each of their turns.",
  },
  {
    id: "flying",
    match: ["flying", "fly (spell)"],
    summary:
      "Flying: they can fly (the speed the granting effect states; 60 feet for the Fly spell). If the effect ends aloft, they fall.",
  },
  {
    id: "fighting_spirit",
    match: ["fighting spirit"],
    summary:
      "Fighting Spirit: advantage on their weapon attack rolls this turn (the temporary hit points were granted when it was spent).",
    attackAdvantage: true,
  },
  {
    id: "giants_might",
    match: ["giant's might", "giants might"],
    summary:
      "Giant's Might: Large, advantage on Strength checks and saves, and one weapon hit per turn deals +1d6 damage.",
    advantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
    onHitDice: { dice: "1d6", type: "" },
  },
  {
    id: "bladesong",
    match: ["bladesong"],
    summary:
      "Bladesong: AC increased by their Intelligence modifier, +10 feet of speed, advantage on Acrobatics, and a bonus on concentration saves. Ends if they wear medium/heavy armor or a shield, or use two hands on a weapon.",
    acBonusAbility: "int",
    speedBonus: 10,
  },
  {
    id: "tentacle_of_the_deep",
    match: ["tentacle of the deep"],
    summary:
      "Tentacle of the Deep: a bonus-action spectral tentacle strike (pc_attack, weapon 'Tentacle of the Deep', 1d8 cold); a hit also halves the target's speed until its next turn.",
    grantedAttack: {
      name: "Tentacle of the Deep",
      diceByLevel: [
        [1, "1d8"],
        [10, "2d8"],
      ],
      type: "cold",
      abilityToDamage: false,
      ranged: false,
      bonusAction: true,
    },
  },
  {
    id: "form_of_dread",
    match: ["form of dread"],
    summary:
      "Form of Dread: immune to being frightened, and once per turn a creature they hit must pass a WIS save or be frightened until their next turn (resolve via cast_at_enemy).",
  },
  {
    id: "spirit_totem_bear",
    match: ["spirit totem: bear", "spirit totem (bear)"],
    summary:
      "Spirit Totem (Bear): allies in the 30-foot aura got temporary hit points when it rose and have advantage on Strength checks and saves while inside.",
  },
  {
    id: "spirit_totem_hawk",
    match: ["spirit totem: hawk", "spirit totem (hawk)"],
    summary:
      "Spirit Totem (Hawk): the druid's reaction grants advantage on an attack against a creature in the aura; allies inside have advantage on Perception checks.",
  },
  {
    id: "spirit_totem_unicorn",
    match: ["spirit totem: unicorn", "spirit totem (unicorn)"],
    summary:
      "Spirit Totem (Unicorn): allies have advantage on checks to detect creatures in the aura, and the druid's healing spells also heal aura allies for the spell's level.",
  },
  {
    id: "trance_of_order",
    match: ["trance of order"],
    summary:
      "Trance of Order: attacks against them cannot have advantage, and their own attacks, checks, and saves treat a d20 roll of 9 or lower as a 10.",
  },
  {
    id: "aspect_of_the_wyrm_frighten",
    match: ["aspect of the wyrm: frighten", "aspect of the wyrm (frighten)"],
    summary:
      "Aspect of the Wyrm (Frighten): enemies starting their turn in the 10-foot aura must pass a WIS save or be frightened (resolve via cast_at_enemy).",
  },
  {
    id: "aspect_of_the_wyrm_ward",
    match: ["aspect of the wyrm: ward", "aspect of the wyrm (ward)"],
    summary:
      "Aspect of the Wyrm (Ward): allies in the 10-foot aura have resistance to the monk's chosen draconic damage type.",
  },
  {
    id: "protected_from_poison",
    match: ["protected from poison", "protection from poison"],
    summary:
      "Protection from Poison: resistance to poison damage and advantage on saves against being poisoned; one poison afflicting them is neutralized.",
    resistances: ["poison"],
  },
  {
    id: "false_life",
    match: ["false life"],
    summary: "False Life: bolstered by necromantic vigor (the temporary hit points were granted at casting).",
  },
  {
    id: "spiritual_weapon",
    match: ["spiritual weapon"],
    summary:
      "Spiritual Weapon: as a bonus action, the floating weapon strikes: a melee spell attack for 1d8 + spellcasting modifier force damage (+1d8 per two slot levels above 2nd). Resolve it with pc_attack, weapon 'Spiritual Weapon'.",
    grantedAttack: {
      name: "Spiritual Weapon",
      diceByLevel: [[1, "1d8"]],
      type: "force",
      abilityToDamage: true,
      ranged: false,
      bonusAction: true,
    },
  },
];

function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// The registry row a condition name resolves to, or null. Exact term or
// "term (" prefix, longest term winning, mirroring feature-effects.
export function conditionEffectsFor(conditionName: string): ConditionEffectRow | null {
  const name = normalize(conditionName);
  let best: ConditionEffectRow | null = null;
  let bestLength = -1;
  for (const row of CONDITION_EFFECTS) {
    for (const term of row.match) {
      if ((name === term || name.startsWith(`${term} `) || name.startsWith(`${term}(`) || name.startsWith(`${term} (`)) && term.length > bestLength) {
        best = row;
        bestLength = term.length;
      }
    }
  }
  return best;
}

// Every registry row active on a conditions list, with the sheet's exact
// condition string kept so consumers can clear consumed riders.
export function activeConditionEffects(
  conditions: string[],
): Array<{ row: ConditionEffectRow; condition: string }> {
  const out: Array<{ row: ConditionEffectRow; condition: string }> = [];
  for (const condition of conditions) {
    const row = conditionEffectsFor(condition);
    if (row) {
      out.push({ row, condition });
    }
  }
  return out;
}

// ---- Aggregators, one per consuming engine ----

export type ConditionAcRiders = {
  bonus: number;
  // Best alternative unarmored base (mage armor), or null.
  base: number | null;
  baseSource: string | null;
  floor: number;
  // Human-readable parts for the AC breakdown.
  parts: string[];
};

export function conditionAcRiders(
  conditions: string[],
  abilityMods?: Record<string, number>,
): ConditionAcRiders {
  const riders: ConditionAcRiders = { bonus: 0, base: null, baseSource: null, floor: 0, parts: [] };
  for (const { row, condition } of activeConditionEffects(conditions)) {
    if (row.acBonus) {
      riders.bonus += row.acBonus;
      riders.parts.push(`${condition} ${row.acBonus > 0 ? "+" : ""}${row.acBonus}`);
    }
    if (row.acBonusAbility) {
      const amount = Math.max(0, abilityMods?.[row.acBonusAbility] ?? 0);
      if (amount) {
        riders.bonus += amount;
        riders.parts.push(`${condition} +${amount}`);
      }
    }
    if (row.acBase && row.acBase > (riders.base ?? 0)) {
      riders.base = row.acBase;
      riders.baseSource = condition;
    }
    if (row.acFloor) {
      riders.floor = Math.max(riders.floor, row.acFloor);
    }
  }
  return riders;
}

export type RollRiderKind = "attack" | "save" | "check" | "initiative";

export type ConditionRollRiders = {
  // Dice/flat suffix for the d20 expression, e.g. "+1d4-1d4" or "-2".
  diceSuffix: string;
  advantageSources: Array<"advantage" | "disadvantage">;
  notes: string[];
  // Exact condition strings whose one-shot rider this roll spends; the
  // caller clears them (the Bardic Inspiration pattern).
  spent: string[];
};

// What the holder's conditions add to one of their own d20 rolls.
export function conditionRollRiders(
  conditions: string[],
  kind: RollRiderKind,
  ability?: SaveAbilityId,
): ConditionRollRiders {
  const riders: ConditionRollRiders = { diceSuffix: "", advantageSources: [], notes: [], spent: [] };
  for (const { row, condition } of activeConditionEffects(conditions)) {
    let used = false;
    if (kind === "attack") {
      if (row.attackDie) {
        riders.diceSuffix += `+${row.attackDie}`;
        riders.notes.push(`${condition}: +${row.attackDie} to the attack roll`);
        used = true;
      }
      if (row.attackPenaltyDie) {
        riders.diceSuffix += `-${row.attackPenaltyDie}`;
        riders.notes.push(`${condition}: -${row.attackPenaltyDie} to the attack roll`);
        used = true;
      }
      if (row.attackAdvantage) {
        riders.advantageSources.push("advantage");
        riders.notes.push(`${condition}: advantage on this attack`);
        used = true;
      }
      // A one-shot on-hit charge (the smites, Zephyr Strike) is spent by the
      // swing that carries it, hit or miss.
      if (row.onHitDice && row.consumedBy === "attack") {
        used = true;
      }
    }
    if (kind === "initiative" && row.initiativeDie) {
      riders.diceSuffix += `+${row.initiativeDie}`;
      riders.notes.push(`${condition}: +${row.initiativeDie} to initiative`);
      used = true;
    }
    if (kind === "save") {
      if (row.saveDie) {
        riders.diceSuffix += `+${row.saveDie}`;
        riders.notes.push(`${condition}: +${row.saveDie} to the save`);
        used = true;
      }
      if (row.savePenaltyDie) {
        riders.diceSuffix += `-${row.savePenaltyDie}`;
        riders.notes.push(`${condition}: -${row.savePenaltyDie} to the save`);
        used = true;
      }
      if (row.saveFlat && (!row.saveFlatAbility || row.saveFlatAbility === ability)) {
        riders.diceSuffix += row.saveFlat > 0 ? `+${row.saveFlat}` : `${row.saveFlat}`;
        riders.notes.push(
          `${condition}: ${row.saveFlat > 0 ? "+" : ""}${row.saveFlat} to ${
            row.saveFlatAbility ? `${row.saveFlatAbility.toUpperCase()} saves` : "saves"
          }`,
        );
        used = true;
      }
    }
    if (kind === "check" && row.checkDie) {
      riders.diceSuffix += `+${row.checkDie}`;
      riders.notes.push(`${condition}: +${row.checkDie} to the check`);
      used = true;
    }
    for (const grant of row.advantageOn ?? []) {
      if (matchesRollKind(grant, kind, ability)) {
        riders.advantageSources.push("advantage");
        riders.notes.push(`${condition}: advantage`);
      }
    }
    for (const grant of row.disadvantageOn ?? []) {
      if (matchesRollKind(grant, kind, ability)) {
        riders.advantageSources.push("disadvantage");
        riders.notes.push(`${condition}: disadvantage`);
      }
    }
    if (used && row.consumedBy === kind) {
      riders.spent.push(condition);
      riders.notes.push(`${condition} is spent by this roll`);
    }
  }
  return riders;
}

function matchesRollKind(
  grant: { kind: "save" | "check"; ability?: SaveAbilityId },
  kind: RollRiderKind,
  ability?: SaveAbilityId,
): boolean {
  if (grant.kind === "save" && kind !== "save") {
    return false;
  }
  if (grant.kind === "check" && kind !== "check") {
    return false;
  }
  return !grant.ability || grant.ability === ability;
}

// Extra on-hit damage dice the holder's conditions add to a landed attack.
// Positive dice are appended, a leading "-" subtracts. Types are advisory
// (the roll rides the attack's expression); notes carry them.
export function conditionOnHitDice(conditions: string[]): {
  suffix: string;
  notes: string[];
} {
  let suffix = "";
  const notes: string[] = [];
  for (const { row, condition } of activeConditionEffects(conditions)) {
    if (!row.onHitDice) {
      continue;
    }
    const { dice, type } = row.onHitDice;
    if (dice.startsWith("-")) {
      suffix += dice;
      notes.push(`${condition}: ${dice} damage`);
    } else {
      suffix += `+${dice}`;
      notes.push(`${condition}: +${dice}${type ? ` ${type}` : ""} damage`);
    }
  }
  return { suffix, notes };
}

// Attack-roll state granted by the TARGET's conditions (blur, faerie fire,
// protected). Merged by attackContext next to the SRD condition rules.
export function conditionIncomingAttackState(targetConditions: string[]): {
  sources: Array<"advantage" | "disadvantage">;
  notes: string[];
} {
  const sources: Array<"advantage" | "disadvantage"> = [];
  const notes: string[] = [];
  for (const { row, condition } of activeConditionEffects(targetConditions)) {
    if (row.attacksAgainstDisadvantage) {
      sources.push("disadvantage");
      notes.push(`target is ${condition}: disadvantage`);
    }
    if (row.attacksAgainstAdvantage) {
      sources.push("advantage");
      notes.push(`target is ${condition}: advantage`);
    }
  }
  return { sources, notes };
}

// Damage resistances the holder's conditions grant (blade ward, stoneskin).
// paramResistance rows read the type out of the condition name's
// parentheses: "absorb elements (fire)" grants fire resistance.
export function conditionResistances(conditions: string[]): string[] {
  const out: string[] = [];
  for (const { row, condition } of activeConditionEffects(conditions)) {
    if (row.resistances) {
      out.push(...row.resistances);
    }
    if (row.paramResistance) {
      const param = /\(([^)]+)\)/.exec(condition);
      if (param) {
        out.push(param[1].trim().toLowerCase());
      }
    }
  }
  return [...new Set(out)];
}

// Speed after condition riders: flat bonuses apply first, then the
// strongest multiplier (haste x2 beats longstrider stacking oddities).
export function conditionSpeed(conditions: string[], baseSpeed: number): number {
  let speed = baseSpeed;
  let multiplier = 1;
  for (const { row } of activeConditionEffects(conditions)) {
    if (row.speedBonus) {
      speed += row.speedBonus;
    }
    if (row.speedMultiplier !== undefined) {
      multiplier = row.speedMultiplier < 1
        ? Math.min(multiplier, row.speedMultiplier)
        : Math.max(multiplier, row.speedMultiplier);
    }
  }
  return Math.max(0, Math.floor(speed * multiplier));
}

// Extra actions per turn the holder's conditions grant (haste: 1).
export function conditionExtraActions(conditions: string[]): number {
  let extra = 0;
  for (const { row } of activeConditionEffects(conditions)) {
    if (row.extraAction) {
      extra += 1;
    }
  }
  return extra;
}

export function conditionBlocksReactions(conditions: string[]): string | null {
  for (const { row, condition } of activeConditionEffects(conditions)) {
    if (row.noReactions) {
      return condition;
    }
  }
  return null;
}

// The lowest total a concentration save can land on (Starry Form: Dragon
// floors it at 10), or 0 when nothing applies.
export function conditionConcentrationFloor(conditions: string[]): number {
  let floor = 0;
  for (const { row } of activeConditionEffects(conditions)) {
    if (row.concentrationFloor) {
      floor = Math.max(floor, row.concentrationFloor);
    }
  }
  return floor;
}

// Attack options the holder's conditions grant, resolved for pc_attack:
// the named term matches loosely so "starry form" or "archer" finds it.
export function grantedAttackFor(
  conditions: string[],
  term: string,
): { attack: GrantedAttack; condition: string } | null {
  const wanted = normalize(term);
  if (!wanted) {
    return null;
  }
  for (const { row, condition } of activeConditionEffects(conditions)) {
    const attack = row.grantedAttack;
    if (!attack) {
      continue;
    }
    const name = normalize(attack.name);
    if (
      name === wanted ||
      name.includes(wanted) ||
      wanted.includes(name) ||
      normalize(condition).includes(wanted)
    ) {
      return { attack, condition };
    }
  }
  return null;
}

// The granted attack's damage dice at a character level.
export function grantedAttackDice(attack: GrantedAttack, level: number): string {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  let dice = attack.diceByLevel[0]?.[1] ?? "1d8";
  for (const [atLevel, expression] of attack.diceByLevel) {
    if (clamped >= atLevel) {
      dice = expression;
    }
  }
  return dice;
}

// One-line summaries for every effect condition a sheet carries, for the DM
// prompt's GAME STATE block and tool results.
export function describeConditionEffects(conditions: string[]): string[] {
  return activeConditionEffects(conditions).map(({ row }) => row.summary);
}
