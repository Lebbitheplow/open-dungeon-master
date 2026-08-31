import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import {
  deleteRollTable,
  getRollTable,
  updateRollTable,
} from "@/lib/db/roll-tables";
import {
  parseRollTable,
  TABLE_MAX_ENTRIES,
  TABLE_NAME_MAX,
} from "@/lib/dm/roll-table-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(TABLE_NAME_MAX).optional(),
  text: z.string().trim().max(20_000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; tableId: string }> },
) {
  const { campaignId, tableId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const table = getRollTable(tableId);
  // The id comes from the URL, so the campaign check is what stops one
  // table's id being used to edit another campaign's.
  if (!table || table.campaignId !== campaignId) {
    return Response.json({ error: "No such table." }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid edit." }, { status: 400 });
  }
  const entries =
    parsed.data.text === undefined
      ? undefined
      : parseRollTable(parsed.data.text).slice(0, TABLE_MAX_ENTRIES);
  if (entries && !entries.length) {
    return Response.json({ error: "No rows found in that." }, { status: 400 });
  }
  return Response.json({ table: updateRollTable(tableId, { name: parsed.data.name, entries }) });
}

export async function DELETE(
  _request: Request,
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
  deleteRollTable(tableId);
  return Response.json({ ok: true });
}
