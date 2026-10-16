// A read-only report on the lore WorldForge's canon touches (audit WF-01).
// It changes nothing; it lists what a DM may want to look at once canon holds
// lore back from players:
//
// - Now held back: lore whose world entry is not canon (draft, alternate,
//   retired) and whose audience is the table. Players read these before; they
//   no longer do until the entry is made canon.
// - Kept to the DM by an earlier import: canon lore that came from a
//   WorldForge file and is DM-only. Imports used to make every non-canon
//   entry DM-only, so an entry made canon since may still be hidden from
//   players by that, not by its author.
//
// The report writes nothing itself; opening the database runs ODM's usual
// startup checks, so run it while the server is stopped (or on a copy).
//
//   SQLITE_DB_PATH=... DB_ENCRYPTION_KEY=... node scripts/report-world-canon.mjs
//   node scripts/report-world-canon.mjs --json
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase, parseJson } = await import("../src/lib/db/core.ts");
const { readDoc, parseRef } = await import("../src/lib/worldforge/model.ts");

const db = getDatabase();
const titles = new Map(
  db.prepare(`SELECT id, title FROM campaigns`).all().map((row) => [row.id, row.title]),
);
const heldBack = [];
const keptByImport = [];

for (const row of db.prepare(`SELECT campaign_id, doc_json FROM world_forge`).all()) {
  const doc = readDoc(parseJson(row.doc_json, {}));
  for (const [ref, entry] of Object.entries(doc.entries)) {
    const parsed = parseRef(ref);
    if (parsed?.shelf !== "lore") continue;
    const lore = db.prepare(`SELECT title, visibility FROM lore_entries WHERE id = ?`).get(parsed.id);
    if (!lore) continue;
    const item = { campaign: titles.get(row.campaign_id) ?? row.campaign_id, campaignId: row.campaign_id, title: lore.title, canon: entry.canon };
    if (entry.canon !== "canon" && lore.visibility !== "dm") heldBack.push(item);
    if (entry.canon === "canon" && lore.visibility === "dm" && entry.wfId) keptByImport.push(item);
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ heldBack, keptByImport }, null, 2));
} else {
  const list = (items) => (items.length ? items.map((item) => `  ${item.campaign} · ${item.title} (${item.canon})`).join("\n") : "  none");
  console.log(`Now held back from players (not canon, written for the table): ${heldBack.length}\n${list(heldBack)}\n`);
  console.log(`Canon, DM-only, from a WorldForge file (check the author meant it): ${keptByImport.length}\n${list(keptByImport)}`);
}
