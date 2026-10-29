// A character sheet as one seat may read it.
//
// Every number on a sheet is the table's business: hit points, slots and
// gear are what the party plans around. The notes are not. The schema says
// they "stay private to the owner" (src/lib/schemas/sheet.ts), and a sheet
// used to be published and snapshotted whole, so every client held every
// other player's notes. The rule lives here, beside the other "who sees
// what" rules in viewer.ts, and every event and the snapshot ask it. The
// same goes for whether the owner opened the character to advances from
// NPCs (issue 501): consent is the player's own business, not the table's.
// And for the player's hopes for the story: what they would love to happen
// is theirs to tell the GM, not the party.
//
// Pure by design: no "@/" value imports and no I/O.
import { isDmSeat, type DmSeats } from "./viewer";

type SheetLike = { id: string; userId: string; notes?: string; hopes?: string; openToAdvances?: boolean; openToPacts?: boolean };

// The notes are blanked rather than removed: a client reads `sheet.notes` as
// a string, and a sheet stored or sent before this rule has the same shape.
// The opt-in reads as off, which is what everyone else assumes anyway.
export function publicSheet<T extends SheetLike>(sheet: T): T {
  if (!sheet.notes && !sheet.hopes && !sheet.openToAdvances && !sheet.openToPacts) {
    return sheet;
  }
  return {
    ...sheet,
    ...(sheet.notes ? { notes: "" } : {}),
    ...(sheet.hopes ? { hopes: "" } : {}),
    ...(sheet.openToAdvances ? { openToAdvances: false } : {}),
    // So is whether a pact may approach them (issue 503 Phase 7).
    ...(sheet.openToPacts ? { openToPacts: false } : {}),
  };
}

// The owner wrote them, and whoever runs the table reads the whole sheet.
// At an AI table nobody holds a DM seat, so the notes are the owner's alone.
export function mayReadNotes(sheet: SheetLike, seats: DmSeats, userId: string): boolean {
  return sheet.userId === userId || isDmSeat(seats, userId);
}

export function sheetForViewer<T extends SheetLike>(sheet: T, seats: DmSeats, userId: string): T {
  return mayReadNotes(sheet, seats, userId) ? sheet : publicSheet(sheet);
}

// An audit row's delta repeats what the change wrote, so a correction of the
// notes (or of either opt-in) carried the new value to every seat that
// publicSheet keeps it from: the snapshot blanked the sheet's notes and
// listed them in full a few lines below. The delta is blanked the same way,
// field for field, so the log still says which fields changed. The whole row
// stays in the database, for the undo and for the seats that may read it.
const PRIVATE_SHEET_FIELDS = { notes: "", hopes: "", openToAdvances: false, openToPacts: false } as const;

type AuditLike = { characterId: string; delta: Record<string, unknown> };

export function publicAuditEntry<T extends AuditLike>(entry: T): T {
  const fields = Object.keys(PRIVATE_SHEET_FIELDS).filter((field) => field in entry.delta);
  if (!fields.length) {
    return entry;
  }
  const delta = { ...entry.delta };
  for (const field of fields) {
    delta[field] = PRIVATE_SHEET_FIELDS[field as keyof typeof PRIVATE_SHEET_FIELDS];
  }
  return { ...entry, delta };
}

// The row whole for whoever may read the character's notes: its owner (by
// the characters they hold) and the DM seats.
export function auditEntryForViewer<T extends AuditLike>(
  entry: T,
  seats: DmSeats,
  userId: string,
  ownedSheetIds: readonly string[],
): T {
  return ownedSheetIds.includes(entry.characterId) || isDmSeat(seats, userId) ? entry : publicAuditEntry(entry);
}
