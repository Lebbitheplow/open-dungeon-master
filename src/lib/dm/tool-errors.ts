// Three kinds of "no" come back from a tool, and the model must treat them
// differently. A retry is a mistake in the call (a wrong id, a missing field,
// a choice only the player can make): nothing happened, so the model fixes
// the call, asks the player, or resends it without the part that cannot
// apply, and never narrates it. A rules refusal is the game saying no (no
// slot left, not their turn, out of reach): nothing was attempted either,
// and the model tells the table why and what they can do. A limit is the
// turn's budget for that kind of call: nothing more runs, so the model
// narrates what has resolved.
//
// Each error states its kind where its sentence is written, in the keys the
// model reads (retry: true, refused: "rules" | "limit"), so a reworded
// sentence keeps its kind and an error without one does not compile.
//
// The order a tool refuses in: what bars the act itself (whose turn, the
// character's state, the feature or spell held, the action, the slots or
// uses) before any question for the player or any part the act can go
// without, so neither is asked of an act that cannot happen. Each family
// asks its gate first: a spell tool the cast guard's dry run (mutations.ts
// castBarred), an attack the swing the turn can pay for (pc-attack-plan.ts),
// a feature its uses and its part of the turn (resource-turn.ts).
// scripts/test-check-order.mjs holds every family to it.

import type { ZodError } from "zod";
import { textKey } from "../language/text-logic.ts";

export type ToolError = { error: string; retry: true } | { error: string; refused: "rules" | "limit" };

// What a tool handler hands back: an error with its kind, or a result that
// is not an error.
export type ToolResult = (ToolError & { [key: string]: unknown }) | { [key: string]: unknown; error?: undefined };

// The error and its kind alone, out of an engine result that carries them
// among fields of its own (canAct's reason, a budget's ok: false), which are
// not the model's to read.
export function toolError(refusal: ToolError): ToolError {
  return "retry" in refusal ? { error: refusal.error, retry: true } : { error: refusal.error, refused: refusal.refused };
}

// A call whose arguments its schema refused: what the call needs, then each
// field zod refused with zod's own reason, which lists a fixed choice's values
// ('Invalid option: expected one of "none"|"advantage"|"disadvantage"'), so the
// model resends the call with a listed value instead of the server guessing
// one from its words.
export function invalidArguments(needs: string, error: ZodError): ToolError {
  const fields = error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`);
  return { error: `${needs} (${fields.join("; ")})`, retry: true };
}

// A name that is no record's whole name, refused with the records there are
// (`subject` reads up to the name: 'The goblin has no attack called'), so the
// model resends one of them or asks the player, and the server never takes
// the nearest one in its place.
export function noneNamed(subject: string, name: string, options: readonly string[]): ToolError {
  const listed = [...new Set(options)];
  return {
    error: `${subject} "${name}". ${listed.length ? `Use one of: ${listed.join(", ")}.` : "There is none to use."}`,
    retry: true,
  };
}

// An id that is no enemy of the fight or no character of the party, refused
// with the ones there are by name and id: a bare "use one from GAME STATE"
// sent the model back to search for it, or to give the attack up.
export function unknownRef(field: string, ref: string | undefined, records: readonly { id: string; name: string }[], tail = ""): ToolError {
  const refused = noneNamed(`Unknown ${field}`, ref ?? "", records.map((record) => `${record.name} (${record.id})`));
  return tail ? { ...refused, error: `${refused.error} ${tail}` } : refused;
}

// The records whose name holds the word a refused name was, for its
// refusal: "spider" is no Giant Spider, but the refusal names it.
export function holdingHint(name: string, holding: readonly string[]): string {
  return holding.length ? ` Named with "${name.trim()}": ${[...new Set(holding)].join(", ")}.` : "";
}

// The option a call names whole in its variant, or the refusal listing them:
// never the first, nor the one whose name the text holds. `owner` is whose
// options they are ("Raging Storm").
export function namedOption(owner: string, variant: string | undefined, options: readonly string[]): string | ToolError {
  const wanted = textKey(variant ?? "");
  const found = options.find((option) => textKey(option) === wanted);
  if (found !== undefined) {
    return found;
  }
  return wanted
    ? noneNamed(`${owner} has no option called`, (variant ?? "").trim(), options)
    : { error: `${owner} needs a variant: ${options.join(" or ")}. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
}
