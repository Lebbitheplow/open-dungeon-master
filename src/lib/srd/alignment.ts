// An alignment as its two axes, however a sheet writes it: the builder
// stores the code ("LG", "N"), a DM or an import writes the words ("Lawful
// Good", "true neutral", "neutral evil"). Every reader of an alignment goes
// through here, so a rule naming "good" or "evil" (the Talismans of Pure
// Good and of Ultimate Evil, a good wielder's weapon) reads both spellings.
import { textKey, words } from "@/lib/language/text-logic";

export type Alignment = {
  ethic: "lawful" | "neutral" | "chaotic" | null;
  moral: "good" | "neutral" | "evil" | null;
};

const CODES: Record<string, Alignment> = {
  lg: { ethic: "lawful", moral: "good" },
  ng: { ethic: "neutral", moral: "good" },
  cg: { ethic: "chaotic", moral: "good" },
  ln: { ethic: "lawful", moral: "neutral" },
  n: { ethic: "neutral", moral: "neutral" },
  tn: { ethic: "neutral", moral: "neutral" },
  cn: { ethic: "chaotic", moral: "neutral" },
  le: { ethic: "lawful", moral: "evil" },
  ne: { ethic: "neutral", moral: "evil" },
  ce: { ethic: "chaotic", moral: "evil" },
};

export function alignmentOf(written: string | null | undefined): Alignment {
  const parts = words(textKey(String(written ?? "")));
  const code = CODES[parts.join("")];
  if (code) {
    return code;
  }
  // "Neutral" fills whichever axis the other word leaves open: "neutral
  // good" is neutral on the ethic axis, "lawful neutral" on the moral one,
  // and "neutral" or "true neutral" on both.
  const neutral = parts.includes("neutral") ? "neutral" : null;
  const ethic = parts.includes("lawful") ? "lawful" : parts.includes("chaotic") ? "chaotic" : neutral;
  const moral = parts.includes("good") ? "good" : parts.includes("evil") ? "evil" : neutral;
  return { ethic, moral };
}

// Whether a sheet's alignment holds a word a rule names ("good", "lawful").
export function alignmentIs(written: string | null | undefined, word: string): boolean {
  const { ethic, moral } = alignmentOf(written);
  const wanted = textKey(word);
  return ethic === wanted || moral === wanted;
}
