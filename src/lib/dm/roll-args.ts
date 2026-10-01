// request_roll's arguments: the schema every caller parses them with, and the
// DC they come to at this table. Split from rolls.ts, which re-exports all
// three and resolves the roll itself.

import { z } from "zod";
import { normalizeAbility, normalizeAdvantage, normalizeRollKind } from "@/lib/dm/arg-coerce";
import { dcForDifficulty, normalizeDifficulty } from "@/lib/srd/dc";

export const rollArgsSchema = z.object({
  // Who may read the result. Only a human DM sets anything but "public";
  // the AI DM is never offered it (src/lib/dm/viewer.ts).
  visibility: z.enum(["public", "dm", "blind", "self"]).optional(),
  characterId: z.string().optional(),
  kind: z.preprocess(
    normalizeRollKind,
    z.enum([
      "skill_check",
      "saving_throw",
      "ability_check",
      "attack",
      "damage",
      "initiative",
      "custom",
    ]),
  ),
  skill: z.string().optional(),
  ability: z.preprocess(
    normalizeAbility,
    z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  ),
  dc: z.coerce.number().int().min(1).max(40).optional(),
  // A difficulty tier the server turns into the canonical DC (very_easy 5 ..
  // nearly_impossible 30). When both are sent, an explicit dc wins.
  difficulty: z.preprocess(
    (value) => normalizeDifficulty(value) ?? undefined,
    z
      .enum(["very_easy", "easy", "moderate", "hard", "very_hard", "nearly_impossible"])
      .optional(),
  ),
  expression: z.string().max(60).optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
  // The circumstance behind an advantage or disadvantage the AI claims; with
  // none, or one the server decides itself, the claim is set aside
  // (src/lib/dm/pc-attack-options.ts claimedAdvantage).
  advantageReason: z.string().max(120).optional(),
  // kind=damage only: the enemy this damage strikes; the server applies the
  // rolled total to that enemy the moment the dice resolve.
  targetEnemyId: z.string().optional(),
  // kind=damage only: damage type, so resistances and immunities apply.
  damageType: z.string().optional(),
  reason: z.string().optional(),
  // kind=saving_throw only: what the save resists (a condition, a damage
  // type, or "spell"/"magic" for a magical effect), so defensive traits apply
  // server-side: Brave (frightened), Fey Ancestry (charmed), Dwarven and
  // Stout Resilience (poison), Gnome Cunning (magic, INT/WIS/CHA).
  against: z.string().max(60).optional(),
  // kind=ability_check only: the tool the check is made with ("thieves'
  // tools"); a character proficient in it adds their proficiency bonus.
  tool: z.string().max(40).optional(),
  // Spend the character's Inspiration (awarded by the DM) for advantage on
  // this roll. Refused when they hold none.
  useInspiration: z.preprocess((value) => (value === "false" ? false : value), z.coerce.boolean()).optional(),
  // A check contested by a creature (SRD 5.1, Contests): the server rolls
  // the creature's own check from its stat block and the character must
  // beat it (src/lib/dm/roll-gates.ts). An enemy in the fight by id, or a
  // monster by name out of one; `contestSkill` names the creature's skill
  // when the usual pairing (Deception against Insight, Stealth against
  // Perception) is not the one wanted.
  againstEnemyId: z.string().max(80).optional(),
  againstMonster: z.string().max(80).optional(),
  contestSkill: z.string().max(40).optional(),
}).transform((args) => {
  // Fold a difficulty tier down into a concrete dc so every downstream
  // consumer (success computation, result text) sees one number. An explicit
  // dc always wins over the tier.
  if (args.dc === undefined && args.difficulty) {
    return { ...args, dc: dcForDifficulty(args.difficulty) };
  }
  return args;
});

export type RollArgs = z.infer<typeof rollArgsSchema>;

// The DC of a request_roll at this table. A named difficulty moves with the
// table's strictness (two points a step, docs/rules-coverage.md), as it does
// for group_check and check_notice; a DC given as a number is the number.
// `raw` is the call as it was sent, which is where "given as a number" can
// still be told from "folded down from the tier".
export function rollDcFor(args: RollArgs, raw: unknown, shift: number): number | undefined {
  const sent = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const explicit = sent.dc !== undefined && sent.dc !== null && sent.dc !== "";
  if (explicit || !args.difficulty) {
    return args.dc;
  }
  return dcForDifficulty(args.difficulty, shift);
}
