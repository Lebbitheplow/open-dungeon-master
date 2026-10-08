// The tools for what the exploration rules hold outside the fight: shifting
// a heavy load (lift), the lifestyle a character lives between adventures
// (set_lifestyle), the downtime activities (downtime), and the SRD's
// diseases, madness and poisons (afflict). Each resolves in the engine
// (src/lib/dm/load-rules.ts, lifestyle.ts, afflictions.ts,
// affliction-poisons.ts); the model narrates what they report.

import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { advanceClock, setTravelPace } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { describeDuration, describeInstant } from "@/lib/dm/calendar";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { liftLimits, weighed } from "@/lib/dm/load-rules";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import { sizeForRace } from "@/lib/srd";
import { LIFESTYLES } from "@/lib/dm/between-state";
import { tableNote, writeLifestyle } from "@/lib/dm/between-io";
import { LIFESTYLE_COST_CP, downtimeProblem, spendDowntime, type DowntimeEntry } from "@/lib/dm/lifestyle";
import { infectDisease, infectWorkshopDisease, inflictMadness } from "@/lib/dm/afflictions";
import { diseaseAt, hazardNamesAt, poisonAt } from "@/lib/srd/table-hazards";
import { applyPoison } from "@/lib/dm/affliction-poisons";
import { DISEASES, POISONS, findDisease } from "@/lib/srd/afflictions";
import { formatCopper } from "@/lib/srd/currency";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const EXPLORE_TOOL_NAMES = ["lift", "set_lifestyle", "downtime", "afflict"] as const;

const ACTIVITIES = ["crafting", "profession", "recuperating", "research", "training"] as const;

const activityProperties = {
  characterId: { type: "string", description: "Exact characterId from GAME STATE." },
  activity: { type: "string", enum: [...ACTIVITIES], description: "What they spend the days on." },
  item: { type: "string", description: "Crafting: the nonmagical item being made (its market value sets the work: 5 gp a day per crafter, materials half the value, paid at the start)." },
  tool: { type: "string", description: "Crafting: the artisan's tools used; the crafter and every helper must be proficient with them." },
  helperIds: { type: "array", items: { type: "string" }, description: "Crafting: other characters proficient with the tools working on the same item; each adds 5 gp a day." },
  subject: { type: "string", description: "Training: the language or tool being learned (250 days at 1 gp a day)." },
  kind: { type: "string", enum: ["language", "tool"], description: "Training: a language or a tool." },
  topic: { type: "string", description: "Research: the question being researched (1 gp a day; what is found is yours to decide)." },
  recover: { type: "string", enum: ["advantage", "end_effect"], description: "Recuperating: on a successful DC 15 CON save after three days, advantage on saves against their disease or poison for 24 hours (default), or end an effect that stops them regaining hit points." },
  organization: { type: "boolean", description: "Profession: a member of an organization that employs them (covers a comfortable lifestyle)." },
  perform: { type: "boolean", description: "Profession: performing, for a character proficient in Performance (covers a wealthy lifestyle)." },
};

export const exploreTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "lift",
      description:
        "A character pushes, drags or lifts something heavy. The server checks it against their Strength: up to 30 x Strength pounds (doubled per size above Medium) can be moved at all, and past their carrying capacity (15 x Strength) they move at 5 feet while pushing or dragging it. Refused above the limit: narrate the strain and the failure. For carrying something, use grant_item, which refuses a pack past capacity.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          weightLb: { type: "number", minimum: 1, description: "The weight in pounds (a boulder, a fallen beam, a portcullis)." },
          how: { type: "string", enum: ["lift", "push", "drag"], description: "Lift, push or drag. Defaults to lift." },
          reason: { type: "string", description: "Short note on what is being moved." },
        },
        required: ["characterId", "weightLb"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_lifestyle",
      description:
        "Set the lifestyle characters live between adventures (SRD 5.1 Lifestyle Expenses): wretched (free), squalid (1 sp a day), poor (2 sp), modest (1 gp), comfortable (2 gp), wealthy (4 gp), aristocratic (10 gp). From then on each dawn that pass_time or a long rest crosses charges a day of it from their purse, and downtime charges its days; a purse that cannot keep it up lives the best it can pay for. Set it when the party settles into town; set none when they leave for the road (they live off their supplies there).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterIds: { type: "array", items: { type: "string" }, description: "Exact characterIds. Omit for the whole party." },
          lifestyle: { type: "string", enum: [...LIFESTYLES, "none"], description: "The lifestyle, or none to stop charging." },
          reason: { type: "string", description: "Short note." },
        },
        required: ["lifestyle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "downtime",
      description:
        "Days of downtime between adventures (SRD 5.1 Downtime Activities), each character on one activity: crafting (5 gp of an item's value a day per crafter, materials half the value, the finished item lands in the pack), profession (work that pays their lifestyle), recuperating (a DC 15 CON save every three days against a disease or poison), research (1 gp a day; what is found is yours to say) or training (a language or tool in 250 days at 1 gp a day). The server moves the clock by the days once, charges lifestyles and costs, keeps the progress and applies the results. Give one character's activity at the top level, or several in activities.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          days: { type: "integer", minimum: 1, maximum: 365, description: "Days of downtime, at least 8 hours of work each." },
          ...activityProperties,
          activities: {
            type: "array",
            description: "Several characters at once, each with their own activity and fields.",
            items: { type: "object", additionalProperties: false, properties: activityProperties, required: ["characterId", "activity"] },
          },
          reason: { type: "string", description: "Short note on the downtime." },
        },
        required: ["days"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "afflict",
      description:
        `Lay an SRD disease, madness or poison on a character; the server rolls the save and holds the effects from then on. Diseases (${Object.values(DISEASES).map((disease) => disease.name).join(", ")}): a CON save against catching it, symptoms after their incubation, then the disease's own saves after each long rest; lesser restoration cures it. Madness (short, long or indefinite): the server rolls the SRD table and its duration and applies the conditions; pass saveDc (and saveAbility wis or cha) for an effect that allows a save. Poisons (${POISONS.filter((poison) => poison.type !== "injury").map((poison) => poison.name).join(", ")}, and the injury poisons when a poisoned blade strikes a character): the server rolls the CON save, the damage and the conditions. The table's own diseases and poisons from the workshop are named under GAME STATE and work the same way. Never narrate a disease, madness or poison taking hold without this call.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          kind: { type: "string", enum: ["disease", "madness", "poison"], description: "What it is." },
          name: { type: "string", description: "The disease or poison by name, or for madness: short, long or indefinite." },
          save: { type: "boolean", description: "Default true: the server rolls the save against it. False when the character is already infected or has no save (a madness from a failed save you already rolled)." },
          dc: { type: "integer", minimum: 1, maximum: 30, description: "A disease's infection DC when the source sets its own; the SRD's otherwise." },
          saveDc: { type: "integer", minimum: 1, maximum: 30, description: "Madness only: the DC of the save that resists it." },
          saveAbility: { type: "string", enum: ["wis", "cha"], description: "Madness only: the save's ability. Default wis." },
          symptomsNow: { type: "boolean", description: "Disease only: the symptoms show now rather than after the incubation." },
          reason: { type: "string", description: "Short note on the source." },
        },
        required: ["characterId", "kind", "name"],
      },
    },
  },
];

function resolveTargets(ids: unknown, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): CharacterSheet[] {
  if (!Array.isArray(ids) || !ids.length) {
    return sheets;
  }
  return ids
    .map((id) => resolveSheetRef(typeof id === "string" ? id : undefined, sheets, sheetsById))
    .filter((sheet): sheet is CharacterSheet => Boolean(sheet));
}

// ---- lift ----

const liftSchema = z.object({
  characterId: z.string(),
  weightLb: z.coerce.number().min(1).max(100000),
  how: z.enum(["lift", "push", "drag"]).optional(),
  reason: z.string().max(200).optional(),
});

function handleLift(args: z.infer<typeof liftSchema>, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): Record<string, unknown> {
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const how = args.how ?? "lift";
  const limits = liftLimits(sheet);
  if (args.weightLb > limits.liftLb) {
    return {
      error: `${sheet.name} can push, drag or lift at most ${limits.liftLb} lb (30 x Strength); ${args.weightLb} lb does not move. Narrate the strain; more hands (another character's own lift) or a lever are the way.`,
    };
  }
  const load = encumbranceFor({
    strength: sheet.abilities.str,
    equipment: weighed(sheet.equipment),
    coins: sheet.gold ?? 0,
    size: sizeForRace(sheet.race),
    wearer: sheet,
  });
  const total = load.carriedLb + args.weightLb;
  const slowed = total > limits.capacityLb;
  return {
    ok: true,
    [how === "lift" ? "lifted" : how === "push" ? "pushed" : "dragged"]: `${args.weightLb} lb`,
    limitLb: limits.liftLb,
    capacityLb: limits.capacityLb,
    ...(slowed ? { speed: 5 } : {}),
    note: slowed
      ? `${sheet.name} ${how === "lift" ? "lifts it but cannot carry it" : `${how}s it`}: with their pack that is ${total} lb, past their ${limits.capacityLb} lb capacity, so they move at 5 feet while ${how === "lift" ? "holding" : `${how}ing`} it.`
      : `${sheet.name} ${how}s it; it is within what they can carry.`,
  };
}

// ---- lifestyle ----

const lifestyleSchema = z.object({
  characterIds: z.array(z.string()).optional(),
  lifestyle: z.enum([...LIFESTYLES, "none"]),
  reason: z.string().max(200).optional(),
});

// ---- downtime ----

const entrySchema = z.object({
  characterId: z.string(),
  activity: z.enum(ACTIVITIES),
  item: z.string().max(80).optional(),
  tool: z.string().max(60).optional(),
  helperIds: z.array(z.string()).max(6).optional(),
  subject: z.string().max(60).optional(),
  kind: z.enum(["language", "tool"]).optional(),
  topic: z.string().max(120).optional(),
  recover: z.enum(["advantage", "end_effect"]).optional(),
  organization: z.boolean().optional(),
  perform: z.boolean().optional(),
});

const downtimeSchema = entrySchema.partial().extend({
  days: z.coerce.number().int().min(1).max(365),
  activities: z.array(entrySchema).max(12).optional(),
  reason: z.string().max(200).optional(),
});

// ---- afflict ----

const afflictSchema = z.object({
  characterId: z.string(),
  kind: z.enum(["disease", "madness", "poison"]),
  name: z.string().max(60),
  save: z.boolean().optional(),
  dc: z.coerce.number().int().min(1).max(30).optional(),
  saveDc: z.coerce.number().int().min(1).max(30).optional(),
  saveAbility: z.enum(["wis", "cha"]).optional(),
  symptomsNow: z.boolean().optional(),
  reason: z.string().max(200).optional(),
});

function parse<T>(schema: z.ZodType<T>, rawArguments: string): T | null {
  try {
    return schema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return null;
  }
}

export function handleExploreCall(
  campaign: Campaign,
  turn: DmTurn,
  name: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  if (name === "lift") {
    const args = parse(liftSchema, rawArguments);
    return args ? handleLift(args, sheets, sheetsById) : { error: "Invalid arguments: lift needs characterId and weightLb." };
  }
  if (name === "set_lifestyle") {
    const args = parse(lifestyleSchema, rawArguments);
    if (!args) {
      return { error: `Invalid arguments: set_lifestyle needs a lifestyle (${LIFESTYLES.join(", ")}, or none).` };
    }
    const targets = resolveTargets(args.characterIds, sheets, sheetsById);
    if (!targets.length) {
      return { error: "No valid characters; use characterIds from GAME STATE." };
    }
    for (const sheet of targets) {
      writeLifestyle(campaign.id, sheet.id, args.lifestyle === "none" ? null : args.lifestyle);
    }
    const names = targets.map((sheet) => sheet.name).join(", ");
    return {
      ok: true,
      lifestyle: args.lifestyle,
      characters: targets.map((sheet) => sheet.name),
      note: args.lifestyle === "none"
        ? `${names} live off their supplies; no lifestyle is charged.`
        : `${names} live ${args.lifestyle}: ${formatCopper(LIFESTYLE_COST_CP[args.lifestyle])} a day, charged at each dawn that passes in town and for each day of downtime.`,
    };
  }
  if (name === "downtime") {
    const args = parse(downtimeSchema, rawArguments);
    if (!args) {
      return { error: "Invalid arguments: downtime needs days, and a characterId with an activity (or activities)." };
    }
    if (getActiveEncounter(campaign.id)) {
      return { error: "Downtime is time between adventures; end the fight first." };
    }
    const entries: DowntimeEntry[] = args.activities?.length
      ? args.activities
      : args.characterId && args.activity
        ? [args as DowntimeEntry]
        : [];
    if (!entries.length) {
      return { error: "downtime needs a characterId and an activity, or activities." };
    }
    const resolved: DowntimeEntry[] = [];
    for (const entry of entries) {
      const stale = resolveSheetRef(entry.characterId, sheets, sheetsById);
      const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
      if (!sheet) {
        return { error: `Unknown characterId ${entry.characterId}; use one from GAME STATE. No time passed.` };
      }
      const fixed = { ...entry, characterId: sheet.id };
      const problem = downtimeProblem(campaign, sheet, fixed);
      if (problem) {
        return { error: `${problem} No time passed.` };
      }
      resolved.push(fixed);
    }
    const moved = advanceClock(campaign.id, args.days, "days");
    if ("error" in moved) {
      return moved;
    }
    setTravelPace(campaign.id, null);
    const lines = resolved.flatMap((entry) => spendDowntime(campaign, turn.id, entry, args.days));
    const now = describeInstant(moved.clock.calendar, moved.clock.instant);
    tableNote(campaign, `${describeDuration(moved.minutes)} of downtime passes. It is now ${now}.`, "cue-bell");
    return { ok: true, days: args.days, now, results: lines, note: "Narrate the days from these results." };
  }
  if (name === "afflict") {
    const args = parse(afflictSchema, rawArguments);
    if (!args) {
      return { error: "Invalid arguments: afflict needs characterId, kind (disease, madness, poison) and name." };
    }
    const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
    const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
    if (!sheet) {
      return { error: "Unknown characterId; use one from GAME STATE." };
    }
    if (sheet.deathSaves?.dead) {
      return { error: `${sheet.name} is dead; nothing more takes hold.` };
    }
    if (args.kind === "disease") {
      const disease = findDisease(args.name);
      if (disease) {
        return infectDisease(campaign, turn.id, sheet, disease, { save: args.save, dc: args.dc, symptomsNow: args.symptomsNow });
      }
      // One of the table's own (the workshop's hazards).
      const own = diseaseAt(args.name, campaign.id);
      if (own) {
        return infectWorkshopDisease(campaign, turn.id, sheet, own, { save: args.save, dc: args.dc, symptomsNow: args.symptomsNow });
      }
      const table = hazardNamesAt(campaign.id).disease;
      return { error: `The server knows the SRD diseases ${Object.values(DISEASES).map((entry) => entry.name).join(", ")}${table.length ? ` and this table's ${table.join(", ")}` : ""}; "${args.name}" is not one. A story illness is set_condition with a duration.` };
    }
    if (args.kind === "madness") {
      const kind = /indef/i.test(args.name) ? "indefinite" : /long/i.test(args.name) ? "long" : /short/i.test(args.name) ? "short" : null;
      if (!kind) {
        return { error: "Madness is short, long or indefinite: pass that as name." };
      }
      return inflictMadness(campaign, turn.id, sheet, kind, { saveDc: args.save === false ? undefined : args.saveDc, saveAbility: args.saveAbility });
    }
    const poison = poisonAt(args.name, campaign.id);
    if (!poison) {
      const table = hazardNamesAt(campaign.id).poison;
      return { error: `The server knows the SRD poisons ${POISONS.map((entry) => entry.name).join(", ")}${table.length ? ` and this table's ${table.join(", ")}` : ""}; "${args.name}" is not one. Another poison is apply_damage with type poison and set_condition poisoned with a duration.` };
    }
    return applyPoison(campaign, turn.id, sheet, poison, { save: args.save });
  }
  return { error: `Unknown tool ${name}.` };
}
