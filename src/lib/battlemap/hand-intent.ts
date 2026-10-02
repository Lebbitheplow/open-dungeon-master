// The parts of a Hand card's structured intent that the engine's newer rules
// need beyond the card itself: a reaction and what it answers, a feature's
// variant (a ki technique), a basic action taken as the bonus action through
// a feature, Ready's trigger and readied spell, Search's skill, a spell's
// chosen form (Command's word, Bestow Curse's curse), the square a spell's
// area is laid on, and the class options
// pc_attack resolves (Martial Arts', Frenzy's and a subclass's bonus strikes,
// Stunning Strike, Reckless Attack, a blow that knocks out, Inspiration,
// Stroke of Luck, Open Hand Technique, Hurl Through Hell).
//
// The message schema itself is the narrator's (src/lib/dm/intent-logic.ts);
// it spreads these fields in and calls the two describers, so a card that
// carries an option reaches the model as the tool argument it stands for.
// Pure: zod and strings only.
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const square = z.number().int().min(0).max(200).optional();

export const HAND_INTENT_ACTIONS = ["search", "escape", "stand-up"] as const;

// pc_attack's bonusAttack values (src/lib/dm/pc-attack-options.ts
// BONUS_ATTACKS) and Open Hand Technique's riders (attack-choice-rules.ts).
const HAND_BONUS_ATTACKS = ["martial arts", "frenzy", "feature"] as const;
const HAND_OPEN_HAND = ["prone", "push", "no reactions"] as const;

export const handIntentExtras = {
  // A reaction card: the feature or reaction spell use_reaction resolves.
  feature: text(80).optional(),
  // A resource's variant: "flurry of blows", "patient defense", "step of the
  // wind"; a restoration spell's condition to end (cast_buff variant).
  variant: text(40).optional(),
  // A save spell's chosen form, cast_at_enemy's `condition`: Command's word,
  // Eyebite's form, Bestow Curse's curse, "armor" for Heat Metal.
  condition: text(40).optional(),
  // A basic action taken as the bonus action through a feature (Cunning Action).
  bonus: z.boolean().optional(),
  // Ready's trigger, which the engine refuses Ready without.
  trigger: text(200).optional(),
  // Ready with a spell: take_action's `spell` and `level`.
  readySpell: text(80).optional(),
  readyLevel: z.number().int().min(1).max(9).optional(),
  // Search's skill.
  skill: z.enum(["perception", "investigation"]).optional(),
  // Where a spell's area is laid on the battle map, under the placement
  // arguments' own names (src/lib/dm/zone-args.ts): a burst's centre or a
  // wall's first square, and the square a wall or a line runs toward.
  atX: square,
  atY: square,
  towardX: square,
  towardY: square,
  // pc_attack's class options, under their own argument names.
  attack: z
    .object({
      bonusAttack: z.enum(HAND_BONUS_ATTACKS).optional(),
      stunningStrike: z.boolean().optional(),
      reckless: z.boolean().optional(),
      nonlethal: z.boolean().optional(),
      useInspiration: z.boolean().optional(),
      strokeOfLuck: z.boolean().optional(),
      hurlThroughHell: z.boolean().optional(),
      rapidStrike: z.boolean().optional(),
      openHand: z.enum(HAND_OPEN_HAND).optional(),
    })
    .optional(),
};

export type HandBonusAttack = (typeof HAND_BONUS_ATTACKS)[number];
export type HandOpenHand = (typeof HAND_OPEN_HAND)[number];

export type HandAttackArgs = {
  bonusAttack?: HandBonusAttack;
  stunningStrike?: boolean;
  reckless?: boolean;
  nonlethal?: boolean;
  useInspiration?: boolean;
  strokeOfLuck?: boolean;
  hurlThroughHell?: boolean;
  rapidStrike?: boolean;
  openHand?: HandOpenHand;
};

export type HandIntentExtras = {
  feature?: string;
  variant?: string;
  condition?: string;
  bonus?: boolean;
  trigger?: string;
  readySpell?: string;
  readyLevel?: number;
  skill?: "perception" | "investigation";
  atX?: number;
  atY?: number;
  towardX?: number;
  towardY?: number;
  attack?: HandAttackArgs;
};

// The tool arguments the extras stand for, as `name=value` pairs the model
// reads in the card line and in the corrective call.
export function handExtraArgs(intent: HandIntentExtras): string[] {
  const args: string[] = [];
  if (intent.feature) args.push(`feature=${intent.feature}`);
  if (intent.variant) args.push(`variant=${intent.variant}`);
  if (intent.condition) args.push(`condition=${intent.condition}`);
  if (intent.bonus) args.push("bonus=true");
  if (intent.trigger) args.push(`trigger=${intent.trigger}`);
  if (intent.readySpell) args.push(`spell=${intent.readySpell}`);
  if (intent.readySpell && intent.readyLevel) args.push(`level=${intent.readyLevel}`);
  if (intent.skill) args.push(`skill=${intent.skill}`);
  for (const key of ["atX", "atY", "towardX", "towardY"] as const) {
    if (intent[key] !== undefined) args.push(`${key}=${intent[key]}`);
  }
  for (const [key, value] of Object.entries(intent.attack ?? {})) {
    if (value !== undefined && value !== false) args.push(`${key}=${value}`);
  }
  return args;
}

// The tail of the card line: " (bonus=true, trigger=...)", or "".
export function describeHandExtras(intent: HandIntentExtras): string {
  const args = handExtraArgs(intent);
  return args.length ? ` (${args.join(", ")})` : "";
}
