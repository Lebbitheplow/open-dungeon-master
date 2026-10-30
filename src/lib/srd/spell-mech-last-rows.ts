// The fourth set of SRD override rows (spell-mech-overrides.ts spreads them
// in last): the spells the last repair round gave an engine place. SRD 5.1
// as printed; a row replaces the parsed answer whole, and the dice still
// come from the spell's own text (or the baked manifest with no pack).

import type { SpellMech } from "@/lib/srd/spell-mech-types";

const MINUTE = 10;
const TEN_MINUTES = 100;
const HOUR = 600;

export const SRD_LAST_ROWS: Record<string, SpellMech> = {
  // Two damage types in one blast, each meeting its own resistance
  // (src/lib/dm/aoe-parts.ts).
  "meteor swarm": {
    resolution: "save", save: "dex", halfOnSave: true, damageType: "fire", secondType: "bludgeoning", area: true, areaFeet: 40,
  },
  "flame strike": {
    resolution: "save", save: "dex", halfOnSave: true, damageType: "fire", secondType: "radiant", area: true, areaFeet: 10,
  },
  "ice storm": {
    resolution: "save", save: "dex", halfOnSave: true, damageType: "bludgeoning", secondType: "cold", area: true, areaFeet: 20,
  },

  // Effects on the caster or an ally, each a condition of the registry
  // (src/lib/srd/condition-effects-last.ts) that the engine reads.
  "freedom of movement": { resolution: "buff", buff: { condition: "freedom of movement", target: "ally", rounds: HOUR } },
  "spider climb": { resolution: "buff", buff: { condition: "spider climb", target: "ally", rounds: HOUR } },
  "water walk": { resolution: "buff", buff: { condition: "water walk", target: "allies", rounds: HOUR } },
  jump: { resolution: "buff", buff: { condition: "jumping", target: "ally", rounds: MINUTE } },
  "see invisibility": { resolution: "buff", buff: { condition: "see invisibility", target: "self", rounds: HOUR } },
  "true seeing": { resolution: "buff", buff: { condition: "true seeing", target: "ally", rounds: HOUR } },
  blink: { resolution: "buff", buff: { condition: "blink", target: "self", rounds: MINUTE } },
  etherealness: {
    resolution: "buff",
    buff: { condition: "ethereal", target: "self", rounds: 8 * HOUR },
    note: "Up to eight hours; three more willing creatures per slot level above 7th (cast again for each).",
  },
  mislead: {
    resolution: "buff",
    buff: { condition: "invisible", target: "self", rounds: HOUR },
    note: "An illusory double appears where the caster stands; the invisibility ends if they attack or cast a spell.",
  },
  "wind walk": { resolution: "buff", buff: { condition: "wind walk", target: "allies", rounds: 8 * HOUR } },

  // Areas the board holds (src/lib/battlemap/zones-spells.ts); the spell
  // itself is cast with use_spell_slot at atX/atY.
  forcecage: {
    resolution: "utility",
    note: "The cage is laid on the battle map at atX/atY (else around the nearest creatures): no creature inside walks out, none outside walks in. Teleporting out takes a CHA save (the GM's to call).",
  },
  "contact other plane": {
    resolution: "utility",
    note: "The server rolls the caster's DC 15 INT save as the casting is paid: a failure is 6d6 psychic and insanity until a long rest. The five answers are the GM's.",
  },
  "antimagic field": {
    resolution: "utility",
    note: "The field moves with the caster on the battle map: no spell is cast inside it and none from outside affects a creature in it. Magic items, summoned creatures and other spells' areas inside are suppressed; narrate them.",
  },
  "antilife shell": {
    resolution: "utility",
    note: "The barrier moves with the caster on the battle map: no creature but an undead or a construct passes it or reaches through it in melee.",
  },

  // Beast forms through Polymorph's machinery (src/lib/srd/shape-rules.ts);
  // `variant` names the beast.
  "animal shapes": {
    resolution: "buff",
    buff: { condition: "polymorphed", target: "allies", rounds: 24 * HOUR },
    note: "Each willing creature takes a Large or smaller beast form of CR 4 or lower (variant), keeping its Intelligence, Wisdom and Charisma; damage past the form's hit points returns it to its own.",
  },
  shapechange: {
    resolution: "buff",
    buff: { condition: "polymorphed", target: "self", rounds: HOUR },
    note: "The caster takes the form (variant) of any creature of CR up to their level that is not a construct or an undead and that they have seen, without its Spellcasting or legendary actions, keeping their Intelligence, Wisdom, Charisma and proficiencies.",
  },
  // A creature into another creature; at an enemy it is cast_at_enemy or
  // cast_buff with targetEnemyId (src/lib/dm/enemy-polymorph.ts).
  "true polymorph": {
    resolution: "buff",
    buff: { condition: "polymorphed", target: "ally", rounds: HOUR },
    note: "The target becomes any creature (variant) of CR up to its level, its whole stat block, mind included. Concentration; held the full hour, it lasts until dispelled.",
  },

  // Saves whose failure takes a creature out of the fight, or out of its
  // spells.
  feeblemind: {
    resolution: "save", save: "int", halfOnSave: false, damageType: "psychic",
    condition: { name: "feebleminded" },
    riders: { damageIgnoresSave: true },
  },
  imprisonment: {
    resolution: "save", save: "wis", noDamage: true,
    condition: { name: "imprisoned" },
    note: "The chosen prison (burial, chaining, hedged prison, minimus containment, slumber) is the caster's to narrate; the creature is out of the fight until the spell is dispelled.",
  },
  maze: {
    resolution: "save", save: "int", noDamage: true,
    condition: { name: "mazed", noInitialSave: true, rounds: TEN_MINUTES, escape: ["int"], escapeDc: 20 },
  },
  "calm emotions": {
    resolution: "save", save: "cha", noDamage: true, area: true, areaFeet: 20, targetTypes: ["humanoid"],
    condition: { name: "calmed", rounds: MINUTE, endsOnDamage: true },
    note: "The other choice, suppressing charm and fear on the creatures in the area, is the caster's to narrate.",
  },
  // Divine Word's tiers (spell-mech-tail-rows.ts) and its return of the
  // extraplanar.
  "divine word": {
    resolution: "save", save: "cha", area: true, areaFeet: 30, noDamage: true,
    riders: {
      hpTiers: [
        { atMost: 20, conditions: [], dies: true },
        { atMost: 30, conditions: ["blinded", "deafened", "stunned"], rounds: HOUR },
        { atMost: 40, conditions: ["deafened", "blinded"], rounds: TEN_MINUTES },
        { atMost: 50, conditions: ["deafened"], rounds: MINUTE },
      ],
      returnsHome: ["celestial", "elemental", "fey", "fiend"],
    },
    note: "By its hit points on a failed save: 20 or fewer killed, 30 or fewer blinded, deafened and stunned for an hour, 40 or fewer deafened and blinded for 10 minutes, 50 or fewer deafened for a minute; a celestial, elemental, fey or fiend that fails is sent home and leaves the fight. The server applies it.",
  },
  // Prismatic Spray: a ray per creature (src/lib/dm/prismatic.ts rolls them);
  // the indigo ray's hold is a row of its own so the end-of-turn saves find
  // it (spell-turn-end.ts).
  "prismatic spray": {
    resolution: "save", save: "dex", halfOnSave: true, area: true, areaFeet: 60, noDamage: true,
    note: "Each creature caught rolls a d8 for its ray (the server rolls): 1-5 10d6 fire, acid, lightning, poison or cold (half on a made DEX save); 6 indigo, restrained and petrified after three failed CON saves; 7 violet, blinded and sent to another plane on a failed WIS save at the caster's next turn; 8 two rays.",
  },
  "indigo ray": {
    resolution: "save", save: "con", noDamage: true,
    condition: { name: "restrained", turnEnd: { baseLevel: 7, tally: { fails: 3, becomes: "petrified" } } },
  },
  // Irresistible Dance: no round-wrap save; "as an action, a dancing
  // creature makes a Wisdom saving throw" (take_action escape,
  // src/lib/dm/spell-escape.ts).
  "irresistible dance": {
    resolution: "save", save: "wis", noDamage: true, immuneIfImmuneTo: "charmed",
    condition: { name: "dancing", rounds: MINUTE, noInitialSave: true, escapeSave: "wis" },
    note: "No save when cast; the dancer dances in place (no movement), and may spend its action on a WIS save to stop (take_action escape). Creatures immune to being charmed are immune.",
  },
  fear: {
    resolution: "save", save: "wis", noDamage: true, area: true, areaFeet: 30,
    condition: { name: "frightened", rounds: MINUTE, also: ["fleeing"] },
    note: "A frightened creature drops what it holds and must Dash away each turn; it saves again only when it ends a turn out of the caster's sight.",
  },

  // Areas whose text the prose parser does not read as one (issue #570,
  // SPL-02). SRD 5.1, Areas of Effect: an area spell "affects multiple
  // creatures at once", so one casting holds everyone it catches. The pack
  // prints Shatter's "10-foot-radius" with soft hyphens and Lightning Bolt's
  // line as "a line 100 feet long"; the walls catch "each creature within its
  // area" and the storm "each creature under the cloud".
  shatter: { resolution: "save", save: "con", halfOnSave: true, damageType: "thunder", area: true, areaFeet: 10 },
  "lightning bolt": { resolution: "save", save: "dex", halfOnSave: true, damageType: "lightning", area: true, areaFeet: 100 },
  "wind wall": { resolution: "save", save: "str", halfOnSave: true, damageType: "bludgeoning", area: true, areaFeet: 50 },
  // "When the wall appears ... 7d8 piercing damage, or half as much damage on
  // a successful save"; "both types of damage increase by 1d8 for each slot
  // level above 6th" (SPL-04). Entering it later is the zone's 7d8 slashing
  // (src/lib/battlemap/zones-spells.ts).
  "wall of thorns": {
    resolution: "save", save: "dex", halfOnSave: true, damageType: "piercing", area: true, areaFeet: 60,
    dice: { base: "7d8", perSlotLevel: "1d8", baseLevel: 6 },
  },
  // "On a failed save, a creature takes 2d6 thunder damage and becomes
  // deafened for 5 minutes" (SPL-06): no half on a success (the half the text
  // prints is round 3's lightning), and five minutes, not the spell's one.
  "storm of vengeance": {
    resolution: "save", save: "con", halfOnSave: false, damageType: "thunder", area: true, areaFeet: 360,
    condition: { name: "deafened", rounds: 5 * MINUTE },
    note: "The cloud's first round. On each later turn of the caster's concentration: round 2, 1d6 acid to each creature under it; round 3, six bolts, DEX save against 10d6 lightning (half on a success); round 4, 2d6 bludgeoning hail to each; rounds 5 to 10, 1d6 cold to each, difficult terrain, heavily obscured. The GM rolls the later rounds; no slot.",
  },
  // A creature that moves within 20 feet of the wall or starts its turn
  // there "must succeed on a Constitution saving throw or become blinded for
  // 1 minute" (SPL-06, SPL-07): no damage and no repeat save. The layers'
  // DEX saves, each with its own effect, are for a creature passing through.
  "prismatic wall": {
    resolution: "save", save: "con", noDamage: true, area: true, areaFeet: 20,
    condition: { name: "blinded", rounds: MINUTE },
    note: "The CON save is for a creature that moves within 20 feet of the wall or starts its turn there. One reaching into or passing through it makes a DEX save at each layer, red to violet: 10d6 fire, acid, lightning, poison, cold (half on a success), indigo restrained then petrified, violet blinded and sent to another plane. The GM runs the layers.",
  },
};
