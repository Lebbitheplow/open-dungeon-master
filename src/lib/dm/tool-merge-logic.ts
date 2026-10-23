// One tool per intent (issue #471), the pure half: which tool names were
// retired into which, how a call to a retired name reads as a call to the
// tool that took its place, and which of the engine's handlers a call to a
// merged tool reaches. src/lib/dm/tool-merge.ts adds the one decision that
// needs the table (which shop, if any, trades a purchase).
//
// Several of the DM's tools did one thing for a different target or setting
// (an enemy's condition beside a character's, a pet's damage beside an
// enemy's, a shop's sale beside a sale at list price), and the model picked
// between siblings and sometimes picked the wrong one. The model is now
// offered one tool per intent. Each sibling's handler stays in the engine
// under its own name, so a merged call runs exactly the rules, the caps, the
// gates, the ledger rows and the events the sibling always ran.
//
// A retired name is never offered again, but it is still accepted wherever a
// call arrives: a turn stored before the merge, an agent program that learned
// the old names, and an app whose console was compiled from older server
// pages all send them. Each is read as a call to the merged tool, with its
// arguments mapped, and routed from there like any other.
//
// No "@/" imports, so the guard tests can load it directly.

import type { ToolError } from "./tool-errors.ts";

export const RETIRED_TOOLS: Readonly<Record<string, string>> = {
  buy_item: "purchase",
  sell_item: "purchase",
  set_enemy_condition: "set_condition",
  clear_enemy_condition: "clear_condition",
  damage_enemy: "apply_damage",
  damage_pet: "apply_damage",
  split_damage: "apply_damage",
  award_xp: "party_award",
  teleport_token: "move_token",
};

export function isRetiredTool(name: string): boolean {
  return Object.hasOwn(RETIRED_TOOLS, name);
}

// The tool a name is offered as: itself, or the tool a retired name became.
export function offeredAs(name: string): string {
  return isRetiredTool(name) ? RETIRED_TOOLS[name] : name;
}

// Whether a call by this name may run where `offers` says what is offered:
// an offered tool, or a retired name whose tool is offered.
export function acceptsCall(offers: (name: string) => boolean, name: string): boolean {
  return offers(name) || (isRetiredTool(name) && offers(RETIRED_TOOLS[name]));
}

export type ToolArgs = Record<string, unknown>;
export type EngineCall = { name: string; args: ToolArgs };

// A call to a retired name, as a call to the tool that took its place. Every
// argument the old tool took keeps its name in the new one, but for three:
// a sale's priceCp becomes a price in gold, and a pet's damage and a
// teleport say which they are, since nothing else in their arguments would.
export function mergedCall(name: string, args: ToolArgs): EngineCall {
  switch (name) {
    case "buy_item":
      return { name: "purchase", args: { ...args, action: "buy" } };
    case "sell_item": {
      const { priceCp, ...rest } = args;
      const cp = Number(priceCp);
      return { name: "purchase", args: { ...rest, action: "sell", ...(priceCp !== undefined && Number.isFinite(cp) ? { price: cp / 100 } : {}) } };
    }
    case "damage_pet":
      return { name: "apply_damage", args: { ...args, pet: true } };
    case "teleport_token":
      return { name: "move_token", args: { ...args, teleport: true } };
    default:
      return { name: offeredAs(name), args };
  }
}

const present = (value: unknown) => (typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null);

// Only these keys reach a sibling's handler. Its schema would drop the rest,
// but the call reads plainly in a log with only what it uses.
function pick(args: ToolArgs, keys: readonly string[]): ToolArgs {
  return Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
}

// A merged tool's call to its own first handler, without the keys only its
// siblings read: everything else arrives exactly as it was sent.
function without(args: ToolArgs, keys: readonly string[]): ToolArgs {
  return Object.fromEntries(Object.entries(args).filter(([key]) => !keys.includes(key)));
}

function oneTarget(tool: string): ToolError {
  return {
    error: `${tool}: name one target, characterId for a character or enemyId for an enemy${tool === "apply_damage" ? ", or several in targets" : ""}. Nothing changed.`,
    retry: true,
  };
}

// An enemy's condition is timed in rounds: enemies are only ever in a fight.
// A duration past a hundred rounds holds for the rest of it.
function enemyRounds(args: ToolArgs): number | undefined {
  const given = Number(args.rounds);
  if (Number.isFinite(given) && given >= 1) {
    return Math.min(100, Math.floor(given));
  }
  const rounds = (Number(args.minutes) || 0) * 10 + (Number(args.hours) || 0) * 600 + (Number(args.days) || 0) * 14_400;
  return rounds >= 1 ? Math.min(100, Math.floor(rounds)) : undefined;
}

const DAMAGE_KEYS = ["amount", "dice", "type", "reason"] as const;
const TELEPORT_KEYS = ["teleport", "spell", "casterId", "casterEnemyId", "cause", "rangeFeet"] as const;

// The handler a call to a merged tool reaches, with the arguments that
// handler reads, or the reason it reaches none. Any other call, a purchase
// among them (tool-merge.ts decides that one), passes through unchanged.
export function engineCall(name: string, args: ToolArgs): EngineCall | ToolError {
  switch (name) {
    case "set_condition":
    case "clear_condition": {
      if (!present(args.enemyId)) {
        return { name, args: without(args, ["enemyId", "level"]) };
      }
      if (present(args.characterId)) {
        return oneTarget(name);
      }
      if (name === "clear_condition") {
        return { name: "clear_enemy_condition", args: pick(args, ["enemyId", "condition", "reason"]) };
      }
      const rounds = enemyRounds(args);
      return {
        name: "set_enemy_condition",
        args: { ...pick(args, ["enemyId", "condition", "saveAbility", "saveDc", "sourceCharacterId", "sourceEnemyId", "level", "reason"]), ...(rounds ? { rounds } : {}) },
      };
    }
    case "apply_damage": {
      if (Array.isArray(args.targets) && args.targets.length) {
        return { name: "split_damage", args: pick(args, [...DAMAGE_KEYS, "targets"]) };
      }
      if (present(args.enemyId)) {
        return present(args.characterId)
          ? oneTarget(name)
          : { name: "damage_enemy", args: pick(args, ["enemyId", ...DAMAGE_KEYS, "fallFeet", "magical", "source"]) };
      }
      if (present(args.fallFeet)) {
        return {
          error: "apply_damage: fallFeet is an enemy's fall. A character's fall is apply_hazard with type falling and feet, which rolls and applies it. Nothing changed.",
          retry: true,
        };
      }
      if (args.pet === true || present(args.petName)) {
        return { name: "damage_pet", args: pick(args, ["characterId", "petName", ...DAMAGE_KEYS]) };
      }
      return { name, args: without(args, ["enemyId", "targets", "fallFeet", "source", "petName", "pet"]) };
    }
    case "party_award": {
      // Experience alone is the award_xp it always was, its level-ups
      // reported the same way.
      const xp = Number(args.amount) || 0;
      const gold = Number(args.delta) || 0;
      return xp > 0 && !gold && !present(args.name) ? { name: "award_xp", args: pick(args, ["characterIds", "amount", "reason"]) } : { name, args };
    }
    case "move_token": {
      const teleport = args.teleport === true || present(args.spell) || present(args.casterEnemyId) || args.cause === "hazard";
      return teleport
        ? { name: "teleport_token", args: pick(args, ["tokenName", "x", "y", ...TELEPORT_KEYS.slice(1), "reason"]) }
        : { name, args: without(args, TELEPORT_KEYS) };
    }
    default:
      return { name, args };
  }
}
