// Disputed rulings, the pure part: who may raise one, how a vote is
// counted, and the line the transcript gets when it is settled. No DB and
// no "@/" imports so scripts/test-disputes.mjs can load it directly; the
// impure rim is src/lib/db/disputes.ts and the two routes.
//
// A player flags a passage the AI narrated ("that was a hit on a 7", "the
// spell has no save"); whoever steers the story (the party lead at an AI
// table, the person in the steering seat, the DM at an assisted one)
// upholds it, overrules it, or puts it to the table. Undo and revert-turn
// already cover the fix itself; this is the ruling, and the record of it.

export type DisputeStatus = "open" | "voting" | "upheld" | "overruled" | "withdrawn";
export type DisputeVote = "uphold" | "overrule";

export const DISPUTE_REASON_MAX = 300;

// Why a dispute cannot be raised, or null when it can. A person's own ruling
// is argued with the person; only a narrated one is flagged this way.
export function disputeRefusal(input: {
  narratorIsAi: boolean;
  message: { authorType: string } | null;
  raiserSteersStory: boolean;
  alreadyOpen: boolean;
}): string | null {
  if (!input.narratorIsAi) {
    return "A person runs this table; take it up with them.";
  }
  if (!input.message) {
    return "That passage is not in the transcript.";
  }
  if (input.message.authorType !== "dm") {
    return "Only a passage the Dungeon Master narrated can be disputed.";
  }
  if (input.raiserSteersStory) {
    return "You steer this story: revert the turn or direct the AI instead of disputing yourself.";
  }
  if (input.alreadyOpen) {
    return "That passage is already under dispute.";
  }
  return null;
}

export type Tally = {
  uphold: number;
  overrule: number;
  // Voters who have not cast yet.
  pending: string[];
  // Settled when one side holds a strict majority of every voter, or when
  // everyone has voted; a tie at the end upholds the ruling (the story as
  // narrated stands unless the table says otherwise).
  outcome: "upheld" | "overruled" | null;
};

export function tallyVotes(votes: Record<string, DisputeVote>, voterIds: string[]): Tally {
  const voters = [...new Set(voterIds)];
  let uphold = 0;
  let overrule = 0;
  for (const userId of voters) {
    if (votes[userId] === "uphold") {
      uphold += 1;
    } else if (votes[userId] === "overrule") {
      overrule += 1;
    }
  }
  const pending = voters.filter((userId) => !votes[userId]);
  const majority = Math.floor(voters.length / 2) + 1;
  let outcome: Tally["outcome"] = null;
  if (voters.length === 0) {
    outcome = "upheld";
  } else if (overrule >= majority) {
    outcome = "overruled";
  } else if (uphold >= majority || pending.length === 0) {
    outcome = "upheld";
  }
  return { uphold, overrule, pending, outcome };
}

// The steerer counting the votes early: whichever side leads, a tie upholds.
export function tallyEarly(votes: Record<string, DisputeVote>, voterIds: string[]): "upheld" | "overruled" {
  const { uphold, overrule } = tallyVotes(votes, voterIds);
  return overrule > uphold ? "overruled" : "upheld";
}

// The line the transcript carries once a dispute is settled, for the table
// and for the narrator, who reads system lines on its next turn.
export function disputeTranscriptLine(input: {
  status: DisputeStatus;
  raisedBy: string;
  reason: string;
  byVote: boolean;
}): string {
  const how = input.byVote ? "The table voted" : "The steerer ruled";
  const about = `${input.raisedBy} disputed the last ruling${input.reason ? `: "${input.reason}"` : ""}.`;
  switch (input.status) {
    case "upheld":
      return `${about} ${how}: the ruling stands as narrated.`;
    case "overruled":
      return `${about} ${how}: the ruling is overruled. Treat it as never having happened and continue from the moment before it; the steerer may revert the turn.`;
    case "withdrawn":
      return `${input.raisedBy} withdrew their dispute of the last ruling.`;
    default:
      return about;
  }
}
