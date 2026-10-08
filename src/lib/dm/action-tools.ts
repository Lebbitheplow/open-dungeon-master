import { acBreakdownFor } from "@/lib/srd";
import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted } from "@/lib/events";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { spendAction, spendAttack, type SpendResult, type TurnBudget } from "@/lib/dm/action-budget";
import { addSheetCondition } from "@/lib/dm/action-common";
import { bonusRouteFor, kiSpend, noBonusRoute, type MoveAction } from "@/lib/dm/bonus-actions";
import { authoredBonusRoute } from "@/lib/srd/authored-economy";
import { featBonusRoute } from "@/lib/srd/feat-combat";
import { EXPEDITIOUS_RETREAT, hasFastHands } from "@/lib/dm/bonus-routes";
import { BONUS_SPELL } from "@/lib/dm/cast-rules";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { canAct } from "@/lib/dm/can-act";
import { characterEscape, enemyEscape } from "@/lib/dm/grapple";
import { readyAction, searchAction, objectAction } from "@/lib/dm/object-actions";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { readySpell } from "@/lib/dm/readied-spell";
import { applyDmMutation } from "@/lib/dm/mutations";
import { DODGING } from "@/lib/dm/condition-logic";
import { contest, help, hide } from "@/lib/dm/combat-actions";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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

// A held Help works like a held Bardic Inspiration die: a condition on the
// recipient the roll it helps consumes. Its source says which roll
// (src/lib/dm/help-logic.ts).
export { HELPED } from "@/lib/dm/help-logic";
export { HIDDEN } from "@/lib/dm/combat-actions";

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
        "A character takes one of the standard 5e actions that is not an attack or a spell: Dodge, Dash, Disengage, Hide, Help, Grapple, Shove, Ready, Search, Use an Object, or Escape (a grapple). The server spends the action from their turn, rolls any check or contest the action calls for through the same resolver as request_roll, and applies the real effect (Dodge makes attacks against them roll at disadvantage, a won Grapple applies grappled, a won Shove knocks prone or pushes, a won Escape ends the grapple). Grapple and Shove each take the place of ONE attack of the Attack action, so a character with Extra Attack can grapple and still swing. bonus=true takes Dash, Disengage or Hide as a bonus action with Cunning Action, Dash with Expeditious Retreat running (the casting's own Dash too, on the turn it is cast), Use an Object with a Thief's Fast Hands, and Dash, Disengage or Dodge with a monk's ki (Step of the Wind, Patient Defense, 1 ki spent by the server); with the action already spent, Cunning Action is used by itself. Ready needs the trigger and holds one readied attack for the character's reaction until their next turn; Ready with spell casts a one-action spell now (slot and concentration) and holds it: when the trigger comes, cast it with its own tool and it is released with the reaction, no second slot. Hide is for a fight; out of one, call request_roll for Stealth. An enemy escaping a character's grapple: action=escape with enemyId. Call this BEFORE narrating the action; narrate exactly what it reports.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          action: { type: "string", enum: [...ACTIONS] },
          bonus: {
            type: "boolean",
            description:
              "Take Dash, Disengage, Hide or Dodge as a bonus action through a feature that allows it (Cunning Action, Step of the Wind, Patient Defense, Expeditious Retreat's Dash), or Use an Object with a Thief's Fast Hands.",
          },
          targetEnemyId: {
            type: "string",
            description:
              "Grapple and Shove: the exact enemyId being seized or pushed. Help: the enemy the ally's attack is helped against (within 5 ft of the helper); omit to help an ability check.",
          },
          targetCharacterId: {
            type: "string",
            description: "Help: the exact characterId of the ally being helped.",
          },
          shove: {
            type: "string",
            enum: ["prone", "push"],
            description: "Shove only: knock the target prone (default) or push it 5 feet back.",
          },
          trigger: {
            type: "string",
            description: "Ready only: what the readied attack waits for, e.g. 'when the ogre comes through the door'.",
          },
          skill: {
            type: "string",
            enum: ["perception", "investigation"],
            description: "Search only: look (perception, the default) or reason it out (investigation).",
          },
          item: {
            type: "string",
            description: "Use an Object only: the object, when it is one they carry. Consumables go through use_item instead.",
          },
          enemyId: {
            type: "string",
            description: "Escape only, for an ENEMY escaping a character's grapple: the exact enemyId. Omit characterId then.",
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
            description: "Ready with a spell: the slot level to cast it from. Omit for the spell's own level.",
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
        "A character spends their reaction on a feature or spell that answers someone else's turn, and the server applies it. The engine keeps the last attack against each character, so a reaction to a hit that already landed re-resolves that attack and gives back what the rules give back: Shield (+5 AC, the hit becomes a miss if the new AC beats the roll), Uncanny Dodge (the hit's damage is halved), Deflect Missiles (a ranged weapon hit loses 1d10 + DEX + monk level), Cutting Words (a Bardic Inspiration die off the attacker's roll or damage; targetCharacterId is the one attacked), Protection (a shield-bearer with the style imposes disadvantage on an attack against an adjacent ally, re-rolled against the attack that just came), Slow Fall and Feather Fall (after a fall), Hellish Rebuke (targetEnemyId: the attacker's DEX save and fire damage), Counterspell (targetEnemyId and spell, called BEFORE the enemy's spell is resolved: a countered spell spends the enemy's action and is not cast). Subclass reactions resolve the same way: Spectral Defense, Spirit Shield, Protective Field, Guardian Coil, Song of Defense (level: the slot) and Body of the Astral Self take damage off the hit; Arcane Deflection and Combat Inspiration raise AC against it; Shadowy Dodge rerolls it at disadvantage; Dampen Elements resists it; Divine Allegiance, Aura of the Guardian and Protective Bond move it onto the protector (targetCharacterId); Storm's Fury, Halo of Spores, Vigilant Rebuke and Ascendant Aspect strike back (targetEnemyId); Opportunist, Hold the Line, Soul of Vengeance, Slayer's Counter, Voice of Authority and Inspiring Surge make one weapon attack (targetEnemyId); Tipsy Sway (1 ki) turns a melee attack that just missed the monk onto another creature within 5 feet (targetEnemyId); Skirmisher (when an enemy stands within 5 feet) and Relentless Avenger (right after the paladin's opportunity attack hit, spending no second reaction) move the character up to half their speed to the square x, y, drawing no opportunity attacks; Retaliation (a Berserker damaged by a creature within 5 feet) makes one melee weapon attack at it; Stand Against the Tide (a Hunter a melee attack just missed) makes the attacker repeat it against another creature (targetEnemyId), rolled by the server. Only the holder of a feature uses it, and a refusal spends nothing. Opportunity attacks are not taken here: on a battle map the server rolls them itself; off the map pass targetEnemyId and the server resolves the swing. One reaction per round, refreshed at the start of their turn.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          feature: {
            type: "string",
            description: "What they react with, e.g. 'Shield', 'Uncanny Dodge', 'Cutting Words'.",
          },
          targetCharacterId: {
            type: "string",
            description:
              "The ally the reaction is for: Protection's covered ally, Cutting Words' attacked ally, Feather Fall's falling ally.",
          },
          targetEnemyId: {
            type: "string",
            description:
              "The enemy the reaction answers: Hellish Rebuke's attacker, Counterspell's caster, Deflect Missiles' shooter to throw the caught missile back at (1 ki), an opportunity attack's target off the map.",
          },
          spell: {
            type: "string",
            description: "Counterspell only: the spell the enemy is casting, as its stat block names it.",
          },
          level: {
            type: "integer",
            minimum: 1,
            maximum: 9,
            description: "A reaction SPELL (Shield, Counterspell, Hellish Rebuke) cast from a higher slot. Omit for the spell's own level; the server spends the slot.",
          },
          x: { type: "integer", minimum: 0, description: "Skirmisher, Relentless Avenger: the column of the square the character moves to." },
          y: { type: "integer", minimum: 0, description: "Skirmisher, Relentless Avenger: the row of the square the character moves to." },
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
export {
  attacksAllowedFor,
  budgetFor,
  currentCombatantId,
  grantActionSurge,
  storeBudget,
} from "@/lib/dm/turn-budget";
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
type Price = { budget: TurnBudget | null; note?: string; ki?: number; feature?: string };

function priceAction(
  sheet: CharacterSheet,
  budget: TurnBudget | null,
  action: (typeof ACTIONS)[number],
  bonus: boolean,
): Price | { error: string } {
  const move = MOVES.has(action) ? (action as MoveAction) : null;
  // Fast Hands (Thief 3): Use an Object with Cunning Action's bonus action.
  if (bonus && action === "use_object" && hasFastHands(sheet)) {
    if (!budget) {
      return { budget: null, feature: "Fast Hands" };
    }
    const spent = spendAction(budget, "bonus", "Fast Hands (use an object)", sheet.name);
    return spent.ok
      ? { budget: spent.budget, note: "Fast Hands: their bonus action", feature: "Fast Hands" }
      : { error: spent.error };
  }
  if (bonus) {
    // Help and Search as a bonus action are the authored features' (Master
    // of Tactics, Eye for Detail): src/lib/srd/authored-effects.ts.
    // The feats' bonus-action routes: Tavern Brawler's grapple after its
    // hit, Shield Master's shove after the Attack action with a shield,
    // Charger's shove after a Dash (src/lib/srd/feat-combat.ts).
    const route =
      (move ? bonusRouteFor(sheet, move) : authoredBonusRoute(sheet, action)) ??
      featBonusRoute(sheet, action, budget, Boolean(acBreakdownFor(sheet).shieldName));
    if (!route) {
      return {
        error: move
          ? noBonusRoute(sheet, move)
          : `${action} is not a bonus action for ${sheet.name}; it takes their action.`,
      };
    }
    if (route.ki) {
      const covered = kiSpend(sheet, route.ki, route.feature);
      if ("error" in covered) {
        return covered;
      }
    }
    if (!budget) {
      return { budget: null, ki: route.ki, feature: route.feature };
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
      ? { budget: spent.budget, note: `${route.feature}: their bonus action`, ki: route.ki, feature: route.feature }
      : { error: spent.error };
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
    // what the player meant; a ki route costs ki and waits to be asked for.
    const route = bonusRouteFor(sheet, move);
    if (route && route.ki === 0) {
      const asBonus = spendAction(budget, "bonus", `${route.feature} (${action})`, sheet.name);
      if (asBonus.ok) {
        spent = { ...asBonus, note: `${route.feature}: their bonus action` };
        return { budget: spent.budget, note: spent.note, ki: 0, feature: route.feature };
      }
    }
  }
  return spent.ok ? { budget: spent.budget, note: spent.note } : { error: spent.error };
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
): Record<string, unknown> {
  let args: z.infer<typeof takeActionSchema>;
  try {
    args = takeActionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: take_action needs characterId and a known action." };
  }
  if (args.action === "escape" && args.enemyId && !args.characterId) {
    return enemyEscape(campaign, turn, args.enemyId);
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const encounter = getActiveEncounter(campaign.id);
  const allowed = canAct({ sheet, encounter, kind: args.bonus ? "bonus" : "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }

  // The action is priced here and paid for below, by `spend`, once the
  // action's own checks have passed: a grapple refused for size or a Help
  // with no ally named leaves the turn its action.
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionExtraActions(sheet.conditions),
  );
  const price = priceAction(sheet, budget && encounter ? budget : null, args.action, args.bonus === true);
  if ("error" in price) {
    return { error: price.error };
  }
  const costs: Record<string, unknown> = {};
  const spend = (flags: Partial<Pick<TurnBudget, "dashed" | "disengaged">> = {}) => {
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
    if (price.note) {
      costs.cost = price.note;
    }
  };
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";

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
    case "shove":
      return contest(campaign, turn, sheet, encounter, args, spend, costs);
    case "ready":
      // A readied spell is cast now and held (src/lib/dm/readied-spell.ts);
      // its casting is the Ready action's cost.
      if (args.spell?.trim()) {
        return readySpell(campaign, turn, sheet, { spell: args.spell, level: args.level, trigger: args.trigger, inFight }, (castArgs) =>
          applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(castArgs), sheets, sheetsById).result,
        );
      }
      return readyAction(campaign, sheet, args.trigger, inFight, { spend: () => spend() });
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
}
