import { LIMITS, readSlice, type Slice, type WorldDoc } from "@/lib/worldforge/model";

// Saving a WorldForge slice as row operations rather than the whole slice
// (docs/workshop-rulebook-audit-pr169.md F16). The editor works out what it
// changed against the document it was showing (rowOps); the server applies
// that onto the stored slice row by row (applyRowOps), so two people editing
// different links, events or secrets both keep their work, and a row
// somebody else changed since the editor last saw it is refused and named
// rather than overwritten. Pure: the browser and the server run the same.

export type RowSlice = Exclude<Slice, "entries">;
export const ROW_SLICES: RowSlice[] = ["types", "links", "folders", "calendars", "events", "secrets", "stubs", "maps", "pins"];

type Row = { id: string };
// `base`: the row's hash as the editor last saw it, or null for a row the
// editor is adding.
export type RowUpsert = { row: Row; base: string | null };
export type RowRemove = { id: string; base: string };
export type SliceOps = { upsert: RowUpsert[]; remove: RowRemove[] };
export type DocOps = Partial<Record<RowSlice, SliceOps>>;

// JSON with its keys sorted, so the same row hashes the same whoever wrote it.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function rowHash(row: unknown): string {
  const text = stable(row);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${(hash >>> 0).toString(36)}:${text.length}`;
}

// What changed between the slice the editor saw and the one it wants.
export function rowOps(before: Row[], after: Row[]): SliceOps {
  const old = new Map(before.map((row) => [row.id, row]));
  const next = new Map(after.map((row) => [row.id, row]));
  const upsert: RowUpsert[] = [];
  for (const row of after) {
    const was = old.get(row.id);
    if (!was) upsert.push({ row, base: null });
    else if (rowHash(was) !== rowHash(row)) upsert.push({ row, base: rowHash(was) });
  }
  const remove: RowRemove[] = before.filter((row) => !next.has(row.id)).map((row) => ({ id: row.id, base: rowHash(row) }));
  return { upsert, remove };
}

export function docOps(before: WorldDoc, slices: Partial<Pick<WorldDoc, RowSlice>>): DocOps {
  const ops: DocOps = {};
  for (const slice of ROW_SLICES) {
    const after = slices[slice] as Row[] | undefined;
    if (!after) continue;
    const change = rowOps(before[slice] as Row[], after);
    if (change.upsert.length || change.remove.length) ops[slice] = change;
  }
  return ops;
}

const label = (slice: RowSlice, row: Record<string, unknown> | undefined, id: string) =>
  `${slice.replace(/s$/, "")} ${String(row?.name ?? row?.title ?? row?.label ?? id)}`;

// The operations onto a document, each row read through its slice's floor.
// What conflicts is left as it is and named in `conflicts`.
export function applyRowOps(doc: WorldDoc, ops: DocOps): { doc: WorldDoc; conflicts: string[] } {
  const conflicts: string[] = [];
  const out = { ...doc } as WorldDoc;
  for (const slice of ROW_SLICES) {
    const change = ops[slice];
    if (!change) continue;
    const rows = [...(doc[slice] as Row[])];
    const at = (id: string) => rows.findIndex((row) => row.id === id);
    for (const { id, base } of change.remove ?? []) {
      const index = at(id);
      if (index === -1) continue;
      if (rowHash(rows[index]) !== base) {
        conflicts.push(`The ${label(slice, rows[index] as unknown as Record<string, unknown>, id)} was changed by someone else, so it was not deleted.`);
        continue;
      }
      rows.splice(index, 1);
    }
    for (const { row, base } of change.upsert ?? []) {
      const [clean] = readSlice(slice, [row]) as unknown as Row[];
      if (!clean) continue;
      const index = at(clean.id);
      if (index === -1) {
        if (base !== null) {
          conflicts.push(`The ${label(slice, row as unknown as Record<string, unknown>, clean.id)} was deleted by someone else, so your change to it was not saved.`);
          continue;
        }
        if (rows.length >= (LIMITS as Record<string, number>)[slice]) continue;
        rows.push(clean);
      } else if (base === null || rowHash(rows[index]) === base) {
        rows[index] = clean;
      } else if (rowHash(rows[index]) !== rowHash(clean)) {
        conflicts.push(`The ${label(slice, rows[index] as unknown as Record<string, unknown>, clean.id)} was changed by someone else since you opened it; theirs was kept.`);
      }
    }
    (out as Record<RowSlice, unknown>)[slice] = readSlice(slice, rows);
  }
  return { doc: out, conflicts };
}
