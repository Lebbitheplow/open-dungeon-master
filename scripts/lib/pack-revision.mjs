// The revision a content pack was built at (its SQLite user_version, written
// by scripts/import-open5e.mjs; src/lib/content/edition.ts PACK_REVISION is
// the one this code needs). A pack built before revisions existed reads 0.
import Database from "better-sqlite3-multiple-ciphers";
import { existsSync } from "node:fs";

export function packRevision(file) {
  if (!existsSync(file)) {
    return null;
  }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return Number(db.pragma("user_version", { simple: true })) || 0;
  } finally {
    db.close();
  }
}
