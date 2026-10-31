// The one line a relationship tool keeps for the record (relationship_beat,
// romance_advance, relationship_end, relationship_scheme), and how those
// tools read their arguments.
//
// A note that runs past NOTE_MAX is fitted at a word, the way a sheet fits a
// long name (src/lib/schemas/sheet.ts fitName), rather than refused: an NPC's
// first move asks for their own words, and a 267-character line once cost
// the whole step (issue 634). Only a note far past any line is refused.
import { z, type ZodType } from "zod";
import { fitName } from "@/lib/schemas/sheet";
import { invalidArguments, type ToolError } from "@/lib/dm/tool-errors";

export const NOTE_MAX = 200;
const NOTE_REFUSED_PAST = 4_000;

// What the model and the console are told about the note's length.
export const NOTE_LIMIT_WORDS = `Up to ${NOTE_MAX} characters; a longer one is cut at a word.`;

export const relationshipNote = z.string().max(NOTE_REFUSED_PAST).transform((value) => fitName(value, NOTE_MAX)).optional();

// A tool's arguments, or the refusal naming each field its schema refused
// with zod's own reason, after what the call needs.
export function parseToolArguments<T>(schema: ZodType<T>, rawArguments: string, needs: string): { args: T } | ToolError {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: needs, retry: true };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { args: parsed.data } : invalidArguments(needs, parsed.error);
}
