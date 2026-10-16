// A read-only report on lore entries that still hold two texts (audit
// WF-13). A lore entry's body is its one account now; at startup, every
// entry whose WorldForge article the body already held, or held in part as
// an import's cut copy, became one text. What is left says two different
// things, so both were kept: the wiki and the DM read the body, and the
// editor shows the other text with "Use this one instead" and "Remove it".
// This lists those entries, for a DM or an admin to look through.
//
// The report writes nothing itself; opening the database runs ODM's usual
// startup checks (the one-text repair among them), so run it while the
// server is stopped, or on a copy.
//
//   SQLITE_DB_PATH=... DB_ENCRYPTION_KEY=... node scripts/report-world-texts.mjs
//   node scripts/report-world-texts.mjs --json
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase, parseJson } = await import("../src/lib/db/core.ts");
const { readDoc, parseRef } = await import("../src/lib/worldforge/model.ts");
const { olderText } = await import("../src/lib/worldforge/account.ts");

const db = getDatabase();
const titles = new Map(db.prepare(`SELECT id, title FROM campaigns`).all().map((row) => [row.id, row.title]));
const twoTexts = [];

for (const row of db.prepare(`SELECT campaign_id, doc_json FROM world_forge`).all()) {
  const doc = readDoc(parseJson(row.doc_json, {}));
  for (const [ref, entry] of Object.entries(doc.entries)) {
    const parsed = parseRef(ref);
    if (parsed?.shelf !== "lore" || !entry.article) continue;
    const lore = db.prepare(`SELECT title, body FROM lore_entries WHERE id = ?`).get(parsed.id);
    if (!lore || !olderText({ shelf: "lore", text: lore.body, entry })) continue;
    twoTexts.push({
      campaign: titles.get(row.campaign_id) ?? row.campaign_id,
      campaignId: row.campaign_id,
      title: lore.title,
      bodyLength: lore.body.length,
      olderLength: entry.article.length,
    });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ twoTexts }, null, 2));
} else {
  const list = twoTexts.length
    ? twoTexts.map((item) => `  ${item.campaign} · ${item.title} (body ${item.bodyLength} characters, older text ${item.olderLength})`).join("\n")
    : "  none";
  console.log(`Lore entries holding two different texts, both kept for their author to choose: ${twoTexts.length}\n${list}`);
}
