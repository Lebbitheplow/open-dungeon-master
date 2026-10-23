import { healerKitUse } from "@/lib/dm/stabilize";
import { subclassExtrasForTable } from "@/lib/db/subclass-extras";
import { foldFieldValue } from "@/lib/dm/update-sheet-args";
import { aiSheetFieldRefusal } from "@/lib/dm/update-sheet-ai";
import { getDmTurn } from "@/lib/db/dm-turns";
import { z } from "zod";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { levelForXp } from "@/lib/srd";
import { publishPersisted } from "@/lib/events";
import {
  fullPatchSheetSchema,
  type CharacterSheet,
  type FullPatchSheetInput,
} from "@/lib/schemas/sheet";
import {
  COPPER_PURSE_MAX,
  goldProblem,
  grantItemMath,
  grantProblem,
  healMath,
  quantityProblem,
  removeItemMath,
  revealItemMath,
  sheetBuffViolation,
  spendSlotMath,
} from "@/lib/dm/mutation-math";
import { capacityProblem } from "@/lib/dm/load-rules";
import {
  addCopper,
  COPPER_PER_GOLD,
  formatPrice,
  formatPurse,
  fromCopper,
  parseCoins,
  unreadCoins,
  purseCopper,
} from "@/lib/srd/currency";
import { healDeathHook } from "@/lib/dm/death";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { featureVariantSpend } from "@/lib/dm/feature-spends";
import { authoredFeatureSpend } from "@/lib/dm/authored-spends";
import { combatFeatureSpend } from "@/lib/dm/combat-features";
import { srdFeatureSpend } from "@/lib/dm/srd-feature-spends";
import { handleStabilize } from "@/lib/dm/stabilize";
import { canonicalCondition, handleSetCondition } from "@/lib/dm/set-condition";
import { exhaustionPatch, namesExhaustion, PRONE, regainBlockedBy, STABILIZE_METHODS, SUFFOCATING } from "@/lib/dm/vitals-logic";
import { castMarkCharge, prepareResourceCharge } from "@/lib/dm/resource-turn";
import { planCounterReaction } from "@/lib/dm/reaction-counters";
import { channelOptions, channelOptionsHeld, optionCost } from "@/lib/dm/option-costs";
import { BONUS_ATTACK_COUNTERS } from "@/lib/dm/feature-bonus-attacks";
import { matchResource } from "@/lib/srd/class-resources";
import { prepareUseItem } from "@/lib/dm/object-actions";
import { chargedItemUse } from "@/lib/dm/item-use";
import { applyConsumable, consumableRefusal, scrollSpellFor } from "@/lib/dm/consumables";
import { castSpell } from "@/lib/dm/cast-guard";
import { characterCallUnasked } from "@/lib/dm/player-word";
import { ZONE_ARGS, zoneArgsSchema, zonePlacement } from "@/lib/dm/zone-args";
import { castHealingSpell } from "@/lib/dm/heal-spell";
import { advanceClock, recordShapeEnd } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { canAct } from "@/lib/dm/can-act";
import { spendAction } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { payToStand } from "@/lib/dm/stand-up";
import { copyCost, learnProblem } from "@/lib/dm/learn-rules";
import { getAuditPreImage, listAuditForTurn, listAuditSince } from "@/lib/db/sheet-audit";
import { autoLevelCompanion } from "@/lib/dm/companion-tools";
import {
  describeExhaustion,
  effectiveMaxHp,
  pruneMeta,
} from "@/lib/dm/condition-logic";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { breakConcentration } from "@/lib/dm/concentration";
import {
  computePurchase,
  computeUseItem,
  computeUseResource,
  fontOfMagicDirection,
  payForUse,
  rollHealing,
} from "@/lib/dm/resource-tools";
import { resourceTools } from "@/lib/dm/resource-tool-defs";
import { applyDamageTool, clearConditionTool, setConditionTool } from "@/lib/dm/merged-tool-defs";
import { searchSpells, spellFactsFor, spellNameMatches } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { suggestedSpellCount } from "@/lib/content/mechanics";
import { abilityMod } from "@/lib/srd";
import { spellClassFor } from "@/lib/classes";
import { planHealFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { checklistClassSpell, isCantripName, spellsAgainstLimit } from "@/lib/srd/spell-lists";
import { casterViewsOf, spellCapOf, spellbookOf, withCasterViews } from "@/lib/srd/spell-prep";
import { subclassSpellsFor } from "@/lib/srd/features";
import { waypointProperty } from "@/lib/dm/waypoint-logic";
import { invalidArguments, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { worthProblem } from "@/lib/dm/trade-value";
import { findCarriedItem, notCarried, sentItemTags, srdNameFor } from "@/lib/dm/item-logic";
import { isTableGearName } from "@/lib/db/homebrew";
import { freeSlotsLine, spentSlotRefusal } from "@/lib/dm/cast-rules";
import { textKey } from "@/lib/language/text-logic";
import { ITEM_TAGS } from "@/lib/schemas/item-tags";
import { holdsFeature, isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { unknownSheetRef } from "@/lib/dm/rolls";

// DM stat authority: the model changes sheets ONLY through these tools.
// Every mutation is server-clamped, audit-logged, and published live.

export const MUTATION_TOOL_NAMES = [
  "apply_damage",
  "heal",
  "stabilize",
  "award_xp",
  "party_award",
  "modify_gold",
  "grant_item",
  "remove_item",
  "reveal_item",
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

// What an item is, for an item whose name is not an SRD or pack item's
// English name (src/lib/srd/item-tags.ts).
const ITEM_SRD_NAME_PROPERTY = {
  type: "string",
  description:
    "The SRD or pack item this is, by its English name ('Elixir of Health', 'Potion of Healing', 'Longsword'), when name is the table's own ('Elisir di salute'): the server reads what it does from that item. A magic weapon or armor built on a chosen base is named with it as the SRD writes it ('Flame Tongue Scimitar', 'Vicious Rapier', 'Mithral Half Plate', 'Chain Mail of Fire Resistance'). Omit when name already is that English name, for loot no list has, and while it is unidentified.",
};

const ITEM_TAGS_PROPERTY = {
  type: "array",
  items: { type: "string", enum: [...ITEM_TAGS] },
  description:
    "What the item is, beyond what its SRD or pack item says: the server reads these for potions, scrolls, rations and water, light, foci, ammunition, silvered or adamantine weapons, and treasure. For loot no list has (loot you invent), all of what it is, [] when none fits. For an SRD or pack item, only what the item adds to its row: a silvered longsword is srdName 'Longsword' with tags ['silvered']; omit them otherwise. Omit while it is unidentified.",
};

// The spell a spell scroll holds (src/lib/dm/consumables.ts).
const ITEM_SPELL_PROPERTY = {
  type: "string",
  description:
    "A spell scroll only (tags with scroll): the spell it holds, by the spell's name as the spell lists give it ('Fireball'), whatever the scroll is called. Reading it casts that spell. Omit while it is unidentified.",
};

// What one is worth, for a thing the content pack does not price
// (src/lib/dm/trade-value.ts).
const ITEM_WORTH_PROPERTY = {
  type: "number",
  minimum: 0.01,
  maximum: 100000,
  description:
    "What one is worth in gold pieces, for a thing no SRD or pack row prices: a gem (10 to 5,000 gp), an art object (25 to 7,500 gp), a trade good, loot you invent. The server prices its sale by it (full for treasure, half for anything else) and a spell's costly material by it. Write the name without its worth. Omit for an SRD item, and while it is unidentified.",
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
  applyDamageTool,
  tool("heal", "Restore a character's hit points, capped at their max. For a HEALING SPELL, pass spell, casterId and level instead of amount: the server casts it (the caster must have the spell; the slot and the action are spent), rolls the spell's real dice, adds the caster's ability modifier, and shows the dice card.", {
    amount: { type: "integer", minimum: 1, maximum: 200, description: "Hit points the server rolled this turn, for healing that is not a spell." },
    dice: { type: "string", description: "Dice the server rolls for healing that is not a spell ('2d4+2'). Instead of amount." },
    spell: {
      type: "string",
      description: "Healing spell being cast (Cure Wounds, Healing Word, Prayer of Healing).",
    },
    level: {
      type: "integer",
      minimum: 1,
      maximum: 9,
      description: "Slot level the healing spell was cast at, for upcast scaling.",
    },
    casterId: {
      type: "string",
      description: "The caster, when a spell heals someone else: exact characterId from GAME STATE.",
    },
    temp: {
      type: "boolean",
      description: "True for TEMPORARY hit points instead of healing (they do not stack; the higher value wins).",
    },
  }, []),
  tool(
    "stabilize",
    "Stabilize a DYING character at 0 HP without healing. It takes the healer's action: with method 'check' the server rolls their DC 10 Wisdom (Medicine) check; 'kit' (one of the ten uses of the healer's kit they carry) and 'spell' (Spare the Dying) need no check. On a battle map the healer must be within 5 feet. A stable character stops making death saves, stays unconscious at 0 HP, and regains 1 hit point after 1d4 hours.",
    {
      healerId: { type: "string", description: "Whoever tends them: exact characterId from GAME STATE." },
      method: {
        type: "string",
        enum: [...STABILIZE_METHODS],
        description: "Default 'check'.",
      },
    },
    ["healerId"],
  ),
  {
    type: "function",
    function: {
      name: "party_award",
      description:
        "Award XP for overcoming a challenge, to one character or the party. Spoils of the same moment ride the same call (a purse split evenly, one item to the finder); the server does the arithmetic and reports who can level up.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterIds: { type: "array", items: { type: "string" }, minItems: 1 },
          amount: { type: "integer", minimum: 1, maximum: 20000, description: "XP for EACH character." },
          delta: {
            type: "integer",
            minimum: -100000,
            maximum: 100000,
            description: "Gold in all, split evenly; the remainder to the first.",
          },
          name: { type: "string", description: "One item, to the first listed (who found it)." },
          qty: { type: "integer", minimum: 1, maximum: 99 },
          reason: { type: "string" },
        },
        required: ["characterIds"],
      },
    },
  },
  tool("modify_gold", "Add or remove money (negative delta = spend/lose). Floors at 0.", {
    delta: { type: "integer", minimum: -100000, maximum: 100000 },
    coins: { type: "string", description: "For anything under a gold piece, or a price quoted in another coin: the amount in the coins' codes pp, gp, ep, sp and cp ('340 sp', '2 pp 5 sp'), whatever the table's language. Overrides delta's size; delta's sign still says gain or spend (-1 to spend it, 1 to gain it)." },
    additional: { type: "boolean", description: "Only when a player just accepted this same amount and this is truly another, separate sum from a different source." },
  }, ["delta"]),
  tool("grant_item", "Give a character an item (loot, purchase, gift), only one the fiction actually put in their hands.", {
    ...waypointProperty,
    unidentified: { type: "boolean", description: "True when the party cannot tell what it is yet: then name is the description they would use ('an ornate silver ring'), never the true name, and reveal_item names it later." },
    name: { type: "string" },
    qty: { type: "integer", minimum: 1, maximum: 99 },
    additional: { type: "boolean", description: "Only when a player just accepted this same item and this is truly another one from a different source." },
    srdName: ITEM_SRD_NAME_PROPERTY,
    tags: ITEM_TAGS_PROPERTY,
    worth: ITEM_WORTH_PROPERTY,
    spell: ITEM_SPELL_PROPERTY,
  }, ["name"]),
  tool("remove_item", "Take an item from a character for good (stolen, destroyed, burned up). Something dropped, set down or knocked away is NOT removed: use handle_item drop, which leaves it where it fell. For consumables being USED, use use_item; for sales, use purchase.", {
    name: { type: "string" },
    qty: { type: "integer", minimum: 1, maximum: 99 },
  }, ["name"]),
  tool("reveal_item", "Name an item the party has been carrying without knowing what it is. Only for items granted unidentified; an ordinary item needs no revealing.", {
    name: { type: "string", description: "The description they have been calling it by, as on the sheet now ('an ornate silver ring')." },
    revealedName: { type: "string", description: "What it truly is ('Ring of Protection')." },
    srdName: ITEM_SRD_NAME_PROPERTY,
    tags: ITEM_TAGS_PROPERTY,
    worth: ITEM_WORTH_PROPERTY,
    spell: ITEM_SPELL_PROPERTY,
  }, ["name"]),
  ...resourceTools,
  setConditionTool,
  clearConditionTool,
  tool("use_spell_slot", "Cast a spell that no other tool resolves (a utility spell, a summoning, a ritual): the server checks the caster holds the spell and can cast it now, spends the slot of the spell's level (or the higher one named), its casting time from the turn and any costly material, and tracks concentration: a new concentration spell ends the previous one and its effects. A spell that leaves an area on the battle map with nobody caught in it yet (Fog Cloud, Darkness, Silence, Spike Growth, Web, Moonbeam, Daylight, a Wall of Stone, Force, Ice, Fire or Thorns, Guardian of Faith) is laid there (atX); the server applies the area from then on (movement, sight, Silence, the saves and damage of creatures entering it or starting or ending a turn in it) and removes it when the concentration or the duration ends.", {
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
    units: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description: "For a material priced per creature affected (Astral Projection), per corpse (Create Undead) or per Hit Die of the target (Imprisonment): how many.",
    },
    ...ZONE_ARGS,
  }, ["level", "spell"]),
  tool(
    "learn_spell",
    "Permanently add or remove ONE spell on a character's spell list, only when the story genuinely teaches or strips it: a scroll copied into a spellbook, a mentor's training, a granted boon, a curse. For a wizard the spell is written in the spellbook and can be prepared after a long rest. Players choose their own prepared spells from their sheet; never use this to swap what is prepared. Never use this to let a character cast something in the moment; casting requires the spell to already be on their sheet.",
    {
      action: { type: "string", enum: ["add", "remove"] },
      spell: { type: "string", description: "Exact spell name." },
    },
    ["action", "spell"],
  ),
  tool(
    "update_sheet",
    "Set who a character is in the story, including a feat or an ability score a curse changed; never a level, hit points, XP, AC, gold or conditions (heal, apply_damage, party_award, modify_gold, set_condition and set_effect move those). Include ONLY the fields that change.",
    {
      name: { type: "string" },
      race: { type: "string" },
      background: { type: "string" },
      alignment: { type: "string" },
      speed: { type: "integer", minimum: 0, maximum: 120 },
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
  // apply_damage: from a spell or a magic weapon.
  magical: z.coerce.boolean().optional(),
  // stabilize: who tends to the dying character, and how.
  healerId: z.string().optional(),
  method: z.enum(STABILIZE_METHODS).optional(),
  // set_condition: who or what the condition is tied to.
  sourceEnemyId: z.string().max(80).optional(),
  sourceCharacterId: z.string().max(80).optional(),
  // use_spell_slot: homebrew concentration flag + ritual casting.
  concentration: z.boolean().optional(),
  ritual: z.coerce.boolean().optional(),
  // use_spell_slot, internal: which cast tool is calling, and a check that
  // writes nothing (src/lib/dm/cast-guard.ts). Not in the tool schema.
  via: z.enum(["slot", "enemy", "buff", "aoe", "attack", "heal", "reaction"]).optional(),
  dryRun: z.boolean().optional(),
  // use_spell_slot, internal: how many of the casting's shares this call
  // resolves (Magic Missile's darts at one target).
  uses: z.coerce.number().int().min(1).max(700).optional(),
  units: z.coerce.number().int().min(1).max(100).optional(),
  ...zoneArgsSchema,
  // heal: temporary hit points instead of healing.
  temp: z.coerce.boolean().optional(),
  delta: z.coerce.number().int().optional(),
  // modify_gold / purchase in the coins' codes: "340 sp", "2 pp 5 sp".
  // Parsed to copper by src/lib/srd/currency.ts, and it wins over `delta`
  // when both are sent, because it is the more specific of the two.
  coins: z.string().max(60).optional(),
  name: z.string().optional(),
  // grant_item: the party cannot tell what this is yet.
  unidentified: z.coerce.boolean().optional(),
  // reveal_item: what it actually turns out to be.
  revealedName: z.string().optional(),
  // grant_item, reveal_item: the SRD or pack item it is, by its English
  // name, when its name is the table's (src/lib/srd/item-tags.ts).
  srdName: z.string().max(80).optional(),
  // grant_item, reveal_item: what the item is (src/lib/srd/item-tags.ts).
  tags: z.array(z.enum(ITEM_TAGS)).max(12).optional(),
  // grant_item, reveal_item: what one is worth, in gold pieces.
  worth: z.coerce.number().positive().max(100000).optional(),
  qty: z.coerce.number().int().optional(),
  // use_item / purchase / use_resource.
  item: z.string().optional(),
  // use_item: charges a charged item spends (src/lib/dm/item-use.ts).
  charges: z.coerce.number().int().min(1).max(50).optional(),
  targetCharacterId: z.string().optional(),
  // use_resource: the creature a feature is aimed at (Intimidating Presence).
  targetEnemyId: z.string().optional(),
  // purchase: gold each, for a thing no list prices (half a gold piece is 0.5).
  price: z.coerce.number().min(0).max(100000).optional(),
  resource: z.string().optional(),
  // use_resource, Wild Shape: the beast form's stat block.
  form: z.string().optional(),
  formHp: z.coerce.number().int().min(1).max(300).optional(),
  formAc: z.coerce.number().int().min(1).max(30).optional(),
  formCr: z.coerce.number().min(0).max(30).optional(),
  formFlies: z.coerce.boolean().optional(),
  formSwims: z.coerce.boolean().optional(),
  // use_resource: the chosen option of a feature with variants.
  variant: z.string().optional(),
  condition: z.string().optional(),
  // set_condition durations: rounds for combat-scale effects, minutes or
  // hours for the ones the in-world clock runs down (all stored as rounds).
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  minutes: z.coerce.number().int().min(1).max(1440).optional(),
  hours: z.coerce.number().int().min(1).max(24).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  saveAbility: z.preprocess(
    normalizeAbility,
    z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  ),
  saveDc: z.coerce.number().int().min(1).max(30).optional(),
  level: z.coerce.number().int().optional(),
  spell: z.string().optional(),
  // heal: who cast the healing spell, when it lands on someone else.
  casterId: z.string().optional(),
  // learn_spell: add|remove; purchase: buy|sell.
  action: z.enum(["add", "remove", "buy", "sell"]).optional(),
  reason: z.string().optional(),
});

export const MUTATION_CAP_PER_TURN = 10;
export const MUTATION_CAP_REFUSAL: ToolError = { error: "Mutation limit reached for this turn.", refused: "limit" };

// How far back update_sheet looks for its own earlier edits of a sheet when
// it judges the ceiling on direct edits.
const UPDATE_SHEET_WINDOW_MS = 10 * 60 * 1000;

// Re-exported for the callers that have always found it here.
export { canonicalCondition };

type MutationOutcome = { result: ToolResult };

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

// The cast guard asked without spending (src/lib/dm/cast-guard.ts): the
// refusal the cast would meet, or null. A spell tool asks it before its own
// questions and options, so nobody is asked which beast, which targets or
// whether to drop Overchannel for a cast the caster, the turn or the slots
// bar.
export function castBarred(
  campaign: Campaign,
  turnId: string,
  cast: { characterId: string; spell: string; level?: number; via: string; units?: number },
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolError | null {
  const check = applyDmMutation(campaign, turnId, "use_spell_slot", JSON.stringify({ ...cast, dryRun: true }), sheets, sheetsById).result;
  return typeof check.error === "string" ? toolError(check) : null;
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
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return { result: { error: "Invalid arguments.", retry: true } };
  }
  const parsed = argsSchema.safeParse(raw);
  if (!parsed.success) {
    return { result: invalidArguments("Invalid arguments.", parsed.error) };
  }
  const args = parsed.data;
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
      sheets.find((entry) => textKey(entry.name) === textKey(trimmed)) ??
      null;
    return stale ? getSheetById(stale.id) : null;
  };

  // The spoils of one moment, split in one call. Every part of it goes
  // through the ordinary single-target mutations below, so the audit trail,
  // the level-up hooks and the character events are the same ones a run of
  // separate calls would have written.
  if (toolName === "party_award") {
    const targets = (args.characterIds ?? [])
      .map(resolve)
      .filter((entry): entry is CharacterSheet => entry !== null);
    if (!targets.length) {
      return { result: { error: "No valid characterIds from GAME STATE.", retry: true } };
    }
    // Every part is judged before any part is handed out, so a refused
    // purse does not leave the experience behind it awarded.
    const bounds =
      goldProblem(args.delta ?? 0, "party_award") ??
      ((args.name ?? "").trim() ? quantityProblem(args.qty, "party_award") : null);
    if (bounds) {
      return { result: bounds };
    }
    const awarded: string[] = [];
    // What the experience reported (who can level up, who was skipped as
    // dead), passed on: the call is the party's award_xp too.
    let experience: Record<string, unknown> = {};
    const xp = args.amount ?? 0;
    if (xp > 0) {
      const outcome = applyDmMutation(
        campaign,
        turnId,
        "award_xp",
        JSON.stringify({ characterIds: targets.map((entry) => entry.id), amount: xp, reason }),
        sheets,
        sheetsById,
      );
      if ("error" in outcome.result) {
        return outcome;
      }
      const { ok: _ok, awarded: _xp, ...reported } = outcome.result;
      void _ok;
      void _xp;
      experience = reported;
      awarded.push(`${xp} XP each`);
    }
    const gold = args.delta ?? 0;
    if (gold) {
      // The remainder rides on the first share so the party ends up with
      // exactly what the hoard held, not one coin less.
      const share = Math.trunc(gold / targets.length);
      const remainder = gold - share * targets.length;
      targets.forEach((entry, index) => {
        const delta = share + (index === 0 ? remainder : 0);
        if (!delta) {
          return;
        }
        applyDmMutation(
          campaign,
          turnId,
          "modify_gold",
          JSON.stringify({ characterId: entry.id, delta, reason }),
          sheets,
          sheetsById,
        );
      });
      awarded.push(`${gold} gold split ${targets.length} ways`);
    }
    const item = (args.name ?? "").trim();
    if (item) {
      // An item cannot be split; it goes to the first character listed,
      // which is the one who found it.
      applyDmMutation(
        campaign,
        turnId,
        "grant_item",
        JSON.stringify({ characterId: targets[0].id, name: item, qty: args.qty ?? 1, reason }),
        sheets,
        sheetsById,
      );
      awarded.push(`${item} to ${targets[0].name}`);
    }
    if (!awarded.length) {
      return { result: { error: "party_award needs XP, gold or an item to hand out.", retry: true } };
    }
    return { result: { ok: true, awarded: awarded.join("; "), ...experience } };
  }

  if (toolName === "award_xp") {
    const amount = args.amount ?? 0;
    if (amount < 1) {
      return { result: { error: "Experience needs a positive amount.", retry: true } };
    }
    // Ceiling so a whispered or in-chat "give me a million XP" cannot vault a
    // character up the track in one call; realistic events award far less, and
    // level-ups still require the player's own app flow.
    const MAX_XP_PER_AWARD = 20000;
    if (amount > MAX_XP_PER_AWARD) {
      return {
        result: {
          error: `That is more experience than any single event grants; award a realistic amount (up to ${MAX_XP_PER_AWARD}).`,
          retry: true,
        },
      };
    }
    const named = (args.characterIds ?? [])
      .map(resolve)
      .filter((sheet): sheet is CharacterSheet => sheet !== null);
    if (!named.length) {
      return { result: { error: "No valid characterIds from GAME STATE.", retry: true } };
    }
    // The dead take no part in the game, its experience included.
    const targets = named.filter((sheet) => !sheet.deathSaves?.dead);
    const dead = named.filter((sheet) => sheet.deathSaves?.dead).map((sheet) => sheet.name);
    if (!targets.length) {
      return {
        result: {
          error: `${dead.join(", ")} ${dead.length === 1 ? "is" : "are"} dead and earn no experience. Award it to the living.`,
          retry: true,
        },
      };
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
        ...(dead.length ? { skippedDead: dead } : {}),
        ...(levelUps.length ? { levelUpAvailable: levelUps } : {}),
        ...(companionLevelUps.length ? { companionLevelUps } : {}),
      },
    };
  }

  const sheet = resolve(args.characterId);
  if (!sheet) {
    return { result: unknownSheetRef("characterId", args.characterId, sheets) };
  }

  switch (toolName) {
    case "apply_damage": {
      const amount = args.amount ?? 0;
      if (amount < 1) {
        return { result: { error: "apply_damage needs a positive amount.", retry: true } };
      }
      // The 200 is the rail on what a caller may SEND. The engine's own
      // dice (a fall, a creature out of air) go to applyPcDamage directly.
      return {
        result: applyPcDamage(campaign, turnId, sheet, {
          amount: Math.min(amount, 200),
          type: args.type,
          crit: args.crit === true,
          magical: args.magical === true,
          // A named spell's damage: Spell Resistance and Aura of Warding resist it.
          spell: Boolean(args.spell),
          reason,
        }),
      };
    }
    case "heal": {
      const unasked = characterCallUnasked(campaign.id, getDmTurn(turnId), rawArguments, "casterId");
      if (unasked) {
        return { result: unasked };
      }
      // A named healing spell is rolled by the server from the content
      // pack's own dice, exactly as a healing potion is, so the model never
      // decides how much a Cure Wounds restores.
      let amount = args.amount ?? 0;
      let healNote: string | null = null;
      const healSpell = (args.spell ?? "").trim();
      if (healSpell) {
        const caster = (args.casterId ? resolve(args.casterId) : null) ?? sheet;
        // Everything a healing spell asks is asked before the slot is spent
        // (src/lib/dm/heal-spell.ts): its healing can be derived, the target
        // is in reach, the dead are reached only by a revival spell inside
        // its window. A name nobody published heals by the amount sent.
        const outcome = castHealingSpell(
          campaign,
          turnId,
          { target: sheet, caster, spell: healSpell, level: args.level, amount: args.amount, reason },
          (castArgs) =>
            applyDmMutation(campaign, turnId, "use_spell_slot", JSON.stringify(castArgs), sheets, sheetsById).result,
        );
        if (outcome && "error" in outcome) {
          return { result: toolError(outcome) };
        }
        if (outcome && "done" in outcome) {
          return { result: outcome.done };
        }
        if (outcome) {
          amount = outcome.amount;
          healNote = outcome.note;
        }
      }
      if (amount < 1) {
        return {
          result: {
            error: "heal needs a positive amount, or a spell name to roll.",
            retry: true,
          },
        };
      }
      if (sheet.deathSaves?.dead) {
        return {
          result: {
            error: `${sheet.name} is DEAD. Healing cannot help; only the party lead can reverse a death.`,
            refused: "rules",
          },
        };
      }
      const blocked = args.temp ? null : regainBlockedBy(sheet);
      if (blocked) {
        return {
          result: {
            error:
              blocked === SUFFOCATING
                ? `${sheet.name} is still without air and cannot regain hit points until they can breathe. Get them to air, clear the suffocating condition, then heal them.`
                : `${sheet.name} is gripped by Chill Touch and cannot regain hit points until its caster's next turn starts.`,
            refused: "rules",
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
      // Healing in a beast form restores the beast: the druid's own hit
      // points wait, untouched, for the form to end.
      if (sheet.wildShape) {
        const shape = sheet.wildShape;
        const beast = healMath(shape.beastHp, shape.beastMaxHp, Math.min(amount, 200));
        const patch: FullPatchSheetInput = { wildShape: { ...shape, beastHp: beast.currentHp } };
        patchSheet(sheet.id, patch);
        audit(campaign, turnId, sheet, "heal", { amount, form: shape.form, beastHp: beast.currentHp }, reason, patch);
        publishSheet(campaign, sheet.id);
        return {
          result: {
            ok: true,
            form: `${shape.form}: ${beast.currentHp}/${shape.beastMaxHp} HP`,
            healed: beast.currentHp - shape.beastHp,
            ...(healNote ? { spell: healNote } : {}),
            note: `The healing restores the beast form; ${sheet.name}'s own ${sheet.currentHp}/${effectiveMaxHp(sheet)} is untouched.`,
          },
        };
      }
      // Exhaustion level 4 halves the maximum healing can reach.
      const ceiling = effectiveMaxHp(sheet);
      const math = healMath(Math.min(sheet.currentHp, ceiling), ceiling, Math.min(amount, 200));
      patchSheet(sheet.id, { currentHp: math.currentHp });
      audit(campaign, turnId, sheet, "heal", { amount, newHp: math.currentHp }, reason, {
        currentHp: math.currentHp,
      });
      publishSheet(campaign, sheet.id);
      {
        const pos = tokenPosition(campaign.id, sheet.id);
        if (pos && amount > 0) {
          publishFx(
            campaign.id,
            planHealFx({ to: pos.at, toTokenId: pos.tokenId, amount: Math.min(amount, 200) }),
          );
        }
      }
      // Any healing ends the dying state.
      const deathInfo = healDeathHook(campaign, turnId, sheet);
      return {
        result: {
          ok: true,
          hp: `${math.currentHp}/${ceiling}`,
          healed: amount,
          ...(healNote ? { spell: healNote } : {}),
          ...deathInfo,
        },
      };
    }
    case "stabilize": {
      const unasked = characterCallUnasked(campaign.id, getDmTurn(turnId), rawArguments, "healerId");
      if (unasked) {
        return { result: unasked };
      }
      return {
        result: handleStabilize(campaign, turnId, sheet, resolve(args.healerId), {
          method: args.method,
          reason,
        }),
      };
    }
    case "modify_gold": {
      const delta = args.delta ?? 0;
      // A coin string is signed by the delta's sign when one is given, so
      // "delta: -1, coins: 5 sp" spends five silver rather than earning it.
      const parsedCoins = args.coins?.trim() ? parseCoins(args.coins) : null;
      // Coins sent and unread are asked for again, never taken as the delta.
      if (args.coins?.trim() && parsedCoins === null) {
        return { result: { error: `modify_gold: ${unreadCoins(args.coins)}. Nothing changed.`, retry: true } };
      }
      const coinDelta =
        parsedCoins === null ? null : (delta < 0 ? -parsedCoins : parsedCoins);
      if (!delta && coinDelta === null) {
        return { result: { error: "modify_gold needs a nonzero delta, or coins like \"340 sp\".", retry: true } };
      }
      const moved = coinDelta ?? delta * COPPER_PER_GOLD;
      const tooMuch = goldProblem(moved / COPPER_PER_GOLD, "modify_gold");
      if (tooMuch) {
        return { result: tooMuch };
      }
      if (sheet.gold * COPPER_PER_GOLD + sheet.copper + moved > COPPER_PURSE_MAX) {
        return {
          result: {
            error: `${sheet.name}'s purse holds at most ${COPPER_PURSE_MAX / COPPER_PER_GOLD} gp; this would pass it. Nothing changed.`,
            retry: true,
          },
        };
      }
      // Denominations win over the plain gold delta when both are sent: a
      // model that says "coins: 340 sp, delta: 34" meant the coins, and
      // the two are the same number only by accident.
      const change = addCopper({ gold: sheet.gold, copper: sheet.copper }, moved);
      patchSheet(sheet.id, { gold: change.purse.gold, copper: change.purse.copper });
      audit(
        campaign,
        turnId,
        sheet,
        "modify_gold",
        { delta: Math.trunc(change.applied / COPPER_PER_GOLD), copper: change.applied, gold: change.purse.gold },
        reason,
        { gold: change.purse.gold, copper: change.purse.copper },
      );
      publishSheet(campaign, sheet.id);
      return {
        result: {
          ok: true,
          gold: change.purse.gold,
          purse: formatPurse(change.purse),
          ...(change.short ? { short: formatPrice(change.short) } : {}),
        },
      };
    }
    case "grant_item": {
      const name = (args.name ?? "").trim().slice(0, 80);
      if (!name) {
        return { result: { error: "grant_item needs an item name.", retry: true } };
      }
      const known = args.unidentified !== true;
      const badQty = quantityProblem(args.qty, "grant_item");
      if (badQty) {
        return { result: badQty };
      }
      const listed = srdNameFor(args.srdName, "grant_item");
      if ("error" in listed) {
        return { result: listed };
      }
      const priced = worthProblem({ name, ...listed }, args.worth, "grant_item");
      if (priced) {
        return { result: priced };
      }
      const tags = sentItemTags({ name, ...listed }, args.tags, args.spell);
      const scroll = scrollSpellFor(campaign, { name, ...listed, tags }, args.spell, "grant_item");
      if ("error" in scroll) {
        return { result: scroll };
      }
      const math = grantItemMath(sheet.equipment, name, args.qty ?? 1, { identified: known, ...listed, tags, worth: args.worth, ...scroll });
      const noRoom = grantProblem(sheet.name, sheet.equipment, math.equipment, name) ?? capacityProblem(sheet, math.equipment, name);
      if (noRoom) {
        return { result: noRoom };
      }
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
    case "reveal_item": {
      const name = (args.name ?? "").trim();
      if (!name) {
        return { result: { error: "reveal_item needs the description the sheet carries now.", retry: true } };
      }
      const revealed = args.revealedName?.trim() || name;
      const listed = srdNameFor(args.srdName, "reveal_item");
      if ("error" in listed) {
        return { result: listed };
      }
      const priced = worthProblem({ name: revealed, ...listed }, args.worth, "reveal_item");
      if (priced) {
        return { result: priced };
      }
      const tags = sentItemTags({ name: revealed, ...listed }, args.tags, args.spell);
      const scroll = scrollSpellFor(campaign, { name: revealed, ...listed, tags }, args.spell, "reveal_item");
      if ("error" in scroll) {
        return { result: scroll };
      }
      const math = revealItemMath(sheet.equipment, name, args.revealedName, { ...listed, tags, worth: args.worth, ...scroll });
      if (!math) {
        return {
          result: {
            error: `${sheet.name} is not carrying an unidentified "${name}". Only an item granted unidentified can be revealed.`,
            retry: true,
          },
        };
      }
      patchSheet(sheet.id, { equipment: math.equipment });
      audit(campaign, turnId, sheet, "reveal_item", { from: math.from, to: math.to }, reason, {
        equipment: math.equipment,
      });
      publishSheet(campaign, sheet.id);
      insertCharacterEvent({
        libraryCharacterId: sheet.libraryCharacterId,
        campaignCharacterId: sheet.id,
        campaignId: campaign.id,
        seq: allocateSeq(campaign.id),
        kind: "item",
        summary:
          math.from === math.to
            ? `Identified ${math.to}.`
            : `${math.from} turned out to be ${math.to}.`,
      });
      return { result: { ok: true, was: math.from, is: math.to } };
    }
    case "remove_item": {
      const name = (args.name ?? "").trim();
      const badQty = quantityProblem(args.qty, "remove_item");
      if (badQty) {
        return { result: badQty };
      }
      const math = removeItemMath(sheet.equipment, name, args.qty ?? 1);
      if (!math) {
        return { result: notCarried(sheet.name, sheet.equipment.map((item) => item.name), name, isTableGearName(campaign.id, name)) };
      }
      patchSheet(sheet.id, { equipment: math.equipment });
      audit(campaign, turnId, sheet, "remove_item", { name: math.item.name, removed: math.removed }, reason, {
        equipment: math.equipment,
      });
      publishSheet(campaign, sheet.id);
      return { result: { ok: true, removed: math.item.name, qty: math.removed } };
    }
    case "use_item": {
      const unasked = characterCallUnasked(campaign.id, getDmTurn(turnId), rawArguments, "characterId");
      if (unasked) {
        return { result: unasked };
      }
      const itemName = (args.item ?? args.name ?? "").trim();
      if (!itemName) {
        return { result: { error: "use_item needs an item name.", retry: true } };
      }
      const target = args.targetCharacterId ? resolve(args.targetCharacterId) : sheet;
      if (!target) {
        return { result: unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets) };
      }
      // A Healer's kit use heals (src/lib/dm/stabilize.ts); null otherwise.
      const kitHeal = healerKitUse(campaign, turnId, sheet, target, itemName);
      if (kitHeal) {
        if ("error" in kitHeal) {
          return { result: kitHeal };
        }
        const healed = applyDmMutation(
          campaign,
          turnId,
          "heal",
          JSON.stringify({ characterId: target.id, amount: kitHeal.amount, reason: "Healer: a healer's kit" }),
          sheets,
          sheetsById,
        ).result;
        return { result: { ok: true, note: kitHeal.note, ...healed } };
      }
      // A charged item (a wand, a staff) spends charges and stays in the
      // pack (src/lib/dm/item-use.ts); null for anything else.
      const charged = chargedItemUse(campaign, turnId, sheet, itemName, args.charges, args.spell);
      if (charged) {
        return { result: charged };
      }
      // Using an object is an action, and only for someone who can take one
      // (src/lib/dm/object-actions.ts); asked before anything is rolled.
      const objectCharge = prepareUseItem(campaign, sheet, target, itemName);
      if ("error" in objectCharge) {
        return { result: objectCharge };
      }
      // A scroll off the reader's class list stays unread (consumables.ts).
      const unreadable = consumableRefusal(sheet, findCarriedItem(sheet.equipment, itemName) ?? { name: itemName });
      if (unreadable) {
        return { result: unreadable };
      }
      const outcome = computeUseItem(campaign, sheet, target, itemName);
      if ("error" in outcome) {
        return { result: outcome };
      }
      patchSheet(sheet.id, outcome.patch);
      Object.assign(outcome.result, objectCharge.commit());
      // What the potion or scroll does, applied by the engine.
      const used = String(outcome.result.used ?? itemName);
      Object.assign(outcome.result, applyConsumable(campaign, turnId, sheet, target, sheet.equipment.find((item) => item.name === used) ?? { name: used }) ?? {});
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
      if (!itemName || !action) {
        return { result: { error: "purchase needs item and action buy|sell.", retry: true } };
      }
      const badQty = quantityProblem(args.qty, "purchase");
      if (badQty) {
        return { result: badQty };
      }
      // The row a bought item is, as grant_item takes it; a sold one is the
      // carried line.
      const listed = action === "buy" ? srdNameFor(args.srdName, "purchase") : {};
      if ("error" in listed) {
        return { result: listed };
      }
      const outcome = computePurchase(sheet, {
        item: itemName,
        price: args.price,
        qty: args.qty ?? 1,
        action,
        srdName: listed.srdName,
      });
      if ("error" in outcome) {
        return { result: outcome };
      }
      const noRoom = outcome.patch.equipment
        ? grantProblem(sheet.name, sheet.equipment, outcome.patch.equipment, itemName) ?? capacityProblem(sheet, outcome.patch.equipment, itemName, outcome.patch.gold)
        : null;
      if (noRoom) {
        return { result: noRoom };
      }
      patchSheet(sheet.id, outcome.patch);
      audit(
        campaign,
        turnId,
        sheet,
        "purchase",
        { item: itemName, ...(args.price !== undefined ? { price: args.price } : {}), qty: args.qty ?? 1, action },
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
      const unasked = characterCallUnasked(campaign.id, getDmTurn(turnId), rawArguments, "characterId");
      if (unasked) {
        return { result: unasked };
      }
      const resourceName = (args.resource ?? args.name ?? "").trim();
      if (!resourceName) {
        return { result: { error: "use_resource needs a resource name.", retry: true } };
      }
      const target = args.targetCharacterId ? resolve(args.targetCharacterId) : sheet;
      if (!target) {
        return { result: unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets) };
      }
      // An amount is a whole number of at least one; none at all means one.
      if (args.amount !== undefined && args.amount < 1) {
        return {
          result: {
            error: `use_resource spends a whole number of uses or points, 1 or more; ${args.amount} is not a spend. Nothing was spent.`,
            retry: true,
          },
        };
      }
      // Intimidating Presence, Holy Nimbus and Divine Intervention resolve in
      // the fight (src/lib/dm/combat-features.ts).
      const combatSpend = combatFeatureSpend(campaign, turnId, sheet, resourceName, args.targetEnemyId);
      if (combatSpend) {
        return { result: combatSpend };
      }
      // Peerless Skill, Quivering Palm, Draconic Presence, Hide in Plain
      // Sight, Primeval Awareness (src/lib/dm/srd-feature-spends.ts).
      const srdSpend = srdFeatureSpend(campaign, turnId, sheet, resourceName, args);
      if (srdSpend) {
        return { result: srdSpend };
      }
      // Authored subclass features the engine resolves (src/lib/dm/authored-spends.ts).
      const authoredSpend = authoredFeatureSpend(campaign, turnId, sheet, resourceName, args, reason);
      if (authoredSpend) {
        return { result: authoredSpend };
      }
      // Channel Divinity's options and Indomitable resolve in the engine
      // (src/lib/dm/feature-spends.ts); everything else takes the generic path.
      const featureSpend = featureVariantSpend(campaign, turnId, sheet, resourceName, args.variant, args.targetCharacterId, reason);
      if (featureSpend) {
        return { result: featureSpend };
      }
      // A reaction counter that acts on the hit that triggered it, or on
      // dropping to 0 (src/lib/dm/reaction-counters.ts): its trigger is
      // checked before anything is spent, its effect applied after.
      const counter = matchResource(resourceName);
      const reacting = counter
        ? planCounterReaction({ campaign, turnId, sheet: getSheetById(sheet.id) ?? sheet, defId: counter.id, targetCharacterId: args.targetCharacterId, sheets, sheetsById })
        : null;
      if (reacting && "error" in reacting) {
        return { result: reacting };
      }
      // An option of a pool whose options cost different things (Channel
      // Divinity's, Psionic Energy's, a maneuver's) costs its own part of
      // the turn (src/lib/dm/option-costs.ts); a Font of Magic conversion is
      // a bonus action. A Channel Divinity in a fight names its option.
      const fighting = (() => {
        const live = getActiveEncounter(campaign.id);
        return Boolean(live && (live.kind ?? "fight") === "fight");
      })();
      // War Priest, Unwavering Mark and Hungry Jaws are spent by the attack
      // they buy (src/lib/dm/feature-bonus-attacks.ts).
      if (counter && BONUS_ATTACK_COUNTERS.includes(counter.id)) {
        return {
          result: {
            error: `${counter.displayName} is spent by its bonus-action attack: pc_attack with bonusAttack "feature"${counter.id === "race_hungry_jaws" ? ' and weapon "bite"' : ""}. Nothing was spent.`,
            retry: true,
          },
        };
      }
      const option = optionCost(counter?.id, [args.variant ?? "", resourceName], fighting);
      if (option && "refused" in option) {
        return { result: option.refused };
      }
      const pool = counter ? sheet.resources[counter.id] : undefined;
      if (!option && counter?.id === "channel_divinity" && fighting && pool) {
        // The uses and the turn before the option: which one is moot when
        // none can be paid for. The turn is held to the cheapest option.
        const payment = payForUse(sheet, counter, pool, 1);
        if ("error" in payment) {
          return { result: payment };
        }
        const costs = channelOptions(sheet).map((entry) => entry.cost);
        const cheapest = (["none", "bonus", "reaction", "action"] as const).find((cost) => costs.includes(cost)) ?? "action";
        const turnGate = prepareResourceCharge(campaign, sheet, resourceName, cheapest);
        if ("error" in turnGate) {
          return { result: turnGate };
        }
        const held = channelOptionsHeld(sheet);
        return {
          result: {
            error: `Channel Divinity in a fight is one of its options, each with its own cost: name it in variant${held.length ? ` (${sheet.name} has ${held.join(", ")})` : ""}. Ask the player which, unless they named one. Nothing was spent.`,
            retry: true,
          },
        };
      }
      const optionCharge = option?.cost ?? (counter?.id === "sorcery_points" && fontOfMagicDirection(args.variant) ? "bonus" : undefined);
      // Embodiment of the Law and the genre surges move the next spell to
      // the bonus action (src/lib/dm/resource-turn.ts castMarkCharge).
      const castMark = castMarkCharge(campaign, sheet, counter?.id);
      if (castMark && "error" in castMark) {
        return { result: castMark };
      }
      // What the feature costs of the turn is checked before anything is
      // spent or rolled, and charged once the spend has gone through.
      const charge = prepareResourceCharge(campaign, sheet, resourceName, optionCharge);
      if ("error" in charge) {
        return { result: charge };
      }
      const outcome = computeUseResource(
        campaign,
        sheet,
        target,
        resourceName,
        args.amount ?? 1,
        {
          name: args.form,
          hp: args.formHp,
          ac: args.formAc,
          cr: args.formCr,
          flies: args.formFlies,
          swims: args.formSwims,
        },
        args.variant,
        { beforeDrop: charge.beforeDrop },
      );
      if ("error" in outcome) {
        return { result: outcome };
      }
      patchSheet(sheet.id, outcome.patch);
      Object.assign(outcome.result, charge.commit());
      if (castMark) {
        Object.assign(outcome.result, castMark.apply());
      }
      if (reacting) {
        Object.assign(outcome.result, reacting.apply());
      }
      if (outcome.shapeHours) {
        recordShapeEnd(campaign.id, sheet.id, outcome.shapeHours);
      }
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
      return { result: handleSetCondition(campaign, turnId, sheet, args, reason) };
    }
    case "clear_condition": {
      // "concentration" is not a real condition: clearing it ends the
      // tracked spell (a caster dropping concentration voluntarily).
      const rawCondition = (args.condition ?? "").trim().toLowerCase();
      if (isConditionNamed(rawCondition, "concentration")) {
        const ended = breakConcentration(campaign, turnId, sheet.id, "ended voluntarily");
        return ended
          ? { result: { ok: true, cleared: `concentration (${ended})` } }
          : { result: { error: `${sheet.name} is not concentrating on anything.`, retry: true } };
      }
      // Exhaustion clears one level at a time (greater restoration, a long
      // rest); level 0 is fully recovered.
      if (namesExhaustion(rawCondition)) {
        if (sheet.exhaustion <= 0 && !sheet.conditions.some(namesExhaustion)) {
          return { result: { error: `${sheet.name} has no exhaustion.`, retry: true } };
        }
        const nextLevel = exhaustionPatch(sheet, sheet.exhaustion - 1).exhaustion;
        // Legacy string entries clear alongside the leveled field.
        const cleanedConditions = sheet.conditions.filter((entry) => !namesExhaustion(entry));
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
      // The condition by its whole name, with or without a bracket note:
      // "aided" clears "aided (+10)"; a miss lists what the sheet holds.
      const wanted = canonicalCondition(args.condition ?? "");
      const matches = (entry: string) => entry === wanted || canonicalCondition(entry) === wanted || isConditionNamed(entry, wanted);
      const removed = wanted ? sheet.conditions.filter(matches) : [];
      if (!removed.length) {
        return {
          result: {
            error: `${sheet.name} is not ${wanted || "under that condition"}.`,
            retry: true,
            currentConditions: sheet.conditions,
          },
        };
      }
      // The AI clearing prone is the character standing up; a person at the
      // console keeps a free hand to correct the board.
      if (removed.some((entry) => canonicalCondition(entry) === PRONE) && getDmTurn(turnId)?.actor !== "human_dm") {
        const refusal = payToStand(campaign.id, sheet);
        if (refusal) {
          return { result: refusal };
        }
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
      const unasked = characterCallUnasked(campaign.id, getDmTurn(turnId), rawArguments, "characterId");
      if (unasked) {
        return { result: unasked };
      }
      const level = args.level ?? 0;
      // A missing spell is tolerated (weak tool calling must not break
      // casting, and Divine Smite burns a slot with no spell): the slot
      // alone is spent. `name` is the same argument under the word a person
      // at the console reaches for.
      const spell = (args.spell ?? args.name ?? "").trim();
      // Combat Wild Shape: while transformed, a slot becomes 1d8 healing per
      // slot level, restoring the beast form's pool. Called as
      // use_spell_slot with spell="Combat Wild Shape".
      if (isNamed(spell, "combat wild shape")) {
        const hasFeature = holdsFeature(sheet, "Combat Wild Shape");
        if (!hasFeature) {
          return { result: { error: `${sheet.name} has no Combat Wild Shape.`, refused: "rules" } };
        }
        if (!sheet.wildShape) {
          return {
            result: {
              error: `${sheet.name} is not wild shaped; the bonus-action healing works only while transformed.`,
              refused: "rules",
            },
          };
        }
        // A bonus action (SRD 5.1, Circle of the Moon): the turn before which
        // slot to burn.
        const encounter = getActiveEncounter(campaign.id);
        const fighting = encounter && (encounter.kind ?? "fight") === "fight" ? encounter : null;
        const able = fighting ? canAct({ sheet, encounter: fighting, kind: "bonus" }) : null;
        if (able && !able.ok) {
          return { result: toolError(able) };
        }
        const budget = fighting ? budgetFor(fighting, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) : null;
        const bonus = budget ? spendAction(budget, "bonus", "Combat Wild Shape", sheet.name) : null;
        if (bonus && !bonus.ok) {
          return { result: toolError(bonus) };
        }
        if (level < 1) {
          return {
            result: {
              error: `Combat Wild Shape healing needs the slot level to burn. ${freeSlotsLine(sheet.spellcasting, 1, false)} Ask the player which, unless they named one.`,
              retry: true,
            },
          };
        }
        const slot = sheet.spellcasting?.slots[String(level)];
        const math = slot ? spendSlotMath(slot) : null;
        if (!math) {
          return { result: spentSlotRefusal(sheet.name, sheet.spellcasting, { level, lowest: 1, what: "Combat Wild Shape", withPact: false }) };
        }
        const healed = rollHealing(campaign, sheet, "Combat Wild Shape", `${level}d8`);
        const beastHp = Math.min(
          sheet.wildShape.beastMaxHp,
          sheet.wildShape.beastHp + Math.max(1, healed),
        );
        const patch: FullPatchSheetInput = {
          spellcasting: sheet.spellcasting
            ? { ...sheet.spellcasting, slots: { ...sheet.spellcasting.slots, [String(level)]: math } }
            : sheet.spellcasting,
          wildShape: { ...sheet.wildShape, beastHp },
        };
        patchSheet(sheet.id, patch);
        if (fighting && bonus?.ok) {
          storeBudget(fighting, bonus.budget);
        }
        audit(
          campaign,
          turnId,
          sheet,
          "use_spell_slot",
          { level, spell: "Combat Wild Shape", healed, beastHp },
          reason,
          patch,
        );
        publishSheet(campaign, sheet.id);
        return {
          result: {
            ok: true,
            healingRolled: healed,
            form: `${sheet.wildShape.form}: ${beastHp}/${sheet.wildShape.beastMaxHp} HP`,
            slot: `level ${level}: ${math.max - math.used}/${math.max} left`,
            note: "A bonus action; the healing lands on the beast form's pool.",
          },
        };
      }
      // Everything else is a cast, and every cast goes through the one guard
      // (src/lib/dm/cast-guard.ts): who may cast, what they hold, what it
      // costs of the slots, the purse and the turn.
      return {
        result: castSpell(
          campaign,
          turnId,
          sheet,
          {
            spell,
            ...(args.level !== undefined ? { level: args.level } : {}),
            ...(args.ritual ? { ritual: true } : {}),
            ...(args.concentration !== undefined ? { concentration: args.concentration } : {}),
            ...(args.via ? { via: args.via } : {}),
            ...(args.dryRun ? { dryRun: true } : {}),
            ...(args.uses ? { uses: args.uses } : {}),
            ...(args.units ? { units: args.units } : {}),
            ...zonePlacement(args),
          },
          {
            record: (delta, patch) => audit(campaign, turnId, sheet, "use_spell_slot", delta, reason, patch),
            publish: () => publishSheet(campaign, sheet.id),
          },
        ),
      };
    }
    case "learn_spell": {
      // `name` is the word a person at the console reaches for, and a spell
      // named with no action is one being learned.
      const spell = (args.spell ?? args.name ?? "").trim().slice(0, 80);
      const action = args.action ?? (spell ? "add" : undefined);
      if (!spell || (action !== "add" && action !== "remove")) {
        return { result: { error: "learn_spell needs a spell name and action add|remove.", retry: true } };
      }
      if (!sheet.spellcasting) {
        return {
          result: { error: `${sheet.name} has no spellcasting; they cannot learn spells.`, refused: "rules" },
        };
      }
      const known = sheet.spellcasting.known;
      const prepared = sheet.spellcasting.prepared;
      const cantrips = sheet.spellcasting.cantrips ?? [];
      const book = sheet.spellcasting.spellbook ?? [];
      const pending = sheet.spellcasting.pending ?? [];
      const matches = (entry: string) => textKey(entry) === textKey(spell);
      if (action === "add") {
        if (known.some(matches) || prepared.some(matches) || cantrips.some(matches) || book.some(matches) || pending.some(matches)) {
          return { result: { ok: true, note: `${sheet.name} already knows ${spell}.` } };
        }
        // A spell taught in play is one the class can cast: on its list, of a
        // level it has slots for, and a cantrip only with room in the column
        // (src/lib/dm/learn-rules.ts).
        const facts = spellFactsFor(spell, spellAuthorsFor(campaign));
        const unlearnable = learnProblem(sheet, spell, facts, subclassExtrasForTable(campaign.id, sheet.userId));
        if (unlearnable) {
          return { result: unlearnable };
        }
        // Known-casters track spells in `known`; prepared casters keep the
        // whole list in `prepared` (known stays empty by convention).
        const intoKnown = known.length > 0;
        if ((intoKnown ? known.length >= 80 : prepared.length >= 60)) {
          return { result: { error: `${sheet.name}'s spell list is full. They must give one up first: ask the player which, then call learn_spell with action=remove for it.`, retry: true } };
        }
        // The class's real 5e ceiling. Cantrips do not count against it, and
        // an unknown class (custom catalog) has no table to enforce.
        // Multiclass: the spell joins a caster entry with allowance headroom
        // at ITS class level (the first that has room); the legacy fields
        // stay the union mirror.
        const packRow = searchSpells({ q: spell, userId: sheet.userId, limit: 10 }).find((entry) =>
          spellNameMatches(entry, spell),
        );
        const spellLevel = packRow?.level;
        const casters = sheet.spellcasting.casters ?? [];
        // Cantrips have their own list and never touch the spell allowance.
        if (spellLevel === 0 || (spellLevel === undefined && isCantripName(spell))) {
          if (cantrips.length >= 40) {
            return { result: { error: `${sheet.name}'s cantrip list is full. They must give one up first: ask the player which, then call learn_spell with action=remove for it.`, retry: true } };
          }
          const nextSpellcasting = {
            ...sheet.spellcasting,
            cantrips: [...cantrips, spell],
            ...(casters.length
              ? {
                  casters: casters.map((caster, index) =>
                    index === 0 ? { ...caster, cantrips: [...(caster.cantrips ?? []), spell] } : caster,
                  ),
                }
              : {}),
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
            summary: `Learned the cantrip ${spell}.`,
          });
          return { result: { ok: true, learned: spell, cantrip: true } };
        }
        // A wizard copies a new spell into the spellbook: no ceiling, and it
        // is prepared like any other, after a long rest (spell-prep.ts). On a
        // multiclass sheet the book takes only spells on the wizard list;
        // a cleric spell taught by the story joins the cleric's list below.
        const views = casterViewsOf(sheet);
        const onWizardList =
          views.length < 2 ||
          (packRow
            ? packRow.classes.some((entry) => entry.toLowerCase() === "wizard")
            : checklistClassSpell(spell, "wizard", 9) !== null);
        const bookView = onWizardList ? views.find((view) => view.style === "spellbook") : undefined;
        if (bookView) {
          // Copying costs 50 gp and two hours a spell level, paid now; the
          // hours are not something a fight has room for.
          const cost = facts ? copyCost(facts) : { gold: 0, hours: 0 };
          const live = getActiveEncounter(campaign.id);
          if (cost.hours && live && live.status === "active" && (live.kind ?? "fight") === "fight") {
            return {
              result: {
                error: `Copying ${spell} into the spellbook takes ${cost.hours} hours; it cannot be done in the middle of a fight.`,
                refused: "rules",
              },
            };
          }
          const purse = purseCopper({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 });
          if (purse < cost.gold * COPPER_PER_GOLD) {
            return {
              result: {
                error: `Copying ${spell} into the spellbook costs ${cost.gold} gp in inks and materials, and ${sheet.name} has ${formatPurse({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 })}. Nothing was written.`,
                refused: "rules",
              },
            };
          }
          const left = fromCopper(purse - cost.gold * COPPER_PER_GOLD);
          const nextSpellcasting = withCasterViews(
            sheet.spellcasting,
            views.map((view) =>
              view === bookView ? { ...view, spellbook: [...spellbookOf(view), spell] } : view,
            ),
          );
          const bookPatch = {
            spellcasting: nextSpellcasting,
            ...(cost.gold ? { gold: left.gold, copper: left.copper } : {}),
          };
          patchSheet(sheet.id, bookPatch);
          audit(campaign, turnId, sheet, "learn_spell", { action, spell, ...(cost.gold ? { cost } : {}) }, reason, bookPatch);
          publishSheet(campaign, sheet.id);
          if (cost.hours) {
            advanceClock(campaign.id, cost.hours, "hours");
          }
          insertCharacterEvent({
            libraryCharacterId: sheet.libraryCharacterId,
            campaignCharacterId: sheet.id,
            campaignId: campaign.id,
            seq: allocateSeq(campaign.id),
            kind: "achievement",
            summary: `Copied ${spell} into the spellbook.`,
          });
          return {
            result: {
              ok: true,
              learned: spell,
              spellbook: true,
              note: `${spell} is written in the spellbook${cost.gold ? `, for ${cost.gold} gp and ${cost.hours} hours of work` : ""}. ${sheet.name} can prepare it after a long rest.`,
            },
          };
        }
        let targetCaster: (typeof casters)[number] | null = null;
        // The ceilings as the sheet's views read them: an Eldritch Knight's
        // spells known (src/lib/srd/spell-prep.ts spellCapOf), where the
        // fighter's own count is none at all.
        const learnerViews = casterViewsOf(sheet, subclassExtrasForTable(campaign.id, sheet.userId));
        if (casters.length) {
          const classLevels = Object.fromEntries(
            (sheet.classes ?? []).map((entry) => [entry.id.toLowerCase(), entry.level]),
          );
          // The views come one per caster entry, in its order.
          for (const [index, caster] of casters.entries()) {
            const level = classLevels[caster.classId.toLowerCase()] ?? sheet.level;
            const view = learnerViews[index];
            const cap = view
              ? spellCapOf(view, sheet.abilities)
              : suggestedSpellCount(spellClassFor(caster.classId), level, abilityMod(sheet.abilities[caster.ability]));
            const classEntry = (sheet.classes ?? []).find(
              (entry) => entry.id.toLowerCase() === caster.classId.toLowerCase(),
            );
            const held = spellsAgainstLimit(
              caster.known.length ? caster.known : caster.prepared,
              subclassSpellsFor(caster.classId, classEntry?.subclass ?? "", level, subclassExtrasForTable(campaign.id, sheet.userId), sheet.features),
            );
            if (!cap || held < cap.count) {
              targetCaster = caster;
              break;
            }
          }
          if (!targetCaster) {
            return {
              result: {
                error: `${sheet.name}'s caster classes are all at their spells-held ceiling. They must give one up first: ask the player which, then call learn_spell with action=remove for the spell they drop.`,
                retry: true,
              },
            };
          }
        } else {
          const ceiling = learnerViews[0]
            ? spellCapOf(learnerViews[0], sheet.abilities)
            : suggestedSpellCount(sheet.class, sheet.level, abilityMod(sheet.abilities[sheet.spellcasting.ability]));
          const current = spellsAgainstLimit(
            intoKnown ? known : prepared,
            subclassSpellsFor(sheet.class, sheet.subclass, sheet.level, subclassExtrasForTable(campaign.id, sheet.userId), sheet.features),
          );
          if (ceiling && current >= ceiling.count) {
            return {
              result: {
                error: `${sheet.name} already has ${current} ${ceiling.label}, the most a level ${sheet.level} ${sheet.class} may hold. They must give one up first: ask the player which, then call learn_spell with action=remove for the spell they drop.`,
                retry: true,
              },
            };
          }
        }
        const nextSpellcasting = {
          ...sheet.spellcasting,
          known: intoKnown ? [...known, spell] : known,
          prepared: intoKnown ? prepared : [...prepared, spell],
          ...(targetCaster
            ? {
                casters: casters.map((caster) =>
                  caster === targetCaster
                    ? caster.known.length
                      ? { ...caster, known: [...caster.known, spell] }
                      : { ...caster, prepared: [...caster.prepared, spell] }
                    : caster,
                ),
              }
            : {}),
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
      if (!known.some(matches) && !prepared.some(matches) && !cantrips.some(matches) && !book.some(matches) && !pending.some(matches)) {
        // A spell the rules know is one they lack; a name nobody knows is the
        // call's to fix, from the spells they hold.
        const held = [...new Set([...cantrips, ...known, ...prepared, ...book, ...pending])];
        return {
          result: spellFactsFor(spell, spellAuthorsFor(campaign))
            ? { error: `${sheet.name} does not know "${spell}".`, refused: "rules" }
            : {
                error: `No spell called "${spell}" is known. ${sheet.name} holds ${held.join(", ") || "no spells"}: send the one meant, by the name on the sheet.`,
                retry: true,
              },
        };
      }
      const nextSpellcasting = {
        ...sheet.spellcasting,
        known: known.filter((entry) => !matches(entry)),
        prepared: prepared.filter((entry) => !matches(entry)),
        cantrips: cantrips.filter((entry) => !matches(entry)),
        ...(sheet.spellcasting.spellbook ? { spellbook: book.filter((entry) => !matches(entry)) } : {}),
        ...(sheet.spellcasting.pending ? { pending: pending.filter((entry) => !matches(entry)) } : {}),
        // A removal comes off every caster entry that lists it, keeping the
        // per-class lists and the union mirror agreeing.
        ...(sheet.spellcasting.casters?.length
          ? {
              casters: sheet.spellcasting.casters.map((caster) => ({
                ...caster,
                known: caster.known.filter((entry) => !matches(entry)),
                prepared: caster.prepared.filter((entry) => !matches(entry)),
                cantrips: (caster.cantrips ?? []).filter((entry) => !matches(entry)),
                ...(caster.spellbook ? { spellbook: caster.spellbook.filter((entry) => !matches(entry)) } : {}),
                ...(caster.pending ? { pending: caster.pending.filter((entry) => !matches(entry)) } : {}),
              })),
            }
          : {}),
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
        return { result: { error: "Invalid arguments.", retry: true } };
      }
      delete rawArgs.characterId;
      delete rawArgs.reason;
      // The console's form names one field and what it becomes.
      const folded = foldFieldValue(rawArgs, sheet.abilities);
      if ("error" in folded) {
        return { result: toolError(folded) };
      }
      rawArgs = folded.args;
      const parsedPatch = updateSheetPatchSchema.safeParse(rawArgs);
      if (!parsedPatch.success) {
        const issue = parsedPatch.error.issues[0];
        return {
          result: { error: `Invalid update_sheet field ${issue?.path.join(".")}: ${issue?.message}`, retry: true },
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
          result: { error: "update_sheet changed nothing; include at least one field.", retry: true },
        };
      }
      // From the model this is a story tool, not a correction: the fields
      // the rules move are refused (src/lib/dm/update-sheet-ai.ts). A person
      // at the console keeps the whole of it.
      if (getDmTurn(turnId)?.actor !== "human_dm") {
        const refusal = aiSheetFieldRefusal(changed);
        if (refusal) {
          return { result: refusal };
        }
      }
      // The ceiling is on what one story moment gives, however the edit is
      // split: it is measured from the sheet as it stood before the first
      // update_sheet of this turn, or of the last ten minutes at a console
      // where every adjudication is a turn of its own.
      const earlier = [
        ...listAuditForTurn(campaign.id, turnId),
        ...listAuditSince(campaign.id, new Date(Date.now() - UPDATE_SHEET_WINDOW_MS).toISOString()),
      ]
        .filter(
          (entry) =>
            entry.characterId === sheet.id && entry.kind === "update_sheet" && !entry.revertedAt,
        )
        .sort((a, b) => a.seq - b.seq)[0];
      const baseline = (earlier ? getAuditPreImage(earlier.id)?.before : null) ?? sheet;
      const buffError = sheetBuffViolation(
        {
          name: sheet.name,
          level: Math.min(sheet.level, baseline.level),
          maxHp: Math.min(sheet.maxHp, baseline.maxHp),
          gold: Math.min(sheet.gold, baseline.gold),
        },
        patch,
        typeof patch.xp === "number" ? levelForXp(patch.xp) : undefined,
      );
      if (buffError) {
        return { result: buffError };
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
      return { result: { error: `Unknown mutation tool ${toolName}.`, retry: true } };
  }
}
