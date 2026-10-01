// The conditions the tail spell rows lay down (src/lib/srd/spell-mech-tail-rows.ts),
// as rows of the one registry (src/lib/srd/condition-effects.ts spreads them
// in). Kept apart so the registry file does not grow past reading; the type
// is imported as a type only, so the two files do not load each other.

import type { ConditionEffectRow } from "@/lib/srd/condition-effects";

const EVERY_TYPE = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;

// Bestow Curse on one ability: its checks and saves at disadvantage.
const ABILITY_CURSES: ConditionEffectRow[] = (Object.keys(ABILITY_NAMES) as Array<keyof typeof ABILITY_NAMES>).map((ability) => ({
  id: `cursed_${ability}`,
  match: [`cursed (${ability})`],
  summary: `Bestow Curse: disadvantage on ${ABILITY_NAMES[ability]} checks and saving throws.`,
  disadvantageOn: [
    { kind: "save", ability },
    { kind: "check", ability },
  ],
}));

export const TAIL_CONDITION_EFFECTS: ConditionEffectRow[] = [
  ...ABILITY_CURSES,
  {
    id: "cursed_attacks",
    match: ["cursed (attacks)"],
    summary: "Bestow Curse: disadvantage on attack rolls against the caster.",
  },
  {
    id: "cursed_will",
    match: ["cursed (will)"],
    summary: "Bestow Curse: a WIS save at the start of each of its turns, or it does nothing that turn.",
  },
  {
    id: "cursed_necrotic",
    match: ["cursed (necrotic)"],
    summary: "Bestow Curse: the caster's attacks and spells deal 1d8 necrotic more to it.",
  },
  {
    id: "dazed",
    match: ["dazed"],
    summary: "Bestow Curse: it wastes its action this turn.",
    noAction: true,
  },
  {
    id: "mocked",
    match: ["mocked"],
    summary: "Vicious Mockery: disadvantage on the next attack roll it makes before the end of its next turn.",
    attackDisadvantage: true,
    consumedBy: "attack",
  },
  {
    id: "searing_metal",
    match: ["searing metal"],
    summary: "Heat Metal: it keeps hold of the red-hot object and has disadvantage on attack rolls and ability checks until the caster's next turn.",
    attackDisadvantage: true,
    disadvantageOn: [{ kind: "check" }],
  },
  {
    id: "sickened",
    match: ["sickened"],
    summary: "Eyebite (Sickened): disadvantage on attack rolls and ability checks; a WIS save at the end of each of its turns ends it.",
    attackDisadvantage: true,
    disadvantageOn: [{ kind: "check" }],
  },
  {
    id: "halted",
    match: ["halted"],
    summary: "Command (Halt): it does not move and takes no action on its turn.",
    noAction: true,
    speedMultiplier: 0,
  },
  {
    id: "retching",
    match: ["retching"],
    summary: "Stinking Cloud: it spends its action retching and reeling this turn.",
    noAction: true,
  },
  {
    id: "wandering",
    match: ["wandering"],
    summary: "Confusion: it moves in a random direction and takes no action this turn.",
    noAction: true,
  },
  {
    id: "levitating",
    match: ["levitating"],
    summary: "Levitate: it hangs in the air and can move only by pushing or pulling against something fixed; its speed is 0.",
    speedMultiplier: 0,
  },
  {
    id: "suggested",
    match: ["suggested"],
    summary: "Suggestion: it pursues the suggested course of action; damage from the caster or their companions ends it.",
  },
  {
    id: "enclosed",
    match: ["enclosed"],
    summary: "Resilient Sphere: sealed in a sphere of force; nothing passes in or out, so it can neither be harmed from outside nor harm anything outside.",
    untargetable: true,
    noAttacks: true,
  },
  {
    id: "gaseous_form",
    match: ["gaseous form"],
    summary: "Gaseous Form: a misty cloud with a 10-foot fly speed, resistance to nonmagical damage and advantage on STR, DEX and CON saves; it cannot attack or cast spells.",
    resistances: EVERY_TYPE,
    nonmagicalOnly: true,
    advantageOn: [
      { kind: "save", ability: "str" },
      { kind: "save", ability: "dex" },
      { kind: "save", ability: "con" },
    ],
    noCasting: true,
    noAttacks: true,
    speedSet: 10,
  },
  {
    id: "heroes_feast",
    match: ["heroes' feast", "heroes feast"],
    summary: "Heroes' Feast: immune to poison and to being frightened, advantage on WIS saves, and 2d10 more hit points for 24 hours.",
    conditionImmunities: ["frightened", "poisoned"],
    damageImmunities: ["poison"],
    advantageOn: [{ kind: "save", ability: "wis" }],
  },
  {
    id: "dispel_evil_and_good",
    match: ["dispel evil and good"],
    summary: "Dispel Evil and Good: celestials, elementals, fey, fiends and undead have disadvantage on attack rolls against them.",
    attacksAgainstDisadvantageFrom: ["celestial", "elemental", "fey", "fiend", "undead"],
  },
  {
    id: "enfeebled",
    match: ["enfeebled"],
    summary: "Ray of Enfeeblement: its weapon attacks that use Strength deal half damage; a CON save at the end of each of its turns ends it.",
  },
  {
    id: "regenerating",
    match: ["regenerating"],
    summary: "Regenerate: 1 hit point back at the start of each of its turns.",
  },
  {
    id: "mind_blank",
    match: ["mind blank"],
    summary: "Mind Blank: immune to psychic damage and to being charmed.",
    conditionImmunities: ["charmed"],
    damageImmunities: ["psychic"],
  },
  {
    id: "foresight",
    match: ["foresight"],
    summary: "Foresight: advantage on attack rolls, ability checks and saving throws, and attack rolls against them have disadvantage.",
    attackAdvantage: true,
    advantageOn: [{ kind: "check" }, { kind: "save" }],
    attacksAgainstDisadvantage: true,
  },
  // The marks the engine keeps for what comes at the end of a creature's turn
  // (src/lib/dm/spell-turn-end.ts); each carries its spell in the meta.
  {
    id: "acid_arrow_splash",
    match: ["acid arrow"],
    summary: "Acid Arrow: the acid burns again at the end of its next turn.",
  },
  {
    id: "phantasmal_dread",
    match: ["phantasmal killer"],
    summary: "Phantasmal Killer: at the end of each of its turns it saves again or takes psychic damage.",
  },
  {
    id: "weird_dread",
    match: ["weird"],
    summary: "Weird: at the end of each of its turns it saves again or takes psychic damage.",
  },
  {
    id: "hardening",
    match: ["flesh to stone"],
    summary: "Flesh to Stone: it saves at the end of each of its turns; three failures turn it to stone, three successes free it.",
  },
];
