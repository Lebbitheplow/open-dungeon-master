// Which roll a held Help belongs to (SRD 5.1, Help): either an ability
// check, or the first attack against one creature within 5 feet of the
// helper. take_action help (src/lib/dm/action-tools.ts) writes the
// "helped" condition with its source: "check" for a check, the enemy's id
// for an attack. A Help written before sources were kept names nothing and
// serves either, as it always did.
//
// Pure, so the roll resolver (src/lib/dm/rolls.ts) and the attack
// situation (src/lib/dm/pc-attack-situation.ts) can both ask it.

export const HELPED = "helped";
export const HELP_FOR_A_CHECK = "check";

type Holder = {
  conditions: string[];
  conditionMeta?: Record<string, { source?: string } | undefined> | null;
};

// The held Help's condition name when it applies to this roll, else null.
export function heldHelp(
  sheet: Holder,
  roll: { check: true } | { enemyId: string },
): string | null {
  const name = sheet.conditions.find((entry) => entry.trim().toLowerCase() === HELPED);
  if (!name) {
    return null;
  }
  const source = sheet.conditionMeta?.[name]?.source;
  if (!source) {
    return name;
  }
  if ("check" in roll) {
    return source === HELP_FOR_A_CHECK ? name : null;
  }
  return source === roll.enemyId ? name : null;
}
