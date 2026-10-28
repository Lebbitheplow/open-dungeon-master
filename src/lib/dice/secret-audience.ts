// Who reads a secret roll, said plainly for this seat.
export function secretAudience(seat: { dmSeat: boolean; steersStory: boolean; aiTable: boolean }): string {
  if (seat.dmSeat) return "Only you see it. The table is not told a die was rolled.";
  if (seat.aiTable) {
    return seat.steersStory
      ? "Only you and the AI storyteller see it."
      : "Only you, the AI storyteller and the party lead see it.";
  }
  return "Only you and the GM see it. The rest of the table is not told.";
}
