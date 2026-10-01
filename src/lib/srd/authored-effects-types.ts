// The shapes of the authored subclass layer's engine hooks
// (src/lib/srd/authored-effects.ts). Kept apart from the data and the readers
// so both data files and every reader import the same words without a cycle.

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

// A number or dice that grow with the level of the class that granted the
// feature: a plain expression ("2d6", "level", "half + cha"), a ladder of
// [class level, value] rows where the last row reached wins, or a function
// of the level and the ability modifiers.
export type Formula =
  | string
  | Array<[number, string]>
  | ((level: number, mods: Record<string, number>) => string | number);

// When an effect holds. Every named test must pass.
export type Gate = {
  // The holder is raging (the rage condition, not in heavy armor).
  raging?: boolean;
  // The holder wears heavy armor.
  heavyArmor?: boolean;
  // The holder is concentrating on a spell.
  concentrating?: boolean;
  // The holder has (or has not) a condition, by name or "name (" prefix.
  condition?: string;
  notCondition?: string;
  // The option chosen for this feature ("Totem Spirit (Bear)"), or for
  // another feature of the same sheet ("Armor Model (Guardian)").
  choice?: string;
  choiceOf?: { feature: string; value: string };
};

type Base = { gate?: Gate; note?: string };

// Passive effects, each read by one engine (AUTHORED_READERS names where).
export type AuthoredEffect = Base &
  (
    // Damage resistance. `spells`: only to damage from spells.
    | { kind: "resist"; types: string[] | "all"; except?: string[]; nonmagical?: boolean; spells?: boolean }
    | { kind: "immune_damage"; types: string[] }
    | { kind: "immune_condition"; conditions: string[] }
    // Advantage on a save: against what the save resists (a pattern over
    // the roll's `against`), or every save of an ability.
    | { kind: "save_adv"; against?: string; ability?: Ability }
    | { kind: "save_prof"; abilities: Ability[] }
    | { kind: "save_bonus"; amount: number }
    // A save of one ability uses another ability's modifier when higher.
    | { kind: "save_swap"; save: Ability; use: Ability }
    | { kind: "ac"; amount: number }
    // Walking speed, through feature-effects' speed_bonus.
    | { kind: "speed"; amount: number }
    // Other movement modes: a number of feet, or "walk" for the walking speed.
    | { kind: "move"; fly?: number | "walk"; swim?: number | "walk" }
    | { kind: "init_adv" }
    | { kind: "init_ability"; ability: Ability }
    // Advantage on checks: named skills, or checks of an ability whose
    // reason matches a pattern ("push|pull|lift").
    | { kind: "check_adv"; skills?: string[]; abilities?: Ability[]; reason?: string }
    // A critical hit against the holder is a normal hit.
    | { kind: "crit_immune" }
    // The holder's damage of these types ignores resistance.
    | { kind: "ignore_resist"; types: string[] }
    // Attacks against the holder by creatures of these types are at
    // disadvantage.
    | { kind: "attacked_disadv"; from: string[] }
    // The holder's attacks have advantage: against a creature that has not
    // taken a turn in the fight yet, against one the holder frightened,
    // against one the holder distracted, or against creatures of these types.
    | { kind: "attack_adv"; vs: "not_acted" | "frightened_by_self" | "distracted" | "types"; types?: string[] }
    | { kind: "auto_crit"; vs: "surprised" }
    // Rolling initiative with none of this counter left gives one back.
    | { kind: "init_refill"; resource: string }
    // A creature within 5 feet of the holder drops to 0: temporary HP.
    | { kind: "kill_temp_hp"; formula: Formula }
    // An enemy dying within range: the most hurt ally in reach regains HP
    // equal to its Hit Dice (Keeper of Souls), once a turn.
    | { kind: "death_heal"; rangeFt: number }
    // Hit points at the start or end of the holder's turn in a fight.
    | { kind: "turn_heal"; when: "start" | "end"; formula: Formula; belowHalf?: boolean }
    // Temporary HP after every rest, for the holder and up to `count` allies.
    | { kind: "rest_temp_hp"; formula: Formula; allies?: { count: number; formula: Formula } }
    // Extra damage dice on the holder's weapon hits (feature-effects rider).
    | {
        kind: "rider";
        dice: Formula;
        type: string;
        when: "weapon" | "melee" | "ranged";
        oncePerTurn?: boolean;
        requiresCondition?: string;
      }
    // A weapon hit marks the creature: it attacks anyone but the holder at
    // disadvantage (halving that damage when `halve`), or attacks against it
    // have advantage, or its next save against the holder is at disadvantage.
    | {
        kind: "mark";
        condition: string;
        effect: "disadv_others" | "attacked_adv" | "save_disadv" | "ally_bonus_dice";
        melee?: boolean;
        oncePerTurn?: boolean;
        firstRoundOnly?: boolean;
        halve?: boolean;
        dice?: string;
        damageType?: string;
      }
    // A creature within 5 feet of the raging holder attacks anyone but the
    // holder at disadvantage (Totemic Attunement: Bear).
    | { kind: "guard_aura"; rangeFt: number }
    // Allies' melee attacks against a creature within 5 feet of the holder
    // have advantage (Totem Spirit: Wolf).
    | { kind: "pack_adv"; rangeFt: number }
    // An action taken as a bonus action.
    | { kind: "bonus_route"; action: "dash" | "disengage" | "hide" | "dodge" | "help" | "search" }
    // A bonus-action weapon attack after something this turn.
    | { kind: "bonus_attack"; after: "spell" | "cantrip" | "attack" | "telekinesis" }
    // Enemies save at disadvantage: when the holder casting is hidden from
    // them, when they carry the holder's mark, or when they stand within
    // range of the holder (a spell's save, any caster when `anyCaster`).
    | { kind: "enemy_save"; when: "hidden" | "marked" | "near"; mark?: string; rangeFt?: number; anyCaster?: boolean }
    // Allies in range (and the holder) resist: spell damage, or the damage
    // type the holder's own condition names.
    | {
        kind: "aura_resist";
        rangeFt: number | Array<[number, number]>;
        spells?: boolean;
        typeFrom?: { condition: string; map: Record<string, string> };
      }
    // A creature that hits the holder takes damage back.
    | { kind: "retaliate"; formula: Formula | "half_dealt"; type: string }
    // Enemies starting their turn near the holder take damage (Aura of
    // Conquest: only frightened ones).
    | { kind: "enemy_turn_damage"; formula: Formula; type: string; rangeFt: number | Array<[number, number]>; frightenedOnly?: boolean }
    // Flurry of Blows grants this many strikes instead of two.
    | { kind: "flurry"; strikes: number }
    // Sneak Attack with no advantage and no ally when the rogue duels one
    // creature alone (Rakish Audacity).
    | { kind: "sneak_duel" }
    // A healing spell on a creature at 0 hit points heals the maximum
    // (Circle of Mortality).
    | { kind: "heal_max" }
    // ---- the final round's hooks (src/lib/srd/authored-effects-more.ts) ----
    // A weapon the feature itself is (Form of the Beast's bite, claws and
    // tail, the Soulknife's psychic blade, Radiant Sun Bolt): pc_attack names
    // it as the weapon, proficient, with the ability a weapon of its kind
    // uses. `second` is the die of the bonus-action second attack (the
    // psychic blade's off-hand blade); `onHit` a rider of its own.
    | {
        kind: "natural_weapon";
        weapon: NaturalWeapon;
      }
    // Melee weapon reach grows by this many 5-foot squares (Demiurgic
    // Colossus while raging).
    | { kind: "reach"; tiles: number }
    // Sneak Attack gains dice against a creature the holder marked
    // (Eye for Weakness: 3d6 against the Insightful Fighting target).
    | { kind: "sneak_bonus"; dice: number; mark: string }
    // A die added to the holder's saves against the effects of a creature
    // they marked (Supernatural Defense against Slayer's Prey).
    | { kind: "save_die_vs"; die: string; mark: string }
    // Dice added to one damage (or healing) roll of the holder's spells
    // (Enhanced Bond while the wildfire spirit is out; Arcane Firearm through
    // a wand, staff or rod).
    | {
        kind: "spell_rider";
        dice: Formula;
        damageTypes?: string[];
        healing?: boolean;
        classes?: string[];
        item?: string;
      }
    // Casting the spell gives temporary hit points, and damage never breaks
    // the concentration on it (Grasping Tentacles).
    | { kind: "concentration_guard"; spell: string; tempHp: Formula }
    // A single-target spell of the school and level range strikes a second
    // creature within 5 feet of the first (Improved Reaper), at the cost the
    // authored text names in hit points per spell level.
    | { kind: "twin_spell"; school: string; maxLevel: number; costPerLevel: string }
    // pc_attack rapidStrike: an attack with advantage forgoes it for one more
    // attack of the action, once a turn (Rapid Strike).
    | { kind: "rapid_strike" }
    // An opportunity attack on every other creature's turn, each with its own
    // reaction (Vigilant Defender).
    | { kind: "oa_each_turn" }
    // Standing up from prone costs this many feet of movement (Tipsy Sway).
    | { kind: "stand_cost"; feet: number }
    // The holder's Bardic Inspiration die carries a mote that bursts when the
    // die is spent (Mote of Potential).
    | { kind: "mote" }
    // The swarm's push knocks the moved creature prone (Mighty Swarm).
    | { kind: "swarm_prone" }
    // The School of Abjuration's ward: hit points that take the wizard's
    // damage first (src/lib/dm/arcane-ward.ts).
    | { kind: "arcane_ward" }
    // What the holder summons with a conjuration spell arrives with these
    // temporary hit points (Durable Summons, src/lib/dm/summon-cast.ts).
    | { kind: "summon_temp_hp"; amount: number; school: string }
    // The steel defender grows sturdier: its armor class rises by this much
    // (Improved Defender, src/lib/dm/summon-defender.ts).
    | { kind: "defender_upgrade"; ac: number }
  );

export type NaturalWeapon = {
  name: string;
  aliases?: string[];
  dice: Formula;
  type: string;
  // Ranged (Radiant Sun Bolt), finesse (the psychic blade: the better of STR
  // and DEX), a reach of 10 feet (the tail), thrown with its range.
  ranged?: boolean;
  finesse?: boolean;
  reach?: boolean;
  thrown?: boolean;
  light?: boolean;
  rangeFt?: number;
  longRangeFt?: number;
  // The die of the bonus-action second attack, when the feature grants one.
  second?: string;
  // The bite: a hit while below half hit points heals the proficiency bonus,
  // once a turn. The claws: one more claw attack in the Attack action, once a
  // turn.
  onHit?: "bite_heal";
  extraAttack?: boolean;
};

export type AuthoredEffectKind = AuthoredEffect["kind"];

// What a use_resource call on the feature does (src/lib/dm/authored-spends.ts).
export type SpendDoes =
  // A condition on the holder, an ally (targetCharacterId), the named enemy
  // (targetEnemyId), or allies in range. `variants` maps a variant word to
  // the condition written; `tempHp` rides along.
  // The condition may name "{bardic}" (the bard's inspiration die) or
  // "{units}" (what the call spent), or step with the class level.
  | {
      kind: "buff";
      condition: string | Array<[number, string]>;
      rounds: number;
      target?: "self" | "ally" | "enemy" | "allies";
      variants?: Record<string, string>;
      tempHp?: Formula;
      rangeFt?: number;
      count?: Formula;
      teleportFeet?: number;
      // A mark laid on the named creature beside the holder's own condition
      // (Slayer's Prey: the prey Supernatural Defense reads).
      mark?: string;
      // The spend's own burst (Arms of the Astral Self, Avenging Angel).
      burst?: { save: Ability; dcAbility: Ability | "spell"; rangeFt: number; dice?: Formula; type?: string; condition?: string; rounds?: number };
    }
  // Choose an option for the feature, outside a fight: the feature is
  // renamed "Feature (Option)", which the passive effects read.
  | { kind: "choose"; options: string[] }
  // One enemy saves or suffers: damage (per unit spent when `perUnit`),
  // a condition, or a note on movement the DM makes on the board.
  | {
      kind: "save_effect";
      save: Ability;
      dcAbility: Ability | "spell";
      dice?: Formula;
      perUnit?: string;
      type?: string;
      half?: boolean;
      condition?: string;
      rounds?: number;
      rangeFt?: number;
      onFail?: string;
      typeFromVariant?: string[];
    }
  | { kind: "reroll_save" }
  // Temporary hit points: to the holder, or to allies in range.
  | { kind: "temp_hp"; formula: Formula; allies?: { rangeFt: number; count: Formula } }
  // An area the model resolves with aoe_damage: the dice, save and DC.
  | { kind: "aoe_report"; dice: Formula; perUnit?: string; baseUnits?: number; save: Ability; dcAbility: Ability | "spell"; type: string; area: string }
  | { kind: "teleport"; feet: number; note?: string }
  // Dice of damage onto the creature the holder just hit.
  | { kind: "die_damage"; dice: Formula; type: string }
  // Blade Flourish: the Bardic Inspiration die onto the hit, and AC for a
  // defensive flourish.
  | { kind: "flourish" }
  // Storm Aura's three environments.
  | { kind: "storm_aura" }
  // Cauterizing Flames: heal an ally or burn an enemy.
  | { kind: "flames"; formula: Formula; type: string }
  // A variant word picks one of several spends.
  | { kind: "variants"; options: Record<string, { does: SpendDoes; action?: SpendAction }> }
  // Insightful Fighting: an Insight check against the creature's Deception.
  | { kind: "insight_contest"; condition: string; rounds: number }
  // Gathered Swarm's push: after the holder's hit this turn, the creature hit
  // makes a STR save or is moved 15 feet (Mighty Swarm: and knocked prone);
  // it takes the swarm's once-a-turn place of the damage.
  | { kind: "swarm_push"; feet: number }
  // A creature the feature makes, as an ally with its stat block (the steel
  // defender, src/lib/dm/summon-defender.ts).
  | { kind: "summon"; form: string };

export type SpendAction = "action" | "bonus" | "reaction" | "none";

export type AuthoredSpend = {
  // The resource name use_resource sends (and other names it answers to).
  name: string;
  aliases?: string[];
  // A counter this spend uses: its own authored counter, or a shared pool
  // (ki, bardic_inspiration, sorcery_points, wild_shape...). `perUnit`: the
  // call's amount is what is spent (Touch of the Long Death's ki); `optional`
  // lets a call spend none.
  pool?: { id: string; amount?: number; perUnit?: boolean; max?: number; optional?: boolean; fallback?: string };
  action?: SpendAction;
  gate?: Gate;
  // Once per rage and similar: a marker condition the spend leaves.
  oncePer?: { marker: string; rounds: number };
  oncePerTurn?: boolean;
  // The turn key oncePerTurn claims, when the spend shares its once-a-turn
  // with a rider (Gathered Swarm's push and its damage: "rider:gathered swarm").
  onceKey?: string;
  // Chosen outside a fight only, or only in one.
  fight?: "in" | "out";
  does: SpendDoes;
};

// What a use_reaction call on the feature does (src/lib/dm/authored-reactions.ts).
export type ReactionDoes =
  // Less damage from the last hit on the holder or an ally in range.
  // "ward": the holder's Arcane Ward takes what it can (Projected Ward).
  | { kind: "reduce"; amount: Formula | "half" | "slot5" | "psionic_int" | "ward"; who: "self" | "ally" | "either"; rangeFt?: number; types?: string[] }
  // A bonus to AC (or the Bardic Inspiration die) against the last hit.
  | { kind: "ac_vs_hit"; amount: number | "bardic" }
  // The attack that hit is rolled again at disadvantage.
  | { kind: "disadv_vs_hit" }
  // Resistance to the last hit's damage when it is one of these types.
  | { kind: "resist_instance"; types: string[]; who: "either"; rangeFt: number }
  // The holder takes the hit an ally in range took.
  | { kind: "take_for_ally"; rangeFt: number | Array<[number, number]> }
  // Damage back at a creature: the attacker, or the named enemy.
  | {
      kind: "strike_back";
      amount: Formula;
      type: string;
      melee?: boolean;
      rangeFt?: number;
      save?: { ability: Ability; dcAbility: Ability | "spell"; half?: boolean; onFail?: string; damageRegardless?: boolean };
    }
  // One weapon attack with the reaction (the holder's own, or an ally's
  // when the feature belongs to someone else in the party).
  | { kind: "attack"; rangeFt: number; onHitCondition?: { name: string; rounds: number } }
  // The creature saves or gains a condition (Beguiling Defenses, Raging Storm).
  | { kind: "save_condition"; save: Ability; dcAbility: Ability | "spell"; condition: string; rounds?: number; variants?: Record<string, string> }
  // The holder gains a condition (Tokens of the Departed's soul trinket).
  | { kind: "gain_condition"; condition: string; rounds: number }
  // The attack's die is lowered by a die (Bend Luck).
  | { kind: "attack_penalty"; die: string }
  // The last hit on the holder lands on the creature beside them instead.
  | { kind: "redirect" }
  // The last hit is declared a miss, for a level of exhaustion.
  | { kind: "force_miss"; exhaustion: number }
  // A move off the holder's turn, up to half their speed, drawing no
  // opportunity attack: when an enemy stands within 5 feet (Skirmisher), or
  // right after the holder's opportunity attack hit, as part of that same
  // reaction (Relentless Avenger: `free`, the reaction already spent).
  | { kind: "move"; trigger: "enemy_adjacent" | "oa_hit"; free?: boolean }
  // A melee attack that missed the holder hits another creature within 5
  // feet of them instead (Tipsy Sway).
  | { kind: "redirect_miss"; rangeFt: number };

export type AuthoredReaction = {
  name: string;
  aliases?: string[];
  gate?: Gate;
  pool?: { id: string; amount?: number } | { slot: true };
  // Who takes the reaction: the feature's holder (default), a creature
  // holding the holder's Bardic Inspiration, or any ally of the holder.
  usedBy?: "holder" | "inspired" | "party";
  does: ReactionDoes;
};

export type AuthoredEntry = {
  subclass: string;
  effects?: AuthoredEffect[];
  spends?: AuthoredSpend[];
  reactions?: AuthoredReaction[];
  // The counter authored-resources.json holds for it, when the feature is
  // limited-use as well.
  counter?: string;
  // Pure roleplay or information, or a mechanic an engine outside this
  // layer must hold first: said why, never left blank.
  narrated?: string;
};
