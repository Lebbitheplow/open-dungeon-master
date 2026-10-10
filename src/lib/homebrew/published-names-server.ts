import { isPublishedSpellName } from "@/lib/content";
import { isPublishedGearName } from "@/lib/db/homebrew";
import { publishedNameProblem } from "@/lib/homebrew/published-names";

// The editor's check (published-names.ts) with the content pack's names too:
// a pack spell or a pack item answers for its name at the table as surely as
// a bundled one.
export function serverPublishedNameProblem(kind: string, name: string): string | null {
  return publishedNameProblem(kind, name, (candidate) =>
    kind === "spell" ? isPublishedSpellName(candidate) : kind === "item" ? isPublishedGearName(candidate) : false,
  );
}
