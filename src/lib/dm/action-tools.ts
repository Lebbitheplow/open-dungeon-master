import { acBreakdownFor } from "@/lib/srd";
import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted } from "@/lib/events";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { spendAction, spendAttack, type SpendResult, type TurnBudget } from "@/lib/dm/action-budget";
import { addSheetCondition } from "@/lib/dm/action-common";
import { bonusRouteFor, counterSpend, kiSpend, noBonusRoute, type BonusRoute, type MoveAction } from "@/lib/dm/bonus-actions";
import { authoredBonusRoute } from "@/lib/srd/authored-economy";
import { featBonusRoute } from "@/lib/srd/feat-combat";
import { EXPEDITIOUS_RETREAT, hasFastHands } from "@/lib/dm/bonus-routes";
import { BONUS_SPELL } from "@/lib/dm/cast-rules";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { canAct } from "@/lib/dm/can-act";
import { characterEscape, enemyEscape } from "@/lib/dm/grapple";
import { readyAction, searchAction, objectAction } from "@/lib/dm/object-actions";
import { READIABLE } from "@/lib/dm/readied-kinds";
import { readiedReleaseFor } from "@/lib/dm/readied-release";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { readySpell } from "@/lib/dm/readied-spell";
import { applyDmMutation } from "@/lib/dm/mutations";
import { DODGING } from "@/lib/dm/condition-logic";
import { contest, help, hide } from "@/lib/dm/combat-actions";
import { grapplingStrikeDie, payGrapplingStrike } from "@/lib/dm/maneuver-reactions";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";

// The rest of a 5e turn: the actions that are not attacks or spells, plus
// reactions. Dodge, Dash, Disengage, Hide, Help, Grapple, and Shove all had
// no representation at all before this, so the model narrated them freely
// with no mechanical consequence; grapples in particular were pure fiction.
//
// Each one lands as real state: Dodge writes a condition the attack engine
// reads, Grapple and Shove run the SRD contested check through the real dice
// engine, Dash flags the doubled movement the battle map honors. Ready,
// Search, Use an Object and the escape from a grapple joined them later
// (src/lib/dm/object-actions.ts, src/lib/dm/grapple.ts), and the features
// that move an action to the bonus action are read in
// src/lib/dm/bonus-actions.ts. use_reaction lives in reaction-tools.ts.
//
// This module must not be imported by encounter-tools (the import points the
// other way); it imports the enemy helpers and the sheet layer only.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const ACTION_TOOL_NAMES = ["take_action", "use_reaction"] as const;

const ACTIONS = [
  "dodge",
  "dash",
  "disengage",
  "hide",
  "help",
  "grapple",
  "shove",
  "ready",
  "search",
  "use_object",
  "escape",
] as const;

export const actionTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "take_action",
      description:
        "Resolve a character taking one of the standard 5e actions that is not an attack or a spell: Dodge, Dash, Disengage, Hide, Help, Grapple, Shove, Ready, Search, Use an Object, or Escape (a grapple). The server spends the action from their turn, rolls any check or contest the action calls for through the same resolver as request_roll, and applies the real effect (Dodge makes attacks against them roll at disadvantage, a won Grapple applies grappled, a won Shove knocks prone or pushes, a won Escape ends the grapple). Grapple and Shove each take the place of ONE attack of the Attack action, so a character with Extra Attack can grapple and still swing. Ready commits to ONE action for the character's reaction until their next turn: an attack unless `readied` names another (a move up to their speed, Help, Use an Object, the use of an item, stabilizing, a class feature, or any action here), or a spell with `spell`. When you judge the trigger has come, release it off their turn with that action's own tool (pc_attack, move_token, take_action, use_item, stabilize, use_resource): the server spends the reaction and refuses any other action. While a character holds a readied action, enemy_attack does not walk an enemy that is out of reach: move it with move_token first. Hide is for a fight; out of one, use request_roll for Stealth. Call it BEFORE narrating the action; narrate exactly what it reports.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          action: { type: "string", enum: [...ACTIONS] },
          bonus: {
            type: "boolean",
            description:
              "Take the action as a bonus action: Dash, Disengage or Hide with Cunning Action (with the action already spent, Cunning Action is used by itself); Dash with Expeditious Retreat running (the casting's own Dash too, on the turn it is cast); Use an Object with a Thief's Fast Hands; Dash, Disengage or Dodge with a monk's ki (Step of the Wind, Patient Defense; the server spends 1 ki).",
          },
          targetEnemyId: {
            type: "string",
            description:
              "Grapple and Shove: the enemy seized or pushed. Help: the enemy the ally's attack is helped against (within 5 ft of the helper); omit to help an ability check. Exact enemyId from GAME STATE.",
          },
          targetCharacterId: {
            type: "string",
            description: "Help only: the ally being helped, exact characterId from GAME STATE.",
          },
          shove: {
            type: "string",
            enum: ["prone", "push"],
            description: "Shove only: knock the target prone (default) or push it 5 feet back.",
          },
          trigger: {
            type: "string",
            description: "Ready only, and needed for it: what the readied action waits for (when the ogre comes through the door).",
          },
          readied: {
            type: "string",
            enum: [...READIABLE],
            description:
              "Ready only: the action the trigger releases. attack (the default), move (up to their speed, released with move_token to the square), dodge, dash, disengage, hide, help, grapple, shove, search, use_object, escape (each released with take_action), item (use_item), stabilize (stabilize), feature (a class feature that takes an action). For a spell pass `spell` instead.",
          },
          skill: {
            type: "string",
            enum: ["perception", "investigation"],
            description: "Search only: look (perception, the default) or reason it out (investigation).",
          },
          item: {
            type: "string",
            description: "Use an Object only: the object, when it is one they carry. For consumables, use use_item.",
          },
          enemyId: {
            type: "string",
            description: "Escape only, for an ENEMY escaping a character's grapple: the enemy, exact enemyId from GAME STATE. Omit characterId then.",
          },
          spell: {
            type: "string",
            description:
              "Ready only: a spell with a casting time of one action to ready instead of an attack. The server casts it now (slot, action, concentration to hold it); when the trigger comes, cast it with its own tool and it is released with the reaction, no second slot.",
          },
          level: {
            type: "integer",
            minimum: 1,
            maximum: 9,
            description: "Ready with a spell only: the slot level to cast it from. Omit for the spell's own level.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "use_reaction",
      description:
        "Resolve a character spending their reaction on a feature or spell that answers someone else's turn; the server applies it. The server keeps the last attack against each character, so a reaction to a hit that already landed re-resolves that attack and gives back what the rules give back: Shield (+5 AC; the hit becomes a miss if the new AC beats the roll), Uncanny Dodge (the hit's damage is halved), Deflect Missiles (a ranged weapon hit loses 1d10 + DEX + monk level), Cutting Words (a Bardic Inspiration die off the attacker's roll or damage), Protection (a shield-bearer with the style imposes disadvantage on an attack against an adjacent ally, re-rolled against the attack that just came), Slow Fall and Feather Fall (after a fall), Hellish Rebuke (the attacker's DEX save and fire damage), Counterspell (call it BEFORE the enemy's spell is resolved: a countered spell spends the enemy's action and is not cast). Subclass reactions resolve the same way (feature). Only the holder of a feature uses it, and a refusal spends nothing. Opportunity attacks are not taken here: on a battle map the server rolls them itself; off the map it resolves the swing. One reaction per round, refreshed at the start of their turn.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          feature: {
            type: "string",
            description:
              "What they react with, by name (Shield, Uncanny Dodge, Cutting Words). Subclass reactions: Spectral Defense, Spirit Shield, Protective Field, Guardian Coil, Song of Defense and Body of the Astral Self take damage off the hit; Arcane Deflection and Combat Inspiration raise AC against it; Shadowy Dodge rerolls it at disadvantage; Dampen Elements resists it; Divine Allegiance, Aura of the Guardian and Protective Bond move it onto the protector (targetCharacterId); Storm's Fury, Halo of Spores, Vigilant Rebuke and Ascendant Aspect strike back (targetEnemyId); Opportunist, Hold the Line, Soul of Vengeance, Slayer's Counter, Voice of Authority and Inspiring Surge make one weapon attack (targetEnemyId); Tipsy Sway (1 ki) turns a melee attack that just missed the monk onto another creature within 5 feet (targetEnemyId); Skirmisher (when an enemy stands within 5 feet) and Relentless Avenger (right after the paladin's opportunity attack hit, spending no second reaction) move the character up to half their speed, drawing no opportunity attacks; Retaliation (a Berserker damaged by a creature within 5 feet) makes one melee weapon attack at it; Stand Against the Tide (a Hunter a melee attack just missed) makes the attacker repeat it against another creature (targetEnemyId), rolled by the server.",
          },
          targetCharacterId: {
            type: "string",
            description:
              "The ally the reaction is for: exact characterId from GAME STATE. Protection's covered ally, Cutting Words' attacked ally, Feather Fall's falling ally.",
          },
          targetEnemyId: {
            type: "string",
            description:
              "The enemy the reaction answers: exact enemyId from GAME STATE. Hellish Rebuke's attacker, Counterspell's caster, Deflect Missiles' shooter to throw the caught missile back at (1 ki), an opportunity attack's target off the map.",
          },
          spell: {
            type: "string",
            description: "Counterspell only: the spell the enemy is casting, as its stat block names it.",
          },
          level: {
            type: "integer",
            minimum: 1,
            maximum: 9,
            description: "A reaction SPELL (Shield, Counterspell, Hellish Rebuke) cast from a higher slot, or Song of Defense's slot. Omit for the spell's own level; the server spends the slot.",
          },
          x: { type: "integer", minimum: 0, description: "Skirmisher, Relentless Avenger only: the column of the square the character moves to." },
          y: { type: "integer", minimum: 0, description: "Skirmisher, Relentless Avenger only: the row of the square the character moves to." },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "feature"],
      },
    },
  },
];

const takeActionSchema = z.object({
  characterId: z.string().optional(),
  action: z.enum(ACTIONS),
  readied: z.enum(READIABLE).optional(),
  bonus: z.coerce.boolean().optional(),
  targetEnemyId: z.string().optional(),
  targetCharacterId: z.string().optional(),
  shove: z.enum(["prone", "push"]).optional(),
  trigger: z.string().max(200).optional(),
  skill: z.enum(["perception", "investigation"]).optional(),
  item: z.string().max(80).optional(),
  enemyId: z.string().optional(),
  spell: z.string().max(80).optional(),
  level: z.coerce.number().int().min(1).max(9).optional(),
  reason: z.string().optional(),
});

// ---- budget plumbing ----

// Lives in src/lib/dm/turn-budget.ts; re-exported for the callers that
// learned it here.
export { attacksAllowedFor } from "@/lib/dm/turn-budget";
export { handleUseReaction } from "@/lib/dm/reaction-tools";

// ---- take_action ----

// The words each action is priced under. Haste's extra action reads them
// (src/lib/dm/action-budget.ts): one weapon attack, Dash, Disengage, Hide
// or Use an Object.
const ACTION_WORDS: Record<(typeof ACTIONS)[number], string> = {
  dodge: "dodge",
  dash: "dash",
  disengage: "disengage",
  hide: "hide",
  help: "help",
  grapple: "grapple",
  shove: "shove",
  ready: "ready",
  search: "search",
  use_object: "use an object",
  escape: "escape",
};

const MOVES = new Set<string>(["dodge", "dash", "disengage", "hide"]);

// How an action is paid for: the priced budget, and what the tool result
// says of the cost. Null budget = no turn to charge (out of a fight).
// `counter`: the counted route's use, and the feature it is a use of.
type Price = {
  budget: TurnBudget | null;
  note?: string;
  ki?: number;
  feature?: string;
  counter?: { id: string; feature: string };
};

function priceAction(
  sheet: CharacterSheet,
  budget: TurnBudget | null,
  action: (typeof ACTIONS)[number],
  bonus: boolean,
  context: { allyDown?: boolean } = {},
): Price | ToolError {
  const move = MOVES.has(action) ? (action as MoveAction) : null;
  // Fast Hands (Thief 3): Use an Object with Cunning Action's bonus action.
  if (bonus && action === "use_object" && hasFastHands(sheet)) {
    if (!budget) {
      return { budget: null, feature: "Fast Hands" };
    }
    const spent = spendAction(budget, "bonus", "Fast Hands (use an object)", sheet.name);
    return spent.ok
      ? { budget: spent.budget, note: "Fast Hands: their bonus action", feature: "Fast Hands" }
      : toolError(spent);
  }
  if (bonus) {
    // Help and Search as a bonus action are the authored features' (Master
    // of Tactics, Eye for Detail): src/lib/srd/authored-effects.ts.
    // The feats' bonus-action routes: Tavern Brawler's grapple after its
    // hit, Shield Master's shove after the Attack action with a shield,
    // Charger's shove after a Dash (src/lib/srd/feat-combat.ts).
    // Grappling Strike's hit opens the grapple as a bonus action
    // (src/lib/dm/maneuver-reactions.ts).
    const route: BonusRoute | null =
      (move ? bonusRouteFor(sheet, move, context) : authoredBonusRoute(sheet, action)) ??
      (action === "grapple" && grapplingStrikeDie(sheet) ? { feature: "Grappling Strike", ki: 0 } : null) ??
      featBonusRoute(sheet, action, budget, Boolean(acBreakdownFor(sheet).shieldName));
    if (!route) {
      return move
        ? noBonusRoute(sheet, move)
        : { error: `${action} is not a bonus action for ${sheet.name}; it takes their action.`, refused: "rules" };
    }
    if (route.ki) {
      const covered = kiSpend(sheet, route.ki, route.feature);
      if ("error" in covered) {
        return covered;
      }
    }
    if (route.counter) {
      const covered = counterSpend(sheet, route.counter, route.feature);
      if ("error" in covered) {
        return covered;
      }
    }
    const counter = route.counter ? { counter: { id: route.counter, feature: route.feature } } : {};
    if (!budget) {
      return { budget: null, ki: route.ki, feature: route.feature, ...counter };
    }
    // Expeditious Retreat's casting (itself the bonus action) takes the Dash
    // with it, once, on the turn it is cast.
    if (route.feature === "Expeditious Retreat" && budget.bonusUsed && castRetreatThisTurn(sheet, budget)) {
      return {
        budget: { ...budget, oncePerTurn: [...budget.oncePerTurn, RETREAT_DASH] },
        note: "Expeditious Retreat: the Dash that comes with the casting",
        feature: route.feature,
      };
    }
    const spent = spendAction(budget, "bonus", `${route.feature} (${action})`, sheet.name);
    return spent.ok
      ? { budget: spent.budget, note: `${route.feature}: their bonus action`, ki: route.ki, feature: route.feature, ...counter }
      : toolError(spent);
  }
  if (!budget) {
    return { budget: null };
  }
  // Grapple and Shove take the place of one attack of the Attack action.
  let spent: SpendResult =
    action === "grapple" || action === "shove"
      ? spendAttack(budget, sheet.name, { hasteOk: false })
      : spendAction(budget, "action", ACTION_WORDS[action], sheet.name);
  if (!spent.ok && move) {
    // With the action gone, a free bonus-action route (Cunning Action) is
    // what the player meant; a ki route costs ki and a counted one a use, and
    // both wait to be asked for.
    const route = bonusRouteFor(sheet, move, context);
    if (route && route.ki === 0 && !route.counter) {
      const asBonus = spendAction(budget, "bonus", `${route.feature} (${action})`, sheet.name);
      if (asBonus.ok) {
        spent = { ...asBonus, note: `${route.feature}: their bonus action` };
        return { budget: spent.budget, note: spent.note, ki: 0, feature: route.feature };
      }
    }
  }
  return spent.ok ? { budget: spent.budget, note: spent.note } : toolError(spent);
}

const RETREAT_DASH = "expeditious-retreat:dash";

// Whether Expeditious Retreat was cast on this very turn: a bonus-action
// spell went on the turn, the spell's minute-count has not ticked yet (the
// round has not wrapped since), and its casting's Dash is still unclaimed.
function castRetreatThisTurn(sheet: CharacterSheet, budget: TurnBudget): boolean {
  if (!budget.oncePerTurn.includes(BONUS_SPELL) || budget.oncePerTurn.includes(RETREAT_DASH)) {
    return false;
  }
  const name = sheet.conditions.find((entry) => entry.trim().toLowerCase() === EXPEDITIOUS_RETREAT);
  const meta = name ? (sheet.conditionMeta as Record<string, { rounds?: number }>)[name] : undefined;
  return (meta?.rounds ?? 0) >= RETREAT_ROUNDS;
}
const RETREAT_ROUNDS = 100;

export function handleTakeAction(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof takeActionSchema>;
  try {
    args = takeActionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: take_action needs characterId and a known action.", retry: true };
  }
  if (args.action === "escape" && args.enemyId && !args.characterId) {
    return enemyEscape(campaign, turn, args.enemyId);
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const encounter = getActiveEncounter(campaign.id);
  // Off their turn, the action they readied: released with their reaction,
  // priced by nothing else (readied-release.ts). Readying is never a release.
  const readied = args.action === "ready" ? null : readiedReleaseFor(sheet, encounter, args.action);
  if (readied && "error" in readied) {
    return toolError(readied);
  }
  if (!readied) {
    const allowed = canAct({ sheet, encounter, kind: args.bonus ? "bonus" : "action" });
    if (!allowed.ok) {
      return toolError(allowed);
    }
  }

  // The action is priced here and paid for below, by `spend`, once the
  // action's own checks have passed: a grapple refused for size or a Help
  // with no ally named leaves the turn its action.
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionTurnShape(sheet.conditions),
  );
  // Under Fire's route opens while an ally lies at 0 hit points.
  const allyDown = sheets.some((entry) => entry.id !== sheet.id && (getSheetById(entry.id) ?? entry).currentHp <= 0 && !(getSheetById(entry.id) ?? entry).deathSaves?.dead);
  const price: Price | ToolError = readied
    ? { budget: null }
    : priceAction(sheet, budget && encounter ? budget : null, args.action, args.bonus === true, { allyDown });
  if ("error" in price) {
    return toolError(price);
  }
  const costs: Record<string, unknown> = {};
  const spend = (flags: Partial<Pick<TurnBudget, "dashed" | "disengaged">> = {}) => {
    if (readied) {
      Object.assign(costs, readied.release());
      return;
    }
    if (encounter && price.budget) {
      storeBudget(encounter, { ...price.budget, ...flags });
    }
    if (price.ki) {
      const covered = kiSpend(getSheetById(sheet.id) ?? sheet, price.ki, price.feature ?? "ki");
      if (!("error" in covered)) {
        const updated = patchSheet(sheet.id, { resources: covered.resources });
        if (updated) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
        }
        costs.ki = `${price.ki} ki (${price.feature})`;
      }
    }
    if (price.counter) {
      const covered = counterSpend(getSheetById(sheet.id) ?? sheet, price.counter.id, price.counter.feature);
      if (!("error" in covered)) {
        const updated = patchSheet(sheet.id, { resources: covered.resources });
        if (updated) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
        }
        costs.uses = `1 use (${price.counter.feature})`;
      }
    }
    if (price.note) {
      costs.cost = price.note;
    }
  };
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";

  // What `spend` recorded (a release's reaction, ki, a counted use) rides
  // every action's reply, whichever handler wrote it.
  const resolveAction = (): Record<string, unknown> => {
  switch (args.action) {
    case "dodge": {
      spend();
      // Until their next turn, attacks against them have disadvantage and
      // they have advantage on DEX saves.
      addSheetCondition(campaign, sheet, DODGING, { untilTurnOf: sheet.id });
      return {
        ok: true,
        action: "Dodge",
        ...costs,
        applied: `${sheet.name} is dodging: every attack against them rolls at disadvantage until their next turn, and they have advantage on Dexterity saves. The server applies it.`,
      };
    }
    case "dash": {
      spend({ dashed: true });
      return {
        ok: true,
        action: "Dash",
        ...costs,
        applied: `${sheet.name}'s movement is doubled this turn; the battle map allows the extra distance.`,
      };
    }
    case "disengage": {
      spend({ disengaged: true });
      return {
        ok: true,
        action: "Disengage",
        ...costs,
        applied: `${sheet.name} can move out of every enemy's reach this turn without provoking an opportunity attack.`,
      };
    }
    case "hide":
      return hide(campaign, turn, sheet, encounter, spend, costs);
    case "help":
      return help(campaign, sheet, encounter, args, sheets, sheetsById, spend);
    case "grapple":
    case "shove": {
      if (price.feature !== "Grappling Strike") {
        return contest(campaign, turn, sheet, encounter, args, spend, costs);
      }
      // The Superiority Die rides the Athletics check; it is paid with the
      // bonus action, once the contest's own checks pass.
      return contest(campaign, turn, sheet, encounter, args, spend, costs, () => {
        const strike = payGrapplingStrike(campaign, turn.id, sheet, args.targetEnemyId, sheets, sheetsById);
        return "error" in strike ? strike : { die: strike.die, label: "Grappling Strike" };
      });
    }
    case "ready":
      // A readied spell is cast now and held (src/lib/dm/readied-spell.ts);
      // its casting is the Ready action's cost.
      if (args.spell?.trim()) {
        return readySpell(campaign, turn, sheet, { spell: args.spell, level: args.level, trigger: args.trigger, inFight }, (castArgs) =>
          applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(castArgs), sheets, sheetsById).result,
        );
      }
      return readyAction(campaign, sheet, args.trigger, inFight, { spend: () => spend() }, args.readied ?? "attack");
    case "search":
      return searchAction(campaign, turn, sheet, args.skill ?? "perception", { spend: () => spend() });
    case "use_object":
      return objectAction(
        sheet,
        args.item,
        args.reason,
        { spend: () => spend() },
        price.feature === "Fast Hands" ? "their bonus action (Fast Hands)" : undefined,
      );
    case "escape":
      return characterEscape(campaign, turn, sheet, () => spend());
  }
  };
  const outcome = resolveAction();
  return "error" in outcome ? outcome : { ...costs, ...outcome };
}
