// The classes made in the workshop (src/lib/homebrew/class-data.ts), by id.
// The server registers every one kept (src/lib/db/homebrew.ts
// syncWorkshopClasses), the browser the ones it was sent (a table's, the
// builder's, a library character's); a sheet holding one is then read by the
// same lookups as a setting class's (src/lib/classes/index.ts
// findCustomClass, src/lib/srd/features.ts). Who may pick one is the
// catalog's to say (src/lib/characters/catalog.ts), not the engines'.
//
// Its own module, with nothing heavy behind it, so the campaign page
// registers a table's classes without loading the class tables into its
// first load (scripts/bundle-budget.json).

import type { WorkshopClass } from "@/lib/homebrew/class-data";

const WORKSHOP_CLASSES = new Map<string, WorkshopClass>();

// `replace`: the whole list (the server's, after a write); otherwise added
// to what is held (the browser's, as pages send them).
export function registerWorkshopClasses(defs: readonly WorkshopClass[], options: { replace?: boolean } = {}): void {
  if (options.replace) {
    WORKSHOP_CLASSES.clear();
  }
  for (const def of defs) {
    WORKSHOP_CLASSES.set(def.klass.id, def);
  }
}

export function workshopClassDef(id: string): WorkshopClass | null {
  return WORKSHOP_CLASSES.get(id) ?? null;
}

// The registered ones these ids name, for a page to send on.
export function workshopClassDefs(ids: readonly string[]): WorkshopClass[] {
  return [...new Set(ids)].flatMap((id) => WORKSHOP_CLASSES.get(id) ?? []);
}

// Every registered one: in the browser, the ones it was sent.
export function workshopClassList(): WorkshopClass[] {
  return [...WORKSHOP_CLASSES.values()];
}

// A workshop class's name, for a page that would otherwise show its id.
export function workshopClassName(id: string): string | null {
  return WORKSHOP_CLASSES.get(id)?.klass.name ?? null;
}
