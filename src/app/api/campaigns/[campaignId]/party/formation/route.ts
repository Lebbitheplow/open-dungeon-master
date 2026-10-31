import { z } from "zod";
import { isDm, isErrorResponse, isLead, requireMember, type MemberContext } from "@/lib/campaign-api";
import { ownSheetFor } from "@/lib/character-seat";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { updateParty } from "@/lib/db/party";
import { listSheets } from "@/lib/db/sheets";
import {
  FORMATION_MAX,
  FORMATION_NOTE_MAX,
  activateFormation,
  answerFormation,
  changeFormation,
  formationProblem,
  withdrawFormation,
} from "@/lib/dm/formation-logic";
import type { PartyState } from "@/lib/dm/party-logic";
import { formationPartyIds } from "@/lib/dm/roster";
import { heroFell } from "@/lib/characters/fallen-logic";
import { publishPersisted, publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The party's travel formation (issue 230), for the table rather than only
// the DM seat: the party lead arranges it at any table (the DM seat too, where
// a person runs the game), and the players whose characters a change moves
// agree or ask for a change. It lives on the party record, so every DM turn
// reads the one in force from campaign state (src/lib/dm/formation-logic.ts).
const formationSchema = z.discriminatedUnion("do", [
  z.object({
    do: z.enum(["set", "propose"]),
    order: z.array(z.string().min(1).max(80)).min(1).max(FORMATION_MAX),
  }),
  z.object({
    do: z.literal("answer"),
    characterId: z.string().min(1).max(80),
    answer: z.enum(["agree", "change"]),
    note: z.string().max(FORMATION_NOTE_MAX).optional(),
  }),
  z.object({ do: z.enum(["activate", "withdraw"]) }),
]);

function tableLine(campaignId: string, content: string) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "system-party", content });
  publishWithSeq(campaignId, seq, "message_added", { message });
}

function names(ids: string[], nameOf: (id: string) => string): string {
  const list = ids.map(nameOf);
  return list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function arranges(context: MemberContext): boolean {
  return isLead(context) || isDm(context);
}

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = formationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Say what to change about the formation." }, { status: 400 });
  }
  const body = parsed.data;
  const sheets = listSheets(campaignId);
  const partyIds = formationPartyIds(context.campaign, sheets);
  // A hero who fell walks nowhere (issue 657). A screen loaded before they
  // fell, or an app built before this, still sends them: their place drops
  // out instead of the whole order being refused.
  if (body.do === "set" || body.do === "propose") {
    const fallen = new Set(sheets.filter(heroFell).map((sheet) => sheet.id));
    body.order = body.order.filter((id) => !fallen.has(id));
  }
  const nameOf = (id: string) => sheets.find((sheet) => sheet.id === id)?.name ?? "someone";
  const who = context.user.username;
  const now = new Date().toISOString();

  if (body.do !== "answer" && !arranges(context)) {
    return Response.json(
      { error: "Only the party lead arranges the travel formation. Ask for a change on your own character instead." },
      { status: 403 },
    );
  }

  // What the change below decided, written from inside the party update.
  const outcome: { error: string | null; line: string } = { error: null, line: "" };
  let party: PartyState | null = null;

  if (body.do === "set" || body.do === "propose") {
    const problem = formationProblem(body.order, partyIds);
    if (problem) {
      return Response.json({ error: problem }, { status: 400 });
    }
    // The players asked: those whose characters the change moves, never the
    // arranger's own characters and never an ally the DM plays.
    const askable = (moved: string[]) =>
      moved.filter((id) => {
        const sheet = sheets.find((entry) => entry.id === id);
        return Boolean(sheet && !sheet.isCompanion && sheet.userId !== context.user.id && partyIds.includes(id));
      });
    party = updateParty(campaignId, (current) => {
      const changed = changeFormation(current, body.order, body.do, { userId: context.user.id, name: who }, askable, now);
      if ("error" in changed) {
        outcome.error = changed.error;
        return current;
      }
      const { change } = changed;
      const asked = change.affected.length
        ? ` ${names(change.affected, nameOf)}: see the Party panel to agree or ask for a change.`
        : "";
      outcome.line =
        changed.status === "proposed"
          ? `${who} proposes a new travel formation.${asked} It takes effect when they agree or when ${who} makes it active; the current one holds until then.`
          : `${who} set a new travel formation.${asked}`;
      return { ...current, ...changed.party };
    });
  } else if (body.do === "answer") {
    // Only for a character of the player's own: an answer is theirs to give.
    const sheet = ownSheetFor(campaignId, context.user.id, body.characterId);
    if (!sheet) {
      return Response.json({ error: "That is not one of your characters." }, { status: 404 });
    }
    party = updateParty(campaignId, (current) => {
      const answered = answerFormation(current, sheet.id, body.answer, body.note ?? "", now);
      if ("error" in answered) {
        outcome.error = answered.error;
        return current;
      }
      const note = (body.note ?? "").trim();
      outcome.line =
        body.answer === "change"
          ? `${who} asks for a change to the travel formation for ${sheet.name}${note ? `: "${note.slice(0, FORMATION_NOTE_MAX)}"` : "."}`
          : answered.activated
            ? "Everyone the proposed travel formation moves has agreed: it is the formation now."
            : "";
      return { ...current, ...answered.party };
    });
  } else {
    party = updateParty(campaignId, (current) => {
      const next = body.do === "activate" ? activateFormation(current) : withdrawFormation(current);
      if ("error" in next) {
        outcome.error = next.error;
        return current;
      }
      outcome.line =
        body.do === "activate"
          ? `${who} made the proposed travel formation the one in force.`
          : current.formationChange?.status === "proposed"
            ? `${who} withdrew the proposed travel formation; the current one holds.`
            : "";
      return { ...current, ...next };
    });
  }

  if (outcome.error) {
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  publishPersisted(campaignId, "party_updated", { party });
  // A line on the table for the players a change asks, and for the lead when
  // one of them asks for something else. It names nobody's place: the order
  // in force is the party record's, read fresh on every DM turn.
  if (outcome.line) {
    tableLine(campaignId, outcome.line);
  }
  return Response.json({ party });
}
