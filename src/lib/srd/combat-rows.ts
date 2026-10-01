// The condition rows and feature counters the combat follow-ups added
// (src/lib/dm/attack-onhit.ts, combat-features.ts, spell-attack-riders.ts),
// spread into the one registry of each (src/lib/srd/condition-effects.ts,
// src/lib/srd/class-resources.ts). Kept apart so neither file grows; the
// types are imported as types only, so the files do not load each other.

import type { ResourceDef } from "@/lib/srd/class-resources";
import type { ConditionEffectRow } from "@/lib/srd/condition-effects";

export const COMBAT_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    id: "open_hand_reeling",
    match: ["no reactions (open hand)"],
    summary: "Open Hand Technique: it cannot take reactions until the end of the monk's next turn.",
    noReactions: true,
  },
  {
    id: "hurled_through_hell",
    match: ["hurled through hell"],
    summary:
      "Hurl Through Hell: gone through the lower planes until the end of the warlock's next turn; it returns to its space and, unless a fiend, takes 10d10 psychic damage.",
  },
  {
    id: "undead_dread",
    match: ["undead dread (chill touch)"],
    summary: "Chill Touch: this undead has disadvantage on attack rolls against the caster until the end of the caster's next turn.",
  },
  {
    id: "poisoned_weapon",
    match: ["poisoned weapon"],
    summary:
      "Basic poison: the next creature their slashing or piercing weapon hits makes a DC 10 Constitution save or takes 1d4 poison damage.",
  },
  {
    id: "shrugged_off_presence",
    match: ["unmoved by intimidating presence"],
    summary: "It saw through the barbarian's Intimidating Presence and cannot be frightened by it again for 24 hours.",
  },
  {
    id: "squeezing",
    match: ["squeezing"],
    summary:
      "Squeezing through a space one size too small: its attack rolls and Dexterity saves are at disadvantage, and attack rolls against it have advantage.",
    attackDisadvantage: true,
    attacksAgainstAdvantage: true,
    disadvantageOn: [{ kind: "save", ability: "dex" }],
  },
  {
    id: "holy_nimbus",
    match: ["holy nimbus"],
    summary:
      "Holy Nimbus: bright light for 30 feet; an enemy starting its turn in it takes 10 radiant damage, and the paladin has advantage on saves against spells cast by fiends or undead.",
  },
  // The final recount's SRD features (src/lib/dm/srd-feature-spends.ts).
  {
    id: "camouflaged",
    match: ["camouflaged"],
    summary: "Hide in Plain Sight: +10 to Dexterity (Stealth) checks while the ranger stays still against the surface they blend into.",
    skillBonus: { skill: "stealth", bonus: 10 },
  },
  {
    id: "peerless_skill",
    match: ["peerless skill"],
    summary: "Peerless Skill: the bard's own Bardic Inspiration die rides their next ability check.",
  },
  {
    id: "quivering_palm",
    match: ["quivering palm"],
    summary: "Quivering Palm: the monk's vibrations wait in this creature; their action ends them with a CON save, 0 hit points on a failure.",
  },
];

export const COMBAT_RESOURCE_DEFS: ResourceDef[] = [
  {
    id: "holy_nimbus",
    classIds: ["paladin"],
    match: ["holy nimbus"],
    exact: true,
    displayName: "Holy Nimbus",
    maxFor: () => 1,
    recharge: "long",
    action: "action",
    effect: { kind: "narrative" },
    guidance:
      "An action: bright light for 30 feet for a minute. Each enemy that starts its turn in it takes 10 radiant damage (the server deals it), and the paladin has advantage on saves against spells cast by fiends or undead.",
  },
  {
    id: "divine_intervention",
    classIds: ["cleric"],
    grantedBy: ["cleric"],
    match: ["divine intervention"],
    exact: true,
    displayName: "Divine Intervention",
    maxFor: () => 1,
    recharge: "long",
    action: "action",
    effect: { kind: "narrative" },
    guidance:
      "An action: the server rolls percentile dice; at or under the cleric's level (always at 20th) the deity intervenes, and the feature is then unusable for 7 days. On a failure it comes back on a long rest.",
  },
];
