// What a feature on a character sheet actually DOES, as data.
//
// populateFeatures grants 182 distinct SRD feature names onto sheets plus
// everything the custom genre-class catalog adds. Before this table only the
// dozen entries in class-resources.ts had any server mechanics, so a rogue's
// Sneak Attack, a fighter's Extra Attack, and every fighting style were
// names on a sheet and nothing else. Each entry here declares typed effects
// the engines read, or an explicit `narrative` entry carrying the SRD line
// the model gets handed so it at least narrates the feature correctly.
//
// Pure and dependency-light (like class-resources.ts and condition-logic.ts)
// so scripts/test-feature-effects.mjs can exercise every branch.

export type FightingStyleId =
  | "archery"
  | "defense"
  | "dueling"
  | "great_weapon_fighting"
  | "protection"
  | "two_weapon_fighting";

export type FeatureEffect =
  // Flat armor class, e.g. the Defense fighting style while wearing armor.
  | { kind: "ac_bonus"; amount: number; requiresArmor?: boolean }
  // Flat to-hit, restricted to a kind of attack (Archery: ranged only).
  | { kind: "attack_bonus"; amount: number; when: "ranged" | "melee" }
  // Flat damage (Dueling: a one-handed melee weapon and no second weapon).
  | { kind: "damage_bonus"; amount: number; when: "one_handed_melee" }
  // Reroll damage dice landing at or below `below` (Great Weapon Fighting).
  | { kind: "damage_reroll"; below: number; when: "two_handed_melee" }
  // Attacks beyond the first when taking the Attack action.
  | { kind: "extra_attack"; attacks: number }
  // Rogue sneak-attack dice: ceil(level / 2) d6, once per turn.
  | { kind: "sneak_attack" }
  // Monk unarmed/monk-weapon die, and DEX in place of STR.
  | { kind: "martial_arts" }
  // Critical hits land on this natural roll and up (19 or 18).
  | { kind: "crit_range"; low: number }
  // Extra weapon damage dice on a critical hit.
  | { kind: "crit_dice"; dice: number | ((level: number) => number) }
  // The off-hand attack keeps its ability modifier on damage.
  | { kind: "two_weapon_ability" }
  // Paladin Divine Smite: a spell slot becomes radiant damage on a hit.
  | { kind: "smite" }
  // Bard Song of Rest: extra hit points for everyone who spends a hit die
  // on a short rest. Not limited-use, so it lives here rather than in the
  // resource table.
  | { kind: "song_of_rest"; die: (level: number) => string }
  // A flat bonus to all saving throws (Aura of Protection: +CHA, min +1).
  | { kind: "save_bonus"; ability: "cha"; min: number }
  // Advantage on saves of a given ability (Danger Sense: DEX).
  | { kind: "save_advantage"; ability: "str" | "dex" | "con" | "int" | "wis" | "cha" }
  // Evasion: a successful DEX save takes no damage, a failure takes half.
  | { kind: "evasion" }
  // Reliable Talent: any proficient ability check treats a d20 roll of 9 or
  // lower as a 10.
  | { kind: "reliable_talent" }
  // Flat initiative bonus (Alert feat: +5).
  | { kind: "initiative_bonus"; amount: number }
  // Flat passive Perception / Investigation bonus (Observant feat: +5).
  | { kind: "passive_bonus"; amount: number }
  // Walking speed, unarmored (Fast Movement, Unarmored Movement).
  | { kind: "speed_bonus"; amount: (level: number) => number; unarmoredOnly?: boolean }
  // No server-enforceable payload; `guidance` carries the SRD truth.
  | { kind: "narrative" };

export type FeatureDef = {
  // Lowercased feature names this entry answers to. A sheet's feature
  // matches when its name equals one of these or begins with one followed
  // by " (" so the numbered SRD variants ("Extra Attack (2)", "Action Surge
  // (1 use)") all land on the same entry.
  match: string[];
  // Restrict to specific classes when one feature name means different
  // things to different classes.
  classes?: string[];
  effects: FeatureEffect[];
  // Handed to the model whenever the feature comes up, so a feature with no
  // mechanical payload is still narrated as the SRD describes it.
  guidance?: string;
};

// Rogue sneak-attack dice by level: one d6 at 1st, another every two levels.
export function sneakAttackDice(level: number): number {
  return Math.max(1, Math.ceil(clampLevel(level) / 2));
}

// Monk unarmed strike / monk weapon die by level.
export function martialArtsDie(level: number): string {
  const clamped = clampLevel(level);
  if (clamped >= 17) return "d10";
  if (clamped >= 11) return "d8";
  if (clamped >= 5) return "d6";
  return "d4";
}

function clampLevel(level: number) {
  return Math.max(1, Math.min(20, Math.floor(level)));
}

export const FIGHTING_STYLES: Array<{
  id: FightingStyleId;
  name: string;
  description: string;
}> = [
  {
    id: "archery",
    name: "Archery",
    description: "+2 to attack rolls with ranged weapons.",
  },
  {
    id: "defense",
    name: "Defense",
    description: "+1 AC while wearing armor.",
  },
  {
    id: "dueling",
    name: "Dueling",
    description: "+2 damage with a one-handed melee weapon and no other weapon in hand.",
  },
  {
    id: "great_weapon_fighting",
    name: "Great Weapon Fighting",
    description: "Reroll 1s and 2s on damage with a two-handed or versatile melee weapon.",
  },
  {
    id: "protection",
    name: "Protection",
    description:
      "Reaction: impose disadvantage on an attack against an ally within 5 ft, using your shield.",
  },
  {
    id: "two_weapon_fighting",
    name: "Two-Weapon Fighting",
    description: "Add your ability modifier to the damage of your off-hand attack.",
  },
];

// A chosen fighting style lives on the sheet as a feature named
// "Fighting Style: Archery" with source "choice", which populateFeatures
// preserves across level-ups exactly like a feat. No new column needed.
export const FIGHTING_STYLE_PREFIX = "Fighting Style: ";

export function fightingStyleFeatureName(id: FightingStyleId): string {
  const style = FIGHTING_STYLES.find((entry) => entry.id === id);
  return `${FIGHTING_STYLE_PREFIX}${style?.name ?? id}`;
}

// Song of Rest's die by bard level. The SRD names the feature with its own
// die ("Song of Rest (d8)"), which is read first; this is the fallback for
// sheets whose entry lost the suffix.
export function songOfRestDie(level: number): string {
  const clamped = clampLevel(level);
  if (clamped >= 17) return "d12";
  if (clamped >= 13) return "d10";
  if (clamped >= 9) return "d8";
  return "d6";
}

// Feats live in sheet.feats, but they are named abilities like any other,
// so they resolve through the same table. defenseRiders and the derived
// stats read features AND feats together.
export const FEATURE_EFFECTS: FeatureDef[] = [
  {
    match: ["alert"],
    effects: [{ kind: "initiative_bonus", amount: 5 }],
    guidance: "Alert: +5 to initiative, and they cannot be surprised while conscious.",
  },
  {
    match: ["observant"],
    effects: [{ kind: "passive_bonus", amount: 5 }],
    guidance: "Observant: +5 to passive Perception and passive Investigation.",
  },
  {
    match: ["fighting style: archery"],
    effects: [{ kind: "attack_bonus", amount: 2, when: "ranged" }],
    guidance: "Archery: +2 on every ranged weapon attack roll. The server applies it.",
  },
  {
    match: ["fighting style: defense"],
    effects: [{ kind: "ac_bonus", amount: 1, requiresArmor: true }],
    guidance: "Defense: +1 AC while wearing armor. Already in their armor class.",
  },
  {
    match: ["fighting style: dueling"],
    effects: [{ kind: "damage_bonus", amount: 2, when: "one_handed_melee" }],
    guidance:
      "Dueling: +2 damage when wielding one melee weapon in one hand and nothing in the other. The server applies it.",
  },
  {
    match: ["fighting style: great weapon fighting"],
    effects: [{ kind: "damage_reroll", below: 2, when: "two_handed_melee" }],
    guidance:
      "Great Weapon Fighting: 1s and 2s on the damage dice of a two-handed or versatile melee weapon are rerolled once. The server rerolls them.",
  },
  {
    match: ["fighting style: protection"],
    effects: [{ kind: "narrative" }],
    guidance:
      "Protection: as a reaction, using a shield, impose disadvantage on an attack roll against an ally within 5 feet.",
  },
  {
    match: ["fighting style: two-weapon fighting"],
    effects: [{ kind: "two_weapon_ability" }],
    guidance:
      "Two-Weapon Fighting: the off-hand attack keeps its ability modifier on damage instead of losing it.",
  },
  {
    match: ["extra attack"],
    effects: [{ kind: "extra_attack", attacks: 1 }],
    guidance:
      "Extra Attack: they attack twice whenever they take the Attack action. Resolve each swing with its own pc_attack call.",
  },
  {
    match: ["extra attack (2)"],
    effects: [{ kind: "extra_attack", attacks: 2 }],
    guidance: "Extra Attack: three attacks per Attack action, one pc_attack call each.",
  },
  {
    match: ["extra attack (3)"],
    effects: [{ kind: "extra_attack", attacks: 3 }],
    guidance: "Extra Attack: four attacks per Attack action, one pc_attack call each.",
  },
  {
    match: ["sneak attack"],
    effects: [{ kind: "sneak_attack" }],
    guidance:
      "Sneak Attack: extra d6s once per turn on a finesse or ranged attack made with advantage, or while an ally is adjacent to the target and the attack is not at disadvantage. The server checks the conditions and adds the dice.",
  },
  {
    match: ["martial arts"],
    effects: [{ kind: "martial_arts" }],
    guidance:
      "Martial Arts: unarmed strikes and monk weapons use DEX and a growing damage die, with a bonus-action unarmed strike after the Attack action.",
  },
  {
    match: ["improved critical"],
    effects: [{ kind: "crit_range", low: 19 }],
    guidance: "Improved Critical: their weapon attacks crit on a natural 19 or 20.",
  },
  {
    match: ["superior critical"],
    effects: [{ kind: "crit_range", low: 18 }],
    guidance: "Superior Critical: their weapon attacks crit on a natural 18, 19, or 20.",
  },
  {
    match: ["brutal critical"],
    effects: [
      {
        kind: "crit_dice",
        dice: (level) => (level >= 17 ? 3 : level >= 13 ? 2 : 1),
      },
    ],
    guidance:
      "Brutal Critical: extra weapon damage dice on a critical hit. The server rolls them.",
  },
  {
    match: ["savage attacks"],
    effects: [{ kind: "crit_dice", dice: 1 }],
    guidance:
      "Savage Attacks: one extra weapon damage die on a critical melee hit. The server rolls it.",
  },
  {
    match: ["divine smite"],
    effects: [{ kind: "smite" }],
    guidance:
      "Divine Smite: after a melee weapon hit, spend a spell slot for 2d8 radiant damage, +1d8 per slot level above 1st and +1d8 against undead or fiends. Call pc_attack with smite set so the server spends the slot and rolls it.",
  },
  {
    match: ["song of rest"],
    effects: [{ kind: "song_of_rest", die: songOfRestDie }],
    guidance:
      "Song of Rest: at the end of a short rest, every friendly creature who spent at least one Hit Die regains an extra die of hit points from the bard's performance. It has no daily limit.",
  },
  {
    match: ["aura of protection"],
    effects: [{ kind: "save_bonus", ability: "cha", min: 1 }],
    guidance:
      "Aura of Protection: the paladin and every ally within 10 feet add the paladin's Charisma modifier (minimum +1) to their saving throws.",
  },
  {
    match: ["danger sense"],
    effects: [{ kind: "save_advantage", ability: "dex" }],
    guidance:
      "Danger Sense: advantage on Dexterity saving throws against effects they can see, such as traps and spells.",
  },
  {
    match: ["evasion"],
    effects: [{ kind: "evasion" }],
    guidance:
      "Evasion: on a Dexterity save for half damage they instead take none on a success and half on a failure. The server applies it.",
  },
  {
    // Recognized but not yet enforced in the dice engine (a floored d20 has
    // no expression form); the guidance keeps the model honest meanwhile.
    match: ["reliable talent"],
    effects: [{ kind: "reliable_talent" }],
    guidance:
      "Reliable Talent: for any ability check they are proficient in, a d20 roll of 9 or lower counts as a 10.",
  },
  {
    match: ["fast movement"],
    effects: [{ kind: "speed_bonus", amount: () => 10, unarmoredOnly: true }],
    guidance: "Fast Movement: +10 feet of speed while not wearing heavy armor.",
  },
  {
    match: ["unarmored movement", "unarmored movement improvement"],
    effects: [
      {
        kind: "speed_bonus",
        amount: (level) =>
          level >= 18 ? 30 : level >= 14 ? 25 : level >= 10 ? 20 : level >= 6 ? 15 : 10,
        unarmoredOnly: true,
      },
    ],
    guidance:
      "Unarmored Movement: extra speed while wearing no armor and no shield, and from 9th level they run up walls and across water.",
  },
];

function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Every effect a character's feature list grants, in table order. The
// longest matching entry wins per feature so "Extra Attack (2)" never also
// counts as a plain "Extra Attack".
export function effectsFor(input: {
  class: string;
  features: Array<{ name: string }>;
}): Array<{ def: FeatureDef; effect: FeatureEffect; feature: string }> {
  const wantedClass = normalize(input.class);
  const out: Array<{ def: FeatureDef; effect: FeatureEffect; feature: string }> = [];
  for (const feature of input.features) {
    const name = normalize(feature.name);
    const matches = FEATURE_EFFECTS.filter(
      (def) =>
        (!def.classes || def.classes.includes(wantedClass)) &&
        def.match.some((term) => name === term || name.startsWith(`${term} (`)),
    );
    // Prefer the most specific match: "extra attack (2)" over "extra attack".
    let best: FeatureDef | null = null;
    let bestLength = -1;
    for (const def of matches) {
      const length = Math.max(
        ...def.match.filter((term) => name === term || name.startsWith(`${term} (`)).map(
          (term) => term.length,
        ),
      );
      if (length > bestLength) {
        best = def;
        bestLength = length;
      }
    }
    if (best) {
      for (const effect of best.effects) {
        out.push({ def: best, effect, feature: feature.name });
      }
    }
  }
  return out;
}

// The SRD line for a feature, so a tool result never leaves the model
// guessing at what an ability it just spent actually does.
export function guidanceFor(input: {
  class: string;
  features: Array<{ name: string }>;
  feature: string;
}): string | null {
  const found = effectsFor({ class: input.class, features: [{ name: input.feature }] });
  return found[0]?.def.guidance ?? null;
}

// Everything the combat engines need off a character's feature list, in one
// resolved shape. pc-attack.ts and the AC engine read this instead of
// hunting through feature names themselves.
export type CombatRiders = {
  acBonus: number;
  acBonusRequiresArmor: boolean;
  rangedAttackBonus: number;
  meleeAttackBonus: number;
  oneHandedMeleeDamageBonus: number;
  // Reroll damage dice at or below this value on two-handed melee; 0 = none.
  greatWeaponRerollBelow: number;
  twoWeaponKeepsAbility: boolean;
  // Attacks beyond the first per Attack action.
  extraAttacks: number;
  sneakAttackDice: number;
  martialArtsDie: string | null;
  critRange: number;
  critExtraDice: number;
  canSmite: boolean;
  unarmoredSpeedBonus: number;
};

export function combatRiders(sheet: {
  class: string;
  level: number;
  features: Array<{ name: string }>;
}): CombatRiders {
  const level = clampLevel(sheet.level);
  const riders: CombatRiders = {
    acBonus: 0,
    acBonusRequiresArmor: false,
    rangedAttackBonus: 0,
    meleeAttackBonus: 0,
    oneHandedMeleeDamageBonus: 0,
    greatWeaponRerollBelow: 0,
    twoWeaponKeepsAbility: false,
    extraAttacks: 0,
    sneakAttackDice: 0,
    martialArtsDie: null,
    critRange: 20,
    critExtraDice: 0,
    canSmite: false,
    unarmoredSpeedBonus: 0,
  };
  for (const { effect } of effectsFor(sheet)) {
    switch (effect.kind) {
      case "ac_bonus":
        riders.acBonus += effect.amount;
        riders.acBonusRequiresArmor = riders.acBonusRequiresArmor || Boolean(effect.requiresArmor);
        break;
      case "attack_bonus":
        if (effect.when === "ranged") {
          riders.rangedAttackBonus += effect.amount;
        } else {
          riders.meleeAttackBonus += effect.amount;
        }
        break;
      case "damage_bonus":
        riders.oneHandedMeleeDamageBonus += effect.amount;
        break;
      case "damage_reroll":
        riders.greatWeaponRerollBelow = Math.max(riders.greatWeaponRerollBelow, effect.below);
        break;
      case "two_weapon_ability":
        riders.twoWeaponKeepsAbility = true;
        break;
      case "extra_attack":
        // The numbered variants replace rather than stack.
        riders.extraAttacks = Math.max(riders.extraAttacks, effect.attacks);
        break;
      case "sneak_attack":
        riders.sneakAttackDice = sneakAttackDice(level);
        break;
      case "martial_arts":
        riders.martialArtsDie = martialArtsDie(level);
        break;
      case "crit_range":
        riders.critRange = Math.min(riders.critRange, effect.low);
        break;
      case "crit_dice":
        riders.critExtraDice +=
          typeof effect.dice === "function" ? effect.dice(level) : effect.dice;
        break;
      case "smite":
        riders.canSmite = true;
        break;
      case "speed_bonus":
        riders.unarmoredSpeedBonus = Math.max(riders.unarmoredSpeedBonus, effect.amount(level));
        break;
      case "narrative":
        break;
    }
  }
  return riders;
}

// How many fighting styles the character has earned but not yet chosen.
// "Fighting Style" and "Additional Fighting Style" each grant one.
export function fightingStyleSlots(features: Array<{ name: string }>): number {
  return features.filter((feature) => {
    const name = normalize(feature.name);
    return name === "fighting style" || name === "additional fighting style";
  }).length;
}

export function chosenFightingStyles(features: Array<{ name: string }>): string[] {
  const prefix = normalize(FIGHTING_STYLE_PREFIX);
  return features
    .filter((feature) => normalize(feature.name).startsWith(prefix))
    .map((feature) => feature.name.slice(FIGHTING_STYLE_PREFIX.length).trim());
}


// The Song of Rest die a character contributes, or null when they have no
// such feature. The die rides in the SRD feature name ("Song of Rest (d8)")
// and falls back to the level table when it does not.
export function songOfRestDieFor(sheet: {
  class: string;
  level: number;
  features: Array<{ name: string }>;
}): string | null {
  for (const { effect, feature } of effectsFor(sheet)) {
    if (effect.kind !== "song_of_rest") {
      continue;
    }
    const named = /\((d\d{1,2})\)/.exec(feature);
    return named ? named[1].toLowerCase() : effect.die(sheet.level);
  }
  return null;
}

// Non-combat mechanical riders a character's features grant, resolved for
// the derived-stats, roll, and area-damage engines. Kept separate from
// combatRiders so each consumer reads only what it needs.
export type DefenseRiders = {
  // Flat bonus to every saving throw (Aura of Protection).
  saveBonus: number;
  // Abilities whose saves have advantage (Danger Sense: dex).
  saveAdvantage: Set<string>;
  // Evasion: a made Dexterity save takes no damage instead of half.
  evasion: boolean;
  // Reliable Talent: proficient ability checks floor a low d20 at 10.
  reliableTalent: boolean;
  // Flat adds from feats (Alert, Observant).
  initiativeBonus: number;
  passiveBonus: number;
};

export function defenseRiders(
  sheet: { class: string; level: number; features: Array<{ name: string }> },
  // Ability modifiers, so a CHA-scaled aura resolves to a real number. When
  // omitted the aura's minimum stands in.
  abilityMods?: Record<string, number>,
): DefenseRiders {
  const riders: DefenseRiders = {
    saveBonus: 0,
    saveAdvantage: new Set<string>(),
    evasion: false,
    reliableTalent: false,
    initiativeBonus: 0,
    passiveBonus: 0,
  };
  for (const { effect } of effectsFor(sheet)) {
    switch (effect.kind) {
      case "save_bonus":
        riders.saveBonus += Math.max(effect.min, abilityMods?.[effect.ability] ?? 0);
        break;
      case "save_advantage":
        riders.saveAdvantage.add(effect.ability);
        break;
      case "evasion":
        riders.evasion = true;
        break;
      case "reliable_talent":
        riders.reliableTalent = true;
        break;
      case "initiative_bonus":
        riders.initiativeBonus += effect.amount;
        break;
      case "passive_bonus":
        riders.passiveBonus += effect.amount;
        break;
      default:
        break;
    }
  }
  return riders;
}
