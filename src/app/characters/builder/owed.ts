import type { BlockerTarget, StepBlock } from "./submit";

// The "choices left on this step" line (steps/shared.tsx OwedLine): every
// pick a step's gate still holds, once per block, in the gate's order and
// in a player's words. The footer's blocker says the first of them; this
// says how many there are and goes to each. Pure, for
// scripts/test-builder-owed.mjs.

export const TARGET_WORDS: Record<BlockerTarget, string> = {
  name: "Name",
  background: "Background",
  backgroundSkills: "Background skills",
  race: "Race",
  languages: "Languages",
  racialAsi: "Ability bonus",
  racialSkills: "Race skills",
  racialTool: "Tool",
  racialCantrip: "Cantrip",
  racialFeat: "Feat",
  ancestry: "Draconic ancestry",
  repeatSkills: "Replacement skill",
  class: "Class",
  classSkills: "Class skills",
  tools: "Tools",
  subclass: "Subclass",
  styles: "Fighting style",
  expertise: "Expertise",
  options: "Class options",
  scores: "Ability scores",
  asi: "Ability score improvement",
  spells: "Spells",
  gear: "Gear",
};

export type OwedPick = { target: BlockerTarget; label: string; message: string };

export function owedPicks(blocks: ReadonlyArray<StepBlock>): OwedPick[] {
  const seen = new Set<BlockerTarget>();
  const out: OwedPick[] = [];
  for (const entry of blocks) {
    if (seen.has(entry.target)) continue;
    seen.add(entry.target);
    out.push({ target: entry.target, label: TARGET_WORDS[entry.target], message: entry.message });
  }
  return out;
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

// "Two choices left on this step", or null when none are.
export function owedHeadline(count: number): string | null {
  if (count <= 0) return null;
  const words = COUNT_WORDS[count] ?? String(count);
  return `${words} ${count === 1 ? "choice" : "choices"} left on this step`;
}
