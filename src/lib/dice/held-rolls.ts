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

// Why one roll was parked. It is written on the pending roll when it is
// parked, because the two reasons are answered differently: real dice are
// typed by the player and believed, a held roll is thrown by the server the
// moment the player lets it go.
export type ParkReason = "real_dice" | "held";

type DicePreferences = Pick<HeldRollMember, "useRealDice" | "holdRolls">;

// Real dice win when a player asked for both: at a table that allows them
// the player has dice in hand, and holding the roll is how they get to
// throw them.
export function parkReasonFor(
  dicePolicy: string,
  member: DicePreferences | null | undefined,
): ParkReason | null {
  if (!member) {
    return null;
  }
  if (dicePolicy === "real_allowed" && member.useRealDice) {
    return "real_dice";
  }
  return member.holdRolls ? "held" : null;
}

// Whether faces a player typed are believed for this parked roll. The roll
// must have been parked for real dice, and the table must still allow them
// for this player now: a policy closed while the roll waited closes this too.
// A roll parked before the reason was recorded (null) is judged by what the
// table and the player say today.
export function mayTypeFaces(
  parkedFor: ParkReason | null,
  dicePolicy: string,
  member: DicePreferences | null | undefined,
): boolean {
  if (parkedFor === "held") {
    return false;
  }
  return parkReasonFor(dicePolicy, member) === "real_dice";
}

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
