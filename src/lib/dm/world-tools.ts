import { z } from "zod";
import { rollCard } from "@/lib/dm/roll-card";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { chargeLifestyle } from "@/lib/dm/lifestyle";
import { dawnsBetween } from "@/lib/dm/item-charges";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishWithSeq } from "@/lib/events";
import { applyDmMutation } from "@/lib/dm/mutations";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { hourlyConSaves, type HourSave } from "@/lib/dm/endurance";
import {
  hoardGoldDice,
  hoardItemCount,
  treasureTierForCr,
} from "@/lib/srd/treasure";
import type { ObjectMaterial, ObjectSize } from "@/lib/srd/objects";
import { damageObject } from "@/lib/dm/object-damage";
import { forcedMarchHours, forcedMarchSaveDc, paceEffect, travelLeg, type TravelPace } from "@/lib/srd/travel";
import { tickWorldTimeskip } from "@/lib/dm/world-tick";
import { advanceClock, getClock, setTravelPace, setWaterRation } from "@/lib/db/clock";
import { refreshSky } from "@/lib/dm/sky";
import { publishTitleCard } from "@/lib/dm/scene-state";
import { handleApplyHazard } from "@/lib/dm/hazard-tools";
import { describeWeather, weatherExposure, weatherTravelFactor } from "@/lib/srd/weather";
import type { Weather } from "@/lib/scene/state";
import { ADVANCE_UNITS, describeDuration, describeInstant } from "@/lib/dm/calendar";
import { insertCampaignMessage } from "@/lib/db/messages";
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

export const WORLD_TOOL_NAMES = [
  "roll_treasure",
  "damage_object",
  "travel",
  "pass_time",
  "set_weather",
  "show_title",
] as const;

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

// Scarce water under the `supplies` variant (src/lib/dm/supplies.ts): what
// the party can find from now on, kept until the DM says otherwise.
const WATER_PROPERTY = {
  type: "string",
  enum: ["plenty", "half", "none"],
  description:
    "Only when the table plays the supplies variant and water is scarce (a desert, a siege): half is a DC 15 Constitution save each day against a level of exhaustion, none a level each day whatever they carry. It holds until you send plenty.",
};

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
        "Resolve an attempt to break an inanimate object (a door, a chest, a rope, a window) against the DMG object table. Give its name, material and size (or an explicit ac and hp). For a character's weapon blow pass characterId (and weapon): the server rolls their attack against the object's AC and their damage. For anything else pass the damage. A named object keeps the damage it has taken, so each call is one blow; the server reports whether it breaks. Objects are immune to poison and psychic damage. A section of a Wall of Ice is named 'Wall of Ice section N' (10-foot sections from the end it was laid from): the server uses its AC 12 and 30 hit points, doubles fire, and when it breaks opens its squares and lays the frigid air.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "What the object is, e.g. 'the oak door'. The server keeps its damage between blows." },
          characterId: { type: "string", description: "The character striking it with a weapon; the server rolls their attack and damage." },
          weapon: { type: "string", description: "The weapon they strike with, from their equipment." },
          damageType: { type: "string", description: "Damage type, for damage you pass yourself." },
          material: { type: "string", enum: MATERIALS, description: "What the object is made of." },
          size: { type: "string", enum: SIZES, description: "Its size class." },
          fragile: { type: "boolean", description: "True for brittle objects (halves HP)." },
          damage: { type: "string", description: "The damage dealt by something other than a character's weapon, as dice (2d6) or a number." },
          ac: { type: "integer", description: "Override the material's AC if you know it." },
          hp: { type: "integer", description: "Override the size's HP if you know it." },
          threshold: { type: "integer", description: "Damage threshold (castle walls, ships): a blow below it does nothing." },
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
        "Resolve a stretch of overland travel, one day's leg at a time. Pass the hours travelled, or the miles to cover, and the pace (fast, normal, slow); the server moves the clock, reports the miles covered (4, 3 or 2 an hour, half in difficult terrain, less in snow or a storm), the pace's effect on watchfulness (fast travellers take -5 passive Perception; only a slow pace allows stealth, so Stealth checks are refused while the party marches at a normal or fast pace) and, for a forced march beyond 8 hours, rolls each character's Constitution save and applies a level of exhaustion to any who fail. Call this for a day's march instead of deciding distance or fatigue yourself.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          hours: { type: "integer", description: "Hours travelled that day. Give this or miles." },
          miles: {
            type: "number",
            description: "Miles to cover instead of hours: the server works out the hours the pace, the ground and the weather need (one day's leg, 24 hours at most).",
          },
          terrain: {
            type: "string",
            enum: ["normal", "difficult"],
            description: "Difficult terrain (dense forest, deep swamp, steep mountains, ice) halves the distance covered. Defaults to normal.",
          },
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
          water: WATER_PROPERTY,
          reason: { type: "string", description: "Short note on the journey." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pass_time",
      description:
        "Move the in-world clock forward when time passes and nothing else accounts for it: waiting out a storm, a night at an inn, a week of downtime, a long conversation. Travel and rests already advance the clock themselves, so do not call this alongside them. Time only moves forward.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          amount: { type: "integer", minimum: 1, description: "How much time passes." },
          unit: {
            type: "string",
            enum: ["minutes", "hours", "days", "weeks"],
            description: "Unit of the amount. Defaults to hours.",
          },
          water: WATER_PROPERTY,
          reason: { type: "string", description: "Short note on what filled the time." },
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_weather",
      description:
        "Change the weather over the table when the story calls for it (a storm rolls in, the fog lifts). The server rolls weather on its own at each dawn and on long journeys; call this only to overrule it. Rain and fog cut what anyone sees and give disadvantage on Perception by sight; a gale gives disadvantage on ranged attacks past 30 ft; frigid or hot air is a hazard on a long march; the board's light follows the sky outdoors.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          sky: {
            type: "string",
            enum: ["clear", "overcast", "rain", "storm", "snow", "fog", "wind"],
          },
          temperature: { type: "string", enum: ["frigid", "cold", "mild", "warm", "hot"] },
          wind: { type: "string", enum: ["calm", "breeze", "gale"] },
          precipitation: {
            type: "integer",
            minimum: 0,
            maximum: 3,
            description: "0 none, 1 light, 2 steady, 3 heavy. Defaults from the sky.",
          },
          reason: { type: "string" },
        },
        required: ["sky"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_title",
      description:
        "Put a title card on every screen for a moment: a chapter name, a place the party arrives at, a dramatic reveal. Chapters, fights and dawns already show their own cards; use this for a beat that deserves one.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "A few words in display type." },
          subtitle: { type: "string", description: "One line under it, optional." },
          tone: {
            type: "string",
            enum: ["gold", "ember", "dawn", "plain"],
            description: "Gold for wonder or a chapter, ember for danger, dawn for relief.",
          },
        },
        required: ["title"],
      },
    },
  },
];

const weatherSchema = z.object({
  sky: z.enum(["clear", "overcast", "rain", "storm", "snow", "fog", "wind"]),
  temperature: z.enum(["frigid", "cold", "mild", "warm", "hot"]).optional(),
  wind: z.enum(["calm", "breeze", "gale"]).optional(),
  precipitation: z.coerce.number().int().min(0).max(3).optional(),
  reason: z.string().optional(),
});

export function handleSetWeather(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof weatherSchema>;
  try {
    args = weatherSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_weather needs a sky." };
  }
  const current = getClock(campaign.id).weather;
  const precipitation =
    args.precipitation ??
    (args.sky === "storm" ? 3 : args.sky === "rain" ? 2 : args.sky === "snow" ? 2 : 0);
  const weather: Weather = {
    sky: args.sky,
    temperature: args.temperature ?? current?.temperature ?? "mild",
    wind: args.wind ?? (args.sky === "storm" || args.sky === "wind" ? "gale" : current?.wind ?? "calm"),
    precipitation: precipitation as Weather["precipitation"],
  };
  const scene = refreshSky(campaign.id, { force: weather });
  const sentence = describeWeather(weather);
  tableNote(campaign, `${sentence}${args.reason ? ` ${args.reason}` : ""}`);
  return {
    ok: true,
    weather: sentence,
    ...(scene ? { light: scene.isDark ? "dark" : "daylight" } : {}),
    note: "The board's light, Perception, ranged attacks and travel now follow this sky.",
  };
}

const titleSchema = z.object({
  title: z.string().trim().min(1).max(60),
  subtitle: z.string().trim().max(120).optional(),
  tone: z.enum(["gold", "ember", "dawn", "plain"]).optional(),
});

export function handleShowTitle(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof titleSchema>;
  try {
    args = titleSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: show_title needs a title." };
  }
  publishTitleCard(campaign.id, {
    title: args.title,
    ...(args.subtitle ? { subtitle: args.subtitle } : {}),
    tone: args.tone ?? "gold",
  });
  return { ok: true, shown: args.title };
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
  let gold = rollCard(campaign, turn, null, "custom", `Treasure: gold (${dice} × ${mult})`, dice, null).total * mult;
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

// A character's own attack against an object's AC, and damage the object
// keeps between blows when it is named (src/lib/dm/object-damage.ts).
export function handleDamageObject(
  rawArguments: string,
  campaign: Campaign | null = null,
  turn: DmTurn | null = null,
): Record<string, unknown> {
  return damageObject(campaign, turn, rawArguments);
}

// ---- travel ----

const travelSchema = z.object({
  hours: z.coerce.number().int().min(0).max(48).optional(),
  miles: z.coerce.number().min(0.1).max(200).optional(),
  terrain: z.enum(["normal", "difficult"]).optional(),
  pace: z.enum(["fast", "normal", "slow"]).optional(),
  characterIds: z.array(z.string()).optional(),
  water: z.enum(["plenty", "half", "none"]).optional(),
  reason: z.string().optional(),
});

// A system line in the transcript, the same shape every other engine uses to
// tell the table something happened without the model having to say it.
function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "cue-bell",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

const passTimeSchema = z.object({
  amount: z.coerce.number().int().min(1).max(10000),
  unit: z.enum(ADVANCE_UNITS).default("hours"),
  water: z.enum(["plenty", "half", "none"]).optional(),
  reason: z.string().max(200).optional(),
});

// Moving the in-world clock without travelling anywhere: waiting out a
// storm, a night in an inn, a week of downtime. Travel and rests move it
// themselves, so this is for the time nothing else accounts for.
//
// Time only ever moves forward here. Undoing a passage of time is the audit
// trail's job (audit/revert-turn), not arithmetic's, because a clock that
// could run backwards would silently un-expire conditions and rests.
export function handlePassTime(
  campaign: Campaign,
  rawArguments: string,
): Record<string, unknown> {
  let args: z.infer<typeof passTimeSchema>;
  try {
    args = passTimeSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: pass_time needs an amount and a unit." };
  }
  if (args.water) {
    setWaterRation(campaign.id, args.water);
  }
  const before = getClock(campaign.id);
  const moved = advanceClock(campaign.id, args.amount, args.unit);
  if ("error" in moved) {
    return moved;
  }
  // Time spent anywhere but the road ends the march and its pace.
  setTravelPace(campaign.id, null);
  // Each dawn that passes in town is a day of each character's lifestyle
  // (src/lib/dm/lifestyle.ts); a character with none chosen pays nothing.
  const dawns = dawnsBetween(before.instant, moved.clock.instant);
  const living = dawns
    ? listSheets(campaign.id).map((sheet) => chargeLifestyle(campaign, sheet.id, dawns)?.line).filter((line): line is string => Boolean(line))
    : [];
  // A stretch of time is a timeskip: the off-screen world moves once per
  // four hours, the same rate travel uses.
  const ticks = Math.min(24, Math.floor(moved.minutes / (4 * 60)));
  if (ticks > 0) {
    tickWorldTimeskip(campaign.id, ticks);
  }
  // The sky moves with the clock: a new day rolls new weather.
  const sky = refreshSky(campaign.id, { before, minutes: moved.minutes });
  tableNote(
    campaign,
    `${describeDuration(moved.minutes)} passes${args.reason ? `: ${args.reason}` : ""}. It is now ${describeInstant(moved.clock.calendar, moved.clock.instant)}.`,
  );
  return {
    ok: true,
    passed: describeDuration(moved.minutes),
    now: describeInstant(moved.clock.calendar, moved.clock.instant),
    ...(sky?.summary ? { weather: sky.summary } : {}),
    ...(living.length ? { lifestyle: living } : {}),
  };
}

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
    return { error: "Invalid arguments: travel needs hours or miles." };
  }
  if (args.water) {
    setWaterRation(campaign.id, args.water);
  }
  const pace: TravelPace = args.pace ?? "normal";
  const effect = paceEffect(pace);
  const terrain = args.terrain ?? "normal";
  // Miles or hours: whichever is given sets the other (SRD 5.1, Travel
  // Pace), at the weather the party sets out in.
  const before = getClock(campaign.id);
  const leg = travelLeg({ pace, terrain, hours: args.hours, miles: args.miles, weatherFactor: before.weather ? weatherTravelFactor(before.weather) : 1 });
  if ("error" in leg) {
    return leg;
  }
  const legHours = leg.hours;
  const extra = forcedMarchHours(legHours);

  // A journey is a timeskip: the off-screen world moves roughly once per
  // four hours on the road (world arcs, NPC goals; zero model calls).
  tickWorldTimeskip(campaign.id, Math.max(1, Math.round(legHours / 4)));

  // The hours the party spent on the road are hours the world spent too, so
  // the clock moves with them. Before this the in-world date never changed
  // no matter how far anyone walked.
  const moved = advanceClock(campaign.id, leg.minutes, "minutes");
  const now = "error" in moved ? "" : describeInstant(moved.clock.calendar, moved.clock.instant);
  // A leg of four hours or more rolls the sky; the sky then has its say on
  // the march: snow and storm halve the ground covered, and frigid or hot
  // air is the extreme cold or heat hazard for every traveller.
  const sky = refreshSky(campaign.id, {
    before,
    minutes: "error" in moved ? 0 : moved.minutes,
  });
  const weatherNotes: string[] = [];
  const weatherOutcome: Record<string, unknown> = {};
  // The ground covered: miles an hour of the pace, halved in difficult
  // terrain, cut by the weather the party set out in (src/lib/srd/travel.ts).
  weatherOutcome.miles = leg.miles;
  if (terrain === "difficult") {
    weatherNotes.push("Difficult terrain halves the distance.");
  }
  if (sky?.weather) {
    const factor = weatherTravelFactor(sky.weather);
    if (factor < 1) {
      weatherNotes.push(
        `${sky.weather.sky === "snow" ? "Snow underfoot" : "The weather"} slows the march: the party covers about ${Math.round(factor * 100)} percent of the usual distance.`,
      );
      weatherOutcome.distanceFactor = factor;
    }
    const exposure = weatherExposure(sky.weather);
    if (exposure && legHours >= 4) {
      const hazard = handleApplyHazard(
        campaign,
        turn,
        JSON.stringify({
          type: exposure,
          characterIds: resolveTargets(args.characterIds, sheets, sheetsById).map((sheet) => sheet.id),
          // One save for every hour on the road in it.
          hours: legHours,
          reason: exposure === "extreme_cold" ? "hours in the bitter cold" : "hours in the heat",
        }),
        sheets,
        sheetsById,
      );
      weatherOutcome.exposure = hazard;
      weatherNotes.push(
        exposure === "extreme_cold"
          ? "The cold is a hazard: the server rolled a Constitution save for each hour and applied any exhaustion."
          : "The heat is a hazard: the server rolled a Constitution save for each hour and applied any exhaustion.",
      );
    }
    weatherOutcome.weather = sky.summary;
  }

  // The pace holds until the party stops: check_notice reads it (a fast
  // pace is -5 to passive Perception) until a rest or pass_time ends the
  // march (src/lib/db/clock.ts).
  setTravelPace(campaign.id, pace);
  const paceNote =
    pace === "fast"
      ? "A fast pace means -5 to passive Perception: the party is likelier to be surprised. check_notice applies it by itself until the party rests or stops."
      : pace === "slow"
        ? "A slow pace lets the party travel stealthily if they wish."
        : "A normal pace carries no perception penalty, and like a fast one it allows no stealth: Stealth checks are refused until the march ends.";

  if (extra <= 0) {
    return {
      ok: true,
      pace,
      hours: legHours,
      forcedMarch: false,
      passivePerceptionMod: effect.passivePerceptionMod,
      ...(now ? { now } : {}),
      ...weatherOutcome,
      note: `A day within 8 hours of marching; no exhaustion. ${paceNote}${weatherNotes.length ? ` ${weatherNotes.join(" ")}` : ""}`,
    };
  }

  // Forced march: a Constitution save at the end of every hour past eight,
  // DC 10 + 1 for each hour past 8 (SRD 5.1, Travel Pace), each failure a
  // level of exhaustion through the real exhaustion track.
  const dc = forcedMarchSaveDc(extra);
  const targets = resolveTargets(args.characterIds, sheets, sheetsById);
  if (!targets.length) {
    return { error: "No travellers; use characterIds from GAME STATE." };
  }
  const hours = Array.from({ length: extra }, (_, index) => ({
    hour: index + 1,
    dc: forcedMarchSaveDc(index + 1),
  }));
  const results: Array<{ name: string; saves: HourSave[]; failed: boolean; exhaustion?: number }> = [];
  for (const stale of targets) {
    const sheet = getSheetById(stale.id) ?? stale;
    const saves = hourlyConSaves({
      campaign,
      turn,
      sheet,
      hours,
      detail: (hour) => `${sheet.name}: CON save vs forced march, hour ${8 + hour}`,
      reason: "forced march",
      sheets,
      sheetsById,
    });
    const failures = saves.filter((entry) => entry.failed);
    results.push({
      name: sheet.name,
      saves,
      failed: failures.length > 0,
      ...(failures.length ? { exhaustion: failures[failures.length - 1].exhaustion } : {}),
    });
  }

  const worn = results.filter((entry) => entry.failed).map((entry) => entry.name);
  return {
    ok: true,
    pace,
    hours: legHours,
    miles: weatherOutcome.miles,
    forcedMarch: true,
    forcedMarchHours: extra,
    dc,
    results,
    note:
      (worn.length
        ? `Forced march (${extra}h past 8, one save an hour up to DC ${dc}): ${worn.join(", ")} failed and gained a level of exhaustion for each failed hour (server-applied).`
        : `Forced march (${extra}h past 8, one save an hour up to DC ${dc}): everyone holds up.`) + ` ${paceNote}`,
  };
}
