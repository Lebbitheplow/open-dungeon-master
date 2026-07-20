import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { healMath } from "@/lib/dm/mutation-math";
import {
  defaultShortRestDice,
  hitDiceExpression,
  longRestPatch,
  shortRestResourcePatch,
} from "@/lib/dm/rest-logic";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { normalizeRestKind } from "@/lib/dm/arg-coerce";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

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
      "The party rests. Call this BEFORE narrating any recovery; never narrate HP, spell slots, or hit dice returning without it. kind=short is a breather of an hour or more: characters spend hit dice to heal (the server rolls them). kind=long is a full night's sleep: HP and spell slots restore fully and half the hit dice return. Not usable during combat.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["short", "long"] },
        spend: {
          type: "array",
          description:
            "Short rest only: hit dice each character spends. Omit to let the server spend sensibly for anyone below half HP.",
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
    return { error: 'Invalid take_rest arguments. Send {"kind":"short"} or {"kind":"long"}.' };
  }
  const reason = (args.reason ?? `${args.kind} rest`).slice(0, 200);

  if (args.kind === "long") {
    const rested: string[] = [];
    const skipped: string[] = [];
    for (const stale of sheets) {
      const sheet = getSheetById(stale.id);
      if (!sheet) {
        continue;
      }
      if (sheet.deathSaves?.dead) {
        skipped.push(sheet.name);
        continue;
      }
      auditRest(campaign, turnId, sheet, "rest_long", longRestPatch(sheet), reason);
      rested.push(sheet.name);
    }
    tableNote(campaign, "The party takes a long rest.");
    return {
      ok: true,
      kind: "long",
      rested,
      ...(skipped.length ? { unaffected: `${skipped.join(", ")} (dead)` } : {}),
      note: "HP and spell slots are fully restored and half the hit dice returned. Narrate the night passing.",
    };
  }

  // Short rest: roll hit dice per character, explicit spend list or the
  // server default (anyone below half HP spends toward half).
  const plan = new Map<string, number>();
  if (args.spend?.length) {
    for (const entry of args.spend) {
      const sheet = resolveSheetRef(entry.characterId, sheets, sheetsById);
      if (sheet) {
        plan.set(sheet.id, entry.dice);
      }
    }
  } else {
    for (const sheet of sheets) {
      const conMod = computeSheetDerived(sheet).abilityMods.con;
      const dice = defaultShortRestDice(sheet, conMod);
      if (dice > 0) {
        plan.set(sheet.id, dice);
      }
    }
  }

  const results: Array<Record<string, unknown>> = [];
  for (const [sheetId, requested] of plan) {
    const sheet = getSheetById(sheetId);
    if (!sheet) {
      continue;
    }
    if (sheet.currentHp <= 0) {
      results.push({
        name: sheet.name,
        note: "unconscious at 0 HP; hit dice cannot be spent until they are healed or stable and awake",
      });
      continue;
    }
    const available = Math.max(0, sheet.hitDice.total - sheet.hitDice.spent);
    const count = Math.min(requested, available);
    if (count < 1) {
      results.push({ name: sheet.name, note: "no hit dice left" });
      continue;
    }
    const conMod = computeSheetDerived(sheet).abilityMods.con;
    const outcome = rollExpression(hitDiceExpression(sheet.hitDice.die, count, conMod));
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "custom",
      detail: `short rest: ${count} hit ${count === 1 ? "die" : "dice"}`,
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    const healed = Math.max(0, outcome.total);
    const math = healMath(sheet.currentHp, sheet.maxHp, healed);
    auditRest(
      campaign,
      turnId,
      sheet,
      "rest_short",
      {
        currentHp: math.currentHp,
        hitDice: { ...sheet.hitDice, spent: sheet.hitDice.spent + count },
      },
      reason,
    );
    results.push({
      name: sheet.name,
      diceSpent: count,
      healed: math.currentHp - sheet.currentHp,
      hp: `${math.currentHp}/${sheet.maxHp}`,
    });
  }
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
  tableNote(campaign, "The party takes a short rest.");
  return {
    ok: true,
    kind: "short",
    results: results.length ? results : "Nobody needed to spend hit dice.",
    ...(refilled.length ? { resourcesRefilled: refilled } : {}),
    note: "Narrate the breather from these real numbers.",
  };
}
