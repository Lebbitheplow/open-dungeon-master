import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getRollTable } from "@/lib/db/roll-tables";
import { insertRoll, ROLL_VISIBILITIES } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { redactRoll } from "@/lib/dm/viewer";
import { dieForTable, entryForRoll } from "@/lib/dm/roll-table-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rolling a table writes an ordinary rolls row, so it lands in the log, the
// audit trail and the dice tray like every other roll. What the table SAYS
// comes back to the DM alone: the row is theirs, and turning the result into
// something the party hears is their job.
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

  const outcome = rollExpression(`1d${die}`);
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

  const entry = entryForRoll(table.entries, outcome.total);
  return Response.json({
    roll,
    total: outcome.total,
    die,
    // Null when the roll landed in a gap the table never covered, which
    // tableGaps warns about at edit time.
    entry,
  });
}
