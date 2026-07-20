import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { isValidExpression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { applyDmMutation } from "@/lib/dm/mutations";
import { resolveRollExpression, resolveSheetRef } from "@/lib/dm/rolls";
import type { RollArgs } from "@/lib/dm/rolls";
import {
  hoardGoldDice,
  hoardItemCount,
  treasureTierForCr,
} from "@/lib/srd/treasure";
import { objectProfile, type ObjectMaterial, type ObjectSize } from "@/lib/srd/objects";
import { forcedMarchHours, forcedMarchSaveDc, paceEffect, type TravelPace } from "@/lib/srd/travel";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The remaining DM-utility engines: CR-scaled treasure the server actually
// moves into purses, object durability read from the DMG table, and forced-
// march exhaustion rolled from the real Constitution saves. Before these,
// loot value, whether a door breaks, and whether a hard day's march wore the
// party down were all pure DM assertion. This module imports the roll engine,
// the sheet layer, and mutations; it must never be imported by them.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const WORLD_TOOL_NAMES = ["roll_treasure", "damage_object", "travel"] as const;

const MATERIALS: ObjectMaterial[] = [
  "cloth",
  "paper",
  "rope",
  "crystal",
  "glass",
  "ice",
  "wood",
  "bone",
  "stone",
  "iron",
  "steel",
  "mithral",
  "adamantine",
];
const SIZES: ObjectSize[] = ["tiny", "small", "medium", "large"];

export const worldTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "roll_treasure",
      description:
        "Generate treasure scaled to a challenge and pay it into the party's purses. Pass the CR (or the toughest enemy's CR) of what they overcame; the server rolls the coin value from the DMG hoard tables, splits it among the named characters, and moves the gold with modify_gold so loot is real, not narrated. It also tells you how many magic items a hoard of that size tends to hold, which you then hand out with grant_item. Call this instead of inventing a gold figure.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          cr: { type: "number", description: "The challenge rating the treasure is scaled to." },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description: "Who shares the coin. Omit to split among the whole party.",
          },
          individual: {
            type: "boolean",
            description:
              "True for a single foe's pocket money (a tenth of a hoard) rather than a full hoard.",
          },
          reason: { type: "string", description: "Short note on the source of the treasure." },
        },
        required: ["cr"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "damage_object",
      description:
        "Resolve an attempt to break an inanimate object (a door, a chest, a rope, a window) against the DMG object table. Give its material and size (or an explicit ac and hp) and the damage dealt; the server reports the object's AC and HP and whether that blow destroys it. Use this instead of deciding by feel whether something breaks. Objects are not tracked between blows, so pass the cumulative damage when a second strike lands.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          material: { type: "string", enum: MATERIALS, description: "What the object is made of." },
          size: { type: "string", enum: SIZES, description: "Its size class." },
          fragile: { type: "boolean", description: "True for brittle objects (halves HP)." },
          damage: { type: "string", description: "The damage dealt, as dice (2d6) or a number." },
          ac: { type: "integer", description: "Override the material's AC if you know it." },
          hp: { type: "integer", description: "Override the size's HP if you know it." },
          reason: { type: "string", description: "Short note on what is being broken." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "travel",
      description:
        "Resolve a stretch of overland travel. Pass the hours travelled and the pace (fast, normal, slow); the server reports the pace's effect on watchfulness (fast travellers take -5 passive Perception, slow travellers can move stealthily) and, for a forced march beyond 8 hours, rolls each character's Constitution save and applies a level of exhaustion to any who fail. Call this for a hard day's march instead of deciding fatigue yourself.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          hours: { type: "integer", description: "Hours travelled that day." },
          pace: {
            type: "string",
            enum: ["fast", "normal", "slow"],
            description: "Travel pace. Defaults to normal.",
          },
          characterIds: {
            type: "array",
            items: { type: "string" },
            description: "Who is travelling. Omit for the whole party.",
          },
          reason: { type: "string", description: "Short note on the journey." },
        },
        required: ["hours"],
      },
    },
  },
];

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

function resolveTargets(
  ids: unknown,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet[] {
  if (!Array.isArray(ids) || !ids.length) {
    return sheets;
  }
  const out: CharacterSheet[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const sheet = resolveSheetRef(typeof id === "string" ? id : undefined, sheets, sheetsById);
    if (sheet && !seen.has(sheet.id)) {
      seen.add(sheet.id);
      out.push(sheet);
    }
  }
  return out;
}

// ---- roll_treasure ----

const treasureSchema = z.object({
  cr: z.coerce.number().min(0).max(30),
  characterIds: z.array(z.string()).optional(),
  individual: z.coerce.boolean().optional(),
  reason: z.string().optional(),
});

export function handleRollTreasure(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof treasureSchema>;
  try {
    args = treasureSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: roll_treasure needs a cr." };
  }
  const recipients = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!recipients.length) {
    return { error: "No characters to receive treasure; use characterIds from GAME STATE." };
  }
  const tier = treasureTierForCr(args.cr);
  const { dice, mult } = hoardGoldDice(tier);
  let gold = rollExpression(dice).total * mult;
  if (args.individual) {
    gold = Math.floor(gold / 10);
  }
  const share = Math.floor(gold / recipients.length);
  const reason = (args.reason ?? "").trim() || "treasure";
  const paid: Array<{ name: string; gold: number }> = [];
  if (share > 0) {
    for (const sheet of recipients) {
      applyDmMutation(
        campaign,
        turn.id,
        "modify_gold",
        JSON.stringify({ characterId: sheet.id, delta: share, reason }),
        sheets,
        sheetsById,
      );
      paid.push({ name: sheet.name, gold: share });
    }
  }
  const items = hoardItemCount(tier);
  return {
    ok: true,
    tier,
    totalGold: share * recipients.length,
    perCharacter: paid,
    suggestedMagicItems: items,
    note:
      (share > 0
        ? `${share} gp paid to each of ${recipients.length}; the server moved the coin.`
        : "This challenge yields no coin.") +
      (items
        ? ` A hoard this size tends to hold about ${items} magic item${items === 1 ? "" : "s"}; hand any out with grant_item.`
        : ""),
  };
}

// ---- damage_object ----

const objectSchema = z.object({
  material: z.enum(MATERIALS as [ObjectMaterial, ...ObjectMaterial[]]).optional(),
  size: z.enum(SIZES as [ObjectSize, ...ObjectSize[]]).optional(),
  fragile: z.coerce.boolean().optional(),
  damage: z.string().max(30).optional(),
  ac: z.coerce.number().int().min(1).max(30).optional(),
  hp: z.coerce.number().int().min(1).max(1000).optional(),
  reason: z.string().optional(),
});

export function handleDamageObject(rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof objectSchema>;
  try {
    args = objectSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments for damage_object." };
  }
  const profile = objectProfile(args.material ?? "wood", args.size ?? "medium", args.fragile);
  const ac = args.ac ?? profile.ac;
  const hp = args.hp ?? profile.hp;

  let dealt: number | null = null;
  if (args.damage) {
    if (/^-?\d+$/.test(args.damage.trim())) {
      dealt = Number(args.damage.trim());
    } else if (isValidExpression(args.damage)) {
      dealt = rollExpression(args.damage).total;
    } else {
      return { error: `Invalid damage "${args.damage}".` };
    }
  }
  const broken = dealt !== null && dealt >= hp;
  return {
    ok: true,
    ac,
    hp,
    ...(dealt !== null ? { damage: dealt, broken } : {}),
    note:
      dealt === null
        ? `That object has AC ${ac} and ${hp} HP; a hit needs to beat AC ${ac} and enough damage to matter.`
        : broken
          ? `${dealt} damage meets or exceeds its ${hp} HP: it breaks. Narrate it giving way.`
          : `${dealt} damage does not break it (${hp} HP); it holds. Pass cumulative damage on the next blow.`,
  };
}

// ---- travel ----

const travelSchema = z.object({
  hours: z.coerce.number().int().min(0).max(48),
  pace: z.enum(["fast", "normal", "slow"]).optional(),
  characterIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

export function handleTravel(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof travelSchema>;
  try {
    args = travelSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: travel needs hours." };
  }
  const pace: TravelPace = args.pace ?? "normal";
  const effect = paceEffect(pace);
  const extra = forcedMarchHours(args.hours);

  const paceNote =
    pace === "fast"
      ? "A fast pace means -5 to passive Perception: the party is likelier to be surprised. Reflect that in later check_notice calls."
      : pace === "slow"
        ? "A slow pace lets the party travel stealthily if they wish."
        : "A normal pace carries no perception penalty.";

  if (extra <= 0) {
    return {
      ok: true,
      pace,
      hours: args.hours,
      forcedMarch: false,
      passivePerceptionMod: effect.passivePerceptionMod,
      note: `A day within 8 hours of marching; no exhaustion. ${paceNote}`,
    };
  }

  // Forced march: one Constitution save per traveller against the final extra
  // hour's DC (a simplified reading of the per-hour PHB rule), a failure
  // costing one level of exhaustion applied through the real exhaustion track.
  const dc = forcedMarchSaveDc(extra);
  const targets = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!targets.length) {
    return { error: "No travellers; use characterIds from GAME STATE." };
  }
  const results: Array<{ name: string; save: number | null; failed: boolean; exhaustion?: number }> = [];
  for (const stale of targets) {
    const sheet = getSheetById(stale.id) ?? stale;
    const resolved = resolveRollExpression(
      { kind: "saving_throw", ability: "con", dc } as unknown as RollArgs,
      sheet,
    );
    let failed: boolean;
    let saveTotal: number | null = null;
    if ("error" in resolved) {
      results.push({ name: sheet.name, save: null, failed: false });
      continue;
    }
    if ("autoFail" in resolved) {
      failed = true;
    } else {
      const rolled = rollExpression(resolved.expression);
      saveTotal = rolled.total;
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "saving_throw",
        detail: `${sheet.name}: CON save vs forced march`,
        dc,
        result: rolled,
      });
      publishRoll(campaign.id, roll);
      turn.rollIds.push(roll.id);
      failed = rolled.total < dc;
    }
    const entry: { name: string; save: number | null; failed: boolean; exhaustion?: number } = {
      name: sheet.name,
      save: saveTotal,
      failed,
    };
    if (failed) {
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "set_condition",
        JSON.stringify({ characterId: sheet.id, condition: "exhaustion", reason: "forced march" }),
        sheets,
        sheetsById,
      ).result as { level?: number };
      if (typeof applied.level === "number") {
        entry.exhaustion = applied.level;
      }
    }
    results.push(entry);
  }

  const worn = results.filter((entry) => entry.failed).map((entry) => entry.name);
  return {
    ok: true,
    pace,
    hours: args.hours,
    forcedMarch: true,
    forcedMarchHours: extra,
    dc,
    results,
    note:
      (worn.length
        ? `Forced march (${extra}h past 8, DC ${dc}): ${worn.join(", ")} fail and gain a level of exhaustion (server-applied).`
        : `Forced march (${extra}h past 8, DC ${dc}): everyone holds up.`) + ` ${paceNote}`,
  };
}
