import { z } from "zod";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { listConditions } from "@/lib/content";
import { levelForXp } from "@/lib/srd";
import { publishPersisted } from "@/lib/events";
import { fullPatchSheetSchema, type CharacterSheet } from "@/lib/schemas/sheet";
import {
  applyDamageMath,
  goldMath,
  grantItemMath,
  healMath,
  removeItemMath,
  spendSlotMath,
} from "@/lib/dm/mutation-math";

// DM stat authority: the model changes sheets ONLY through these tools.
// Every mutation is server-clamped, audit-logged, and published live.

export const MUTATION_TOOL_NAMES = [
  "apply_damage",
  "heal",
  "award_xp",
  "modify_gold",
  "grant_item",
  "remove_item",
  "set_condition",
  "clear_condition",
  "use_spell_slot",
  "learn_spell",
  "update_sheet",
] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const characterProperty = {
  characterId: { type: "string", description: "Exact characterId from GAME STATE." },
  reason: { type: "string", description: "Short in-fiction cause." },
};

function tool(name: string, description: string, extra: Record<string, unknown>, required: string[]): ToolDef {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { ...characterProperty, ...extra },
        required: ["characterId", ...required],
      },
    },
  };
}

export const mutationTools: ToolDef[] = [
  tool("apply_damage", "Deal damage to a character. Temp HP absorbs first; HP floors at 0.", {
    amount: { type: "integer", minimum: 1, maximum: 200 },
    type: { type: "string", description: "Damage type, e.g. slashing, fire." },
  }, ["amount"]),
  tool("heal", "Restore a character's hit points, capped at their max.", {
    amount: { type: "integer", minimum: 1, maximum: 200 },
  }, ["amount"]),
  {
    type: "function",
    function: {
      name: "award_xp",
      description: "Award XP to characters for overcoming challenges.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterIds: { type: "array", items: { type: "string" }, minItems: 1 },
          amount: { type: "integer", minimum: 1, maximum: 10000 },
          reason: { type: "string" },
        },
        required: ["characterIds", "amount"],
      },
    },
  },
  tool("modify_gold", "Add or remove gold (negative delta = spend/lose). Floors at 0.", {
    delta: { type: "integer", minimum: -100000, maximum: 100000 },
  }, ["delta"]),
  tool("grant_item", "Give a character an item (loot, purchase, gift). Only for items the fiction actually put in their hands.", {
    name: { type: "string" },
    qty: { type: "integer", minimum: 1, maximum: 99 },
  }, ["name"]),
  tool("remove_item", "Take an item from a character (lost, sold, consumed).", {
    name: { type: "string" },
    qty: { type: "integer", minimum: 1, maximum: 99 },
  }, ["name"]),
  tool("set_condition", "Apply a condition (poisoned, frightened, ...).", {
    condition: { type: "string" },
  }, ["condition"]),
  tool("clear_condition", "Remove a condition from a character.", {
    condition: { type: "string" },
  }, ["condition"]),
  tool("use_spell_slot", "Expend one of a character's spell slots of the given level.", {
    level: { type: "integer", minimum: 1, maximum: 9 },
    spell: { type: "string", description: "Exact name of the spell being cast, from the character's spell list." },
  }, ["level", "spell"]),
  tool(
    "learn_spell",
    "Permanently add or remove ONE spell on a character's spell list, only when the story genuinely teaches or strips it: a scroll copied into a spellbook, a mentor's training, a granted boon, a curse. Never use this to let a character cast something in the moment; casting requires the spell to already be on their sheet.",
    {
      action: { type: "string", enum: ["add", "remove"] },
      spell: { type: "string", description: "Exact spell name." },
    },
    ["action", "spell"],
  ),
  tool(
    "update_sheet",
    "Directly set character sheet fields for permanent or story-driven changes: renames, transformations, curses, blessings, training, level or ability score changes. For routine bookkeeping (damage, healing, loot, gold, XP, conditions, spell slots) use the specific tools instead. Include ONLY the fields that change.",
    {
      name: { type: "string" },
      race: { type: "string" },
      class: { type: "string" },
      subclass: { type: "string" },
      background: { type: "string" },
      alignment: { type: "string" },
      level: { type: "integer", minimum: 1, maximum: 20 },
      xp: { type: "integer", minimum: 0 },
      maxHp: { type: "integer", minimum: 1, maximum: 500 },
      currentHp: { type: "integer", minimum: 0, maximum: 500 },
      tempHp: { type: "integer", minimum: 0, maximum: 200 },
      ac: { type: "integer", minimum: 1, maximum: 30 },
      speed: { type: "integer", minimum: 0, maximum: 120 },
      gold: { type: "integer", minimum: 0 },
      abilities: {
        type: "object",
        description: "Full ability block: str, dex, con, int, wis, cha (1-30 each).",
        properties: {
          str: { type: "integer" },
          dex: { type: "integer" },
          con: { type: "integer" },
          int: { type: "integer" },
          wis: { type: "integer" },
          cha: { type: "integer" },
        },
      },
      conditions: { type: "array", items: { type: "string" } },
      feats: { type: "array", items: { type: "string" } },
      features: {
        type: "array",
        description:
          "FULL replacement features-and-traits list. To grant a lasting story ability, resend the existing list plus the new entry with source \"story\".",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            source: { type: "string", enum: ["class", "race", "feat", "story"] },
            level: { type: "integer" },
          },
          required: ["name"],
        },
      },
    },
    ["reason"],
  ),
];

// Fields update_sheet may write. Equipment, spell slots, portrait, and the
// player's private notes stay with the granular tools and the lead UI.
const updateSheetPatchSchema = fullPatchSheetSchema.pick({
  name: true,
  race: true,
  class: true,
  subclass: true,
  background: true,
  alignment: true,
  level: true,
  xp: true,
  maxHp: true,
  currentHp: true,
  tempHp: true,
  ac: true,
  speed: true,
  gold: true,
  abilities: true,
  conditions: true,
  feats: true,
  features: true,
});

const argsSchema = z.object({
  characterId: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
  amount: z.number().int().optional(),
  type: z.string().optional(),
  delta: z.number().int().optional(),
  name: z.string().optional(),
  qty: z.number().int().optional(),
  condition: z.string().optional(),
  level: z.number().int().optional(),
  spell: z.string().optional(),
  action: z.enum(["add", "remove"]).optional(),
  reason: z.string().optional(),
});

export const MUTATION_CAP_PER_TURN = 10;

type MutationOutcome = { result: Record<string, unknown> };

// `sheet` is the freshly resolved pre-mutation state; it doubles as the
// undo pre-image. `patch` is exactly what patchSheet was given.
function audit(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  kind: string,
  delta: Record<string, unknown>,
  reason: string,
  patch: Record<string, unknown>,
) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind,
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return updated;
}

// Applies one mutation tool call. Returns the compact tool result the model
// narrates from. Never throws: errors come back as {error} results.
export function applyDmMutation(
  campaign: Campaign,
  turnId: string,
  toolName: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): MutationOutcome {
  let args: z.infer<typeof argsSchema>;
  try {
    args = argsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { result: { error: "Invalid arguments." } };
  }
  const reason = (args.reason ?? "").slice(0, 200);

  // Resolve by id or name, then RE-FETCH from the database: earlier
  // mutations in this same turn may have already changed the sheet.
  const resolve = (ref: string | undefined): CharacterSheet | null => {
    const trimmed = (ref ?? "").trim();
    if (!trimmed) {
      return null;
    }
    const stale =
      sheetsById.get(trimmed) ??
      sheets.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase()) ??
      null;
    return stale ? getSheetById(stale.id) : null;
  };

  if (toolName === "award_xp") {
    const amount = args.amount ?? 0;
    if (amount < 1) {
      return { result: { error: "award_xp needs a positive amount." } };
    }
    const targets = (args.characterIds ?? [])
      .map(resolve)
      .filter((sheet): sheet is CharacterSheet => sheet !== null);
    if (!targets.length) {
      return { result: { error: "No valid characterIds from GAME STATE." } };
    }
    const levelUps: string[] = [];
    for (const sheet of targets) {
      const newXp = sheet.xp + amount;
      patchSheet(sheet.id, { xp: newXp });
      audit(campaign, turnId, sheet, "award_xp", { amount, newXp }, reason, { xp: newXp });
      publishSheet(campaign, sheet.id);
      if (levelForXp(newXp) > sheet.level) {
        levelUps.push(sheet.name);
        publishPersisted(campaign.id, "level_up_available", {
          characterId: sheet.id,
          characterName: sheet.name,
          level: levelForXp(newXp),
        });
        insertCharacterEvent({
          libraryCharacterId: sheet.libraryCharacterId,
          campaignCharacterId: sheet.id,
          campaignId: campaign.id,
          seq: allocateSeq(campaign.id),
          kind: "level_up",
          summary: `Reached enough experience for level ${levelForXp(newXp)}.`,
        });
      }
    }
    return {
      result: {
        ok: true,
        awarded: amount,
        to: targets.map((sheet) => sheet.name),
        ...(levelUps.length ? { levelUpAvailable: levelUps } : {}),
      },
    };
  }

  const sheet = resolve(args.characterId);
  if (!sheet) {
    return { result: { error: "Unknown characterId; use one from GAME STATE." } };
  }

  switch (toolName) {
    case "apply_damage": {
      const amount = args.amount ?? 0;
      if (amount < 1) {
        return { result: { error: "apply_damage needs a positive amount." } };
      }
      const math = applyDamageMath(sheet.currentHp, sheet.tempHp, Math.min(amount, 200));
      patchSheet(sheet.id, { currentHp: math.currentHp, tempHp: math.tempHp });
      audit(campaign, turnId, sheet, "apply_damage", { amount, ...math, type: args.type ?? "" }, reason, {
        currentHp: math.currentHp,
        tempHp: math.tempHp,
      });
      publishSheet(campaign, sheet.id);
      return {
        result: {
          ok: true,
          hp: `${math.currentHp}/${sheet.maxHp}`,
          ...(math.absorbed ? { tempHpAbsorbed: math.absorbed } : {}),
          ...(math.dropped ? { dropped: true, note: `${sheet.name} falls to 0 HP.` } : {}),
        },
      };
    }
    case "heal": {
      const amount = args.amount ?? 0;
      if (amount < 1) {
        return { result: { error: "heal needs a positive amount." } };
      }
      const math = healMath(sheet.currentHp, sheet.maxHp, Math.min(amount, 200));
      patchSheet(sheet.id, { currentHp: math.currentHp });
      audit(campaign, turnId, sheet, "heal", { amount, newHp: math.currentHp }, reason, {
        currentHp: math.currentHp,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, hp: `${math.currentHp}/${sheet.maxHp}` } };
    }
    case "modify_gold": {
      const delta = args.delta ?? 0;
      if (!delta) {
        return { result: { error: "modify_gold needs a nonzero delta." } };
      }
      const math = goldMath(sheet.gold, delta);
      patchSheet(sheet.id, { gold: math.gold });
      audit(campaign, turnId, sheet, "modify_gold", { delta: math.applied, gold: math.gold }, reason, {
        gold: math.gold,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, gold: math.gold } };
    }
    case "grant_item": {
      const name = (args.name ?? "").trim().slice(0, 80);
      if (!name) {
        return { result: { error: "grant_item needs an item name." } };
      }
      const math = grantItemMath(sheet.equipment, name, args.qty ?? 1);
      patchSheet(sheet.id, { equipment: math.equipment });
      audit(campaign, turnId, sheet, "grant_item", { name, qty: args.qty ?? 1 }, reason, {
        equipment: math.equipment,
      });
      publishSheet(campaign, sheet.id);
      insertCharacterEvent({
        libraryCharacterId: sheet.libraryCharacterId,
        campaignCharacterId: sheet.id,
        campaignId: campaign.id,
        seq: allocateSeq(campaign.id),
        kind: "item",
        summary: `Acquired ${name}${(args.qty ?? 1) > 1 ? ` x${args.qty}` : ""}.`,
      });
      return { result: { ok: true, granted: name } };
    }
    case "remove_item": {
      const name = (args.name ?? "").trim();
      const math = removeItemMath(sheet.equipment, name, args.qty ?? 1);
      if (!math) {
        return { result: { error: `${sheet.name} does not carry "${name}".` } };
      }
      patchSheet(sheet.id, { equipment: math.equipment });
      audit(campaign, turnId, sheet, "remove_item", { name, removed: math.removed }, reason, {
        equipment: math.equipment,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, removed: name, qty: math.removed } };
    }
    case "set_condition": {
      const condition = (args.condition ?? "").trim().toLowerCase().slice(0, 40);
      if (!condition) {
        return { result: { error: "set_condition needs a condition name." } };
      }
      const known = listConditions({ limit: 50 }).map((entry) => entry.name.toLowerCase());
      const normalized = known.includes(condition) ? condition : condition;
      if (sheet.conditions.includes(normalized)) {
        return { result: { ok: true, note: `${sheet.name} is already ${normalized}.` } };
      }
      const withCondition = [...sheet.conditions, normalized].slice(0, 15);
      patchSheet(sheet.id, { conditions: withCondition });
      audit(campaign, turnId, sheet, "set_condition", { condition: normalized }, reason, {
        conditions: withCondition,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, condition: normalized } };
    }
    case "clear_condition": {
      const condition = (args.condition ?? "").trim().toLowerCase();
      if (!sheet.conditions.includes(condition)) {
        return { result: { error: `${sheet.name} is not ${condition || "under that condition"}.` } };
      }
      const withoutCondition = sheet.conditions.filter((entry) => entry !== condition);
      patchSheet(sheet.id, { conditions: withoutCondition });
      audit(campaign, turnId, sheet, "clear_condition", { condition }, reason, {
        conditions: withoutCondition,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, cleared: condition } };
    }
    case "use_spell_slot": {
      const level = args.level ?? 0;
      // A named spell must be on the character's list; the slot is not spent
      // otherwise. A missing spell arg is tolerated (weak tool calling must
      // not break casting), so the slot check still runs.
      const spell = (args.spell ?? "").trim();
      if (spell && sheet.spellcasting) {
        const spellList = [...sheet.spellcasting.known, ...sheet.spellcasting.prepared];
        const knows = spellList.some((entry) => entry.trim().toLowerCase() === spell.toLowerCase());
        if (!knows) {
          return {
            result: {
              error: `${sheet.name} cannot cast "${spell}". Their spells: ${spellList.join(", ") || "none"}.`,
            },
          };
        }
      }
      const slot = sheet.spellcasting?.slots[String(level)];
      const math = slot ? spendSlotMath(slot) : null;
      if (!math) {
        return {
          result: { error: `${sheet.name} has no free level ${level} spell slot.` },
        };
      }
      const nextSpellcasting = sheet.spellcasting
        ? {
            ...sheet.spellcasting,
            slots: { ...sheet.spellcasting.slots, [String(level)]: math },
          }
        : sheet.spellcasting;
      patchSheet(sheet.id, { spellcasting: nextSpellcasting });
      audit(
        campaign,
        turnId,
        sheet,
        "use_spell_slot",
        spell ? { level, spell, used: math.used, max: math.max } : { level, used: math.used, max: math.max },
        reason,
        { spellcasting: nextSpellcasting },
      );
      publishSheet(campaign, sheet.id);
      return {
        result: { ok: true, slot: `level ${level}: ${math.max - math.used}/${math.max} left` },
      };
    }
    case "learn_spell": {
      const spell = (args.spell ?? "").trim().slice(0, 80);
      const action = args.action;
      if (!spell || (action !== "add" && action !== "remove")) {
        return { result: { error: "learn_spell needs a spell name and action add|remove." } };
      }
      if (!sheet.spellcasting) {
        return {
          result: { error: `${sheet.name} has no spellcasting; they cannot learn spells.` },
        };
      }
      const known = sheet.spellcasting.known;
      const prepared = sheet.spellcasting.prepared;
      const matches = (entry: string) => entry.trim().toLowerCase() === spell.toLowerCase();
      if (action === "add") {
        if (known.some(matches) || prepared.some(matches)) {
          return { result: { ok: true, note: `${sheet.name} already knows ${spell}.` } };
        }
        // Known-casters track spells in `known`; prepared casters keep the
        // whole list in `prepared` (known stays empty by convention).
        const intoKnown = known.length > 0;
        if ((intoKnown ? known.length >= 80 : prepared.length >= 60)) {
          return { result: { error: `${sheet.name}'s spell list is full.` } };
        }
        const nextSpellcasting = {
          ...sheet.spellcasting,
          known: intoKnown ? [...known, spell] : known,
          prepared: intoKnown ? prepared : [...prepared, spell],
        };
        patchSheet(sheet.id, { spellcasting: nextSpellcasting });
        audit(campaign, turnId, sheet, "learn_spell", { action, spell }, reason, {
          spellcasting: nextSpellcasting,
        });
        publishSheet(campaign, sheet.id);
        insertCharacterEvent({
          libraryCharacterId: sheet.libraryCharacterId,
          campaignCharacterId: sheet.id,
          campaignId: campaign.id,
          seq: allocateSeq(campaign.id),
          kind: "achievement",
          summary: `Learned the spell ${spell}.`,
        });
        return { result: { ok: true, learned: spell } };
      }
      if (!known.some(matches) && !prepared.some(matches)) {
        return { result: { error: `${sheet.name} does not know "${spell}".` } };
      }
      const nextSpellcasting = {
        ...sheet.spellcasting,
        known: known.filter((entry) => !matches(entry)),
        prepared: prepared.filter((entry) => !matches(entry)),
      };
      patchSheet(sheet.id, { spellcasting: nextSpellcasting });
      audit(campaign, turnId, sheet, "learn_spell", { action, spell }, reason, {
        spellcasting: nextSpellcasting,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, removed: spell } };
    }
    case "update_sheet": {
      let rawArgs: Record<string, unknown>;
      try {
        rawArgs = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
      } catch {
        return { result: { error: "Invalid arguments." } };
      }
      delete rawArgs.characterId;
      delete rawArgs.reason;
      const parsedPatch = updateSheetPatchSchema.safeParse(rawArgs);
      if (!parsedPatch.success) {
        const issue = parsedPatch.error.issues[0];
        return {
          result: { error: `Invalid update_sheet field ${issue?.path.join(".")}: ${issue?.message}` },
        };
      }
      const patch = parsedPatch.data;
      const changed = Object.keys(patch).filter(
        (key) => patch[key as keyof typeof patch] !== undefined,
      );
      if (!changed.length) {
        return {
          result: { error: "update_sheet changed nothing; include at least one field." },
        };
      }
      patchSheet(sheet.id, patch);
      audit(
        campaign,
        turnId,
        sheet,
        "update_sheet",
        patch as Record<string, unknown>,
        reason,
        patch as Record<string, unknown>,
      );
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, changed } };
    }
    default:
      return { result: { error: `Unknown mutation tool ${toolName}.` } };
  }
}
