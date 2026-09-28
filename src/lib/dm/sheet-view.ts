// A character sheet as one seat may read it.
//
// Every number on a sheet is the table's business: hit points, slots and
// gear are what the party plans around. The notes are not. The schema says
// they "stay private to the owner" (src/lib/schemas/sheet.ts), and a sheet
// used to be published and snapshotted whole, so every client held every
// other player's notes. The rule lives here, beside the other "who sees
// what" rules in viewer.ts, and every event and the snapshot ask it.
//
// Pure by design: no "@/" value imports and no I/O.
import { isDmSeat, type DmSeats } from "./viewer";

type SheetLike = { id: string; userId: string; notes?: string };

// The notes are blanked rather than removed: a client reads `sheet.notes` as
// a string, and a sheet stored or sent before this rule has the same shape.
export function publicSheet<T extends SheetLike>(sheet: T): T {
  return sheet.notes ? { ...sheet, notes: "" } : sheet;
}

// The owner wrote them, and whoever runs the table reads the whole sheet.
// At an AI table nobody holds a DM seat, so the notes are the owner's alone.
export function mayReadNotes(sheet: SheetLike, seats: DmSeats, userId: string): boolean {
  return sheet.userId === userId || isDmSeat(seats, userId);
}

export function sheetForViewer<T extends SheetLike>(sheet: T, seats: DmSeats, userId: string): T {
  return mayReadNotes(sheet, seats, userId) ? sheet : publicSheet(sheet);
}
