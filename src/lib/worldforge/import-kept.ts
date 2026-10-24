import { EDITABLE_LABELS, describeValue, same, type EditableKey } from "@/lib/worldforge/entry-merge";
import { hashOf } from "@/lib/worldforge/import-merge";
import { KEPT_KEYS, typeFor, type Binding, type Entry, type FieldValue, type KeptValue, type Origin, type Shelf, type WorldDoc } from "@/lib/worldforge/model";

// What a reimport kept (audit WF-03/WF-04, journey 7 of M6): a value the
// campaign changed and the source changed too stays as the campaign has
// it, and the import's version is kept beside it on the entry's origin
// (model.ts KeptValue) until the author chooses. The entry says so, and
// offers the import's version; taking it keeps the version it replaced,
// so it can be restored. The rules:
//
//   - a reimport that finds a value changed on both sides records the
//     import's version, replacing an older one; a value the import
//     cleared is recorded as null;
//   - a reimport that finds the two sides agree, or takes the source's
//     value because the campaign never changed it, clears the record;
//   - an entry written so the value reads as the import's marks it taken,
//     with the version before the write as `mine`; written back to `mine`,
//     or to anything else, it is kept again. Taken, the value reads to the
//     next import as the source's own, so a later change there applies
//     like any other; kept again, it reads as the clash left it;
//   - "Use the import's version" that changes the value takes it, even
//     when the entry could not hold it whole (a folder or an option no
//     longer here), and says so; one that changes nothing says the
//     import's version cannot be written here;
//   - "Keep mine" (or, once taken, "Keep the import's") clears it.
//
// Only what the entry form itself writes is recorded: the entry's own
// texts, lists, type, folder, canon, links to playable records and type
// fields. A picture (it needs its file) and a lore entry's audience stay
// in the import's note alone. Pure.

const FIELD = "fields.";

export const keepsRecord = (key: string) => key.startsWith(FIELD) || (KEPT_KEYS as readonly string[]).includes(key);

type Merged = { take: Record<string, unknown>; clashes: string[]; agreed: string[] };

// An entry's kept values after a reimport merged it.
export function keptAfter(prior: Origin | undefined, merged: Merged, theirs: Record<string, unknown>): Pick<Origin, "kept"> {
  const kept: Record<string, KeptValue> = { ...(prior?.kept ?? {}) };
  for (const key of [...merged.agreed, ...Object.keys(merged.take)]) delete kept[key];
  for (const key of merged.clashes) if (keepsRecord(key)) kept[key] = { theirs: theirs[key] ?? null };
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

// The entry patch that writes `value` under `key`. A lore entry's article
// goes with its body: sent alone it would be written as the body
// (src/lib/db/world-forge.ts oneLoreText).
export function patchFor(entity: KeptEntity, key: string, value: unknown): Record<string, unknown> {
  if (key === "article" && entity.shelf === "lore") return { article: value ?? "", text: entity.text };
  if (!key.startsWith(FIELD)) return { [key]: value ?? (key === "aliases" || key === "tags" || key === "bindings" ? [] : "") };
  const fields: Record<string, FieldValue> = { ...entity.entry.fields };
  const id = key.slice(FIELD.length);
  if (value === undefined || value === null || value === "") delete fields[id];
  else fields[id] = value as FieldValue;
  return { fields };
}

const blank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
const alike = (a: unknown, b: unknown) => (blank(a) && blank(b)) || same(a, b);

// An entry's origin after a write, from what each kept key held before the
// write and holds after it. `using` is the key "Use the import's version"
// wrote (src/lib/db/world-forge.ts settleKept).
export function keptAfterWrite(origin: Origin, before: KeptEntity, after: KeptEntity, using?: string): Pick<Origin, "at" | "kept"> {
  const at = { ...origin.at };
  const kept: Record<string, KeptValue> = {};
  for (const [key, value] of Object.entries(origin.kept ?? {})) {
    const was = valueAt(before, key);
    const now = valueAt(after, key);
    if (alike(was, now)) {
      // Unchanged. Asked to use the import's version, the entry refused it.
      kept[key] = key === using && !value.taken ? { theirs: value.theirs, landed: "not" } : value;
    } else if (!value.taken && (key === using || alike(now, value.theirs))) {
      at[key] = `${hashOf(value.theirs)}.${hashOf(now)}`;
      kept[key] = {
        theirs: value.theirs,
        mine: was,
        taken: true,
        ...(origin.at[key] ? { reading: origin.at[key] } : {}),
        ...(alike(now, value.theirs) ? {} : { landed: "partly" as const }),
      };
    } else if (value.taken) {
      at[key] = value.reading ?? `${hashOf(value.theirs)}.`;
      kept[key] = { theirs: value.theirs };
    } else kept[key] = value;
  }
  return Object.keys(kept).length ? { at, kept } : { at };
}

// What the entry shows: each kept value with the name the form gives it.
// `now` is what the entry holds when the import's version did not fit
// whole. A type, a folder and links are said by their names in `shown`,
// never by their ids.
export type KeptImport = {
  key: string;
  label: string;
  theirs: unknown;
  mine?: unknown;
  taken: boolean;
  landed?: "partly" | "not";
  now?: unknown;
  shown?: { theirs: string; mine?: string; now?: string };
};

export function keptList(
  doc: Pick<WorldDoc, "types" | "folders">,
  entity: KeptEntity,
  origin: Origin | undefined,
  bindingName: (binding: Binding) => string,
): KeptImport[] {
  const named = (key: string, value: unknown): string | undefined => {
    if (key === "typeId") {
      const type = doc.types.find((entry) => entry.id === value && entry.shelf === entity.shelf) ?? (value ? undefined : typeFor(doc, entity.shelf, ""));
      return type ? describeValue(type.name) : "a type no longer in this world";
    }
    if (key === "folderId") {
      if (!value) return "no folder";
      const folder = doc.folders.find((entry) => entry.id === value);
      return folder ? describeValue(folder.name) : "a folder no longer in this world";
    }
    if (key === "bindings") return describeValue(Array.isArray(value) ? (value as Binding[]).map(bindingName) : []);
    return undefined;
  };
  return Object.entries(origin?.kept ?? {}).map(([key, value]) => {
    const now = value.landed === "partly" ? valueAt(entity, key) : undefined;
    const shown = named(key, value.theirs);
    return {
      key,
      label: key.startsWith(FIELD)
        ? typeFor(doc, entity.shelf, entity.entry.typeId).fields.find((field) => field.id === key.slice(FIELD.length))?.name ?? "A field"
        : EDITABLE_LABELS[key as EditableKey] ?? key,
      theirs: value.theirs,
      ...(value.taken ? { mine: value.mine } : {}),
      taken: Boolean(value.taken),
      ...(value.landed ? { landed: value.landed } : {}),
      ...(value.landed === "partly" ? { now } : {}),
      ...(shown === undefined
        ? {}
        : {
            shown: {
              theirs: shown,
              ...(value.taken ? { mine: named(key, value.mine) } : {}),
              ...(value.landed === "partly" ? { now: named(key, now) } : {}),
            },
          }),
    };
  });
}
