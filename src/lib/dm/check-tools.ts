import { dungeonDelverNotices, hasDungeonDelver } from "@/lib/srd/feat-combat";
import { CHECK_KEY_PROPERTIES, named, NONE } from "@/lib/dm/roll-about";
import { CHECK_KEY_FIELDS } from "@/lib/dm/roll-args";
import { askedFields, unnamedTraitFields } from "@/lib/dm/roll-feature-riders";
import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { computeSheetDerived, SRD_SKILLS } from "@/lib/srd";
import { dcForDifficulty, difficultyOfDc, normalizeDifficulty } from "@/lib/srd/dc";
import { strictnessShift } from "@/lib/dm/safety-logic";
import { resolveRollExpression, resolveSheetRef } from "@/lib/dm/rolls";
import { itemCheckRiders } from "@/lib/srd/item-check-riders";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { rollEffectExtras } from "@/lib/dm/effect-tools";
import { exhaustionRollState, mergeAdvantage, rollDerivation, type AdvantageState } from "@/lib/dm/condition-logic";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import type { RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { normalizeClock } from "@/lib/dm/calendar";
import { getClock } from "@/lib/db/clock";
import { cannotNotice, sightPassiveShift } from "@/lib/dm/notice-logic";
import { lightForSheet, offBoardAmbient } from "@/lib/dm/place-light";
import { contestOpponent, marchStealthProblem, rollContest } from "@/lib/dm/roll-gates";
import { weatherPerceptionRider } from "@/lib/srd/weather";
import { obscuredFor, silencedImmunity } from "@/lib/dm/zone-rules";
import { senseCheckFailure } from "@/lib/srd/sense-checks";
import { sightRotPenalty } from "@/lib/srd/afflictions";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { npcDeceiver, seeThroughActs } from "@/lib/dm/scheme-tools";

// Two exploration-pillar tools that were pure narration before: a group skill
// check resolved by the 5e "half the group succeeds" rule, and a passive
// notice gate that decides who spots a hidden thing from passive scores
// instead of the model simply declaring it. Both lean on the same difficulty
// ladder request_roll now uses (src/lib/srd/dc.ts), so a "hard" lock, a "hard"
// group climb, and a "hard" hidden door all read DC 20.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const CHECK_TOOL_NAMES = ["group_check", "check_notice"] as const;

const DIFFICULTY_ENUM = [
  "very_easy",
  "easy",
  "moderate",
  "hard",
  "very_hard",
  "nearly_impossible",
] as const;

export const checkTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "group_check",
      description:
        "Resolve one skill (or raw ability) check attempted by several characters at once. The server rolls each named character from their real sheet and reports who passed. Call it BEFORE narrating the outcome; narrate exactly what it reports.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          skill: {
            type: "string",
            enum: SRD_SKILLS.map((skill) => skill.id),
            description: "Which skill everyone rolls. Give this or ability.",
          },
          ability: {
            type: "string",
            enum: ["str", "dex", "con", "int", "wis", "cha"],
            description: "A raw ability check when no skill fits. Give this or skill.",
          },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact characterIds from GAME STATE taking part. Omit to include the whole party.",
          },
          difficulty: {
            type: "string",
            enum: [...DIFFICULTY_ENUM],
            description: "How hard the shared task is; the server sets the DC. Prefer this over dc.",
          },
          dc: { type: "integer", description: "An exact DC, only when a specific number is called for." },
          reason: { type: "string", description: "Short note on what the group is attempting." },
          ...CHECK_KEY_PROPERTIES,
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_notice",
      description:
        "Decide who PASSIVELY notices a hidden thing the party is not actively searching for. The unconscious notice nothing, and the pace and the light count for Perception.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          sense: {
            type: "string",
            enum: ["perception", "insight", "investigation"],
            description:
              "Which passive score decides it. Default: 'perception'. Perception: traps, ambushers, sounds; insight: a lie, a hidden motive; investigation: a concealed mechanism or clue.",
          },
          by: {
            type: "string",
            enum: ["sight", "hearing"],
            description:
              "Perception only: whether the thing is seen or heard. Default: 'sight'. Off the battle map the server applies the light and a fast pace; a sound ignores the light.",
          },
          light: {
            type: "string",
            enum: ["bright", "dim", "dark"],
            description:
              "Off the battle map, the light where the party is, when you know it. Omit it and the server reads it from the location and the hour.",
          },
          againstEnemyId: {
            type: "string",
            description:
              "A creature of the running fight hiding (or lying, for insight): exact enemyId from GAME STATE. The server rolls its Stealth (or Deception) as the DC. Out of a fight, use againstMonster.",
          },
          againstMonster: {
            type: "string",
            description: "Out of a fight, who hides or lies: a bestiary creature, or for insight a tracked NPC's exact name. For insight an AI companion's exact name works too. The server rolls its Stealth or Deception as the DC.",
          },
          difficulty: {
            type: "string",
            enum: [...DIFFICULTY_ENUM],
            description: "How hard the thing is to spot; the server sets the DC. Prefer this over dc.",
          },
          dc: { type: "integer", description: "An exact spot DC, only when a specific number is called for." },
          about: {
            type: "string",
            enum: ["traps_and_secret_doors", NONE],
            description: "Perception or investigation: 'traps_and_secret_doors' for a trap or a secret door, or 'none'.",
          },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description: "Exact characterIds from GAME STATE who could notice. Omit to test the whole party.",
          },
          reason: { type: "string", description: "Short note on the hidden thing." },
        },
        required: [],
      },
    },
  },
];

// Turns a difficulty tier and/or explicit dc into a concrete DC, tier label,
// and any error. Shared by both tools; an explicit dc wins over the tier.
function resolveDc(
  difficulty: unknown,
  dc: unknown,
  shift = 0,
): { dc: number; label: string } | ToolError {
  const explicit = typeof dc === "number" && Number.isFinite(dc) ? Math.round(dc) : null;
  const tier = normalizeDifficulty(difficulty);
  const value = explicit ?? (tier ? dcForDifficulty(tier, shift) : null);
  if (value === null) {
    return { error: "Pass a difficulty tier (very_easy .. nearly_impossible) or an exact dc.", retry: true };
  }
  return { dc: value, label: difficultyOfDc(value) };
}

// The characters a group tool acts on: the named ones, or the whole party
// when none are named. Bad ids are dropped; an all-bad list is an error.
function resolveTargets(
  ids: unknown,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet[] {
  if (!Array.isArray(ids) || !ids.length) {
    return sheets;
  }
  const resolved: CharacterSheet[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const sheet = resolveSheetRef(typeof id === "string" ? id : undefined, sheets, sheetsById);
    if (sheet && !seen.has(sheet.id)) {
      seen.add(sheet.id);
      resolved.push(sheet);
    }
  }
  return resolved;
}

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

// ---- group_check ----

const groupCheckSchema = z.object({
  ...CHECK_KEY_FIELDS,
  skill: z.string().optional(),
  ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  characterIds: z.array(z.string()).optional(),
  difficulty: z.unknown().optional(),
  dc: z.unknown().optional(),
  reason: z.string().optional(),
});

export function handleGroupCheck(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof groupCheckSchema>;
  try {
    args = groupCheckSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: group_check needs a skill or ability and a difficulty.", retry: true };
  }
  if (!args.skill && !args.ability) {
    return { error: "group_check needs a skill (e.g. stealth) or an ability (e.g. str).", retry: true };
  }
  // A normal or fast march allows no stealth (src/lib/dm/roll-gates.ts).
  const marching = marchStealthProblem(campaign.id, args.skill);
  if (marching) {
    return marching;
  }
  const dc = resolveDc(args.difficulty, args.dc, strictnessShift(campaign.gameSettings.gm?.strictness ?? "standard"));
  if ("error" in dc) {
    return dc;
  }
  const targets = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!targets.length) {
    return { error: "No valid characters for the group check; use characterIds from GAME STATE.", retry: true };
  }
  const kind = args.skill ? "skill_check" : "ability_check";
  // A trait a participant holds that a field the model left unnamed would
  // call on, asked for before anyone rolls, as request_roll asks
  // (src/lib/srd/roll-keys.ts).
  if (turn.actor === "ai") {
    const keyed = { kind, skill: args.skill, ability: args.ability, about: args.about, creature: args.creature, terrain: args.terrain, by: args.by } as RollArgs;
    const holders = targets.map((sheet) => ({ sheet, gaps: unnamedTraitFields(getSheetById(sheet.id) ?? sheet, keyed) })).filter((entry) => entry.gaps.length);
    if (holders.length) {
      return {
        error: `${holders.map((entry) => entry.sheet.name).join(" and ")} ${holders.length > 1 ? "hold" : "holds"} a trait this check can call on. Name ${askedFields(holders.flatMap((entry) => entry.gaps))}, as the fiction is, and send the check again. Nothing was rolled.`,
        retry: true,
      };
    }
  }

  const results: Array<{ name: string; total: number; success: boolean }> = [];
  for (const stale of targets) {
    const sheet = getSheetById(stale.id) ?? stale;
    const rollArgs = {
      kind,
      skill: args.skill,
      ability: args.ability,
      about: args.about,
      creature: args.creature,
      terrain: args.terrain,
      by: args.by,
    } as unknown as RollArgs;
    // The dead take no part, and count as a failure for the group.
    if (sheet.deathSaves?.dead) {
      results.push({ name: sheet.name, total: 0, success: false });
      continue;
    }
    const resolved = resolveRollExpression(
      rollArgs,
      sheet,
      rollExtrasFor(campaign, sheet, rollArgs.kind),
    );
    if ("error" in resolved || "autoFail" in resolved) {
      // An auto-fail (paralysis) or an unresolvable skill counts as a failed
      // participant rather than aborting the whole group's attempt.
      results.push({ name: sheet.name, total: 0, success: false });
      continue;
    }
    // An inspiration die or a held Help is spent by the roll it rides.
    spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
    const rolled = rollExpression(resolved.expression);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind,
      detail: `${sheet.name}: group ${args.skill ?? args.ability} check`,
      dc: dc.dc,
      result: rolled,
    });
    publishRoll(campaign.id, roll);
    turn.rollIds.push(roll.id);
    results.push({ name: sheet.name, total: rolled.total, success: rolled.total >= dc.dc });
  }

  const successes = results.filter((entry) => entry.success).length;
  const passed = successes * 2 >= results.length;
  return {
    ok: true,
    check: args.skill ?? args.ability,
    dc: dc.dc,
    difficulty: dc.label,
    successes,
    total: results.length,
    passed,
    results,
    note: passed
      ? `The group succeeds: ${successes} of ${results.length} made it, at least half. Narrate the shared success.`
      : `The group fails: only ${successes} of ${results.length} made it, short of half. Narrate the shared setback.`,
  };
}

// ---- check_notice ----

const checkNoticeSchema = z.object({
  sense: z.enum(["perception", "insight", "investigation"]).optional(),
  by: z.enum(["sight", "hearing"]).optional(),
  light: z.enum(["bright", "dim", "dark"]).optional(),
  againstEnemyId: z.string().max(80).optional(),
  againstMonster: z.string().max(80).optional(),
  difficulty: z.unknown().optional(),
  dc: z.unknown().optional(),
  characterIds: z.array(z.string()).optional(),
  about: z.enum(["traps_and_secret_doors", NONE]).optional(),
  reason: z.string().optional(),
});

// The passive score a sense reads. Perception carries its feat/feature bonus
// (Observant, keen senses) through the derived value; insight/investigation
// take the plain 10 + skill modifier, which is faithful for all but the rare
// Observant investigator and keeps the gate simple. Exported for the
// surprise check an ambush makes (src/lib/dm/encounter-open.ts).
export function passiveScore(
  campaign: Campaign,
  sheet: CharacterSheet,
  sense: "perception" | "insight" | "investigation",
  situational: AdvantageState[] = [],
) {
  const derived = computeSheetDerived(sheet);
  const base =
    sense === "perception"
      ? derived.passivePerception
      : sense === "investigation"
        ? derived.passiveInvestigation
        : 10 + (derived.skills[sense] ?? 0);
  return base + passiveModifier(campaign, sheet, sense, situational);
}

// A passive check takes -5 when the character would roll the check at
// disadvantage and +5 at advantage (SRD 5.1, Passive Checks): the same
// conditions, exhaustion and lasting effects an active check reads, plus
// what an effect adds to checks outright. `situational` is what the moment
// adds (dim light, fog, an obscured zone, Dungeon Delver): merged with the
// rest, so two disadvantages are still -5, not -10 (SRD 5.1, Advantage and
// Disadvantage: "you don't roll more than one additional d20").
function passiveModifier(
  campaign: Campaign,
  sheet: CharacterSheet,
  sense: "perception" | "insight" | "investigation",
  situational: AdvantageState[],
): number {
  const ability = sense === "investigation" ? "int" : "wis";
  const effect = rollEffectExtras(campaign.id, sheet.id, "skill_check");
  // Items that ride checks (Eyes of the Eagle, a Stone of Good Luck).
  const items = itemCheckRiders(sheet.equipment, sense);
  const state = mergeAdvantage([
    ...rollDerivation(sheet.conditions, "skill_check", ability).sources,
    exhaustionRollState(sheet.exhaustion ?? 0, "skill_check").advantage,
    ...conditionRollRiders(sheet.conditions, "check", ability).advantageSources,
    ...(effect.effectAdvantage ? ["advantage" as const] : []),
    ...(effect.effectDisadvantage ? ["disadvantage" as const] : []),
    ...(items.advantage ? ["advantage" as const] : []),
    ...situational,
  ]);
  const swing = state === "advantage" ? 5 : state === "disadvantage" ? -5 : 0;
  // Sight rot's penalty (src/lib/srd/afflictions.ts); its blindness at -5 is
  // the blinded condition's own.
  const rot = sense === "insight" ? 0 : sightRotPenalty(sheet.conditions);
  return swing + (effect.effectBonus ?? 0) + items.bonus - rot;
}

export function handleCheckNotice(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof checkNoticeSchema>;
  try {
    args = checkNoticeSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: check_notice needs a difficulty and optionally a sense.", retry: true };
  }
  const sense = args.sense ?? "perception";
  const targets = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!targets.length) {
    return { error: "No valid characters to test; use characterIds from GAME STATE.", retry: true };
  }
  // Dungeon Delver reads what the hidden thing is: a model's call that leaves
  // it unnamed while a character tested holds the feat is asked for it, so
  // the feat is never lost to an omission (as request_roll's fields are,
  // src/lib/srd/roll-keys.ts).
  const delvers = turn.actor === "ai" && sense !== "insight" && args.about === undefined ? targets.filter((sheet) => hasDungeonDelver(sheet)) : [];
  if (delvers.length) {
    return {
      error: `${delvers.map((sheet) => sheet.name).join(" and ")} ${delvers.length > 1 ? "hold" : "holds"} a trait this check can call on. Name about: 'traps_and_secret_doors' or 'none', as the fiction is, and send the check again. Nothing was rolled.`,
      retry: true,
    };
  }
  // A creature that hides or lies sets the DC with its own roll (SRD 5.1,
  // Contests; src/lib/dm/roll-gates.ts); a tie goes to the one noticing.
  let contest: ReturnType<typeof rollContest> | null = null;
  // A tracked NPC's lie or act (issue 501), named where a stat block would
  // be: their Deception sets the DC, from their stat block or their nature
  // (src/lib/dm/scheme-tools.ts). No parameter of its own, so the compact
  // core costs nothing more.
  const deceiver = sense === "insight" && args.againstMonster && !args.againstEnemyId ? npcDeceiver(campaign, args.againstMonster, sheets) : null;
  if (deceiver) {
    contest = rollContest(campaign, null, deceiver, { skill: sense, hiding: true, contestSkill: "deception" });
  } else if (args.againstEnemyId || args.againstMonster) {
    const opponent = contestOpponent(campaign, { enemyId: args.againstEnemyId, monster: args.againstMonster });
    if ("error" in opponent) {
      return opponent;
    }
    contest = rollContest(campaign, null, opponent, {
      skill: sense,
      hiding: true,
      contestSkill: sense === "insight" ? "deception" : "stealth",
      // One roll answers every character tested: a liar's charm over the
      // one it lies to gives its Deception advantage (SRD 5.1, Charmed).
      roller: targets.length === 1 ? targets[0] : null,
    });
  }
  const dc = contest
    ? { dc: contest.dc, label: difficultyOfDc(contest.dc) }
    : resolveDc(args.difficulty, args.dc, strictnessShift(campaign.gameSettings.gm?.strictness ?? "standard"));
  if ("error" in dc) {
    return dc;
  }

  // Rain and fog: disadvantage on Perception by sight when the party is
  // under the sky (no board, or an outdoor one).
  const board = getActiveBattleMap(campaign.id);
  const underSky = !board || board.outdoors;
  const clock = getClock(campaign.id);
  const weather =
    sense === "perception" && underSky
      ? weatherPerceptionRider(normalizeClock(campaign.clock).weather)
      : { disadvantage: false, passiveMod: 0, note: null };
  // Off the board the light is the place's, a lit torch or lantern and
  // darkvision on top (src/lib/dm/place-light.ts, which a rolled check
  // reads too). A board keeps its own light.
  const ambient = offBoardAmbient(campaign.id, args.light ?? null);
  const noticedBy: string[] = [];
  const noticers: CharacterSheet[] = [];
  const missedBy: string[] = [];
  const shifts: string[] = [];
  for (const sheet of targets) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    // The dead and the unconscious notice nothing.
    if (cannotNotice(fresh)) {
      missedBy.push(sheet.name);
      continue;
    }
    // Blinded or deafened: nothing is noticed by the lost sense (srd/sense-checks.ts).
    const senseless = sense === "perception" ? senseCheckFailure(fresh.conditions, { by: args.by ?? "sight" }) : null;
    if (senseless) {
      shifts.push(`${sheet.name}: ${senseless}`);
      missedBy.push(sheet.name);
      continue;
    }
    const sight =
      sense === "perception"
        ? sightPassiveShift({
            pace: clock.travelPace,
            byEar: args.by === "hearing",
            ...(ambient ? { light: lightForSheet(ambient, fresh) } : {}),
          })
        : { shift: 0, blind: false, disadvantage: false, notes: [] };
    if (sight.notes.length) {
      shifts.push(`${sheet.name}: ${sight.notes.join(", ")}`);
    }
    if (sight.blind) {
      missedBy.push(sheet.name);
      continue;
    }
    // Inside Silence a creature is deafened: nothing is heard there (zone-rules.ts).
    if (sense === "perception" && args.by === "hearing" && silencedImmunity(campaign.id, fresh.id)) {
      shifts.push(`${sheet.name}: deafened inside Silence`);
      missedBy.push(sheet.name);
      continue;
    }
    // Standing in an obscured spell area: disadvantage on Perception by sight (zone-rules.ts).
    const veiled = sense === "perception" && args.by !== "hearing" ? obscuredFor(campaign.id, fresh.id) : null;
    if (veiled) {
      shifts.push(`${sheet.name}: ${veiled}`);
    }
    // Dungeon Delver: advantage to notice a trap or a secret door.
    const delver = sense !== "insight" && dungeonDelverNotices(fresh, named(args.about));
    if (delver) {
      shifts.push(`${sheet.name}: Dungeon Delver, +5`);
    }
    const situational: AdvantageState[] = [
      ...(weather.disadvantage ? ["disadvantage" as const] : []),
      ...(sight.disadvantage ? ["disadvantage" as const] : []),
      ...(veiled ? ["disadvantage" as const] : []),
      ...(delver ? ["advantage" as const] : []),
    ];
    const passive = passiveScore(campaign, fresh, sense, situational) + sight.shift;
    if (passive >= dc.dc) {
      noticedBy.push(sheet.name);
      noticers.push(fresh);
    } else {
      missedBy.push(sheet.name);
    }
  }
  const anyNoticed = noticedBy.length > 0;
  // Whoever beat an NPC's act sees through it, and only their player is told.
  const seenThrough = deceiver && noticers.length ? seeThroughActs(campaign, turn, deceiver.name, noticers) : [];
  return {
    ok: true,
    sense,
    dc: dc.dc,
    difficulty: dc.label,
    noticedBy,
    missedBy,
    anyNoticed,
    ...(weather.note ? { weather: weather.note } : {}),
    ...(contest ? { contest: `${contest.name} rolled ${contest.skill} ${contest.total}: that is the DC.` } : {}),
    ...(shifts.length ? { applied: shifts } : {}),
    ...(seenThrough.length ? { seenThrough } : {}),
    note: seenThrough.length
      ? `${seenThrough.join(" ")} Tell no one else: play the act on as before, and let those players decide what to do with it.`
      : anyNoticed
      ? `${noticedBy.join(", ")} notice${noticedBy.length === 1 ? "s" : ""} it (passive ${sense} vs DC ${dc.dc}); ${missedBy.length ? `${missedBy.join(", ")} do not` : "everyone catches it"}. Reveal it only to those who noticed.`
      : `No one notices it: every passive ${sense} is under DC ${dc.dc}. Keep it hidden; do not describe it.`,
  };
}
