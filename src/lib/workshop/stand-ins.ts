import { rollHeroName } from "@/app/characters/builder/heroNames";
import type { PlaystyleId } from "@/app/characters/builder/playstyles";
import { admitSheet } from "@/lib/characters/admit";
import { buildDraft, type DraftOffered } from "@/lib/characters/pregen-drafts";
import { textKey } from "@/lib/language/text-logic";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { TARGET_PARTY_LIMITS, normalizeTargetParty, type TargetParty } from "@/lib/workshop/kind";

// The stand-in party a test fight seats when the author does not pick their
// own characters (issue 553): the workshop's target party, as real sheets.
//
// Each hero is built by the quick-build engine with no model call, the same
// rounds "Draft pregens" runs on what the AI proposes
// (src/lib/characters/pregen-drafts.ts), and judged by the library's door
// like any drafted pregen. The lineup is the classic one, a front line, a
// healer, a striker and a caster first, so a party of four is the table most
// fights are written for; a larger party adds the next four. A setting that
// does not offer a class (a world pack's own list) gets the builder's
// closest class for the same job.

type Slot = { role: PlaystyleId; className: string; race: string; background: string };

export const STAND_IN_LINEUP: readonly Slot[] = [
  { role: "tank", className: "Fighter", race: "Human", background: "Soldier" },
  { role: "healer", className: "Cleric", race: "Dwarf", background: "Acolyte" },
  { role: "dps", className: "Rogue", race: "Halfling", background: "Criminal" },
  { role: "support", className: "Wizard", race: "Elf", background: "Sage" },
  { role: "tank", className: "Paladin", race: "Dragonborn", background: "Noble" },
  { role: "dps", className: "Ranger", race: "Half-Elf", background: "Outlander" },
  { role: "support", className: "Bard", race: "Tiefling", background: "Entertainer" },
  { role: "healer", className: "Druid", race: "Gnome", background: "Hermit" },
];

export type StandIn = {
  name: string;
  className: string;
  level: number;
  sheet: CreateSheetInput;
  // Call once the sheet is stored (admitSheet's settle).
  settle: () => void;
};

// The classes the party would hold, for the picker's line before anything
// is built: the lineup's names cut to the party's size.
export function standInClasses(size: number): string[] {
  const { size: count } = normalizeTargetParty({ size, level: 1 });
  return STAND_IN_LINEUP.slice(0, count).map((slot) => slot.className);
}

export function buildStandIns(
  party: TargetParty,
  offered: DraftOffered,
  userId: string,
  rng: () => number = Math.random,
): { ok: true; heroes: StandIn[] } | { ok: false; error: string } {
  const { size, level } = normalizeTargetParty(party);
  const heroes: StandIn[] = [];
  const taken = (name: string) => heroes.some((hero) => textKey(hero.name) === textKey(name));
  for (const slot of STAND_IN_LINEUP.slice(0, Math.min(size, TARGET_PARTY_LIMITS.size.max))) {
    // A name each, never two alike, so the order and the narration can tell
    // them apart.
    let name = rollHeroName({ raceName: slot.race, rng });
    for (let attempt = 0; attempt < 6 && taken(name); attempt += 1) {
      name = rollHeroName({ raceName: slot.race, rng });
    }
    const built = buildDraft(
      { name, concept: `A ${slot.className} stand-in`, className: slot.className, race: slot.race, background: slot.background, backstory: "", role: slot.role },
      level,
      offered,
      rng,
    );
    if (!built.ok) {
      return { ok: false, error: `The stand-in party could not be built: ${built.error}` };
    }
    const className = offered.classes.find((entry) => entry.id === built.draft.sheet.class)?.name ?? slot.className;
    const sheet: CreateSheetInput = { ...built.draft.sheet, notes: `A ${className} stand-in for a test fight.` };
    const verdict = admitSheet({ door: "library", level: built.draft.level, sheet, userId });
    if (!verdict.ok) {
      return {
        ok: false,
        error: `The ${className} stand-in did not pass the rules check (${verdict.problems[0] ?? "no reason given"}).`,
      };
    }
    heroes.push({ name, className, level: built.draft.level, sheet: verdict.sheet, settle: verdict.settle });
  }
  return { ok: true, heroes };
}
