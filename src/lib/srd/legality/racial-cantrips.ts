// The cantrips a race leaves to the player: as many as the race offers
// (a high elf's one wizard cantrip, a homebrew species' three), each a
// different spell, each from the race's list.
//
// A sheet carried one pick until a species could offer more, so a count-3
// species was admitted with one cantrip and the two others were lost
// between the builder and the sheet. Every pick is judged and written here.
//
// A character made or edited here names every pick; a file may be older
// than the species it names, so a pick it leaves open is owed, not wrong
// (as a feat's are, src/lib/srd/feat-spells.ts). A stored character's picks
// were settled where the server saw them, and a companion the engine drafts
// is not held to the count.
import { textKey } from "@/lib/language/text-logic";
import { namedRacialCantrips, racialCantripsOf, type RacialCantripChoices } from "@/lib/srd/racial-cantrips";
import type { SpellFacts } from "@/lib/srd/legality/types";

export type RacialCantripVerdict = {
  // The picks, each once, with the list each is drawn from.
  picks: Array<{ name: string; list: string }>;
  problems: string[];
  owed: string[];
};

export function judgeRacialCantrips(input: {
  race: { name: string; cantripChoice?: { list: string; count: number } };
  sent: RacialCantripChoices;
  // Whether the class casts: a caster's picks are judged with its lists
  // (src/lib/srd/legality/spells.ts), anyone else's here.
  casts: boolean;
  spellOf: (name: string) => SpellFacts | null;
  // Whether the picks are judged at all, and whether their count is.
  judgesPicks: boolean;
  countsPicks: boolean;
  picksMayWait: boolean;
}): RacialCantripVerdict {
  const choice = input.race.cantripChoice;
  if (!choice) {
    return { picks: [], problems: [], owed: [] };
  }
  const { list, count } = choice;
  const sent = namedRacialCantrips(input.sent);
  const names = racialCantripsOf(input.sent);
  const problems: string[] = [];
  const owed: string[] = [];
  const plural = (n: number) => (n === 1 ? "cantrip" : "cantrips");
  if (input.judgesPicks && input.countsPicks) {
    const twice = sent.find((name, index) => sent.findIndex((other) => textKey(other) === textKey(name)) !== index);
    if (twice) {
      problems.push(`The ${input.race.name}'s cantrips are different spells; ${twice} is named twice.`);
    }
    const named = `this sheet names ${names.length || "none"}`;
    if (names.length > count) {
      problems.push(`The ${input.race.name} learns ${count} ${list} ${plural(count)} of the player's choice; ${named}.`);
    } else if (names.length < count) {
      const left = count - names.length;
      if (input.picksMayWait) {
        owed.push(`${input.race.name}: pick ${left} ${list} ${plural(left)}.`);
      } else {
        problems.push(`The ${input.race.name} learns ${count} ${list} ${plural(count)} of the player's choice; ${named}.`);
      }
    }
  }
  // A caster's lists judge its picks with its own cantrips.
  if (input.judgesPicks && !input.casts) {
    for (const name of names) {
      const spell = input.spellOf(name);
      if (!spell || spell.level !== 0 || !spell.classes.map(textKey).includes(textKey(list))) {
        problems.push(
          `${name} is not a ${list} cantrip, which is what the ${input.race.name}'s ${plural(count)} must be.`,
        );
      }
    }
  }
  return { picks: names.map((name) => ({ name, list })), problems, owed };
}
