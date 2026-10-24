import { typeFor, type Binding, type Canon, type FieldValue, type WorldDoc, type Shelf, type Entry } from "@/lib/worldforge/model";

// Two people editing one entry. The editor keeps the values it opened with
// (its base) and sends only the fields it changed, each with its base. The
// server writes a changed field when nobody else has changed it since, or
// when the other change agrees. A field both changed differently is a
// conflict: nothing is written, the editor keeps its draft, and the author
// picks per field. A type field counts on its own, so two authors filling
// different fields of one entry both keep theirs.

export type Editable = {
  name: string;
  tagline: string;
  text: string;
  article: string;
  aliases: string[];
  tags: string[];
  portrait: string;
  typeId: string;
  folderId: string;
  canon: Canon;
  hiddenTruth: string;
  notes: string;
  fields: Record<string, FieldValue>;
  bindings: Binding[];
};

export const EDITABLE_KEYS = ["name", "tagline", "text", "article", "aliases", "tags", "portrait", "typeId", "folderId", "canon", "hiddenTruth", "notes", "fields", "bindings"] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];

// One conflicting field: a top-level key, or "fields.<id>" for a type field.
export type EntryConflict = { key: string; label: string; theirs: unknown };

type EntityLike = { shelf: Shelf; name: string; tagline: string; text: string; aliases: string[]; tags: string[]; portrait: string; entry: Entry };

// What the editor shows for an entity, in the shape it saves.
export function editableOf(doc: Pick<WorldDoc, "types">, entity: EntityLike): Editable {
  return {
    name: entity.name,
    tagline: entity.tagline,
    text: entity.text,
    article: entity.entry.article,
    aliases: [...entity.aliases],
    tags: [...entity.tags],
    portrait: entity.portrait,
    typeId: typeFor(doc, entity.shelf, entity.entry.typeId).id,
    folderId: entity.entry.folderId,
    canon: entity.entry.canon,
    hiddenTruth: entity.entry.hiddenTruth,
    notes: entity.entry.notes,
    fields: { ...entity.entry.fields },
    bindings: entity.entry.bindings.map((binding) => ({ ...binding })),
  };
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!same(left[key], right[key])) return false;
  return true;
}

// What the editor sends: the fields it changed, and the base of each.
export function changesSince(base: Editable, draft: Editable): { patch: Partial<Editable>; base: Partial<Editable> } {
  const patch: Partial<Editable> = {};
  const sent: Partial<Editable> = {};
  for (const key of EDITABLE_KEYS) {
    if (same(base[key], draft[key])) continue;
    (patch as Record<string, unknown>)[key] = draft[key];
    (sent as Record<string, unknown>)[key] = base[key];
  }
  return { patch, base: sent };
}

export const EDITABLE_LABELS: Record<EditableKey, string> = {
  name: "Name",
  tagline: "One line",
  text: "Text",
  article: "Article",
  aliases: "Also called",
  tags: "Tags",
  portrait: "Picture",
  typeId: "Type",
  folderId: "Folder",
  canon: "Canon",
  hiddenTruth: "Hidden truth",
  notes: "Author's notes",
  fields: "Fields",
  bindings: "Used at the table",
};

// Checks a patch against what the entry holds now. Returns the patch to
// write, with type fields merged one by one onto the current ones, or the
// conflicts. Keys sent without a base are written as before: the callers
// that do not edit a form (painting, imports) keep their behaviour.
export function mergeAgainst(
  doc: Pick<WorldDoc, "types">,
  current: Editable,
  patch: Partial<Editable>,
  base: Partial<Editable>,
): { patch: Partial<Editable> } | { conflicts: EntryConflict[] } {
  const conflicts: EntryConflict[] = [];
  const out: Partial<Editable> = { ...patch };
  for (const key of EDITABLE_KEYS) {
    if (!(key in patch) || !(key in base)) continue;
    if (key === "fields") {
      const mine = patch.fields ?? {};
      const was = base.fields ?? {};
      const now = current.fields;
      const merged: Record<string, FieldValue> = { ...now };
      const type = doc.types.find((entry) => entry.id === (patch.typeId ?? current.typeId)) ?? doc.types.find((entry) => entry.id === current.typeId);
      for (const id of new Set([...Object.keys(mine), ...Object.keys(was)])) {
        if (same(mine[id], was[id])) continue;
        if (!same(now[id], was[id]) && !same(now[id], mine[id])) {
          conflicts.push({ key: `fields.${id}`, label: type?.fields.find((def) => def.id === id)?.name ?? id, theirs: now[id] });
          continue;
        }
        if (mine[id] === undefined) delete merged[id];
        else merged[id] = mine[id];
      }
      out.fields = merged;
      continue;
    }
    const now = current[key];
    if (!same(now, base[key]) && !same(now, patch[key])) conflicts.push({ key, label: EDITABLE_LABELS[key], theirs: now });
  }
  return conflicts.length ? { conflicts } : { patch: out };
}

// A conflicting value in words, for the editor's notice.
export function describeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "nothing";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "nothing";
  if (typeof value === "object") {
    const year = value as { year?: unknown };
    return typeof year.year === "string" && year.year ? year.year : "a value";
  }
  const text = String(value);
  return text.length > 140 ? `“${text.slice(0, 140)}…”` : `“${text}”`;
}
