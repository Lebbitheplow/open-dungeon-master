// What one seat is sent of an event, live and on replay.
//
// The stream used to be one text for every member, so whatever had to stay
// with one seat had to be left out when the event was made, at every one of
// the dozens of places that publish a sheet or a roll. This module is the
// single place instead: src/lib/events.ts stores what the WHOLE table may
// read, and asks here what each listener gets.
//
//   a sheet is stored and sent without its notes; the owner and the DM
//   seats are sent the sheet whole;
//   a roll made for the DM alone ("dm") or for one player ("self") is sent
//   to the seats that may read it, with its number, and to nobody else, not
//   even redacted. That is what the snapshot already did
//   (src/lib/db/rolls.ts listRollsVisibleTo), so the two now agree;
//   a blind roll is sent to everyone without its number, as before.
import { campaignSeats, capsFor, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getRoll } from "@/lib/db/rolls";
import { getSheetById, listSheetsForUser } from "@/lib/db/sheets";
import { mayReadNotes, publicSheet } from "@/lib/dm/sheet-view";
import { redactRoll, rollAccessFor, type RollView } from "@/lib/dm/viewer";

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

// True for an event no seat is sent unless it may read it.
export function isSeatOnly(type: string, payload: unknown): boolean {
  const roll = rollOf(type, payload);
  return roll !== null && (roll.visibility === "dm" || roll.visibility === "self");
}

// The payload as the whole table may hold it, which is what the log stores.
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

// What `viewer` is sent of a stored event: the payload, or null for nothing.
// A null viewer is a listener nobody vouched for, who gets the table's view.
// `original` is the payload as it was published, when it is still at hand
// (live); a replay reads what the log left out back from the database.
export function payloadForViewer(
  type: string,
  stored: unknown,
  viewer: Viewer | null,
  original?: unknown,
): unknown | null {
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
  return stored;
}
