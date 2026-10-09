// A trap as numbers the hazard engine runs (src/lib/dm/hazard-tools.ts
// apply_hazard with `trap`): how it is found and disarmed, an attack roll or
// a fall it makes first, damage nobody saves against, the save and the
// damage it resists, and the conditions it leaves. The SRD 5.1 sample traps
// (Running the Game, Traps) are written out below; a workshop trap is the
// same shape (src/lib/homebrew/hazard-data.ts). Pure.

import type { Ability } from "@/lib/schemas/sheet";

export type TrapDamage = { dice: string; type: string };

export type TrapSpec = {
  kind: "mechanical" | "magic";
  trigger: string;
  // Finding it, and the check that makes it safe.
  spot?: { dc: number; skill: "perception" | "investigation" | "arcana" };
  disarm?: { dc: number; how: string };
  // An attack roll against each victim's AC; a miss does nothing.
  attackBonus?: number;
  // A fall into it (a pit): falling damage and prone, before the rest.
  fallFeet?: number;
  // Damage nobody saves against (a needle's prick, a dart that hit).
  hit?: TrapDamage[];
  // The save, the damage it halves (or turns away), and what a failure leaves.
  save?: { ability: Ability; dc: number; halfOnSave: boolean };
  damage?: TrapDamage;
  condition?: string;
  // Conditions on everyone it catches, save or not (a net's restraint).
  conditionsAlways?: string[];
  // How long a condition lasts, in rounds (10 a minute); absent, until removed.
  rounds?: number;
  summary: string;
};

export type SampleTrap = TrapSpec & { id: string; name: string };

const TRIP_WIRE = { spot: { dc: 10, skill: "perception" as const }, disarm: { dc: 15, how: "thieves' tools (an edged tool at disadvantage)" } };

export const SAMPLE_TRAPS: SampleTrap[] = [
  {
    id: "collapsing_roof", name: "Collapsing Roof", kind: "mechanical", trigger: "a trip wire 3 inches off the ground", ...TRIP_WIRE,
    save: { ability: "dex", dc: 15, halfOnSave: true }, damage: { dice: "4d10", type: "bludgeoning" },
    summary: "The ceiling collapses: DC 15 Dexterity save, 4d10 bludgeoning, half on a success; the floor becomes difficult terrain.",
  },
  {
    id: "falling_net", name: "Falling Net", kind: "mechanical", trigger: "a trip wire between two columns or trees", ...TRIP_WIRE,
    conditionsAlways: ["restrained"], save: { ability: "str", dc: 10, halfOnSave: false }, condition: "prone",
    summary: "A net drops over a 10-foot square: everyone under it is restrained, and a DC 10 Strength save keeps them standing. A DC 10 Strength check frees one; the net has AC 10 and 20 hit points.",
  },
  {
    id: "fire_breathing_statue", name: "Fire-Breathing Statue", kind: "magic", trigger: "more than 20 pounds on a hidden pressure plate",
    spot: { dc: 15, skill: "perception" }, disarm: { dc: 13, how: "an iron spike under the pressure plate, or dispel magic (DC 13) on the statue" },
    save: { ability: "dex", dc: 13, halfOnSave: true }, damage: { dice: "4d10", type: "fire" },
    summary: "A 30-foot cone of fire from the statue: DC 13 Dexterity save, 4d10 fire, half on a success.",
  },
  {
    id: "simple_pit", name: "Simple Pit", kind: "mechanical", trigger: "walking onto the cloth over a 10-foot hole",
    spot: { dc: 10, skill: "perception" }, fallFeet: 10,
    summary: "A covered hole: a fall of 10 feet, 1d6 bludgeoning and prone.",
  },
  {
    id: "hidden_pit", name: "Hidden Pit", kind: "mechanical", trigger: "stepping on a false floor over a 10-foot pit",
    spot: { dc: 15, skill: "perception" }, disarm: { dc: 15, how: "an iron spike wedged between the lid and the floor" }, fallFeet: 10,
    summary: "A lid that swings open: a fall of 10 feet, 1d6 bludgeoning and prone.",
  },
  {
    id: "spiked_pit", name: "Spiked Pit", kind: "mechanical", trigger: "falling into a pit lined with spikes",
    spot: { dc: 15, skill: "perception" }, fallFeet: 10, hit: [{ dice: "2d10", type: "piercing" }],
    summary: "A pit with sharpened spikes: the fall, and 2d10 piercing from the spikes.",
  },
  {
    id: "poisoned_spiked_pit", name: "Spiked Pit (poisoned)", kind: "mechanical", trigger: "falling into a pit lined with poisoned spikes",
    spot: { dc: 15, skill: "perception" }, fallFeet: 10, hit: [{ dice: "2d10", type: "piercing" }],
    save: { ability: "con", dc: 13, halfOnSave: true }, damage: { dice: "4d10", type: "poison" },
    summary: "The fall, 2d10 piercing from the spikes, and a DC 13 Constitution save against 4d10 poison, half on a success.",
  },
  {
    id: "poison_darts", name: "Poison Darts", kind: "mechanical", trigger: "more than 20 pounds on a hidden pressure plate",
    spot: { dc: 15, skill: "perception" }, disarm: { dc: 15, how: "an iron spike under the plate, or the holes stuffed with cloth or wax" },
    attackBonus: 8, hit: [{ dice: "1d4", type: "piercing" }],
    save: { ability: "con", dc: 15, halfOnSave: true }, damage: { dice: "2d10", type: "poison" },
    summary: "Darts at +8 to hit: 1d4 piercing, then a DC 15 Constitution save against 2d10 poison, half on a success.",
  },
  {
    id: "poison_needle", name: "Poison Needle", kind: "mechanical", trigger: "opening the lock without its key",
    spot: { dc: 20, skill: "investigation" }, disarm: { dc: 15, how: "thieves' tools" },
    hit: [{ dice: "1", type: "piercing" }, { dice: "2d10", type: "poison" }],
    save: { ability: "con", dc: 15, halfOnSave: false }, condition: "poisoned", rounds: 600,
    summary: "A needle in the lock: 1 piercing and 2d10 poison, and a DC 15 Constitution save or poisoned for 1 hour.",
  },
  {
    id: "rolling_sphere", name: "Rolling Sphere", kind: "mechanical", trigger: "20 or more pounds on a pressure plate",
    spot: { dc: 15, skill: "perception" }, disarm: { dc: 15, how: "an iron spike under the pressure plate" },
    save: { ability: "dex", dc: 15, halfOnSave: false }, damage: { dice: "10d10", type: "bludgeoning" }, condition: "prone",
    summary: "A 10-foot stone sphere: a DC 15 Dexterity save or 10d10 bludgeoning and knocked prone. A DC 20 Strength check slows it by 15 feet.",
  },
];

export function findSampleTrap(name: string): SampleTrap | null {
  const key = name.trim().toLowerCase();
  return SAMPLE_TRAPS.find((trap) => trap.name.toLowerCase() === key || trap.id === key.replace(/[^a-z]+/g, "_")) ?? null;
}
