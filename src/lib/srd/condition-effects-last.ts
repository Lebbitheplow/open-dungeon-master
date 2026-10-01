// The conditions the last spell rows lay (src/lib/srd/spell-mech-last-rows.ts),
// as rows of the one registry (src/lib/srd/condition-effects.ts spreads them
// in). SRD 5.1 as printed; the type is imported as a type only, so the two
// files do not load each other.

import type { ConditionEffectRow } from "@/lib/srd/condition-effects";

export const LAST_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    id: "blink",
    match: ["blink"],
    summary: "Blink: at the end of each of their turns the server rolls a d20; on 11 or higher they vanish to the Ethereal Plane until the start of their next turn.",
  },
  {
    id: "blinked",
    match: ["blinked", "blinked away"],
    summary: "Blinked away: on the Ethereal Plane until the start of their next turn; nothing on the Material Plane can attack or target them.",
    untargetable: true,
    noAttacks: true,
  },
  {
    id: "ethereal",
    match: ["ethereal", "etherealness"],
    summary: "Etherealness: on the Border Ethereal; they cannot affect or be affected by creatures on the Material Plane (no attacks either way).",
    untargetable: true,
    noAttacks: true,
  },
  {
    id: "see_invisibility",
    match: ["see invisibility"],
    summary: "See Invisibility: they see invisible creatures as if they were visible.",
    seesInvisible: true,
  },
  {
    id: "true_seeing",
    match: ["true seeing"],
    summary: "True Seeing: truesight 120 feet: they see invisible creatures and into magical darkness.",
    seesInvisible: true,
    truesightFeet: 120,
  },
  {
    id: "feebleminded",
    match: ["feebleminded", "feeblemind"],
    summary: "Feeblemind: Intelligence and Charisma are 1; the creature cannot cast spells, activate magic items, understand language or communicate.",
    noCasting: true,
  },
  {
    id: "mazed",
    match: ["mazed", "in a maze"],
    summary: "Maze: banished into a labyrinthine demiplane; it cannot be targeted, and its action buys an Intelligence check against DC 20 to escape (take_action escape).",
    untargetable: true,
    noAttacks: true,
    noCasting: true,
  },
  {
    id: "imprisoned",
    match: ["imprisoned"],
    summary: "Imprisonment: bound by the spell until it is dispelled; it takes no actions and cannot be targeted.",
    untargetable: true,
    noAction: true,
    noAttacks: true,
    noCasting: true,
  },
  {
    id: "insane_contact",
    match: ["insane (contact other plane)"],
    summary: "Insane (Contact Other Plane): no actions, no understanding of speech or writing, only gibberish, until a long rest.",
    noAction: true,
    noAttacks: true,
    noCasting: true,
  },
  {
    id: "calmed",
    match: ["calmed", "calm emotions"],
    summary: "Calm Emotions: indifferent to the creatures it was hostile to; it makes no attacks, and the calm ends when it or its allies are harmed.",
    noAttacks: true,
  },
  {
    id: "fleeing",
    match: ["fleeing"],
    summary: "Fear: it drops what it holds and must take the Dash action away from the caster on each of its turns; it makes no attacks and casts no spells.",
    noAttacks: true,
    noCasting: true,
  },
  {
    id: "freedom_of_movement",
    match: ["freedom of movement"],
    summary: "Freedom of Movement: difficult terrain does not slow them, magic cannot reduce their speed, paralyze or restrain them, and 5 feet of movement frees them from a nonmagical grapple or restraint.",
    conditionImmunities: ["paralyzed", "restrained"],
  },
  {
    id: "spider_climb",
    match: ["spider climb"],
    summary: "Spider Climb: a climbing speed equal to their walking speed; they climb walls and ceilings with their hands free.",
  },
  {
    id: "water_walk",
    match: ["water walk"],
    summary: "Water Walk: they walk across water and other liquid as if it were solid ground.",
  },
  {
    id: "jump_spell",
    match: ["jump (spell)", "jumping"],
    summary: "Jump: their jump distance is tripled.",
    jumpMultiplier: 3,
  },
  {
    id: "wind_walk",
    match: ["wind walk"],
    summary: "Wind Walk: a cloud of mist with a flying speed of 300 feet and resistance to nonmagical weapon damage; the only actions are Dash or reverting (a minute).",
    resistances: ["bludgeoning", "piercing", "slashing"],
    nonmagicalOnly: true,
    noAttacks: true,
    noCasting: true,
    speedSet: 300,
  },
];
