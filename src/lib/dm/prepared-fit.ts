import type { Campaign } from "@/lib/db/campaigns";
import { resolveEnemyRequests, type ResolvedEnemyRequest } from "@/lib/dm/encounter-spawn";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { partyLevelsFor, rosterBudget } from "@/lib/dm/party-budget";
import { scaleRoster, type RowWeight, type TemplateEnemy } from "@/lib/dm/encounter-template-logic";

// Whether a prepared fight runs for the party in front of it (issue 520).
//
// A prepared fight answers to the table's rails as any fight does: no more
// than eight combatants, no more than the table's difficulty allows. Those
// are the table's rules, not the model's: start_encounter holds a person's
// own fights to them too, and the prep readout shows them. What a prepared
// fight cannot do is meet them where it was written for another party (a
// workshop adventure for four at fifth level, played by three at third) or
// for this one before it lost a member. A DM at the table cuts such a fight
// down to the party; the storyteller cannot edit the prep, so the server
// cuts it the same way when it runs (scaleRoster), and the readout says what
// it would run. A fight whose core is beyond the party even alone is held.

export type PreparedFit =
  | { kind: "unknown"; monster: string }
  // The roster as prepared runs.
  | { kind: "fits" }
  // Cut down to `rows`, leaving out `dropped`.
  | { kind: "scaled"; rows: TemplateEnemy[]; dropped: TemplateEnemy[] }
  // Beyond the party even cut down to its strongest creature.
  | { kind: "held" };

// Each row resolved once, the way start_encounter resolves it, then judged
// against the party fighting now (src/lib/dm/party-budget.ts).
export function preparedFit(campaign: Campaign, rows: TemplateEnemy[]): PreparedFit {
  const authors = spellAuthorsFor(campaign);
  const resolved: ResolvedEnemyRequest[] = [];
  for (const row of rows) {
    const outcome = resolveEnemyRequests(campaign.gameSettings, [{ monster: row.monster, count: 1 }], authors, campaign.id);
    if (!("resolved" in outcome)) {
      return { kind: "unknown", monster: "unknownMonster" in outcome ? outcome.unknownMonster : outcome.unknownReturning };
    }
    resolved.push(outcome.resolved[0]);
  }
  const levels = partyLevelsFor(campaign);
  const byRow = new Map(rows.map((row, index) => [row.monster, resolved[index]]));
  const judge = (shaped: TemplateEnemy[]) => {
    const budget = rosterBudget(
      campaign,
      levels,
      shaped.flatMap((row) => Array.from({ length: row.count }, () => byRow.get(row.monster)!)),
    );
    return !budget.tooMany && !budget.tooDeadly;
  };
  if (judge(rows)) {
    return { kind: "fits" };
  }
  // A character fighting as itself (the companion a return is about) is
  // the point of the fight: it is never cut.
  const weights: RowWeight[] = resolved.map((entry) => ({ cr: entry.stats.cr, keep: Boolean(entry.sheetFoe) }));
  const scaled = scaleRoster(rows, weights, judge);
  if (!scaled) {
    return { kind: "held" };
  }
  // What it leaves out by the names the fight would show, not by a
  // workshop monster's "homebrew:<id>" ref.
  return { kind: "scaled", rows: scaled.rows, dropped: scaled.dropped.map((row) => ({ ...row, monster: byRow.get(row.monster)?.name ?? row.monster })) };
}
