import { z } from "zod";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { listConditions } from "@/lib/content";
import { levelForXp } from "@/lib/srd";
import { RAGING, spendRelentlessEndurance } from "@/lib/srd/class-resources";
import { publishPersisted } from "@/lib/events";
import {
  fullPatchSheetSchema,
  type CharacterSheet,
  type FullPatchSheetInput,
} from "@/lib/schemas/sheet";
import {
  applyDamageMath,
  goldMath,
  grantItemMath,
  healMath,
  removeItemMath,
  sheetBuffViolation,
  spendSlotMath,
  wildShapeDamageMath,
} from "@/lib/dm/mutation-math";
import { applyDamageDeathHook, healDeathHook } from "@/lib/dm/death";
import { autoLevelCompanion } from "@/lib/dm/companion-tools";
import {
  damageAdjust,
  describeExhaustion,
  pcResistances,
  pruneMeta,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { normalizeAbility, normalizeListAction } from "@/lib/dm/arg-coerce";
import {
  breakConcentration,
  concentrationDamageHook,
  setConcentration,
  spellRequiresConcentration,
} from "@/lib/dm/concentration";
import {
  computePurchase,
  computeUseItem,
  computeUseResource,
  resourceTools,
} from "@/lib/dm/resource-tools";
import { searchSpells, spellDamageFor } from "@/lib/content";
import { suggestedSpellCount } from "@/lib/content/mechanics";
import { abilityMod, computeSheetDerived } from "@/lib/srd";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";

// DM stat authority: the model changes sheets ONLY through these tools.
// Every mutation is server-clamped, audit-logged, and published live.

export const MUTATION_TOOL_NAMES = [
  "apply_damage",
  "heal",
  "stabilize",
  "award_xp",
  "modify_gold",
  "grant_item",
  "remove_item",
  "use_item",
  "purchase",
  "use_resource",
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
  tool("heal", "Restore a character's hit points, capped at their max. Healing a dying character any amount ends their death saves and wakes them. Pass temp:true to grant TEMPORARY hit points instead (they do not stack; the higher value wins). For a HEALING SPELL, pass spell (and the slot level it was cast at) instead of amount: the server rolls the spell's real dice, adds the caster's ability modifier, and shows the dice card.", {
    amount: { type: "integer", minimum: 1, maximum: 200, description: "Flat hit points, for healing that is not a spell." },
    spell: {
      type: "string",
      description:
        "Healing spell being cast (Cure Wounds, Healing Word, Prayer of Healing). The server rolls it.",
    },
    level: {
      type: "integer",
      minimum: 1,
      maximum: 9,
      description: "Slot level the healing spell was cast at, for upcast scaling.",
    },
    casterId: {
      type: "string",
      description: "Who cast it, when a spell heals someone else; their ability modifier is added.",
    },
    temp: {
      type: "boolean",
      description: "True = temporary hit points instead of healing.",
    },
  }, []),
  tool(
    "stabilize",
    "Stabilize a DYING character at 0 HP without healing: a successful DC 10 Wisdom (Medicine) check or a healer's kit. They stop making death saves but stay unconscious at 0 HP.",
    {},
    [],
  ),
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
  tool("remove_item", "Take an item from a character (lost, stolen, destroyed). For consumables being USED, call use_item instead; for sales, call purchase.", {
    name: { type: "string" },
    qty: { type: "integer", minimum: 1, maximum: 99 },
  }, ["name"]),
  ...resourceTools,
  tool("set_condition", "Apply a condition. Use the exact 5e name when one fits: blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion. Custom names are allowed for story effects. Timed effects expire automatically: pass rounds, or saveAbility + saveDc for save-ends effects the server re-rolls each round.", {
    condition: { type: "string" },
    rounds: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description: "Rounds until the condition ends on its own.",
    },
    saveAbility: {
      type: "string",
      enum: ["str", "dex", "con", "int", "wis", "cha"],
      description: "Save-ends: ability re-saved at the end of each round.",
    },
    saveDc: { type: "integer", minimum: 1, maximum: 30, description: "Save-ends DC." },
  }, ["condition"]),
  tool("clear_condition", "Remove a condition from a character the moment the fiction ends it (cured, dispelled, rested, shaken off). Use the condition name shown in GAME STATE.", {
    condition: { type: "string" },
  }, ["condition"]),
  tool("use_spell_slot", "Expend one of a character's spell slots of the given level. The server validates the slot level against the spell's real level (no casting a level 3 spell from a level 1 slot), skips the spend for cantrips, and tracks concentration automatically: casting a concentration spell ends any previous one.", {
    level: { type: "integer", minimum: 1, maximum: 9 },
    spell: { type: "string", description: "Exact name of the spell being cast, from the character's spell list." },
    ritual: {
      type: "boolean",
      description: "True when cast as a ritual (10 extra minutes, no slot spent; only ritual-tagged spells).",
    },
    concentration: {
      type: "boolean",
      description: "Only for homebrew spells the server does not know: true if this spell requires concentration.",
    },
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
  amount: z.coerce.number().int().optional(),
  type: z.string().optional(),
  // Internal: set by enemy_attack on a natural 20 so damage on a dying
  // target counts two death-save failures. Not exposed in the tool schema.
  crit: z.boolean().optional(),
  // use_spell_slot: homebrew concentration flag + ritual casting.
  concentration: z.boolean().optional(),
  ritual: z.coerce.boolean().optional(),
  // heal: temporary hit points instead of healing.
  temp: z.coerce.boolean().optional(),
  delta: z.coerce.number().int().optional(),
  name: z.string().optional(),
  qty: z.coerce.number().int().optional(),
  // use_item / purchase / use_resource.
  item: z.string().optional(),
  targetCharacterId: z.string().optional(),
  price: z.coerce.number().int().min(0).max(100000).optional(),
  resource: z.string().optional(),
  // use_resource, Wild Shape: the beast form's stat block.
  form: z.string().optional(),
  formHp: z.coerce.number().int().min(1).max(300).optional(),
  formAc: z.coerce.number().int().min(1).max(30).optional(),
  condition: z.string().optional(),
  // set_condition durations.
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  saveAbility: z.preprocess(
    normalizeAbility,
    z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  ),
  saveDc: z.coerce.number().int().min(1).max(30).optional(),
  level: z.coerce.number().int().optional(),
  spell: z.string().optional(),
  // heal: who cast the healing spell, when it lands on someone else.
  casterId: z.string().optional(),
  // learn_spell: add|remove; purchase: buy|sell (synonyms normalized).
  action: z.preprocess(
    normalizeListAction,
    z.enum(["add", "remove", "buy", "sell"]).optional(),
  ),
  reason: z.string().optional(),
});

export const MUTATION_CAP_PER_TURN = 10;

// Conditions are stored lowercase. The model's wording drifts ("poison",
// "Poisoned by the dart"), so set and clear both map through the SRD names;
// unmatched strings stay as-is because custom story conditions are legal.
export function canonicalCondition(raw: string): string {
  const cleaned = raw.trim().toLowerCase().slice(0, 40);
  if (!cleaned) {
    return cleaned;
  }
  const known = listConditions({ limit: 50 }).map((entry) => entry.name.toLowerCase());
  if (known.includes(cleaned)) {
    return cleaned;
  }
  const prefix = known.find((name) => name.startsWith(cleaned) || cleaned.startsWith(name));
  if (prefix) {
    return prefix;
  }
  return known.find((name) => cleaned.includes(name)) ?? cleaned;
}

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
    // Ceiling so a whispered or in-chat "give me a million XP" cannot vault a
    // character up the track in one call; realistic events award far less, and
    // level-ups still require the player's own app flow.
    const MAX_XP_PER_AWARD = 20000;
    if (amount > MAX_XP_PER_AWARD) {
      return {
        result: {
          error: `That is more experience than any single event grants; award a realistic amount (up to ${MAX_XP_PER_AWARD}).`,
        },
      };
    }
    const targets = (args.characterIds ?? [])
      .map(resolve)
      .filter((sheet): sheet is CharacterSheet => sheet !== null);
    if (!targets.length) {
      return { result: { error: "No valid characterIds from GAME STATE." } };
    }
    const levelUps: string[] = [];
    const companionLevelUps: string[] = [];
    for (const sheet of targets) {
      const newXp = sheet.xp + amount;
      patchSheet(sheet.id, { xp: newXp });
      audit(campaign, turnId, sheet, "award_xp", { amount, newXp }, reason, { xp: newXp });
      publishSheet(campaign, sheet.id);
      if (levelForXp(newXp) > sheet.level) {
        // Companions have no level-up dialog; the server applies a plain
        // level-up right away instead of announcing an available one.
        if (sheet.isCompanion) {
          const leveled = autoLevelCompanion(campaign, sheet.id);
          if (leveled) {
            companionLevelUps.push(leveled);
          }
          continue;
        }
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
        ...(companionLevelUps.length ? { companionLevelUps } : {}),
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
      if (sheet.deathSaves?.dead) {
        return { result: { error: `${sheet.name} is already dead.` } };
      }
      // Racial/feature resistances halve matching damage types server-side.
      const adjusted = damageAdjust(
        Math.min(amount, 200),
        args.type,
        pcResistances(sheet),
        "",
        "",
      );
      // Wild Shape: the beast's hit points take the blow first. While the
      // form holds, the druid's own sheet is untouched and no death or
      // concentration hook fires; when it breaks, only the excess carries
      // through into the rest of this same call.
      let carried = adjusted.amount;
      let tempHpNow = sheet.tempHp;
      let shapeInfo: Record<string, unknown> = {};
      if (sheet.wildShape) {
        const shape = wildShapeDamageMath(
          sheet.wildShape.beastHp,
          sheet.tempHp,
          adjusted.amount,
        );
        const form = sheet.wildShape.form;
        const patch: FullPatchSheetInput = shape.reverted
          ? { wildShape: null, tempHp: shape.tempHp }
          : {
              wildShape: { ...sheet.wildShape, beastHp: shape.beastHp },
              tempHp: shape.tempHp,
            };
        patchSheet(sheet.id, patch);
        // currentHp rides along unchanged: it is what the event log reports
        // and the druid's own pool genuinely did not move.
        audit(
          campaign,
          turnId,
          sheet,
          "apply_damage",
          { amount, form, currentHp: sheet.currentHp, ...shape },
          reason,
          patch,
        );
        publishSheet(campaign, sheet.id);
        if (!shape.reverted) {
          return {
            result: {
              ok: true,
              form: `${form}: ${shape.beastHp}/${sheet.wildShape.beastMaxHp} HP`,
              ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
              ...(shape.absorbed ? { tempHpAbsorbed: shape.absorbed } : {}),
              note: `The beast form absorbs it; ${sheet.name}'s own hit points are untouched.`,
            },
          };
        }
        carried = shape.carryover;
        tempHpNow = shape.tempHp;
        shapeInfo = {
          wildShape: `${form} collapses and ${sheet.name} returns to their own body${
            carried > 0 ? `, taking the remaining ${carried} damage` : " unharmed by the excess"
          }.`,
        };
      }

      const math = applyDamageMath(sheet.currentHp, tempHpNow, carried);
      patchSheet(sheet.id, { currentHp: math.currentHp, tempHp: math.tempHp });
      audit(campaign, turnId, sheet, "apply_damage", { amount, ...math, type: args.type ?? "" }, reason, {
        currentHp: math.currentHp,
        tempHp: math.tempHp,
      });
      publishSheet(campaign, sheet.id);
      // Relentless Endurance: a half-orc who would drop stays up at 1 HP
      // instead, once per long rest. The server burns the use itself, so
      // the death engine never sees the drop.
      if (math.dropped) {
        const spent = spendRelentlessEndurance(sheet.resources);
        if (spent) {
          const patch: FullPatchSheetInput = { currentHp: 1, resources: spent };
          patchSheet(sheet.id, patch);
          audit(campaign, turnId, sheet, "apply_damage", { relentlessEndurance: true }, reason, patch);
          publishSheet(campaign, sheet.id);
          return {
            result: {
              ok: true,
              hp: `1/${sheet.maxHp}`,
              relentlessEndurance: true,
              ...shapeInfo,
              note: `${sheet.name} should have fallen, but Relentless Endurance holds them at 1 HP. The feature is now spent until a long rest.`,
            },
          };
        }
      }
      // A barbarian knocked unconscious stops raging. Checked after
      // Relentless Endurance, which keeps them on their feet still raging.
      let rageInfo: Record<string, unknown> = {};
      if (math.dropped && sheet.conditions.some((entry) => entry.toLowerCase() === RAGING)) {
        const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [RAGING]);
        const patch: FullPatchSheetInput = {
          conditions: cleared.conditions,
          conditionMeta: cleared.meta,
        };
        patchSheet(sheet.id, patch);
        audit(campaign, turnId, sheet, "clear_condition", { condition: RAGING }, reason, patch);
        publishSheet(campaign, sheet.id);
        rageInfo = { rageEnded: `${sheet.name}'s rage ends as they fall.` };
      }
      // Death engine: dropping to 0 starts the dying track; damage while
      // already down adds automatic failures; massive damage kills.
      const deathInfo = applyDamageDeathHook(campaign, turnId, sheet, math, args.crit === true);
      // Concentration: damage forces the CON save server-side.
      const concentrationInfo = concentrationDamageHook(campaign, turnId, sheet, carried);
      return {
        result: {
          ok: true,
          hp: `${math.currentHp}/${sheet.maxHp}`,
          ...shapeInfo,
          ...rageInfo,
          ...(adjusted.note ? { resistance: `${sheet.name} is ${adjusted.note}` } : {}),
          ...(math.absorbed ? { tempHpAbsorbed: math.absorbed } : {}),
          ...(math.dropped && !("note" in deathInfo)
            ? { dropped: true, note: `${sheet.name} falls to 0 HP.` }
            : math.dropped
              ? { dropped: true }
              : {}),
          ...deathInfo,
          ...concentrationInfo,
        },
      };
    }
    case "heal": {
      // A named healing spell is rolled by the server from the content
      // pack's own dice, exactly as a healing potion is, so the model never
      // decides how much a Cure Wounds restores.
      let amount = args.amount ?? 0;
      let healNote: string | null = null;
      const healSpell = (args.spell ?? "").trim();
      if (healSpell) {
        const caster = (args.casterId ? resolve(args.casterId) : null) ?? sheet;
        const scaled = spellDamageFor({
          spell: healSpell,
          userId: caster.userId,
          casterLevel: caster.level,
          slotLevel: args.level,
        });
        if (scaled) {
          const derived = computeSheetDerived(caster);
          const modifier = caster.spellcasting
            ? derived.abilityMods[caster.spellcasting.ability]
            : 0;
          const expression = modifier > 0 ? `${scaled.dice}+${modifier}` : scaled.dice;
          const outcome = rollExpression(expression);
          const roll = insertRoll({
            campaignId: campaign.id,
            characterId: sheet.id,
            requestedBy: "dm",
            kind: "custom",
            detail: `${healSpell} on ${sheet.name} (${expression})`,
            result: outcome,
          });
          publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
            roll,
            source: "digital",
          });
          amount = Math.max(1, outcome.total);
          healNote = `${healSpell}: ${scaled.note}, rolled ${amount}`;
        }
      }
      if (amount < 1) {
        return {
          result: {
            error: healSpell
              ? `The server could not derive ${healSpell}'s healing; send heal again with an explicit amount.`
              : "heal needs a positive amount, or a spell name to roll.",
          },
        };
      }
      if (sheet.deathSaves?.dead) {
        return {
          result: {
            error: `${sheet.name} is DEAD. Healing cannot help; only the party lead can reverse a death.`,
          },
        };
      }
      // Temporary HP: 5e non-stacking, the higher value wins.
      if (args.temp) {
        const tempHp = Math.max(sheet.tempHp, Math.min(amount, 200));
        if (tempHp === sheet.tempHp) {
          return {
            result: {
              ok: true,
              tempHp,
              note: `${sheet.name} keeps their existing ${tempHp} temp HP (temporary hit points do not stack; the higher value wins).`,
            },
          };
        }
        patchSheet(sheet.id, { tempHp });
        audit(campaign, turnId, sheet, "grant_temp_hp", { tempHp }, reason, { tempHp });
        publishSheet(campaign, sheet.id);
        return { result: { ok: true, tempHp, note: "Temporary hit points; they absorb damage first and vanish on a long rest." } };
      }
      const math = healMath(sheet.currentHp, sheet.maxHp, Math.min(amount, 200));
      patchSheet(sheet.id, { currentHp: math.currentHp });
      audit(campaign, turnId, sheet, "heal", { amount, newHp: math.currentHp }, reason, {
        currentHp: math.currentHp,
      });
      publishSheet(campaign, sheet.id);
      // Any healing ends the dying state.
      const deathInfo = healDeathHook(campaign, turnId, sheet);
      return {
        result: {
          ok: true,
          hp: `${math.currentHp}/${sheet.maxHp}`,
          healed: amount,
          ...(healNote ? { spell: healNote } : {}),
          ...deathInfo,
        },
      };
    }
    case "stabilize": {
      const track = sheet.deathSaves;
      if (!track || track.dead || sheet.currentHp > 0) {
        return { result: { error: `${sheet.name} is not dying; nothing to stabilize.` } };
      }
      if (track.stable) {
        return { result: { ok: true, note: `${sheet.name} is already stable.` } };
      }
      const nextTrack = { ...track, stable: true };
      patchSheet(sheet.id, { deathSaves: nextTrack });
      audit(campaign, turnId, sheet, "stabilize", { deathSaves: nextTrack }, reason, {
        deathSaves: nextTrack,
      });
      publishSheet(campaign, sheet.id);
      return {
        result: {
          ok: true,
          note: `${sheet.name} is stable: no more death saves, but still unconscious at 0 HP until healed.`,
        },
      };
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
    case "use_item": {
      const itemName = (args.item ?? args.name ?? "").trim();
      if (!itemName) {
        return { result: { error: "use_item needs an item name." } };
      }
      const target = args.targetCharacterId ? resolve(args.targetCharacterId) : sheet;
      if (!target) {
        return { result: { error: "Unknown targetCharacterId; use one from GAME STATE." } };
      }
      const outcome = computeUseItem(campaign, sheet, target, itemName);
      if ("error" in outcome) {
        return { result: outcome };
      }
      patchSheet(sheet.id, outcome.patch);
      audit(campaign, turnId, sheet, "use_item", { item: itemName }, reason, outcome.patch);
      publishSheet(campaign, sheet.id);
      // Potion healing rides the standard heal mutation so the death engine
      // wakes a dying drinker; recursion is safe (different tool name).
      if (outcome.healTarget) {
        const healed = applyDmMutation(
          campaign,
          turnId,
          "heal",
          JSON.stringify({
            characterId: outcome.healTarget.characterId,
            amount: outcome.healTarget.amount,
            reason: itemName,
          }),
          sheets,
          sheetsById,
        ).result;
        return { result: { ...outcome.result, ...healed } };
      }
      return { result: outcome.result };
    }
    case "purchase": {
      const itemName = (args.item ?? args.name ?? "").trim();
      const action = args.action === "sell" ? "sell" : args.action === "buy" ? "buy" : null;
      if (!itemName || args.price === undefined || !action) {
        return { result: { error: "purchase needs item, price, and action buy|sell." } };
      }
      const outcome = computePurchase(sheet, {
        item: itemName,
        price: args.price,
        qty: args.qty ?? 1,
        action,
      });
      if ("error" in outcome) {
        return { result: outcome };
      }
      patchSheet(sheet.id, outcome.patch);
      audit(
        campaign,
        turnId,
        sheet,
        "purchase",
        { item: itemName, price: args.price, qty: args.qty ?? 1, action },
        reason,
        outcome.patch,
      );
      publishSheet(campaign, sheet.id);
      if (outcome.event) {
        insertCharacterEvent({
          libraryCharacterId: sheet.libraryCharacterId,
          campaignCharacterId: sheet.id,
          campaignId: campaign.id,
          seq: allocateSeq(campaign.id),
          kind: "item",
          summary: outcome.event,
        });
      }
      return { result: outcome.result };
    }
    case "use_resource": {
      const resourceName = (args.resource ?? args.name ?? "").trim();
      if (!resourceName) {
        return { result: { error: "use_resource needs a resource name." } };
      }
      const target = args.targetCharacterId ? resolve(args.targetCharacterId) : sheet;
      if (!target) {
        return { result: { error: "Unknown targetCharacterId; use one from GAME STATE." } };
      }
      const outcome = computeUseResource(
        campaign,
        sheet,
        target,
        resourceName,
        Math.max(1, args.amount ?? 1),
        { name: args.form, hp: args.formHp, ac: args.formAc },
      );
      if ("error" in outcome) {
        return { result: outcome };
      }
      patchSheet(sheet.id, outcome.patch);
      audit(
        campaign,
        turnId,
        sheet,
        "use_resource",
        { resource: resourceName, spent: args.amount ?? 1 },
        reason,
        outcome.patch,
      );
      publishSheet(campaign, sheet.id);
      // A feature that lands on someone else (Bardic Inspiration) patches
      // the second sheet the same audited way.
      if (outcome.patchTarget) {
        patchSheet(outcome.patchTarget.characterId, outcome.patchTarget.patch);
        const recipient = resolve(outcome.patchTarget.characterId);
        if (recipient) {
          audit(
            campaign,
            turnId,
            recipient,
            "use_resource",
            { resource: resourceName, from: sheet.name },
            reason,
            outcome.patchTarget.patch,
          );
        }
        publishSheet(campaign, outcome.patchTarget.characterId);
      }
      // Feature healing rides the standard heal mutation so the death
      // engine sees it; recursion is safe (different tool name).
      if (outcome.healTarget) {
        const healed = applyDmMutation(
          campaign,
          turnId,
          "heal",
          JSON.stringify({
            characterId: outcome.healTarget.characterId,
            amount: outcome.healTarget.amount,
            reason: resourceName,
          }),
          sheets,
          sheetsById,
        ).result;
        return { result: { ...outcome.result, ...healed } };
      }
      return { result: outcome.result };
    }
    case "set_condition": {
      const normalized = canonicalCondition(args.condition ?? "");
      if (!normalized) {
        return { result: { error: "set_condition needs a condition name." } };
      }
      // Exhaustion is a leveled track, not a stackable condition: each set
      // raises it one level (6 = death). Effects apply automatically.
      if (normalized.startsWith("exhaustion")) {
        const nextLevel = Math.min(6, sheet.exhaustion + 1);
        const patch: Record<string, unknown> = { exhaustion: nextLevel };
        if (nextLevel >= 6) {
          patch.deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
        }
        patchSheet(sheet.id, patch);
        audit(campaign, turnId, sheet, "set_condition", { condition: "exhaustion", level: nextLevel }, reason, patch);
        publishSheet(campaign, sheet.id);
        return {
          result: {
            ok: true,
            ...(nextLevel >= 6
              ? { dead: true, note: `${sheet.name} reaches exhaustion level 6 and DIES.` }
              : { condition: describeExhaustion(nextLevel), note: "A long rest reduces exhaustion by one level." }),
          },
        };
      }
      if (sheet.conditions.includes(normalized)) {
        return { result: { ok: true, note: `${sheet.name} is already ${normalized}.` } };
      }
      const withCondition = [...sheet.conditions, normalized].slice(0, 15);
      // Duration metadata: timed conditions tick down at round wrap;
      // save-ends conditions re-save server-side each round.
      const meta =
        args.rounds || (args.saveAbility && args.saveDc)
          ? {
              ...sheet.conditionMeta,
              [normalized]: {
                ...(args.rounds ? { rounds: args.rounds } : {}),
                ...(args.saveAbility && args.saveDc
                  ? { saveEnds: { ability: args.saveAbility, dc: args.saveDc } }
                  : {}),
              },
            }
          : sheet.conditionMeta;
      patchSheet(sheet.id, { conditions: withCondition, conditionMeta: meta });
      audit(campaign, turnId, sheet, "set_condition", { condition: normalized }, reason, {
        conditions: withCondition,
        conditionMeta: meta,
      });
      publishSheet(campaign, sheet.id);
      return {
        result: {
          ok: true,
          condition: normalized,
          ...(args.rounds ? { duration: `${args.rounds} rounds, expires automatically` } : {}),
          ...(args.saveAbility && args.saveDc
            ? {
                duration: `until they succeed on a ${args.saveAbility.toUpperCase()} save (DC ${args.saveDc}), re-rolled automatically each round`,
              }
            : {}),
        },
      };
    }
    case "clear_condition": {
      // "concentration" is not a real condition: clearing it ends the
      // tracked spell (a caster dropping concentration voluntarily).
      const rawCondition = (args.condition ?? "").trim().toLowerCase();
      if (rawCondition.startsWith("concentrat")) {
        const ended = breakConcentration(campaign, turnId, sheet.id, "ended voluntarily");
        return ended
          ? { result: { ok: true, cleared: `concentration (${ended})` } }
          : { result: { error: `${sheet.name} is not concentrating on anything.` } };
      }
      // Exhaustion clears one level at a time (greater restoration, a long
      // rest); level 0 is fully recovered.
      if (rawCondition.startsWith("exhaustion")) {
        if (sheet.exhaustion <= 0 && !sheet.conditions.some((entry) => entry.startsWith("exhaustion"))) {
          return { result: { error: `${sheet.name} has no exhaustion.` } };
        }
        const nextLevel = Math.max(0, sheet.exhaustion - 1);
        // Legacy string entries clear alongside the leveled field.
        const cleanedConditions = sheet.conditions.filter(
          (entry) => !entry.startsWith("exhaustion"),
        );
        const patch = { exhaustion: nextLevel, conditions: cleanedConditions };
        patchSheet(sheet.id, patch);
        audit(campaign, turnId, sheet, "clear_condition", { condition: "exhaustion", level: nextLevel }, reason, patch);
        publishSheet(campaign, sheet.id);
        return {
          result: {
            ok: true,
            cleared: nextLevel === 0 ? "exhaustion (fully recovered)" : `one level (now ${describeExhaustion(nextLevel)})`,
          },
        };
      }
      // Forgiving match: "poison" clears "poisoned", and legacy free-form
      // entries ("poisoned by the dart") still clear alongside it.
      const wanted = canonicalCondition(args.condition ?? "");
      const matches = (entry: string) =>
        entry === wanted ||
        canonicalCondition(entry) === wanted ||
        (wanted.length > 3 && (entry.includes(wanted) || wanted.includes(entry)));
      const removed = wanted ? sheet.conditions.filter(matches) : [];
      if (!removed.length) {
        return {
          result: {
            error: `${sheet.name} is not ${wanted || "under that condition"}.`,
            currentConditions: sheet.conditions,
          },
        };
      }
      const withoutCondition = sheet.conditions.filter((entry) => !matches(entry));
      const prunedMeta = pruneMeta(withoutCondition, sheet.conditionMeta);
      patchSheet(sheet.id, { conditions: withoutCondition, conditionMeta: prunedMeta });
      audit(campaign, turnId, sheet, "clear_condition", { condition: removed.join(", ") }, reason, {
        conditions: withoutCondition,
        conditionMeta: prunedMeta,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, cleared: removed.join(", ") } };
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
      // Content-pack validation: cantrips need no slot, upcasting only goes
      // UP (a level 3 spell never fits a level 1 slot), and ritual-tagged
      // spells may skip the slot entirely.
      const known = spell
        ? searchSpells({ q: spell, userId: sheet.userId, limit: 10 }).find(
            (entry) => entry.name.trim().toLowerCase() === spell.toLowerCase(),
          )
        : undefined;
      if (known && known.level === 0) {
        return {
          result: {
            ok: true,
            note: `${spell} is a cantrip: no spell slot is spent. Cantrips are unlimited.`,
          },
        };
      }
      if (known && known.level > 0 && level < known.level) {
        return {
          result: {
            error: `${spell} is a level ${known.level} spell; it cannot be cast from a level ${level} slot. Use a slot of level ${known.level} or higher.`,
          },
        };
      }
      if (args.ritual) {
        if (known && !known.ritual) {
          return {
            result: {
              error: `${spell} has no ritual tag; it cannot be cast as a ritual and needs a slot.`,
            },
          };
        }
        return {
          result: {
            ok: true,
            note: `${spell} cast as a ritual: ten extra minutes of casting, no slot spent.`,
          },
        };
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
      // Concentration: a concentration spell displaces any previous one.
      const requiresConcentration =
        args.concentration === true ||
        (spell ? spellRequiresConcentration(spell, sheet.userId) === true : false);
      let concentrationInfo: Record<string, unknown> = {};
      if (spell && requiresConcentration) {
        const { displaced } = setConcentration(campaign, turnId, sheet.id, spell);
        concentrationInfo = {
          concentration: true,
          ...(displaced
            ? { droppedConcentration: `${displaced} ended when ${spell} was cast.` }
            : {}),
        };
      }
      return {
        result: {
          ok: true,
          slot: `level ${level}: ${math.max - math.used}/${math.max} left`,
          ...concentrationInfo,
        },
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
        // The class's real 5e ceiling. Cantrips do not count against it, and
        // an unknown class (custom catalog) has no table to enforce.
        const spellLevel = searchSpells({ q: spell, userId: sheet.userId, limit: 10 }).find(
          (entry) => entry.name.trim().toLowerCase() === spell.toLowerCase(),
        )?.level;
        const ceiling = suggestedSpellCount(
          sheet.class,
          sheet.level,
          abilityMod(sheet.abilities[sheet.spellcasting.ability]),
        );
        const current = intoKnown ? known.length : prepared.length;
        if (ceiling && spellLevel !== 0 && current >= ceiling.count) {
          return {
            result: {
              error: `${sheet.name} already has ${current} ${ceiling.label}, the most a level ${sheet.level} ${sheet.class} may hold. They must give one up first: call learn_spell with action=remove for the spell they drop.`,
            },
          };
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
      const patch: typeof parsedPatch.data & {
        conditionMeta?: CharacterSheet["conditionMeta"];
      } = parsedPatch.data;
      if (patch.conditions) {
        patch.conditions = [...new Set(patch.conditions.map(canonicalCondition).filter(Boolean))];
        // A full conditions replacement drops metadata for anything removed.
        patch.conditionMeta = pruneMeta(patch.conditions, sheet.conditionMeta);
      }
      const changed = Object.keys(patch).filter(
        (key) => patch[key as keyof typeof patch] !== undefined,
      );
      if (!changed.length) {
        return {
          result: { error: "update_sheet changed nothing; include at least one field." },
        };
      }
      const buffError = sheetBuffViolation(
        sheet,
        patch,
        typeof patch.xp === "number" ? levelForXp(patch.xp) : undefined,
      );
      if (buffError) {
        return { result: { error: buffError } };
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
