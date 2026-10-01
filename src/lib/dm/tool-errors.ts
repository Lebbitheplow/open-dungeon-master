// Two kinds of "no" come back from a tool, and the model must treat them
// differently. An argument fault (a wrong id, a missing field, a malformed
// expression) is the model's own mistake in the call: the character did not
// fail at anything, and the right move is to fix the call and send it again.
// A rules refusal (no slot left, not their turn, out of reach) is the game
// saying no: the attempt failed in the fiction, and that is what gets
// narrated. A cap on the turn's calls is neither: nothing more runs, so the
// model narrates what has resolved.
//
// The handlers write both kinds as { error }, in plain sentences; this reads
// which kind a sentence is by its shape. Pure, so the patterns are testable.

export type ToolErrorKind = "retry" | "rules" | "limit";

// Shapes that only an argument fault takes. Rules refusals name a character
// and a rule ("Kara is at 0 HP and cannot attack"); these name the call.
const ARGUMENT_FAULTS: RegExp[] = [
  /^Invalid\b/i,
  /\bUnknown\b/,
  /\bfrom GAME STATE\b/,
  /^[a-z]+(?:_[a-z]+)+ (?:needs|takes|changed nothing)\b/,
  /^(?:Name|Give|Say|Pass|Describe) /,
  /\bpass (?:their |a |an |the )?(?:healerId|targetCharacterId|targetEnemyId|characterId|form|variant|forced:true|the slot level)\b/i,
  /\bSend \w+(?: \w+)? again\b/,
  /\bName the slot\b/,
  /\bneeds? the spell's damage dice\b/,
  /^No active encounter\b|^No fight is running\b|^No current location\b|^No structured scene is running\b/,
  /\bneeds? (?:a|an) (?:valid|dice|ability|positive|nonzero|name|number)\b/,
  /\bis not available at this point\b/,
];

const LIMITS = /\blimit reached for this turn\b/i;

export function classifyToolError(error: string): ToolErrorKind {
  const text = error.trim();
  if (LIMITS.test(text)) {
    return "limit";
  }
  return ARGUMENT_FAULTS.some((pattern) => pattern.test(text)) ? "retry" : "rules";
}

// The result as the model is handed it: an error gains the mark that says
// which kind it is. A result that is not an error, or already carries its
// mark, is returned as it was.
export function markToolError(result: Record<string, unknown>): Record<string, unknown> {
  if (typeof result.error !== "string" || result.retry !== undefined || result.refused !== undefined) {
    return result;
  }
  const kind = classifyToolError(result.error);
  return kind === "retry" ? { ...result, retry: true } : { ...result, refused: kind };
}
