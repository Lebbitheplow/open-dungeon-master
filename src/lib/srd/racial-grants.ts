// What a race grants beyond numbers the race table states outright: the
// dragonborn's ancestry, the spells some lineages cast by nature, and the
// rule for a proficiency two grants both give.
//
// Pure and database-free, like the rest of src/lib/srd, so the builder, the
// server's creation check and the counters can all read the same answer.
import racesJson from "@/lib/srd/races.json";
import { srdRaceId } from "@/lib/srd/race-id";
import type { Ability } from "@/lib/schemas/sheet";

// ---- Draconic Ancestry (SRD 5.1, Dragonborn) ----

export type DraconicAncestry = {
  id: string;
  dragon: string;
  damageType: string;
  area: string;
  save: "dex" | "con";
};

// The SRD's table, row for row: the dragon, the damage its breath deals and
// the dragonborn resists, and the breath's shape and saving throw.
export const DRACONIC_ANCESTRIES: DraconicAncestry[] = [
  { id: "black", dragon: "Black", damageType: "acid", area: "5 by 30 ft. line", save: "dex" },
  { id: "blue", dragon: "Blue", damageType: "lightning", area: "5 by 30 ft. line", save: "dex" },
  { id: "brass", dragon: "Brass", damageType: "fire", area: "5 by 30 ft. line", save: "dex" },
  { id: "bronze", dragon: "Bronze", damageType: "lightning", area: "5 by 30 ft. line", save: "dex" },
  { id: "copper", dragon: "Copper", damageType: "acid", area: "5 by 30 ft. line", save: "dex" },
  { id: "gold", dragon: "Gold", damageType: "fire", area: "15 ft. cone", save: "dex" },
  { id: "green", dragon: "Green", damageType: "poison", area: "15 ft. cone", save: "con" },
  { id: "red", dragon: "Red", damageType: "fire", area: "15 ft. cone", save: "dex" },
  { id: "silver", dragon: "Silver", damageType: "cold", area: "15 ft. cone", save: "con" },
  { id: "white", dragon: "White", damageType: "cold", area: "15 ft. cone", save: "con" },
];

export const DRACONIC_ANCESTRY_IDS = DRACONIC_ANCESTRIES.map((entry) => entry.id);

// An ancestry nobody chose, rolled on the table above (one d10, one row
// each), for a dragonborn the engine makes: every dragon is as likely.
export function rollDraconicAncestry(rollDie: (sides: number) => number): DraconicAncestry {
  const face = Math.max(1, Math.min(DRACONIC_ANCESTRIES.length, rollDie(DRACONIC_ANCESTRIES.length)));
  return DRACONIC_ANCESTRIES[face - 1];
}

// A stored choice read back: the id ("red"), the dragon's name ("Red") or the
// feature this module names ("Draconic Ancestry: Red (...)").
export function findDraconicAncestry(value: string | null | undefined): DraconicAncestry | null {
  const key = (value ?? "").trim().toLowerCase().replace(/^draconic ancestry:\s*/, "");
  const word = key.split(/[\s(]/)[0];
  return DRACONIC_ANCESTRIES.find((entry) => entry.id === word) ?? null;
}

// Whether this race asks for an ancestry (the bundled dragonborn under any of
// its ids).
export function takesDraconicAncestry(raceId: string): boolean {
  return raceRow(raceId)?.ancestryChoice === "draconic";
}

// The race feature a chosen ancestry is written as. Its name carries the
// resistance in the words the damage engine reads ("resistance to fire"),
// so the sheet resists the ancestry's type wherever features are read.
export function draconicAncestryFeature(ancestry: DraconicAncestry): { name: string; source: "race" } {
  return {
    name: `Draconic Ancestry: ${ancestry.dragon} (${ancestry.damageType} breath, ${ancestry.area}, ${ancestry.save.toUpperCase()} save; resistance to ${ancestry.damageType})`,
    source: "race",
  };
}

// The ancestry a sheet holds, read from its features. Null for a dragonborn
// written before the choice existed; the breath then stays the narrated one.
export function ancestryOf(features: Array<{ name: string }>): DraconicAncestry | null {
  for (const feature of features) {
    if (/^draconic ancestry:/i.test(feature.name.trim())) {
      return findDraconicAncestry(feature.name);
    }
  }
  return null;
}

// Breath Weapon (SRD 5.1): 2d6, 3d6 at 6th level, 4d6 at 11th, 5d6 at 16th;
// DC 8 + Constitution modifier + proficiency bonus; the save and the damage
// type are the ancestry's.
export function breathWeaponFor(
  ancestry: DraconicAncestry,
  level: number,
  conMod: number,
  proficiencyBonus: number,
): { dice: string; damageType: string; save: "dex" | "con"; dc: number; area: string } {
  const dice = level >= 16 ? "5d6" : level >= 11 ? "4d6" : level >= 6 ? "3d6" : "2d6";
  return {
    dice,
    damageType: ancestry.damageType,
    save: ancestry.save,
    dc: 8 + conMod + proficiencyBonus,
    area: ancestry.area,
  };
}

// ---- spells a race casts by nature ----

type InnateSpellRow = { name: string; level: number; castAt?: number; per?: "long" };
type RaceRow = {
  id: string;
  ancestryChoice?: string;
  innateSpells?: { trait: string; ability: Ability; spells: InnateSpellRow[] };
};

const RACES = (racesJson as unknown as { races: RaceRow[] }).races;

function raceRow(raceId: string): RaceRow | null {
  const wanted = srdRaceId(raceId);
  return RACES.find((entry) => entry.id === wanted) ?? null;
}

export type InnateSpell = {
  name: string;
  // Character level the spell arrives at.
  gainedAt: number;
  // The slot level it is cast at (0 for a cantrip).
  castAt: number;
  // A levelled innate spell is cast once, and again after a long rest.
  counterId: string | null;
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Every spell the race has given by this character level: Infernal Legacy's
// thaumaturgy, then hellish rebuke (as a 2nd-level spell) at 3rd and darkness
// at 5th; Drow Magic's dancing lights, faerie fire and darkness; a forest
// gnome's minor illusion. Cantrips are known outright and cost nothing.
export function innateSpellsFor(raceId: string, level: number): InnateSpell[] {
  const row = raceRow(raceId);
  return (row?.innateSpells?.spells ?? [])
    .filter((spell) => level >= spell.level)
    .map((spell) => {
      const cantrip = spell.level === 1 && !spell.per;
      return {
        name: spell.name,
        gainedAt: spell.level,
        castAt: cantrip ? 0 : (spell.castAt ?? 1),
        counterId: spell.per ? `racial_${slug(spell.name)}` : null,
      };
    });
}

// The ability the race's spells are cast with (Charisma for the tiefling and
// the drow, Intelligence for the forest gnome), or null.
export function innateSpellAbility(raceId: string): Ability | null {
  return raceRow(raceId)?.innateSpells?.ability ?? null;
}

// The race's cantrips, which ride on top of any class's cantrips known.
export function innateCantripsFor(raceId: string, level: number): string[] {
  return innateSpellsFor(raceId, level)
    .filter((spell) => spell.castAt === 0)
    .map((spell) => spell.name);
}

// The once-a-day counters, shaped like the sheet's resources map, with any
// use already spent kept (and clamped) so a regrant never refunds one.
export function innateSpellCounters(
  raceId: string,
  level: number,
  existing?: Record<string, { max: number; used: number }>,
): Record<string, { max: number; used: number }> {
  const out: Record<string, { max: number; used: number }> = {};
  for (const spell of innateSpellsFor(raceId, level)) {
    if (spell.counterId) {
      out[spell.counterId] = { max: 1, used: Math.min(existing?.[spell.counterId]?.used ?? 0, 1) };
    }
  }
  return out;
}

// The once-a-day racial spells as counter rows, for the resource table: the
// trait whose feature carries them ("infernal legacy"), the level the spell
// arrives at, and the spell. A counter exists only from that level on.
export type InnateSpellCounterRow = {
  id: string;
  displayName: string;
  trait: string;
  spell: string;
  gainedAt: number;
  castAt: number;
};

export function innateSpellCounterRows(): InnateSpellCounterRow[] {
  const rows: InnateSpellCounterRow[] = [];
  for (const race of RACES) {
    for (const spell of race.innateSpells?.spells ?? []) {
      if (!spell.per) {
        continue;
      }
      const id = `racial_${slug(spell.name)}`;
      if (rows.some((row) => row.id === id && row.trait === race.innateSpells!.trait.toLowerCase())) {
        continue;
      }
      rows.push({
        id,
        displayName: `${spell.name} (${race.innateSpells!.trait})`,
        trait: race.innateSpells!.trait.toLowerCase(),
        spell: spell.name,
        gainedAt: spell.level,
        castAt: spell.castAt ?? 1,
      });
    }
  }
  return rows;
}

// ---- the same proficiency from two grants ----

// SRD 5.1, Backgrounds: a character who would gain the same proficiency from
// two sources can choose a different proficiency of the same kind instead.
// Given the fixed grants of one kind (the race's skills, the background's
// skills, the class's tools), the names given more than once: each repeat is
// one free pick of that kind owed to the player.
export function repeatedGrants(...grants: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const list of grants) {
    for (const name of new Set((list ?? []).map((entry) => entry.trim().toLowerCase()))) {
      if (!name) {
        continue;
      }
      if (seen.has(name)) {
        repeated.push(name);
      } else {
        seen.add(name);
      }
    }
  }
  return repeated;
}
