import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { resourceDef, resourceLevel } from "@/lib/srd/class-resources";
import {
  defaultShortRestDice,
  longRestPatch,
  settleAttuning,
  shortRestResourcePatch,
} from "@/lib/dm/rest-logic";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { normalizeRestKind } from "@/lib/dm/arg-coerce";
import { tickWorldTimeskip } from "@/lib/dm/world-tick";
import { advanceClock, getClock, openShortRestWindow, recordLongRests, setTravelPace } from "@/lib/db/clock";
import { getDmTurn } from "@/lib/db/dm-turns";
import { partySongOfRestDie, playerChoosesHitDice, spendHitDice } from "@/lib/dm/hit-dice";
import { goingWithout } from "@/lib/dm/supplies";
import { afflictedRestPatch, afflictionsAfterLongRest } from "@/lib/dm/afflictions";
import { chargeLifestyle } from "@/lib/dm/lifestyle";
import { dawnsBetween } from "@/lib/dm/item-charges";
import { refreshSky } from "@/lib/dm/sky";
import { publishTitleCard } from "@/lib/dm/scene-state";
import {
  describeDuration,
  describeInstant,
  longRestAllowed,
  restMinutes,
} from "@/lib/dm/calendar";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { authoredRestTempHp } from "@/lib/dm/authored-turns";
import { tranquilityAfterLongRest } from "@/lib/dm/srd-defenses";

// The rest engine: short rests spend hit dice with real server rolls, long
// rests restore HP, slots, and half the hit dice. Every sheet write is
// audited (kinds rest_short / rest_long) so the party lead can undo it.

export const REST_TOOL_NAMES = ["take_rest"] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const takeRestTool: ToolDef = {
  type: "function",
  function: {
    name: "take_rest",
    description:
      "The party rests. Call this BEFORE narrating any recovery; never narrate HP, spell slots, or hit dice returning without it. kind=short is a breather of an hour or more: characters spend hit dice to heal (the server rolls them; a player at the table chooses how many on their own sheet), and an item waiting to be attuned becomes attuned. kind=long is a full night's sleep: HP and spell slots restore fully and half the hit dice return. Not usable during combat.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["short", "long"] },
        spend: {
          type: "array",
          description:
            "Short rest only: hit dice to spend for a character whose player is not at the table (the server otherwise spends toward half HP for them). A connected player chooses their own hit dice on their sheet after the rest; the server rolls them.",
          items: {
            type: "object",
            properties: {
              characterId: { type: "string", description: "Exact characterId from GAME STATE." },
              dice: { type: "integer", minimum: 1, maximum: 20 },
            },
            required: ["characterId", "dice"],
          },
        },
        reason: { type: "string", description: "Short in-fiction description of the rest." },
      },
      required: ["kind"],
    },
  },
};

export const restTools: ToolDef[] = [takeRestTool];

const restArgsSchema = z.object({
  kind: z.preprocess(normalizeRestKind, z.enum(["short", "long"])),
  spend: z
    .array(z.object({ characterId: z.string(), dice: z.number().int().min(1).max(20) }))
    .optional(),
  reason: z.string().optional(),
});

// Flat fallback for the textual-salvage path (no arrays): a single
// characterId/dice pair becomes a one-entry spend list.
function parseRestArgs(rawArguments: string): z.infer<typeof restArgsSchema> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const nested = restArgsSchema.safeParse(raw);
  if (nested.success) {
    return nested.data;
  }
  // A spend list that was sent and cannot be read is a request that was not
  // understood. Running the rest on the server's own spending would spend
  // somebody's hit dice on it, so the whole call is refused.
  if (raw && typeof raw === "object" && "spend" in raw && (raw as { spend?: unknown }).spend != null) {
    return null;
  }
  const flat = z
    .object({
      kind: z.preprocess(normalizeRestKind, z.enum(["short", "long"])),
      characterId: z.string().optional(),
      dice: z.coerce.number().int().min(1).max(20).optional(),
      reason: z.string().optional(),
    })
    .safeParse(raw);
  if (flat.success) {
    return {
      kind: flat.data.kind,
      spend:
        flat.data.characterId && flat.data.dice
          ? [{ characterId: flat.data.characterId, dice: flat.data.dice }]
          : undefined,
      reason: flat.data.reason,
    };
  }
  return null;
}

function auditRest(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  kind: string,
  patch: FullPatchSheetInput,
  reason: string,
) {
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind,
    delta: patch as Record<string, unknown>,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

export function handleTakeRest(
  campaign: Campaign,
  turnId: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  if (getActiveEncounter(campaign.id)) {
    return { error: "The party cannot rest during combat. End the encounter first." };
  }
  const args = parseRestArgs(rawArguments);
  if (!args) {
    return {
      error:
        'Invalid take_rest arguments. Send {"kind":"short"} or {"kind":"long"}; a spend list is [{"characterId": "...", "dice": 1}] with whole dice of 1 or more. Nobody rested and no time passed.',
    };
  }
  const reason = (args.reason ?? `${args.kind} rest`).slice(0, 200);
  const variant = campaign.gameSettings.variantRules.restVariant;

  // Who gains from a long rest is decided from how they START it: alive, at
  // least 1 hit point, and no long rest ended in the 24 hours before this
  // one ends (SRD 5.1, Long Rest). Decided before the clock moves, because
  // the hours of the rest themselves wake a stable character. The rest
  // happens whoever gains from it: the hours pass, conditions run out and a
  // stable creature wakes, even when nobody at the table qualifies.
  const starts = getClock(campaign.id);
  const endsAt = starts.instant + restMinutes(args.kind, variant);
  const resting: string[] = [];
  const unaffected: string[] = [];
  if (args.kind === "long") {
    for (const stale of sheets) {
      const sheet = getSheetById(stale.id);
      if (!sheet) {
        continue;
      }
      if (sheet.deathSaves?.dead) {
        unaffected.push(`${sheet.name} (dead)`);
      } else if (sheet.currentHp <= 0) {
        unaffected.push(`${sheet.name} (at 0 hit points; a long rest needs at least 1 to begin with)`);
      } else if (!longRestAllowed(starts.longRests?.[sheet.id], endsAt)) {
        unaffected.push(`${sheet.name} (finished a long rest less than 24 hours ago)`);
      } else {
        resting.push(sheet.id);
      }
    }
  }

  // A rest takes in-world time, and how much depends on the variant: eight
  // hours and one under the standard rules, a night and a week under gritty
  // realism, five minutes and an hour under the heroic option. Those two
  // settings existed only as a line in the prompt until there was a clock to
  // count against (src/lib/dm/calendar.ts).
  const restedMinutes = restMinutes(args.kind, variant);
  // A party at rest is no longer on the march.
  setTravelPace(campaign.id, null);
  const clockAfter = advanceClock(campaign.id, restedMinutes, "minutes");
  const restedFor = describeDuration(restedMinutes);
  const nowReads =
    "error" in clockAfter
      ? ""
      : describeInstant(clockAfter.clock.calendar, clockAfter.clock.instant);

  // Whoever rested with an item they asked to attune to is attuned now,
  // short rest or long (a long rest holds a short one).
  const attuned = settleAttunements(campaign, turnId, sheets, reason);

  if (args.kind === "long") {
    const rested: string[] = [];
    for (const id of resting) {
      const sheet = getSheetById(id);
      if (!sheet || sheet.deathSaves?.dead) {
        continue;
      }
      // Under the supplies variant, going without keeps the exhaustion.
      const starving =
        campaign.gameSettings.variantRules.supplies === true && goingWithout(starts.supplies?.[sheet.id]);
      // A disease shapes the rest itself: sewer plague restores no hit
      // points, cackle fever keeps its level of exhaustion (afflictions.ts).
      auditRest(campaign, turnId, sheet, "rest_long", afflictedRestPatch(sheet, longRestPatch(sheet, { keepExhaustion: starving })), reason);
      rested.push(sheet.name);
    }
    recordLongRests(campaign.id, resting, endsAt);
    // The saves a disease asks at the end of a long rest.
    const afflictions = afflictionsAfterLongRest(campaign, turnId, resting);
    // A lifestyle is paid for each dawn the rest crosses (lifestyle.ts).
    const living = dawnsBetween(starts.instant, endsAt)
      ? resting.map((id) => chargeLifestyle(campaign, id, dawnsBetween(starts.instant, endsAt))?.line).filter((line): line is string => Boolean(line))
      : [];
    // Celestial Resilience: temporary hit points when a rest ends (authored-hooks.ts).
    const resilience = authoredRestTempHp(campaign, resting);
    // Tranquility: an Open Hand monk wakes under Sanctuary (srd-defenses.ts).
    tranquilityAfterLongRest(campaign, resting);
    tableNote(
      campaign,
      `The party takes a long rest (${restedFor})${nowReads ? `. It is now ${nowReads}` : ""}.${
        unaffected.length ? ` No benefit from it for ${unaffected.join("; ")}.` : ""
      }`,
    );
    // A night passing is a timeskip: the off-screen world moves too (world
    // arcs, NPC goals), with results landing as DM-only facts and sparks.
    tickWorldTimeskip(campaign.id, 3);
    // A new day: the sky rolls again and the dawn card wipes the screen.
    refreshSky(campaign.id, { minutes: "error" in clockAfter ? 0 : clockAfter.minutes });
    publishTitleCard(campaign.id, {
      title: "Dawn",
      ...(nowReads ? { subtitle: nowReads } : {}),
      tone: "dawn",
    });
    return {
      ok: true,
      kind: "long",
      rested,
      ...(attuned.length ? { attuned } : {}),
      ...(resilience.length ? { restTempHp: resilience } : {}),
      ...(afflictions.length ? { afflictions } : {}),
      ...(living.length ? { lifestyle: living } : {}),
      ...(unaffected.length ? { unaffected: unaffected.join("; ") } : {}),
      restedFor,
      ...(nowReads ? { now: nowReads } : {}),
      note: rested.length
        ? `For those who rested, HP and spell slots are fully restored, half the hit dice returned, one level of exhaustion is gone, and any spells a caster chose to prepare are now prepared. ${restedFor} passed. Narrate it.`
        : `${restedFor} passed, but nobody gained the rest's benefits (a character needs at least 1 hit point when it begins, and gains from one long rest in 24 hours). Narrate the time passing.`,
    };
  }

  // Short rest: hit dice per character. The player chooses how many (SRD
  // 5.1, Short Rest): a character whose player is at the table spends them
  // on their own sheet once the rest is over (src/lib/dm/hit-dice.ts). The
  // DM at the console may still spend for anyone; the assistant's list and
  // the server's own choice (toward half HP) stand in for a character with
  // no player connected.
  const humanDm = getDmTurn(turnId)?.actor === "human_dm";
  const choosers = sheets.filter(
    (sheet) => !sheet.deathSaves?.dead && playerChoosesHitDice(campaign.id, sheet),
  );
  const chooses = (id: string) => choosers.some((sheet) => sheet.id === id);
  const plan = new Map<string, number>();
  const leftToPlayers: string[] = [];
  if (args.spend?.length) {
    for (const entry of args.spend) {
      const sheet = resolveSheetRef(entry.characterId, sheets, sheetsById);
      if (!sheet) {
        continue;
      }
      if (chooses(sheet.id) && !humanDm) {
        leftToPlayers.push(sheet.name);
        continue;
      }
      plan.set(sheet.id, entry.dice);
    }
  } else {
    for (const sheet of sheets) {
      if (chooses(sheet.id)) {
        continue;
      }
      const conMod = computeSheetDerived(sheet).abilityMods.con;
      const dice = defaultShortRestDice(sheet, conMod);
      if (dice > 0) {
        plan.set(sheet.id, dice);
      }
    }
  }

  // Song of Rest: each creature that spends at least one Hit Die regains
  // ONE extra die, not one per die spent. The bard benefits too.
  const songDie = partySongOfRestDie(sheets);

  const results: Array<Record<string, unknown>> = [];
  for (const [sheetId, requested] of plan) {
    const spent = spendHitDice({
      campaign,
      turnId,
      sheetId,
      requested,
      songDie,
      reason,
      requestedBy: "dm",
    });
    if ("error" in spent) {
      const sheet = getSheetById(sheetId);
      results.push({ name: sheet?.name ?? sheetId, note: spent.error });
      continue;
    }
    results.push({ name: spent.name, diceSpent: spent.diceSpent, healed: spent.healed, hp: spent.hp });
  }
  // The players still choosing: their window stays open until the clock
  // moves again.
  const waiting = choosers.filter((sheet) => !plan.has(sheet.id));
  openShortRestWindow(campaign.id, waiting.map((sheet) => sheet.id));
  // Short-recharge resources (Ki, Second Wind, Action Surge...) refill for
  // everyone, hit dice spent or not.
  const refilled: string[] = [];
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id);
    if (!sheet || sheet.deathSaves?.dead) {
      continue;
    }
    const resourcePatch = shortRestResourcePatch(sheet);
    if (resourcePatch) {
      auditRest(campaign, turnId, sheet, "rest_short", resourcePatch, reason);
      refilled.push(sheet.name);
    }
  }
  // Arcane Recovery / Natural Recovery: a wizard or druid gets slots back on
  // a short rest, once per day, spending the tracked use.
  const recovered = applySlotRecovery(campaign, turnId, sheets, reason);
  const resilience = authoredRestTempHp(campaign, sheets.map((sheet) => sheet.id));

  tableNote(
    campaign,
    `The party takes a short rest (${restedFor})${nowReads ? `. It is now ${nowReads}` : ""}.`,
  );
  return {
    ok: true,
    kind: "short",
    restedFor,
    ...(nowReads ? { now: nowReads } : {}),
    results: results.length ? results : waiting.length ? "No hit dice spent by the server." : "Nobody needed to spend hit dice.",
    ...(waiting.length
      ? {
          choosing: waiting.map((sheet) => sheet.name),
          choosingNote: `${waiting.map((sheet) => sheet.name).join(", ")} choose${waiting.length === 1 ? "s" : ""} how many hit dice to spend on their own sheet; the server rolls each one. Wait for their rolls before narrating their healing.`,
        }
      : {}),
    ...(leftToPlayers.length
      ? { notSpent: `${leftToPlayers.join(", ")}: the player chooses their own hit dice, so the spend list was not used for them.` }
      : {}),
    ...(refilled.length ? { resourcesRefilled: refilled } : {}),
    // Only for a rest where somebody spent a Hit Die: the song adds to that.
    ...(songDie && results.some((row) => typeof row.diceSpent === "number")
      ? {
          songOfRest: `Song of Rest: everyone who spent a Hit Die regained an extra 1${songDie}.`,
        }
      : {}),
    ...(recovered.length ? { slotsRecovered: recovered } : {}),
    ...(attuned.length ? { attuned } : {}),
    ...(resilience.length ? { restTempHp: resilience } : {}),
    note: "Narrate the breather from these real numbers.",
  };
}


// Every item waiting on the rest to be attuned becomes attuned, for each
// character who is not dead. Returns "Name: Item" lines for the result.
function settleAttunements(
  campaign: Campaign,
  turnId: string,
  sheets: CharacterSheet[],
  reason: string,
): string[] {
  const out: string[] = [];
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id);
    if (!sheet || sheet.deathSaves?.dead) {
      continue;
    }
    const patch = settleAttuning(sheet);
    if (!patch?.equipment) {
      continue;
    }
    const before = new Set(sheet.equipment.filter((item) => item.attuned).map((item) => item.name));
    auditRest(campaign, turnId, sheet, "attune", patch, reason);
    for (const item of patch.equipment) {
      if (item.attuned && !before.has(item.name)) {
        out.push(`${sheet.name}: ${item.name}`);
      }
    }
  }
  return out;
}

// Arcane Recovery and Natural Recovery: returns expended slots totalling
// half the character's level, lowest slots first and never 6th or higher,
// spending the once-per-day use.
function applySlotRecovery(
  campaign: Campaign,
  turnId: string,
  sheets: CharacterSheet[],
  reason: string,
): string[] {
  const recovered: string[] = [];
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id);
    if (!sheet?.spellcasting || sheet.deathSaves?.dead) {
      continue;
    }
    for (const id of ["arcane_recovery", "natural_recovery"]) {
      const state = sheet.resources?.[id];
      const def = resourceDef(id);
      if (!state || state.used >= state.max || !def || def.effect.kind !== "recover_slots") {
        continue;
      }
      // Multiclass: Arcane/Natural Recovery reads the wizard/druid levels.
      let budget = def.effect.levels(resourceLevel(def, sheet));
      const slots = { ...sheet.spellcasting.slots };
      const regained: string[] = [];
      for (const level of [1, 2, 3, 4, 5]) {
        const slot = slots[String(level)];
        while (slot && slot.used > 0 && budget >= level) {
          slots[String(level)] = { max: slot.max, used: slot.used - 1 };
          slot.used -= 1;
          budget -= level;
          regained.push(`level ${level}`);
        }
      }
      if (!regained.length) {
        continue;
      }
      const patch = {
        spellcasting: { ...sheet.spellcasting, slots },
        resources: { ...sheet.resources, [id]: { max: state.max, used: state.used + 1 } },
      };
      auditRest(campaign, turnId, sheet, "rest_short", patch, reason);
      recovered.push(`${sheet.name} (${def.displayName}): ${regained.join(", ")}`);
    }
  }
  return recovered;
}
