// Whose rolls the game parks instead of rolling at once. Two reasons put a
// player here, and both produce the same pending-roll card:
//
// - real dice: the player opted in and the campaign's dice policy allows it
//   (the numbers are typed or reported by a Pixels die, so trust is the
//   campaign's call);
// - hold my rolls: the player asked for every roll to wait for them, then
//   rolls it digitally themselves (a shake of the phone, or a tap). The
//   server still draws every number, so no policy gates it.
//
// Pure and alias-import-free so scripts/test-held-rolls.mjs can load it.

export type HeldRollMember = {
  userId: string;
  useRealDice: boolean;
  holdRolls: boolean;
};

export function heldRollUserIds(
  dicePolicy: string,
  members: ReadonlyArray<HeldRollMember>,
): Set<string> {
  const realAllowed = dicePolicy === "real_allowed";
  const ids = new Set<string>();
  for (const member of members) {
    if (member.holdRolls || (realAllowed && member.useRealDice)) {
      ids.add(member.userId);
    }
  }
  return ids;
}
