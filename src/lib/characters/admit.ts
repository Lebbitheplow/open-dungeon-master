// The one door every character sheet comes through. Each route that stores
// a sheet (the table, the library, a file, a library character entering
// play, a companion) asks here, and gets back either the sheet to store,
// with every derived value written by the server, or the list of what is
// wrong with it. The rules are src/lib/srd/sheet-legality.ts; the rows they
// are judged against are looked up by src/lib/characters/catalog.ts.
import { legalityContextsFor, type ContextInput } from "@/lib/characters/catalog";
import { spendAbilityPool, spendWealthRolls } from "@/lib/db/creation-rolls";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { legalizeSheet } from "@/lib/srd/sheet-legality";

export type Admitted =
  | {
      ok: true;
      sheet: CreateSheetInput;
      // Hit dice the server rolled for a table that rolls its hit points.
      rolledHp?: number[];
      // Call once the character is stored: the rolls it was made with are
      // spent, so the next character throws its own.
      settle: () => void;
    }
  | { ok: false; problems: string[] };

export function admitSheet(
  input: Omit<ContextInput, "sheet"> & { sheet: CreateSheetInput },
): Admitted {
  // A race id can name more than one row (src/lib/characters/catalog.ts
  // raceCandidatesFor): the sheet passes when it is legal under one of them,
  // and is otherwise told what is wrong under the first.
  const contexts = legalityContextsFor(input);
  const verdicts = contexts.map((candidate) => ({
    context: candidate,
    judged: legalizeSheet(input.sheet, candidate),
  }));
  const passed = verdicts.find((verdict) => !verdict.judged.problems.length);
  if (!passed) {
    return { ok: false, problems: verdicts[0].judged.problems };
  }
  const { context, judged } = passed;
  // Whether the scores needed the pool the server rolled: they did when the
  // same sheet does not pass without it.
  const usedPool =
    Boolean(context.abilityPool) &&
    legalizeSheet(input.sheet, { ...context, abilityPool: null, rollDie: () => 1 }).problems.length > 0;
  return {
    ok: true,
    sheet: judged.sheet,
    ...(judged.rolled?.hp ? { rolledHp: judged.rolled.hp } : {}),
    settle: () => {
      if (usedPool) {
        spendAbilityPool(input.userId);
      }
      if (input.campaign && context.wealthRoll !== null && context.wealthRoll !== undefined) {
        spendWealthRolls(input.userId, input.campaign.id);
      }
    },
  };
}

// The refusal every door answers with: the first problem as the message a
// screen shows, and the whole list for one that can show more.
export function refusal(problems: string[], status = 400): Response {
  return Response.json(
    { error: problems[0] ?? "That character is not within the rules.", problems },
    { status },
  );
}
