import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import {
  dropAttribute,
  getAttributes,
  listAttributeRecords,
  putAttribute,
  saveAttributes,
} from "@/lib/db/entity-attributes";
import {
  adjustAttribute,
  ATTRIBUTE_TARGETS,
  ATTRIBUTE_TYPES,
  buildAttribute,
} from "@/lib/dm/attributes-logic";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Freeform attributes on NPCs, items, locations, factions, props and the
// campaign itself (src/lib/dm/attributes-logic.ts).
//
// DM-only and deliberately not an adjudication: this is the DM inventing
// bookkeeping for their own world, and a model given a "make up a new field"
// tool would use it instead of the specific ones that already exist.

const target = z.object({
  target: z.enum(ATTRIBUTE_TARGETS),
  targetId: z.string().trim().min(1).max(120),
});

const attributeSchema = z.discriminatedUnion("do", [
  target.extend({
    do: z.literal("set"),
    label: z.string().trim().min(1).max(40),
    type: z.enum(ATTRIBUTE_TYPES),
    value: z.unknown().optional(),
    max: z.number().optional(),
    group: z.string().trim().max(30).optional(),
    visible: z.boolean().optional(),
  }),
  target.extend({ do: z.literal("remove"), key: z.string().trim().min(1).max(40) }),
  target.extend({
    do: z.literal("adjust"),
    key: z.string().trim().min(1).max(40),
    delta: z.number().int().min(-100000).max(100000),
  }),
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("target");
  const id = url.searchParams.get("targetId");
  // One target's attributes when asked for, the whole campaign's shelf when
  // not, so the console can render a list without N requests.
  if (kind && id && (ATTRIBUTE_TARGETS as readonly string[]).includes(kind)) {
    return Response.json({
      attributes: getAttributes(campaignId, kind as (typeof ATTRIBUTE_TARGETS)[number], id),
    });
  }
  return Response.json({ records: listAttributeRecords(campaignId) });
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

  const parsed = attributeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say what to set, and on what." }, { status: 400 });
  }
  const body = parsed.data;

  if (body.do === "remove") {
    const attributes = dropAttribute(campaignId, body.target, body.targetId, body.key);
    publishPersisted(campaignId, "attributes_updated", {
      target: body.target,
      targetId: body.targetId,
      attributes,
    });
    return Response.json({ attributes });
  }

  if (body.do === "adjust") {
    const adjusted = adjustAttribute(
      getAttributes(campaignId, body.target, body.targetId),
      body.key,
      body.delta,
    );
    if ("error" in adjusted) {
      return Response.json({ error: adjusted.error }, { status: 409 });
    }
    saveAttributes(campaignId, body.target, body.targetId, adjusted.attributes);
    publishPersisted(campaignId, "attributes_updated", {
      target: body.target,
      targetId: body.targetId,
      attributes: adjusted.attributes,
    });
    return Response.json({ attributes: adjusted.attributes, attribute: adjusted.attribute });
  }

  const built = buildAttribute(body);
  if ("error" in built) {
    return Response.json({ error: built.error }, { status: 400 });
  }
  const stored = putAttribute(campaignId, body.target, body.targetId, built.attribute);
  if ("error" in stored) {
    return Response.json({ error: stored.error }, { status: 409 });
  }
  publishPersisted(campaignId, "attributes_updated", {
    target: body.target,
    targetId: body.targetId,
    attributes: stored.attributes,
  });
  return Response.json({ attributes: stored.attributes });
}
