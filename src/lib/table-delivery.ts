// What one seat is sent of an event, live and on replay.
//
// The stream used to be one text for every member, so whatever had to stay
// with one seat had to be left out when the event was made, at every one of
// the dozens of places that publish a sheet or a roll. This module is the
// single place instead: src/lib/events.ts stores what the WHOLE table may
// read, and asks here what each listener gets. Which seats an event type is
// for at all is written down in src/lib/event-audience.ts; a type missing
// from that table is sent to nobody.
//
//   a sheet is stored and sent without its notes; the owner and the DM
//   seats are sent the sheet whole;
//   a roll made for the DM alone ("dm") or for one player ("self") is sent
//   to the seats that may read it, with its number, and to nobody else, not
//   even redacted. That is what the snapshot already did
//   (src/lib/db/rolls.ts listRollsVisibleTo), so the two now agree;
//   a blind roll is sent to everyone without its number, as before;
//   an effect whose numbers are the DM's is stored and sent without the
//   damage figure; seats allowed real enemy numbers are sent it whole. The
//   client used to strip it on arrival, which left the number on every
//   device;
//   the DM's cover is sent to everyone without the brief handed to the AI;
//   the seats that hold the story's secrets are sent it whole.
import { campaignSeats, capsFor, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getRoll } from "@/lib/db/rolls";
import { getSheetById, listSheetsForUser } from "@/lib/db/sheets";
import { mayReadNotes, publicSheet } from "@/lib/dm/sheet-view";
import { redactRoll, rollAccessFor, type RollView } from "@/lib/dm/viewer";
import { audienceOf, type SeatRight } from "@/lib/event-audience";

type Payload = Record<string, unknown>;
type SheetLike = { id: string; userId: string; notes?: string };
type RollLike = RollView & { id?: string; total?: number | null };

function asPayload(payload: unknown): Payload | null {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Payload)
    : null;
}

function sheetOf(type: string, payload: unknown): SheetLike | null {
  if (type !== "sheet_updated") {
    return null;
  }
  const sheet = asPayload(payload)?.sheet as SheetLike | undefined;
  return sheet && typeof sheet.id === "string" && typeof sheet.userId === "string" ? sheet : null;
}

function rollOf(type: string, payload: unknown): RollLike | null {
  if (type !== "roll_result") {
    return null;
  }
  const roll = asPayload(payload)?.roll as RollLike | undefined;
  return roll && typeof roll === "object" && typeof roll.visibility === "string" ? roll : null;
}

// An effect whose damage figure is the DM's (src/lib/battlemap/fx-plan.ts).
function dmNumberedFx(type: string, payload: unknown): Payload | null {
  if (type !== "fx") {
    return null;
  }
  const fx = asPayload(payload);
  return fx && fx.numbers === "dm" && typeof fx.amount === "number" ? fx : null;
}

// The DM's cover, when it carries a brief for the AI.
function coverBriefOf(type: string, payload: unknown): string | null {
  if (type !== "dm_cover_changed") {
    return null;
  }
  const cover = asPayload(asPayload(payload)?.cover);
  return cover && typeof cover.brief === "string" && cover.brief ? cover.brief : null;
}

// True for an event no seat is sent unless it may read it.
export function isSeatOnly(type: string, payload: unknown): boolean {
  const audience = audienceOf(type);
  if (!audience || audience.kind === "dm") {
    return true;
  }
  const roll = rollOf(type, payload);
  return roll !== null && (roll.visibility === "dm" || roll.visibility === "self");
}

// The payload as the whole table may hold it, which is what the log stores
// and what the fast path sends every seat.
export function tablePayload(type: string, payload: unknown): unknown {
  const sheet = sheetOf(type, payload);
  if (sheet) {
    return { ...(payload as Payload), sheet: publicSheet(sheet) };
  }
  const roll = rollOf(type, payload);
  // A caller that forgot to redact does not get to publish the number.
  if (roll && roll.visibility !== "public" && typeof roll.total === "number") {
    return {
      ...(payload as Payload),
      roll: redactRoll(roll as Parameters<typeof redactRoll>[0]),
    };
  }
  const fx = dmNumberedFx(type, payload);
  if (fx) {
    const rest = { ...fx };
    delete rest.amount;
    return rest;
  }
  if (coverBriefOf(type, payload)) {
    const cover = asPayload((payload as Payload).cover)!;
    return { ...(payload as Payload), cover: { ...cover, brief: "" } };
  }
  return payload;
}

// One listener's view of a campaign, worked out once per event and only when
// an event needs it.
export type Viewer = {
  userId: string;
  campaign: () => Campaign | null;
  owned: () => string[];
};

export function viewerFor(campaignId: string, userId: string): Viewer {
  let campaign: Campaign | null | undefined;
  let owned: string[] | undefined;
  return {
    userId,
    campaign: () => (campaign === undefined ? (campaign = getCampaignById(campaignId)) : campaign),
    owned: () => (owned ??= listSheetsForUser(campaignId, userId).map((sheet) => sheet.id)),
  };
}

function holds(viewer: Viewer | null, right: SeatRight): boolean {
  const campaign = viewer?.campaign();
  return Boolean(viewer && campaign && capsFor(campaign, viewer.userId)[right]);
}

// What `viewer` is sent of a stored event: the payload, or null for nothing.
// A null viewer is a listener nobody vouched for, who gets the table's view
// of a table event and nothing of the rest. `original` is the payload as it
// was published, when it is still at hand (live); a replay reads what the
// log left out back from the database.
export function payloadForViewer(
  type: string,
  stored: unknown,
  viewer: Viewer | null,
  original?: unknown,
): unknown | null {
  const audience = audienceOf(type);
  if (!audience) {
    return null;
  }
  if (audience.kind === "dm") {
    return holds(viewer, audience.right) ? stored : null;
  }
  if (audience.kind === "table") {
    return stored;
  }

  const roll = rollOf(type, stored);
  if (roll && isSeatOnly(type, stored)) {
    const campaign = viewer?.campaign();
    if (!viewer || !campaign) {
      return null;
    }
    const access = rollAccessFor(roll, capsFor(campaign, viewer.userId), viewer.owned());
    if (access !== "full") {
      return null;
    }
    const whole = roll.id ? getRoll(roll.id) : null;
    return whole ? { ...(stored as Payload), roll: whole } : stored;
  }

  const sheet = sheetOf(type, stored);
  if (sheet && viewer) {
    const campaign = viewer.campaign();
    if (!campaign || !mayReadNotes(sheet, campaignSeats(campaign), viewer.userId)) {
      return stored;
    }
    const whole = sheetOf(type, original) ?? getSheetById(sheet.id);
    return whole?.notes ? { ...(stored as Payload), sheet: { ...sheet, notes: whole.notes } } : stored;
  }

  // The figure rides only live: an effect is ephemeral and never replayed.
  const fx = dmNumberedFx(type, original);
  if (fx) {
    return holds(viewer, "enemyNumbers") ? fx : stored;
  }

  // Live, the brief is still on the published payload; on replay it is
  // read back from the campaign's current cover, when the stored event is
  // that cover (a cover already handed back has nothing to add).
  if (type === "dm_cover_changed" && holds(viewer, "secretStory")) {
    const cover = asPayload((stored as Payload).cover);
    const brief =
      coverBriefOf(type, original) ??
      (() => {
        const current = viewer!.campaign()?.dmCover;
        return current && cover && current.startedAt === cover.startedAt ? current.brief : null;
      })();
    if (cover && brief) {
      return { ...(stored as Payload), cover: { ...cover, brief } };
    }
  }
  return stored;
}
