// The SRD 5.1 afflictions of the Running the Game chapter, as data: the
// three sample diseases, the madness tables, and the list of poisons. The
// engine that applies them is src/lib/dm/afflictions.ts; the conditions they
// leave on a sheet, and what those do to rolls, are rows in
// src/lib/srd/affliction-conditions.ts. Pure.

export type AbilityId = "str" | "dex" | "con" | "int" | "wis" | "cha";

// ---- diseases ----

export type DiseaseId = "cackle_fever" | "sewer_plague" | "sight_rot";

export type Disease = {
  id: DiseaseId;
  name: string;
  // The condition the sheet carries once symptoms show.
  condition: string;
  // The save against catching it (the SRD gives none for cackle fever's
  // first infection; its spread from laughter is DC 10).
  infectDc: number;
  // How long before symptoms show, as dice of hours or days.
  onset: { dice: string; unit: "hours" | "days" };
  summary: string;
};

export const DISEASES: Record<DiseaseId, Disease> = {
  cackle_fever: {
    id: "cackle_fever",
    name: "Cackle Fever",
    condition: "cackle fever",
    infectDc: 10,
    onset: { dice: "1d4", unit: "hours" },
    summary:
      "One level of exhaustion that no rest removes while it lasts; great stress (entering combat, taking damage) is a DC 13 CON save or 1d10 psychic and a minute of mad laughter (incapacitated); after each long rest a DC 13 CON save lowers the DC by 1d6, cured at 0; three failed rest saves bring indefinite madness.",
  },
  sewer_plague: {
    id: "sewer_plague",
    name: "Sewer Plague",
    condition: "sewer plague",
    infectDc: 11,
    onset: { dice: "1d4", unit: "days" },
    summary:
      "One level of exhaustion; spent hit dice heal half and a long rest restores no hit points; after each long rest a DC 11 CON save: a failure adds a level of exhaustion, a success removes one, and falling below 1 cures it.",
  },
  sight_rot: {
    id: "sight_rot",
    name: "Sight Rot",
    condition: "sight rot",
    infectDc: 15,
    onset: { dice: "1", unit: "days" },
    summary:
      "-1 to attack rolls and to checks that rely on sight, 1 worse after each long rest; at -5 the victim is blinded until magic restores their sight. Eyebright ointment before a long rest stops the worsening; three doses cure it.",
  },
};

// A disease of the DM's own, as the engine runs it (src/lib/dm/
// afflictions.ts): the save against catching it, how long before symptoms
// show, what they are (a condition, levels of exhaustion, standard
// conditions), and the save after each long rest that moves it, the
// SRD's own pattern (Sewer Plague: a success sheds a level of exhaustion and
// cures it below one, a failure adds one). A copy of one of the SRD's three
// keeps that disease's own rules instead (`runsAs`), since cackle fever's
// falling DC and sight rot's penalty are not this pattern.
export type DiseaseSpec = {
  condition: string;
  infect: { ability: AbilityId; dc: number };
  onset: { dice: string; unit: "hours" | "days" };
  exhaustion: number;
  conditions?: string[];
  rest?: { ability: AbilityId; dc: number; onSuccess: "improve" | "recover"; onFail: "worsen" | "nothing"; successes: number };
  runsAs?: DiseaseId;
  summary: string;
};

export function findDisease(text: string): Disease | null {
  const key = text.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  return (Object.values(DISEASES).find((disease) => disease.id === key || disease.condition.replace(/ /g, "_") === key) ?? null);
}

// ---- madness ----

export type MadnessKind = "short" | "long" | "indefinite";

export type MadnessEffect = {
  low: number;
  high: number;
  text: string;
  // The conditions the effect lays on the sheet; none for one that is only
  // roleplayed (a compulsion, a craving).
  conditions: string[];
  // Ends when the character takes damage (short-term paralysis).
  endsOnDamage?: boolean;
  // Whenever the character takes damage, a DC 15 WIS save or confused for a
  // minute (long-term 86 to 90).
  confusionOnDamage?: boolean;
};

export const SHORT_TERM_MADNESS: MadnessEffect[] = [
  { low: 1, high: 20, text: "retreats into their mind and is paralyzed; it ends if they take any damage", conditions: ["paralyzed"], endsOnDamage: true },
  { low: 21, high: 30, text: "is incapacitated, screaming, laughing or weeping", conditions: ["incapacitated"] },
  { low: 31, high: 40, text: "is frightened and must use action and movement each round to flee the source of the fear", conditions: ["frightened"] },
  { low: 41, high: 50, text: "babbles, incapable of normal speech or spellcasting", conditions: ["babbling"] },
  { low: 51, high: 60, text: "must use their action each round to attack the nearest creature", conditions: ["madness: attacks the nearest creature"] },
  { low: 61, high: 70, text: "sees vivid hallucinations: disadvantage on ability checks", conditions: ["hallucinating"] },
  { low: 71, high: 75, text: "does whatever anyone tells them that is not obviously self-destructive", conditions: ["madness: obeys any order"] },
  { low: 76, high: 80, text: "has an overpowering urge to eat something strange (dirt, slime, offal)", conditions: ["madness: strange hunger"] },
  { low: 81, high: 90, text: "is stunned", conditions: ["stunned"] },
  { low: 91, high: 100, text: "falls unconscious", conditions: ["unconscious"] },
];

export const LONG_TERM_MADNESS: MadnessEffect[] = [
  { low: 1, high: 10, text: "feels compelled to repeat a specific activity over and over (washing hands, counting coins)", conditions: ["madness: compulsion"] },
  { low: 11, high: 20, text: "sees vivid hallucinations: disadvantage on ability checks", conditions: ["hallucinating"] },
  { low: 21, high: 30, text: "suffers extreme paranoia: disadvantage on Wisdom and Charisma checks", conditions: ["paranoid"] },
  { low: 31, high: 40, text: "regards something (usually the source of the madness) with intense revulsion, as the antipathy effect of antipathy/sympathy", conditions: ["madness: revulsion"] },
  { low: 41, high: 45, text: "imagines they are under the effects of a potion of the DM's choice", conditions: ["madness: delusion"] },
  { low: 46, high: 55, text: "clings to a lucky charm: disadvantage on attack rolls, ability checks and saving throws while more than 30 feet from it", conditions: ["madness: lucky charm"] },
  { low: 56, high: 65, text: "is blinded (25%) or deafened (75%)", conditions: [] },
  { low: 66, high: 75, text: "has uncontrollable tremors or tics: disadvantage on attack rolls, and on checks and saves that use Strength or Dexterity", conditions: ["tremors"] },
  { low: 76, high: 85, text: "suffers partial amnesia: knows who they are, recognizes no one and remembers nothing from before the madness", conditions: ["madness: amnesia"] },
  { low: 86, high: 90, text: "whenever they take damage, a DC 15 Wisdom save or confused (as the spell) for 1 minute", conditions: ["madness: confusion on damage"], confusionOnDamage: true },
  { low: 91, high: 95, text: "loses the ability to speak", conditions: ["muted"] },
  { low: 96, high: 100, text: "falls unconscious, and no jostling or damage wakes them", conditions: ["unconscious"] },
];

export const INDEFINITE_MADNESS: Array<{ low: number; high: number; text: string }> = [
  { low: 1, high: 15, text: "\"Being drunk keeps me sane.\"" },
  { low: 16, high: 25, text: "\"I keep whatever I find.\"" },
  { low: 26, high: 30, text: "\"I try to become more like someone else I know, adopting his or her style of dress, mannerisms, and name.\"" },
  { low: 31, high: 35, text: "\"I must bend the truth, exaggerate, or outright lie to be interesting to other people.\"" },
  { low: 36, high: 45, text: "\"Achieving my goal is the only thing of interest to me, and I'll ignore everything else to pursue it.\"" },
  { low: 46, high: 50, text: "\"I find it hard to care about anything that goes on around me.\"" },
  { low: 51, high: 55, text: "\"I don't like the way people judge me all the time.\"" },
  { low: 56, high: 70, text: "\"I am the smartest, wisest, strongest, fastest, and most beautiful person I know.\"" },
  { low: 71, high: 80, text: "\"I am convinced that powerful enemies are hunting me, and their agents are everywhere I go.\"" },
  { low: 81, high: 85, text: "\"There's only one person I can trust. And only I can see this special friend.\"" },
  { low: 86, high: 95, text: "\"I can't take anything seriously. The more serious the situation, the funnier I find it.\"" },
  { low: 96, high: 100, text: "\"I've discovered that I really like killing people.\"" },
];

export const INDEFINITE_MADNESS_CONDITION = "indefinite madness";

export function madnessEntry<T extends { low: number; high: number }>(table: T[], roll: number): T {
  return table.find((entry) => roll >= entry.low && roll <= entry.high) ?? table[table.length - 1];
}

// Every condition name a madness can leave on a sheet, for the cures.
export function madnessConditions(kind: "short" | "long" | "indefinite"): string[] {
  if (kind === "indefinite") {
    return [INDEFINITE_MADNESS_CONDITION];
  }
  const table = kind === "short" ? SHORT_TERM_MADNESS : LONG_TERM_MADNESS;
  return [...new Set(table.flatMap((entry) => entry.conditions))];
}

// ---- poisons ----

export type PoisonType = "contact" | "ingested" | "inhaled" | "injury";

export type Poison = {
  id: string;
  name: string;
  type: PoisonType;
  priceGp: number;
  dc: number;
  // Damage on a failed save, and whether a success halves it.
  damage?: string;
  halfOnSave?: boolean;
  // Conditions on a failed save and how long they last, in minutes.
  conditions?: string[];
  minutes?: number;
  // Dice of hours instead of a fixed duration (Torpor).
  hoursDice?: string;
  // Drow poison: failing by 5 or more also leaves the creature unconscious.
  unconsciousIfFailBy?: number;
  // The poisoned creature wakes when it takes damage.
  wakesOnDamage?: boolean;
  // Repeated saves: at the start of each of its turns (Burnt Othur Fumes),
  // at the end of each of its turns (Crawler Mucus), or every 24 hours
  // (Pale Tincture), with the successes that end it.
  repeat?: { every: "turn_start" | "turn_end" | "day"; damage?: string; successes: number };
  // Midnight Tears: nothing until the stroke of midnight.
  atMidnight?: boolean;
  summary: string;
};

export const POISONS: Poison[] = [
  { id: "assassins_blood", name: "Assassin's Blood", type: "ingested", priceGp: 150, dc: 10, damage: "1d12", halfOnSave: true, conditions: ["poisoned"], minutes: 24 * 60, summary: "DC 10 CON: 1d12 poison and poisoned for 24 hours; half and not poisoned on a success." },
  { id: "burnt_othur_fumes", name: "Burnt Othur Fumes", type: "inhaled", priceGp: 500, dc: 13, damage: "3d6", repeat: { every: "turn_start", damage: "1d6", successes: 3 }, summary: "DC 13 CON or 3d6 poison, and the save again at the start of each turn, 1d6 on each failure, until three successes." },
  { id: "crawler_mucus", name: "Crawler Mucus", type: "contact", priceGp: 200, dc: 13, conditions: ["poisoned", "paralyzed"], minutes: 1, repeat: { every: "turn_end", successes: 1 }, summary: "DC 13 CON or poisoned and paralyzed for 1 minute, a save at the end of each turn ends it." },
  { id: "drow_poison", name: "Drow Poison", type: "injury", priceGp: 200, dc: 13, conditions: ["poisoned"], minutes: 60, unconsciousIfFailBy: 5, wakesOnDamage: true, summary: "DC 13 CON or poisoned for 1 hour; failing by 5 or more, also unconscious until it takes damage." },
  { id: "essence_of_ether", name: "Essence of Ether", type: "inhaled", priceGp: 300, dc: 15, conditions: ["poisoned", "unconscious"], minutes: 8 * 60, wakesOnDamage: true, summary: "DC 15 CON or poisoned and unconscious for 8 hours; damage wakes it." },
  { id: "malice", name: "Malice", type: "inhaled", priceGp: 250, dc: 15, conditions: ["poisoned", "blinded"], minutes: 60, summary: "DC 15 CON or poisoned and blinded for 1 hour." },
  { id: "midnight_tears", name: "Midnight Tears", type: "ingested", priceGp: 1500, dc: 17, damage: "9d6", halfOnSave: true, atMidnight: true, summary: "Nothing until midnight; then DC 17 CON, 9d6 poison, half on a success." },
  { id: "oil_of_taggit", name: "Oil of Taggit", type: "contact", priceGp: 400, dc: 13, conditions: ["poisoned", "unconscious"], minutes: 24 * 60, wakesOnDamage: true, summary: "DC 13 CON or poisoned and unconscious for 24 hours; damage wakes it." },
  { id: "pale_tincture", name: "Pale Tincture", type: "ingested", priceGp: 250, dc: 16, damage: "1d6", conditions: ["poisoned"], repeat: { every: "day", damage: "1d6", successes: 7 }, summary: "DC 16 CON or 1d6 poison and poisoned; the save again every 24 hours, 1d6 on each failure, until seven successes." },
  { id: "purple_worm_poison", name: "Purple Worm Poison", type: "injury", priceGp: 2000, dc: 19, damage: "12d6", halfOnSave: true, summary: "DC 19 CON: 12d6 poison, half on a success." },
  { id: "serpent_venom", name: "Serpent Venom", type: "injury", priceGp: 200, dc: 11, damage: "3d6", halfOnSave: true, summary: "DC 11 CON: 3d6 poison, half on a success." },
  { id: "torpor", name: "Torpor", type: "ingested", priceGp: 600, dc: 15, conditions: ["poisoned", "incapacitated"], hoursDice: "4d6", summary: "DC 15 CON or poisoned and incapacitated for 4d6 hours." },
  { id: "truth_serum", name: "Truth Serum", type: "ingested", priceGp: 150, dc: 11, conditions: ["poisoned", "truth serum"], minutes: 60, summary: "DC 11 CON or poisoned for 1 hour, unable to knowingly speak a lie." },
  { id: "wyvern_poison", name: "Wyvern Poison", type: "injury", priceGp: 1200, dc: 15, damage: "7d6", halfOnSave: true, summary: "DC 15 CON: 7d6 poison, half on a success." },
];

// A name as a vial's label might say it ("Vial of Serpent Venom", "dose of
// Malice"), and the book's names read the same way: "Essence of Ether" and
// "Oil of Taggit" were never found by their own names, because the asked
// name lost its "of" and the book's kept it.
const poisonKey = (text: string) =>
  text.trim().toLowerCase().replace(/\(.*\)/g, "").replace(/[^a-z]+/g, " ").replace(/\b(vial|dose|of)\b/g, " ").replace(/\s+/g, " ").trim();

export function findPoison(text: string): Poison | null {
  const key = poisonKey(text);
  if (!key) {
    return null;
  }
  return (
    POISONS.find((poison) => poisonKey(poison.name) === key) ??
    POISONS.find((poison) => key.includes(poisonKey(poison.name))) ??
    null
  );
}

// Sight rot's penalty to ability checks that rely on sight (and to attack
// rolls, through its condition row): the N of "sight rot (-N)", or 0.
export function sightRotPenalty(conditions: string[]): number {
  let penalty = 0;
  for (const condition of conditions) {
    const match = /^sight rot \(-(\d)\)$/i.exec(condition.trim());
    if (match) {
      penalty = Math.max(penalty, Number(match[1]));
    }
  }
  return penalty;
}
