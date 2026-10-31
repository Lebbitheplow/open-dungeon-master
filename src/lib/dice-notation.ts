// Maps a stored server roll to dice-box-threejs notation with forced
// values ("2d20@12,15"), so the 3D animation always lands on the
// authoritative numbers. Pure and alias-import-free for node test scripts.

type DieResultLike = { sides: number; value: number; kept: boolean };
type TermLike =
  | {
      kind: "dice";
      sides: number;
      dice: DieResultLike[];
    }
  | { kind: "modifier"; sign: 1 | -1; value: number };

// Die shapes the 3D box can physically represent.
const SUPPORTED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);

// Returns one notation string per dice term, or null when any term cannot
// be animated (odd homebrew sides); callers then skip the animation and
// rely on the chip alone.
export function rollToDiceBoxNotation(breakdown: { terms: TermLike[] }): string[] | null {
  const notations: string[] = [];
  for (const term of breakdown.terms) {
    if (term.kind !== "dice") {
      continue;
    }
    if (!SUPPORTED_SIDES.has(term.sides) || !term.dice.length) {
      return null;
    }
    const values = term.dice.map((die) => die.value);
    if (term.sides === 100) {
      notations.push(percentileNotation(values));
      continue;
    }
    notations.push(`${values.length}d${term.sides}@${values.join(",")}`);
  }
  return notations.length ? notations : null;
}

// dice-box-threejs's d100 is the tens die of a percentile pair: its faces
// read 10, 20 ... 90, 00, so a forced 57 matches no face and the library
// gave up and showed a random tens value (issue 668). A percentile roll is
// thrown the way it is at a table: the tens die and a d10 together, forced
// so they read the stored value (00 and 0 read 100).
export function percentileNotation(values: readonly number[]): string {
  const tens = values.map((value) => (value === 100 || value < 10 ? 100 : Math.floor(value / 10) * 10));
  const ones = values.map((value) => value % 10 || 10);
  return `${values.length}d100+${values.length}d10@${[...tens, ...ones].join(",")}`;
}
