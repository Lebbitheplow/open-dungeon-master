import { EDITABLE_LABELS, same, type EditableKey } from "@/lib/worldforge/entry-merge";
import { typeFor, type Entry, type FieldValue, type KeptValue, type Origin, type Shelf, type WorldDoc } from "@/lib/worldforge/model";

// What a reimport kept (audit WF-03/WF-04, journey 7 of M6): a value the
// campaign changed and the source changed too stays as the campaign has
// it, and the import's version is kept beside it on the entry's origin
// (model.ts KeptValue) until the author chooses. The entry says so, and
// offers the import's version; taking it keeps the version it replaced,
// so it can be restored. The rules:
//
//   - a reimport that finds a value changed on both sides records the
//     import's version, replacing an older one;
//   - a reimport that finds the two sides agree, or takes the source's
//     value because the campaign never changed it, clears the record;
//   - an entry written so the value reads as the import's marks it taken,
//     with the version before the write as `mine`; written back to `mine`,
//     it is kept again;
//   - "Keep mine" (or, once taken, "Keep the import's") clears it.
//
// Only what the entry form itself writes is recorded: the entry's own
// texts, lists, type, folder, canon, links to playable records and type
// fields. A picture (it needs its file) and a lore entry's audience stay
// in the import's note alone. Pure.

const TOP: ReadonlyArray<EditableKey> = ["name", "tagline", "text", "article", "aliases", "tags", "typeId", "folderId", "canon", "hiddenTruth", "notes", "bindings"];
const FIELD = "fields.";

export const keepsRecord = (key: string) => key.startsWith(FIELD) || (TOP as readonly string[]).includes(key);

type Merged = { take: Record<string, unknown>; clashes: string[]; agreed: string[] };

// An entry's kept values after a reimport merged it.
export function keptAfter(prior: Origin | undefined, merged: Merged, theirs: Record<string, unknown>): Pick<Origin, "kept"> {
  const kept: Record<string, KeptValue> = { ...(prior?.kept ?? {}) };
  for (const key of [...merged.agreed, ...Object.keys(merged.take)]) delete kept[key];
  for (const key of merged.clashes) if (keepsRecord(key)) kept[key] = { theirs: theirs[key] };
  return Object.keys(kept).length ? { kept } : {};
}

export type KeptEntity = { shelf: Shelf; name: string; tagline: string; text: string; aliases: string[]; tags: string[]; entry: Entry };

// The value an entry holds now under a key a merge compares.
export function valueAt(entity: KeptEntity, key: string): unknown {
  if (key.startsWith(FIELD)) return entity.entry.fields[key.slice(FIELD.length)];
  switch (key) {
    case "name":
      return entity.name;
    case "tagline":
      return entity.tagline;
    case "text":
      return entity.text;
    case "aliases":
      return entity.aliases;
    case "tags":
      return entity.tags;
    default:
      return entity.entry[key as keyof Entry];
  }
}

// The entry patch that writes `value` under `key`.
export function patchFor(entity: KeptEntity, key: string, value: unknown): Record<string, unknown> {
  if (!key.startsWith(FIELD)) return { [key]: value ?? (key === "aliases" || key === "tags" || key === "bindings" ? [] : "") };
  const fields: Record<string, FieldValue> = { ...entity.entry.fields };
  const id = key.slice(FIELD.length);
  if (value === undefined || value === null || value === "") delete fields[id];
  else fields[id] = value as FieldValue;
  return { fields };
}

const blank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
const alike = (a: unknown, b: unknown) => (blank(a) && blank(b)) || same(a, b);

// The kept values after the entry was written, from what each key held
// before the write and holds after it.
export function keptAfterWrite(kept: Record<string, KeptValue>, before: KeptEntity, after: KeptEntity): Record<string, KeptValue> {
  const next: Record<string, KeptValue> = {};
  for (const [key, value] of Object.entries(kept)) {
    const was = valueAt(before, key);
    const now = valueAt(after, key);
    if (alike(was, now)) next[key] = value;
    else if (!value.taken && alike(now, value.theirs)) next[key] = { theirs: value.theirs, mine: was, taken: true };
    else if (value.taken && alike(now, value.mine)) next[key] = { theirs: value.theirs };
    else next[key] = value.taken ? { theirs: value.theirs } : value;
  }
  return next;
}

// What the entry shows: each kept value with the name the form gives it.
export type KeptImport = { key: string; label: string; theirs: unknown; mine?: unknown; taken: boolean };

export function keptList(doc: Pick<WorldDoc, "types">, entity: KeptEntity, origin: Origin | undefined): KeptImport[] {
  return Object.entries(origin?.kept ?? {}).map(([key, value]) => ({
    key,
    label: key.startsWith(FIELD)
      ? typeFor(doc, entity.shelf, entity.entry.typeId).fields.find((field) => field.id === key.slice(FIELD.length))?.name ?? "A field"
      : EDITABLE_LABELS[key as EditableKey] ?? key,
    theirs: value.theirs,
    ...(value.taken ? { mine: value.mine } : {}),
    taken: Boolean(value.taken),
  }));
}
