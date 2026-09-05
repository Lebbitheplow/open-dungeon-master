import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getRollTable, listRollTables, markDrawn } from "@/lib/db/roll-tables";
import { insertRoll, ROLL_VISIBILITIES } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { redactRoll } from "@/lib/dm/viewer";
import {
  describeRollChain,
  dieForTable,
  entryForRoll,
  followTableRefs,
  remainingResults,
} from "@/lib/dm/roll-table-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rolling a table writes an ordinary rolls row, so it lands in the log, the
// audit trail and the dice tray like every other roll. What the table SAYS
// comes back to the DM alone: the row is theirs, and turning the result into
// something the party hears is their job.
//
// A table that draws without replacement picks among the results it has not
// handed out yet, and a row that points at another table rolls that one too
// (src/lib/dm/roll-table-logic.ts).

const rollSchema = z.object({
  visibility: z.enum(ROLL_VISIBILITIES).default("dm"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; tableId: string }> },
) {
  const { campaignId, tableId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const table = getRollTable(tableId);
  if (!table || table.campaignId !== campaignId) {
    return Response.json({ error: "No such table." }, { status: 404 });
  }
  const die = dieForTable(table.entries);
  if (die < 1) {
    return Response.json({ error: "That table has no rows to roll on." }, { status: 400 });
  }
  const parsed = rollSchema.safeParse(await request.json().catch(() => ({})));
  const visibility = parsed.success ? parsed.data.visibility : "dm";

  let total: number;
  let outcome: ReturnType<typeof rollExpression>;
  let remaining: number | null = null;
  if (table.noReplacement) {
    const left = remainingResults(table.entries, table.drawn);
    if (!left.length) {
      return Response.json(
        { error: "Every result on that table has been drawn. Reset it to deal again." },
        { status: 409 },
      );
    }
    // The die is the pile of what is left; the face it lands on picks from it.
    outcome = rollExpression(`1d${left.length}`);
    total = left[outcome.total - 1];
    markDrawn(tableId, total);
    remaining = left.length - 1;
  } else {
    outcome = rollExpression(`1d${die}`);
    total = outcome.total;
  }

  const roll = insertRoll({
    campaignId,
    requestedBy: "dm",
    kind: "custom",
    detail: table.name,
    result: outcome,
    visibility,
  });
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
    roll: roll.visibility === "public" ? roll : redactRoll(roll),
    source: "digital",
  });
  const entry = entryForRoll(table.entries, total);
  const chain = followTableRefs(
    { table: table.name, die, total, entry },
    listRollTables(campaignId),
    (sides) => rollExpression(`1d${sides}`).total,
  );
  return Response.json({
    roll,
    total,
    die,
    // Null when the roll landed in a gap the table never covered, which
    // tableGaps warns about at edit time.
    entry,
    chain: describeRollChain(chain),
    // The last step: what the whole chain finally landed on.
    final: chain[chain.length - 1]?.entry ?? null,
    remaining,
  });
}
