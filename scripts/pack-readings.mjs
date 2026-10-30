// What a content pack's readers read (issue #570, "Rules and content"),
// from the readings the build stored (scripts/lib/pack-readings.mjs).
//
//   node scripts/pack-readings.mjs [pack]
//       counts per reader and document: hand-written, parsed, missing,
//       left unread, and the rules entries need that the engine lacks
//   node scripts/pack-readings.mjs [pack] --list [--kind spell]
//       [--source parsed] [--document dmag] [--unread buff] [--needs strife]
//       one line per entry that matches
//   node scripts/pack-readings.mjs --diff <older pack> [newer pack]
//       every entry whose reading or needs changed between two packs
//   node scripts/pack-readings.mjs [pack] --needs-markdown
//       the list of entries needing rules the engine lacks, as markdown
//       (docs/content-needs.md is this, written against the release pack)
//
// The pack defaults to CONTENT_DB_PATH, else data/content/open5e.sqlite.
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3-multiple-ciphers";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { NEEDS } = await import("../src/lib/content/needs-logic.ts");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const positional = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const defaultPack = process.env.CONTENT_DB_PATH || path.join(root, "data", "content", "open5e.sqlite");

function load(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  let meta;
  try {
    meta = db.prepare("SELECT value FROM pack_meta WHERE key = 'reader_revision'").get();
  } catch {
    throw new Error(`${file} has no stored readings: it was built before they were (rebuild it with node scripts/import-open5e.mjs)`);
  }
  const titles = new Map(db.prepare("SELECT slug, name FROM documents").all().map((row) => [row.slug, row.name]));
  const names = new Map();
  for (const table of ["spells", "monsters", "feats", "races", "classes", "backgrounds", "archetypes", "items"]) {
    const kind = { spells: "spell", monsters: "monster", feats: "feat", races: "race", classes: "class", backgrounds: "background", archetypes: "archetype", items: "item" }[table];
    for (const row of db.prepare(`SELECT slug, name FROM ${table}`).all()) {
      names.set(`${kind}:${row.slug}`, row.name);
    }
  }
  const needs = new Map(db.prepare("SELECT kind, slug, document_slug, needs_json FROM entry_needs").all().map((row) => [`${row.kind}:${row.slug}`, { ...row, needs: JSON.parse(row.needs_json) }]));
  const readings = db.prepare("SELECT * FROM readings ORDER BY kind, document_slug, slug").all().map((row) => ({
    ...row,
    key: `${row.kind}:${row.slug}`,
    unread: JSON.parse(row.unread_json),
    needs: needs.get(`${row.kind}:${row.slug}`)?.needs ?? [],
  }));
  db.close();
  return { file, revision: Number(meta?.value), readings, needs, titles, names };
}

if (args.includes("--diff")) {
  const [older, newer = defaultPack] = positional;
  const a = load(older);
  const b = load(newer);
  const before = new Map(a.readings.map((row) => [row.key, row]));
  const after = new Map(b.readings.map((row) => [row.key, row]));
  let changed = 0;
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const was = before.get(key);
    const now = after.get(key);
    const parts = [];
    if (!was || !now) {
      parts.push(was ? "gone" : "new");
    } else {
      if (was.source !== now.source) parts.push(`source ${was.source} -> ${now.source}`);
      if (was.mechanics_json !== now.mechanics_json) parts.push("mechanics changed");
      if (was.unread_json !== now.unread_json) parts.push(`unread [${was.unread.join(", ")}] -> [${now.unread.join(", ")}]`);
      if (JSON.stringify(was.needs) !== JSON.stringify(now.needs)) parts.push(`needs [${was.needs.join(", ")}] -> [${now.needs.join(", ")}]`);
    }
    if (parts.length) {
      changed += 1;
      const row = now ?? was;
      console.log(`${row.kind} ${row.document_slug}/${row.slug} (${(b.names.get(key) ?? a.names.get(key)) || row.slug}): ${parts.join("; ")}`);
    }
  }
  console.log(`\n${changed} entries changed between ${a.file} (readers ${a.revision}) and ${b.file} (readers ${b.revision}).`);
} else {
  const pack = load(positional[0] ?? defaultPack);
  if (args.includes("--list")) {
    const want = { kind: flag("--kind"), source: flag("--source"), document: flag("--document"), unread: flag("--unread"), needs: flag("--needs") };
    const rows = [
      ...pack.readings,
      // Items carry needs but no reading.
      ...[...pack.needs.values()].filter((row) => row.kind === "item").map((row) => ({ ...row, key: `item:${row.slug}`, source: "-", unread: [] })),
    ].filter(
      (row) =>
        (!want.kind || row.kind === want.kind) &&
        (!want.source || row.source === want.source) &&
        (!want.document || row.document_slug === want.document) &&
        (!want.unread || row.unread.includes(want.unread)) &&
        (!want.needs || row.needs.includes(want.needs)),
    );
    for (const row of rows) {
      const extra = [row.unread.length ? `unread: ${row.unread.join(", ")}` : "", row.needs.length ? `needs: ${row.needs.join(", ")}` : ""].filter(Boolean).join("; ");
      console.log(`${row.kind} ${row.document_slug}/${row.slug} (${pack.names.get(row.key) ?? row.slug}): ${row.source}${extra ? `; ${extra}` : ""}`);
    }
    console.log(`\n${rows.length} entries.`);
  } else if (args.includes("--needs-markdown")) {
    console.log(needsMarkdown(pack));
  } else {
    const byKind = new Map();
    for (const row of pack.readings) {
      const tally = byKind.get(row.kind) ?? { rows: 0, "hand-written": 0, parsed: 0, missing: 0, unread: 0, needs: 0 };
      tally.rows += 1;
      tally[row.source] += 1;
      tally.unread += row.unread.length ? 1 : 0;
      tally.needs += row.needs.length ? 1 : 0;
      byKind.set(row.kind, tally);
    }
    const items = [...pack.needs.values()].filter((row) => row.kind === "item").length;
    console.log(`Readers revision ${pack.revision}, ${pack.file}`);
    for (const [kind, tally] of byKind) {
      console.log(`  ${kind}: ${tally.rows} entries, ${tally["hand-written"]} hand-written, ${tally.parsed} parsed, ${tally.missing} missing, ${tally.unread} with text left unread, ${tally.needs} needing rules the engine lacks`);
    }
    console.log(`  item: ${items} needing rules the engine lacks`);
  }
}

// The entries that use rules the engine does not have, by rule and by
// book, for docs/content-needs.md.
function needsMarkdown(pack) {
  const KIND_NAMES = { spell: "spells", monster: "monsters", feat: "feats", race: "races", class: "classes", background: "backgrounds", archetype: "subclasses", item: "items" };
  const rows = [...pack.needs.values()];
  const rules = NEEDS.filter((need) => rows.some((row) => row.needs.includes(need)));
  const lines = [];
  for (const rule of rules) {
    const using = rows.filter((row) => row.needs.includes(rule));
    lines.push(`## ${rule[0].toUpperCase()}${rule.slice(1)} (${using.length})`, "");
    const byDocument = new Map();
    for (const row of using) {
      const list = byDocument.get(row.document_slug) ?? [];
      list.push(row);
      byDocument.set(row.document_slug, list);
    }
    for (const [document, list] of [...byDocument].sort(([a], [b]) => a.localeCompare(b))) {
      const byKind = new Map();
      for (const row of list) {
        byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), pack.names.get(`${row.kind}:${row.slug}`) ?? row.slug]);
      }
      const parts = [...byKind].map(([kind, names]) => `${KIND_NAMES[kind]} (${names.length}): ${names.sort((a, b) => a.localeCompare(b)).join(", ")}`);
      lines.push(`- **${pack.titles.get(document) ?? document}**: ${parts.join("; ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
