import type { WorldDoc, Shelf, Entry } from "./model.ts";
import { typeFor } from "./model.ts";
import { formatField } from "./time.ts";
import { accountOf } from "./account.ts";
import { textKey } from "../language/text-logic.ts";

// Finding an entry in a big world (audit WF-24): by its name, an alias or a
// tag, as the wiki always did, and now also by a word in its texts or a
// value in its fields. A 4,000-entry world holds megabytes of text, so the
// keys are built once per world (searchIndex) and each search only reads
// them. Matching is the wiki's own: the query's key (textKey, so case and
// Unicode forms fold) found anywhere in a text's key. A name, alias or tag
// match comes first, then a field, then a text, each in the order given.
// Each hit says where it matched, with a short excerpt to show under the
// name. Pure, so the server can run it too.

export type SearchWhere = "name" | "alias" | "tag" | "field" | "text";
export type SearchHit = { ref: string; where: SearchWhere; excerpt: string };

type Searchable = { ref: string; shelf: Shelf; name: string; aliases: string[]; tags: string[]; tagline: string; text: string; entry: Entry };

type Keyed = { label: string; shown: string; key: string };
type Handle = { where: "name" | "alias" | "tag"; shown: string; key: string };
export type SearchIndex = Array<{ ref: string; handles: Handle[]; fields: Keyed[]; texts: Keyed[] }>;

const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;

export function searchIndex(doc: Pick<WorldDoc, "types" | "calendars">, entities: Searchable[]): SearchIndex {
  return entities.map((entity) => {
    const type = typeFor(doc as WorldDoc, entity.shelf, entity.entry.typeId);
    const handles: Handle[] = [
      { where: "name", shown: entity.name, key: textKey(entity.name) },
      ...[...entity.aliases, ...entity.entry.aliases].map((alias) => ({ where: "alias" as const, shown: alias, key: textKey(alias) })),
      ...entity.tags.map((tag) => ({ where: "tag" as const, shown: tag, key: textKey(tag) })),
    ];
    const fields = type.fields
      .map((def) => ({ def, text: formatField(def, entity.entry.fields[def.id], doc.calendars) }))
      .filter((field) => field.text)
      .map(({ def, text }) => ({ label: def.name, shown: text, key: textKey(text) }));
    const account = accountOf(entity);
    // A place keeps its arrival text beside its article; both are searched.
    // An excerpt is shown from the text's key: lower case, without
    // punctuation, but the words where they matched.
    const texts: Keyed[] = [
      { label: "", text: account },
      { label: "", text: entity.text && entity.text !== account ? entity.text : "" },
      { label: "", text: entity.tagline && entity.tagline !== account ? entity.tagline : "" },
      { label: "hidden truth", text: entity.entry.hiddenTruth },
      { label: "notes", text: entity.entry.notes },
    ]
      .filter((text) => text.text)
      .map(({ label, text }) => {
        const key = textKey(text);
        return { label, shown: key, key };
      });
    return { ref: entity.ref, handles, fields, texts };
  });
}

// The entries that match, best first; every entry for an empty query.
export function searchEntries(index: SearchIndex, query: string): SearchHit[] {
  const wanted = textKey(query);
  if (!wanted) return index.map((row) => ({ ref: row.ref, where: "name", excerpt: "" }));
  const ranks: SearchHit[][] = [[], [], []];
  for (const row of index) {
    const handle = row.handles.find((entry) => entry.key.includes(wanted));
    if (handle) {
      ranks[0].push({ ref: row.ref, where: handle.where, excerpt: handle.where === "name" ? "" : `${handle.where}: ${handle.shown}` });
      continue;
    }
    const field = row.fields.find((entry) => entry.key.includes(wanted));
    if (field) {
      ranks[1].push({ ref: row.ref, where: "field", excerpt: `${field.label}: ${field.shown}` });
      continue;
    }
    for (const text of row.texts) {
      const at = text.key.indexOf(wanted);
      if (at < 0) continue;
      const start = Math.max(0, at - EXCERPT_BEFORE);
      const end = Math.min(text.key.length, at + wanted.length + EXCERPT_AFTER);
      const excerpt = `${start > 0 ? "..." : ""}${text.key.slice(start, end)}${end < text.key.length ? "..." : ""}`;
      ranks[2].push({ ref: row.ref, where: "text", excerpt: text.label ? `${text.label}: ${excerpt}` : excerpt });
      break;
    }
  }
  return ranks.flat();
}
