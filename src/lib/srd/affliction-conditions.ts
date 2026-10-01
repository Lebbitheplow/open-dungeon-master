// The condition rows the SRD 5.1 afflictions leave on a sheet (diseases,
// madness, poisons, and the downtime that answers them), spread into the one
// registry (src/lib/srd/condition-effects.ts). What a row can carry the
// engines read wherever dice are rolled; what a row cannot (a disease's
// exhaustion that no rest removes, the save after a long rest, the laughter
// that stress brings) the affliction engine holds (src/lib/dm/afflictions.ts).
// Types are imported as types only, so the files do not load each other.

import type { ConditionEffectRow } from "@/lib/srd/condition-effects";

const sightRot = (penalty: number): ConditionEffectRow => ({
  id: `sight_rot_${penalty}`,
  match: [`sight rot (-${penalty})`],
  summary: `Sight Rot: -${penalty} to attack rolls and to ability checks that rely on sight; 1 worse after each long rest, blinded at -5.`,
  attackPenaltyDie: String(penalty),
});

export const AFFLICTION_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    id: "cackle_fever",
    match: ["cackle fever"],
    summary:
      "Cackle Fever: a level of exhaustion no rest removes; great stress (a fight, damage) is a DC 13 CON save or 1d10 psychic and a minute of mad laughter; a DC 13 CON save after each long rest lowers the DC by 1d6, cured at 0.",
  },
  {
    id: "sewer_plague",
    match: ["sewer plague"],
    summary:
      "Sewer Plague: spent hit dice heal half, a long rest restores no hit points, and a DC 11 CON save after each long rest adds or removes a level of exhaustion; below 1 it is cured.",
  },
  sightRot(1),
  sightRot(2),
  sightRot(3),
  sightRot(4),
  sightRot(5),
  {
    id: "hallucinating",
    match: ["hallucinating"],
    summary: "Madness: vivid hallucinations, disadvantage on ability checks.",
    disadvantageOn: [{ kind: "check" }],
  },
  {
    id: "paranoid",
    match: ["paranoid"],
    summary: "Madness: extreme paranoia, disadvantage on Wisdom and Charisma checks.",
    disadvantageOn: [
      { kind: "check", ability: "wis" },
      { kind: "check", ability: "cha" },
    ],
  },
  {
    id: "tremors",
    match: ["tremors"],
    summary:
      "Madness: uncontrollable tremors, disadvantage on attack rolls and on checks and saves that use Strength or Dexterity.",
    attackDisadvantage: true,
    disadvantageOn: [
      { kind: "check", ability: "str" },
      { kind: "check", ability: "dex" },
      { kind: "save", ability: "str" },
      { kind: "save", ability: "dex" },
    ],
  },
  {
    id: "babbling",
    match: ["babbling"],
    summary: "Madness: babbling, incapable of normal speech or spellcasting.",
    noCasting: true,
  },
  { id: "madness_attacks_nearest", match: ["madness: attacks the nearest creature"], summary: "Madness: must use their action each round to attack the nearest creature." },
  { id: "madness_obeys", match: ["madness: obeys any order"], summary: "Madness: does whatever anyone tells them that is not obviously self-destructive." },
  { id: "madness_hunger", match: ["madness: strange hunger"], summary: "Madness: an overpowering urge to eat something strange." },
  { id: "madness_compulsion", match: ["madness: compulsion"], summary: "Madness: compelled to repeat one activity over and over." },
  { id: "madness_revulsion", match: ["madness: revulsion"], summary: "Madness: intense revulsion toward something, as the antipathy effect of antipathy/sympathy." },
  { id: "madness_delusion", match: ["madness: delusion"], summary: "Madness: believes they are under the effects of a potion of the DM's choice." },
  { id: "madness_lucky_charm", match: ["madness: lucky charm"], summary: "Madness: disadvantage on attack rolls, ability checks and saving throws while more than 30 feet from their lucky charm." },
  { id: "madness_amnesia", match: ["madness: amnesia"], summary: "Madness: partial amnesia, recognizes no one and remembers nothing from before." },
  { id: "madness_confusion", match: ["madness: confusion on damage"], summary: "Madness: whenever they take damage, a DC 15 Wisdom save or confused for 1 minute (the server rolls it)." },
  { id: "indefinite_madness", match: ["indefinite madness"], summary: "Indefinite madness: a new flaw, lasting until greater restoration or stronger magic." },
  { id: "truth_serum", match: ["truth serum"], summary: "Truth Serum: cannot knowingly speak a lie." },
  { id: "recuperated", match: ["recuperated"], summary: "Recuperating: advantage on saving throws against a disease or poison for 24 hours." },
  { id: "eyebright_ointment", match: ["eyebright ointment"], summary: "Eyebright ointment on the eyes: sight rot does not worsen after the next long rest." },
];
