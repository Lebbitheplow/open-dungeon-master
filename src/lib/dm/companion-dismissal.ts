import type { Campaign } from "@/lib/db/campaigns";
import { handleDismissCompanion } from "@/lib/dm/companion-tools";
import { companionRung, conscienceSetting } from "@/lib/dm/conscience";
import { RUNG_WORD, rungName } from "@/lib/dm/conscience-logic";
import { sendAway } from "@/lib/dm/departure";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";

// dismiss_companion, with the companion's conscience in the way (issue 563).
// Whether a lasting companion leaves over what the party did is the
// server's (src/lib/dm/departure.ts); before this the prompt said so and
// nothing held the AI to it, and a dismissal skipped the departure record,
// so a companion written out that way never came back.
//
// At a table that runs a conscience, a lasting companion at a warning or
// worse (warning, ultimatum, breaking point):
//   - the AI's dismissal is refused, and it plays the rung instead;
//   - a person's (the party lead from the companion's card, a person at the
//     console) goes through: at Leave and Turn as a departure, kept on the
//     record with how they went so the return can follow; at Talk, where the
//     table keeps its companions, as the plain parting it always was.
// A companion who has fallen, or stands above a warning, leaves as before.
//
// Kept apart from companion-tools.ts, which departure.ts imports for the
// removal itself.

export type DismissedBy = "ai" | "person";

const WARNING = 2;

function named(rawArguments: string, sheets: readonly CharacterSheet[]): CharacterSheet | null {
  let ref = "";
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { characterId?: unknown };
    ref = typeof parsed.characterId === "string" ? parsed.characterId.trim() : "";
  } catch {
    return null;
  }
  if (!ref) {
    return null;
  }
  return sheets.find((sheet) => sheet.id === ref) ?? sheets.find((sheet) => textKey(sheet.name) === textKey(ref)) ?? null;
}

export function dismissCompanion(campaign: Campaign, rawArguments: string, sheets: CharacterSheet[], by: DismissedBy): ToolResult {
  const sheet = named(rawArguments, sheets);
  const rung = sheet?.isCompanion && !sheet.deathSaves?.dead ? companionRung(campaign, sheet, sheets) : null;
  if (!sheet || rung === null || rung < WARNING) {
    return handleDismissCompanion(campaign, rawArguments, sheets);
  }
  const setting = conscienceSetting(campaign);
  if (by === "ai") {
    const word = RUNG_WORD[rungName(rung)];
    return {
      error:
        setting === "talk"
          ? `This table keeps its companions: ${sheet.name} stays whatever their conscience says (at their ${word} now), and says so bitterly. Play that. If a player sends them away, the party lead does it from ${sheet.name}'s card in the Party panel.`
          : `${sheet.name} is at their ${word}, and whether they leave over what the party did is the server's: at their breaking point it decides, and a result or GAME STATE tells you. Play the rung. If a player sends them away, the party lead does it from ${sheet.name}'s card in the Party panel, and the server keeps how they went.`,
      refused: "rules",
    };
  }
  if (setting === "talk") {
    return handleDismissCompanion(campaign, rawArguments, sheets);
  }
  const outcome = sendAway(campaign, sheet);
  const note = [
    `${sheet.name} is out of the party, sent away; the server keeps their sheet and how they went. Narrate the parting.`,
    outcome.caresFor?.length ? `They still care for ${outcome.caresFor.join(" and ")}.` : "",
    outcome.avenging ? "They mean to come back with help; the server tracks it." : "",
  ];
  return { ok: true, dismissed: sheet.name, departed: outcome.how, note: note.filter(Boolean).join(" ") };
}
