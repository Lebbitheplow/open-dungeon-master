import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { insertRollTable, listRollTables } from "@/lib/db/roll-tables";
import {
  parseRollTable,
  TABLE_MAX_ENTRIES,
  TABLE_NAME_MAX,
} from "@/lib/dm/roll-table-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM's random tables. Written by pasting rows in; the parser takes
// numbered ranges, single numbers, or bare lines (src/lib/dm/roll-table-logic.ts).
const createSchema = z.object({
  name: z.string().trim().min(1).max(TABLE_NAME_MAX),
  // The rows as typed. Parsed rather than validated field by field, because
  // the point is that a table pasted out of a book works.
  text: z.string().trim().min(1).max(20_000),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ tables: listRollTables(campaignId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "A table needs a name and some rows." }, { status: 400 });
  }
  const entries = parseRollTable(parsed.data.text).slice(0, TABLE_MAX_ENTRIES);
  if (!entries.length) {
    return Response.json({ error: "No rows found in that." }, { status: 400 });
  }
  const table = insertRollTable({
    campaignId,
    name: parsed.data.name,
    entries,
    createdByUserId: context.user.id,
  });
  return Response.json({ table }, { status: 201 });
}
