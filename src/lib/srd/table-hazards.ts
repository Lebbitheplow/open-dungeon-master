// The traps, poisons and diseases a table's DM wrote in the workshop
// (homebrew kind "hazard", src/lib/homebrew/hazard-data.ts), for the
// engines that run hazards by name: apply_hazard's traps, the afflict tool's
// poisons and diseases, and a weapon coated in a poison. The server reads
// the table's authors' hazards (src/lib/db/table-hazards.ts, registered by
// src/lib/db/core.ts); the SRD's own come first, so a workshop "Wyvern
// Poison" never shadows the book's.

import { POISONS, findDisease, findPoison, type DiseaseSpec, type Poison } from "@/lib/srd/afflictions";
import { findSampleTrap, type TrapSpec } from "@/lib/srd/trap-specs";

export type HazardKind = "trap" | "poison" | "disease";

export type WorkshopHazard =
  | { id: string; name: string; hazardKind: "trap"; trap: TrapSpec }
  | { id: string; name: string; hazardKind: "poison"; poison: Omit<Poison, "id" | "name"> }
  | { id: string; name: string; hazardKind: "disease"; disease: DiseaseSpec };

let reader: ((campaignId: string) => ReadonlyMap<string, WorkshopHazard>) | null = null;

export function registerTableHazardReader(next: (campaignId: string) => ReadonlyMap<string, WorkshopHazard>): void {
  reader = next;
}

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function tableHazards(campaignId: string | null | undefined): WorkshopHazard[] {
  return campaignId && reader ? [...reader(campaignId).values()] : [];
}

function tableHazard<K extends HazardKind>(name: string, campaignId: string | null | undefined, kind: K): Extract<WorkshopHazard, { hazardKind: K }> | null {
  if (!campaignId || !reader) {
    return null;
  }
  const found = reader(campaignId).get(key(name));
  return found && found.hazardKind === kind ? (found as Extract<WorkshopHazard, { hazardKind: K }>) : null;
}

// A poison by name: the SRD's, else the table's.
export function poisonAt(name: string, campaignId: string | null | undefined): Poison | null {
  const srd = findPoison(name);
  if (srd) {
    return srd;
  }
  const own = tableHazard(name.replace(/\(.*\)/g, "").trim(), campaignId, "poison");
  return own ? { ...own.poison, id: own.id, name: own.name } : null;
}

// A trap by name: one of the SRD's samples, else the table's.
export function trapAt(name: string, campaignId: string | null | undefined): { name: string; trap: TrapSpec } | null {
  const sample = findSampleTrap(name);
  if (sample) {
    return { name: sample.name, trap: sample };
  }
  const own = tableHazard(name, campaignId, "trap");
  return own ? { name: own.name, trap: own.trap } : null;
}

// A disease of the table's (the SRD's three are findDisease's).
export function diseaseAt(name: string, campaignId: string | null | undefined): { id: string; name: string; disease: DiseaseSpec } | null {
  if (findDisease(name)) {
    return null;
  }
  const own = tableHazard(name, campaignId, "disease");
  return own ? { id: own.id, name: own.name, disease: own.disease } : null;
}

// The names the tools accept at this table, for their descriptions and the
// DM's prompt.
export function hazardNamesAt(campaignId: string | null | undefined): Record<HazardKind, string[]> {
  const own = tableHazards(campaignId);
  return {
    trap: own.filter((entry) => entry.hazardKind === "trap").map((entry) => entry.name),
    poison: own.filter((entry) => entry.hazardKind === "poison").map((entry) => entry.name),
    disease: own.filter((entry) => entry.hazardKind === "disease").map((entry) => entry.name),
  };
}

export const SRD_POISON_NAMES = POISONS.map((poison) => poison.name);
