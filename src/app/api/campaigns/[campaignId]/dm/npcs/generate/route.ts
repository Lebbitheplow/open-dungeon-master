import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { GENERATABLE_FIELDS, personalityVocabulary } from "@/lib/npcs/forge";
import { suggestNpcField } from "@/lib/dm/npc-suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One field of one NPC, written by the model.
//
// Deliberately not "generate an NPC". The plan's word for what this phase
// owes is "interactive", and a form that fills itself in leaves a person
// nothing to disagree with. A DM should be able to take the model's sense of
// what somebody wants and throw away its sense of who they are, which means
// the unit of generation is the field.
//
// Nothing is written here. The suggestion goes back to the panel, which
// applies it to the draft in front of the DM; only Save writes a row.

const bodySchema = z.object({
  field: z.enum(GENERATABLE_FIELDS as unknown as [string, ...string[]]),
  // What the DM has written so far, so the suggestion fits the person on the
  // screen rather than inventing a stranger.
  name: z.string().trim().max(80).optional(),
  trait: z.string().trim().max(200).optional(),
  location: z.string().trim().max(120).optional(),
  attitude: z.string().trim().max(20).optional(),
  // A free-text steer for this one field: "make her older", "something to do
  // with the harbour".
  hint: z.string().trim().max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { text, error } = await suggestNpcField(context.campaign, {
    ...parsed.data,
    field: parsed.data.field as Parameters<typeof suggestNpcField>[1]["field"],
    // Handed to the model so a personality comes back in the vocabulary the
    // axes are built from rather than in numbers it would have to invent.
    vocabulary: personalityVocabulary(),
  });
  return error
    ? Response.json({ error }, { status: 502 })
    : Response.json({ ok: true, field: parsed.data.field, text });
}
