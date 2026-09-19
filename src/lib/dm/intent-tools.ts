import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { recordEncounterIntent } from "@/lib/db/encounter-intents";
import { publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { declaredVerbKind, expectedDamage } from "@/lib/dm/intent";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// declare_intent (docs/visual-overhaul-plan.md 5.6): the DM, model or person,
// says what an enemy is about to do, and the board telegraphs it for the
// rest of the round. It changes no rule and rolls nothing; the projection in
// src/lib/battlemap/view.ts decides who is told. Wired into the encounter
// tool set by encounter-tools-extra.ts, as legendary-tools.ts is.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const declareIntentTool: ToolDef = {
  type: "function",
  function: {
    name: "declare_intent",
    description:
      "Telegraph what an enemy is about to do next, so the board shows it over that enemy for the rest of this round (players who cannot see the enemy are not told). Optional flavour: it rolls nothing and binds nothing.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        actor: { type: "string", description: "Exact enemyId from GAME STATE, or the enemy's name." },
        verb: { type: "string", description: "What it plans, as the table would say it: \"Longsword\", \"Fire Breath\", \"Retreat\"." },
        target: { type: "string", description: "characterId or name of its mark. Omit when there is no single mark." },
        expected: { type: "number", description: "Expected damage. Omit to use the named attack's average." },
      },
      required: ["actor", "verb"],
    },
  },
};

const declareIntentArgsSchema = z.object({
  actor: z.string().min(1),
  verb: z.string().trim().min(1).max(60),
  target: z.string().optional(),
  expected: z.coerce.number().min(0).max(9999).optional(),
});

export function handleDeclareIntent(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof declareIntentArgsSchema>;
  try {
    args = declareIntentArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: declare_intent needs actor and verb." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.actor);
  if (!enemy) {
    return { error: "Unknown actor; use an enemyId from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }
  const wantsTarget = Boolean(args.target?.trim());
  const target = wantsTarget ? resolveSheetRef(args.target, sheets, sheetsById) : null;
  if (wantsTarget && !target) {
    return { error: "Unknown target; use a characterId from GAME STATE, or omit target." };
  }
  // A number is only ever the DM's own or the named attack's average: a verb
  // the stat block does not list gets none rather than a guess.
  const attack = enemy.stats.attacks.find(
    (entry) => entry.name.toLowerCase() === args.verb.toLowerCase(),
  );
  const expected =
    args.expected !== undefined ? Math.round(args.expected) : expectedDamage(attack?.damage);
  recordEncounterIntent(encounter.id, encounter.round, enemy.id, {
    verb: args.verb,
    verbKind: declaredVerbKind(args.verb, enemy.stats.attacks),
    targetRef: target?.id ?? null,
    expected,
  });
  // The intent rides the per-viewer map projection, so the map ping is what
  // makes clients refetch; the encounter event keeps the two in step.
  publishBattleMapUpdate(campaign.id);
  publishEncounter(campaign.id);
  return {
    ok: true,
    declared: `${enemy.displayName}: ${args.verb}${target ? ` at ${target.name}` : ""}`,
    round: encounter.round,
    note: "Shown on the board for the rest of this round.",
  };
}
