import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { SECRET_KINDS, SECRET_SKILLS } from "@/lib/dm/pact-logic";
import { declareSecretAction } from "@/lib/dm/pact-players";
import { tableBreakOn } from "@/lib/dm/table-break";
import { breakRefusal } from "@/lib/dm/table-break-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The /actions route's secret mode (issue 503 Phase 7): an action a player
// in a pact takes where the table does not see it. Nothing is posted to the
// transcript and no DM turn wakes; the server holds it, rolls it hidden
// (src/lib/dm/pact-players.ts declareSecretAction), and the answer goes to
// the player alone. It comes out when the pact moves or someone catches it.
const secretSchema = z.object({
  characterId: z.string().trim().min(1).max(80).optional(),
  secret: z.object({
    kind: z.enum(SECRET_KINDS),
    text: z.string().trim().max(300).default(""),
    skill: z.enum(SECRET_SKILLS).optional(),
    targetId: z.string().trim().max(80).optional(),
    item: z.string().trim().max(120).optional(),
  }),
});

export function isSecretActionBody(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && "secret" in (raw as Record<string, unknown>));
}

export function secretActionResponse(campaign: Campaign, userId: string, selected: CharacterSheet, raw: unknown): Response {
  const parsed = secretSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "A secret action needs a kind (steal, scheme, harm or attack) and what you do." }, { status: 400 });
  }
  const tableBreak = tableBreakOn(campaign.id);
  if (tableBreak) {
    return Response.json({ error: breakRefusal(tableBreak), tableBreak }, { status: 409 });
  }
  const named = parsed.data.characterId ? getSheetById(parsed.data.characterId) : null;
  const sheet = named && named.campaignId === campaign.id && named.userId === userId && !named.isCompanion ? named : selected;
  const outcome = declareSecretAction(campaign, sheet, parsed.data.secret);
  if ("error" in outcome) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json(outcome);
}
