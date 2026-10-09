// What the legality check is told about the table and the catalog. The check
// itself (src/lib/srd/sheet-legality.ts) reads no database: whoever calls it
// looks the rows up (src/lib/characters/catalog.ts) and hands them in.
import type { BackgroundOption, ClassOption, RaceOption } from "@/lib/characters/options";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import type { HpMethod } from "@/lib/srd/hit-points";
import type { PriceLookup, StartingWealthMethod } from "@/lib/srd/starting-wealth";

export type ClassGrants = ClassOption;
export type RaceGrants = RaceOption & {
  // Feats the race itself hands out (the variant human's one).
  feats: number;
};
export type BackgroundGrants = BackgroundOption;

// The door a sheet is coming through.
//   "table"    a new character made at a campaign's table
//   "library"  a character made or edited in the player's library
//   "import"   a character file, possibly from another server
//   "stored"   a library character, as stored, entering play
//   "engine"   a companion the engine builds
export type Door = "table" | "library" | "import" | "stored" | "engine";

export type SpellFacts = {
  // The spell's canonical name, its level, and the class lists it is on.
  name: string;
  level: number;
  classes: string[];
  // The school of magic ("evocation"), where known: the third casters learn
  // from two schools (src/lib/srd/third-caster.ts).
  school?: string | null;
  // Whether it carries the ritual tag, where the source knows.
  ritual?: boolean;
};

// The feat's text rides along: what it grants beyond its ability point is
// read from it (src/lib/srd/feat-grants.ts).
export type FeatFacts = { name: string; prerequisite: string; desc: string };

export type LegalityContext = {
  door: Door;
  // The level the sheet is judged at: the table's starting level, or the
  // library character's own.
  level: number;
  // Null where no table is in sight (the library, a file): hit points are
  // then held to what the dice could have given.
  hpMethod: HpMethod | null;
  startingWealth: StartingWealthMethod;
  // Resolves a class id, the sheet's own and those of a multiclass list.
  classOf: (classId: string) => ClassGrants | null;
  race: RaceGrants | null;
  background: BackgroundGrants | null;
  // The stored character an edit starts from. What it holds was earned, so
  // an edit may keep it; what the request adds is held to the rules.
  baseline?: { sheet: CreateSheetInput; level: number } | null;
  // Six totals the server rolled for this player, when it did.
  abilityPool?: number[] | null;
  // Gold the server rolled for this player's class, under "rolled" wealth.
  wealthRoll?: number | null;
  priceOf: PriceLookup;
  spellOf: (name: string) => SpellFacts | null;
  featOf: (name: string) => FeatFacts | null;
  // Whether a subclass name is one the class offers: the bundled tables,
  // the content pack's archetypes, the player's homebrew.
  subclassOffered: (classId: string, name: string) => boolean;
  // A die for the rolled HP method: the server's own.
  rollDie: (sides: number) => number;
};

export type Legalized = {
  // Plain sentences, each saying what the rule is and what would pass.
  // Empty when the sheet may be stored.
  problems: string[];
  // The sheet with every derived value written by the server. Only
  // meaningful when `problems` is empty.
  sheet: CreateSheetInput;
  // What the server rolled while deriving, for the response to show.
  rolled?: { hp?: number[] };
};

export const lower = (value: string) => value.trim().toLowerCase();

export function uniqueBy<T>(list: T[], keyOf: (entry: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => {
    const key = keyOf(entry);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export const uniqueNames = (names: string[]) => uniqueBy(names, lower);

export const ABILITY_NAMES: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};
