// What a class card and a lineage card print (backlog F11): a plain play line
// first ("Wizard/Fighter mix", "Suits Bard, Sorcerer"), then chips. A chip may
// print an ability's code ("INT caster", "CON +2"), which the grid wraps so a
// screen reader hears the name; the hit die is said in words ("High HP") and
// its die joins them only with "Show rules and numbers" on. What a card says
// another way still goes to the search as keywords, so "d10" or
// "constitution" finds a card either way. Pure, so
// scripts/test-builder-plain-cards.mjs reads every bundled class and lineage
// through the same code the steps render.
import { textKey } from "@/lib/language/text-logic";
import type { ClassRoleReading } from "@/lib/srd/class-roles";
import { abilityName, asiChips, asiChoiceChip, casterChip, classArt, hitDieChip, type LineageEntry } from "./lineage";
import { lineageFits } from "./lineageFits";
import type { OptionCardView } from "./OptionCardGrid";
import { EASY_CLASSES } from "./playstyles";

// What the class plays like, in a few words: "Wizard/Fighter mix" for a
// blend, "Cleric style" for a class that plays like one other, and "Core
// class" for one of the core four itself (rather than "Wizard: like Wizard").
// A reading guessed from a pack class's numbers says so.
export function playLine(reading: ClassRoleReading | undefined, id: string): string {
  if (!reading) {
    return "";
  }
  const like = reading.playsLike.split(/\s*\+\s*/).filter(Boolean);
  const line =
    like.length > 1
      ? `${like.join("/")} mix`
      : textKey(reading.playsLike) === textKey(id)
        ? "Core class"
        : `${reading.playsLike} style`;
  return reading.suggested ? `${line} (suggested)` : line;
}

export function classCard({
  option,
  entry,
  reading,
  gender,
  numbers,
}: {
  // The picker's row: its name, its book, and in `meta` the canonical class
  // behind a reskin ("d10 · Paladin").
  option: { id: string; name: string; meta?: string; source?: string };
  entry: { hitDie: number; spellAbility?: string | null; packName?: string } | undefined;
  reading: ClassRoleReading | undefined;
  gender?: string | null;
  numbers: boolean;
}): OptionCardView {
  // Under a reskin the canonical class name follows the play line, the same
  // fact the dropdown kept in its meta column.
  const canonical = entry?.packName ? option.meta?.split(" · ")[1] : undefined;
  return {
    id: option.id,
    name: option.name,
    meta: canonical,
    art: classArt(option.id, gender),
    // The play line leads: what the class is, in words a new player and a
    // veteran new to the setting both read. Then the book where the group
    // heading does not say it (issue #116: a Marshal looked like a Core
    // Rules class). Saves are left to the chosen-class line and the "?"
    // box: the least of what a player chooses a class by.
    tagline: [playLine(reading, option.id), canonical, option.source].filter(Boolean).join(" · "),
    // "Easy to learn" leads where it applies: about play, where the
    // setting's seal on the plate is about the world. The caster is a chip
    // of its own, so the play line is never cut to make room for it.
    chips: [
      ...(EASY_CLASSES.has(option.id) ? ["Easy to learn"] : []),
      ...(reading?.roles ?? []),
      ...(entry?.spellAbility ? [casterChip(entry.spellAbility)] : []),
      ...(entry ? [hitDieChip(entry.hitDie, numbers)] : []),
    ],
    keywords: [
      ...(entry ? [`d${entry.hitDie}`] : []),
      ...(entry?.spellAbility ? [abilityName(entry.spellAbility)] : []),
    ],
    icon: { kind: "family", key: `class-${option.id}` },
  };
}

export function lineageCard({
  slide,
}: {
  slide: LineageEntry & { art: string; canonical?: string; sourceOnCard?: string };
}): OptionCardView {
  const chips = asiChips(slide.asi).slice(0, 2);
  const choice = asiChoiceChip(slide);
  return {
    id: slide.id,
    name: slide.name,
    meta: slide.canonical,
    art: slide.art,
    // The classes its bonuses suit ("Suits Bard, Sorcerer") lead: the play
    // line. Under a reskin the canonical name follows, so a player always
    // knows which SRD race they are actually taking; then the book, where
    // the heading does not say it (issue #116).
    tagline: [suitsLine(slide), slide.canonical, slide.sourceOnCard].filter(Boolean).join(" · "),
    // What it raises ("CON +2"), and a bonus the player places ("Choose +1
    // / +1").
    chips: [...chips.map((chip) => chip.label), ...(choice ? [choice] : [])],
    keywords: chips.map((chip) => chip.spoken),
  };
}

// The first two classes a lineage's bonuses suit, for its card.
function suitsLine(slide: LineageEntry): string {
  const fits = lineageFits(slide, 2);
  if (!fits) {
    return "";
  }
  return fits.kind === "any" ? "Suits any class" : `Suits ${fits.names.join(", ")}`;
}
