// What the spell EFFECT suites share (scripts/test-enforce-spell-engine.mjs,
// scripts/test-enforce-spell-rows.mjs): a caster of any class with the slots
// the SRD gives its level, a table with dummies in a fight, an open field to
// lay tokens on, the engine reached as the AI reaches it, and a run of the
// same engine with no content pack, in a child process, for the rules that
// must hold on a server that has none.
//
// Import scripts/lib/enforce-world.mjs before this file.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { openWorld } from "./enforce-world.mjs";
import { castOnOwnTurn, fightDummies, FULL_CASTER_SLOTS, slotsOf } from "./enforce-spells.mjs";

export const PROF = {
  saves: ["wis", "cha"],
  skills: [],
  expertise: [],
  languages: ["Common"],
  tools: [],
  armor: [],
  weapons: ["simple", "martial"],
};

// A full caster of `cls` at `level` holding `prepared` and `cantrips`, the
// casting ability at 18.
export function caster(cls, ability, prepared, cantrips = [], level = 9, extra = {}) {
  return {
    class: cls,
    level,
    abilities: { [ability]: 18, con: 14, dex: 12 },
    proficiencies: PROF,
    ...extra,
    spellcasting: {
      ability,
      slots: slotsOf(FULL_CASTER_SLOTS[level - 1]),
      known: [],
      prepared,
      cantrips,
      ...(extra.spellcasting ?? {}),
    },
  };
}

export const FIGHTER = {
  class: "fighter",
  level: 5,
  abilities: { str: 16, dex: 14 },
  proficiencies: { ...PROF, saves: ["str", "con"], armor: ["light", "medium", "heavy", "shields"] },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
};

const worlds = [];

// A fight against `count` dummies (AC 13, 90 HP, saves +0), the first hero
// first in the order, every cast made on its caster's own turn.
export async function table(heroes, count = 1, stats = {}, options = {}) {
  const world = await openWorld(options);
  worlds.push(world);
  const sheets = heroes.map((hero) => world.addHero(hero));
  const enemies = await fightDummies(world, count, { heroFaces: { [sheets[0].id]: 20 }, stats });
  castOnOwnTurn(world);
  return { world, sheets, enemies };
}

export const enemyOf = (world, id) => world.enemies().find((entry) => entry.id === id);

// An open field of `width` by 5 tiles, for laying tokens with layMap.
export const field = (width = 40) => Array.from({ length: 5 }, () => ".".repeat(width));

// The engine as the AI DM reaches it: a DM turn of its own, the model's
// rails on. What a person at the console may correct, the model may not.
export async function invokeAsAi(world, name, args = {}) {
  const { createDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const turn = createDmTurn(world.campaignId, []);
  return invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
}

// Dice of one size rolled since the last call.
export const countDice = (log, sides) => log.filter((die) => die.sides === sides).length;

// Runs one probe of scripts/lib/enforce-spell-nopack.mjs with no content
// pack and returns the JSON it prints.
export function withoutPack(probe) {
  const script = path.join(import.meta.dirname, "enforce-spell-nopack.mjs");
  const out = execFileSync(process.execPath, [script, probe], {
    env: { ...process.env, CONTENT_DB_PATH: "/nonexistent" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = out.trim().split("\n").filter((entry) => entry.startsWith("{")).pop();
  return JSON.parse(line ?? "{}");
}

export function closeTables() {
  for (const world of worlds) {
    world.clearDice();
  }
  worlds[0]?.close();
}
