// Deleting a campaign takes the files only it used: its cover, its scene
// art, the WebP copies beside them, its narration folder. A picture another
// row still names (a second table's cover, a library portrait) stays, and a
// path that is not one of ours is never followed. Real encrypted throwaway
// database, test-account-deletion pattern.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-campaign-deletion-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// File cleanup looks under process.cwd()/public; point it at the temp dir
// so the test never touches the real folders.
const publicDir = path.join(dir, "public");
for (const folder of ["uploads", "generated", "generated-audio"]) {
  fs.mkdirSync(path.join(publicDir, folder), { recursive: true });
}
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { campaignFilePaths, filePathsIn } = await import("../src/lib/image-files.ts");
const { deleteCampaignWithFiles } = await import("../src/lib/campaign-deletion.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const db = getDatabase();
const now = new Date().toISOString();
const exists = (...segments) => fs.existsSync(path.join(publicDir, ...segments));
function write(...segments) {
  fs.mkdirSync(path.dirname(path.join(publicDir, ...segments)), { recursive: true });
  fs.writeFileSync(path.join(publicDir, ...segments), "bytes");
}

const alice = createUser("alice", "hash");
const table = (title) => ({
  title,
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});
const doomed = createCampaign(alice.id, table("The doomed table"));
const kept = createCampaign(alice.id, table("The table that stays"));

// The doomed table's own art: a cover with its WebP copies and a scene
// picture from an image backend.
write("uploads", "doomed-cover.webp");
write("uploads", "doomed-cover.w256.webp");
write("uploads", "doomed-cover.w1024.webp");
write("generated", "1700000000000-42-comfyui-a-cave.png");
write("generated", "1700000000000-42-comfyui-a-cave.w1024.webp");
db.prepare(`UPDATE campaigns SET cover_json = ? WHERE id = ?`).run(
  JSON.stringify({ url: "/uploads/doomed-cover.webp" }),
  doomed.id,
);
db.prepare(
  `INSERT INTO campaign_messages (id, campaign_id, seq, author_type, user_id, content, generated_image_json, created_at)
   VALUES ('m1', ?, 1, 'dm', NULL, 'A cave opens.', ?, ?)`,
).run(doomed.id, JSON.stringify({ url: "/generated/1700000000000-42-comfyui-a-cave.png" }), now);

// Art the doomed table shares: the DM cover is also the other table's
// cover, and a message shows a portrait a library character still uses.
write("uploads", "shared-cover.png");
write("uploads", "library-portrait.jpg");
db.prepare(`UPDATE campaigns SET dm_cover_json = ? WHERE id = ?`).run(
  JSON.stringify({ url: "/uploads/shared-cover.png" }),
  doomed.id,
);
db.prepare(`UPDATE campaigns SET cover_json = ? WHERE id = ?`).run(
  JSON.stringify({ url: "/uploads/shared-cover.png" }),
  kept.id,
);
db.prepare(
  `INSERT INTO campaign_messages (id, campaign_id, seq, author_type, user_id, content, image_request_json, created_at)
   VALUES ('m2', ?, 2, 'dm', NULL, 'A face in the dark.', ?, ?)`,
).run(doomed.id, JSON.stringify({ url: "/uploads/library-portrait.jpg", note: "/uploads/../../secret.png" }), now);
db.prepare(
  `INSERT INTO library_characters (id, user_id, name, race, class, sheet_json, portrait_json, created_at, updated_at)
   VALUES ('lc1', ?, 'Kept', 'elf', 'wizard', '{}', ?, ?, ?)`,
).run(alice.id, JSON.stringify({ url: "/uploads/library-portrait.jpg" }), now, now);

// A picture the doomed table shows that the other table only mentions in
// the text of a message, outside any picture column.
write("generated", "1700000000001-openai-a-map.webp");
db.prepare(
  `INSERT INTO campaign_messages (id, campaign_id, seq, author_type, user_id, content, generated_image_json, image_request_json, created_at)
   VALUES ('m3', ?, 3, 'dm', NULL, 'The map.', ?, ?, ?)`,
).run(
  doomed.id,
  JSON.stringify({ url: "/generated/1700000000001-openai-a-map.webp" }),
  JSON.stringify({ fallback: "/assets/placeholders/fantasy.png" }),
  now,
);
// Built-in art the doomed table points at.
write("assets", "placeholders", "fantasy.png");
db.prepare(
  `INSERT INTO campaign_messages (id, campaign_id, seq, author_type, user_id, content, created_at)
   VALUES ('m9', ?, 1, 'player', ?, 'Same map as before: /generated/1700000000001-openai-a-map.webp', ?)`,
).run(kept.id, alice.id, now);

// Something outside the folders a crafted path would aim at.
write("secret.png");

// Narration for both tables.
write("generated-audio", doomed.id, "m1.mp3");
write("generated-audio", kept.id, "m9.mp3");

test("only our own file shapes are picked out of stored text", () => {
  assert.deepEqual(
    filePathsIn(
      JSON.stringify({
        cover: "/uploads/abc-123.png",
        scene: "/generated/170-harness-x.webp",
        pdf: "/uploads/rules.pdf",
        variant: "/uploads/abc-123.w256.webp",
        climb: "/uploads/../../etc/passwd",
        other: "https://example.com/uploads/far.png?x=1",
      }),
    ).sort(),
    ["/generated/170-harness-x.webp", "/uploads/abc-123.png", "/uploads/rules.pdf"].sort(),
  );
  assert.deepEqual(filePathsIn(null), []);
});

test("a campaign's files are gathered from its own row and its keyed rows", () => {
  assert.deepEqual(
    campaignFilePaths(doomed.id).sort(),
    [
      "/generated/1700000000000-42-comfyui-a-cave.png",
      "/generated/1700000000001-openai-a-map.webp",
      "/uploads/doomed-cover.webp",
      "/uploads/library-portrait.jpg",
      "/uploads/shared-cover.png",
    ].sort(),
  );
});

test("deleting removes the rows, the art only it used and its narration", () => {
  deleteCampaignWithFiles(doomed.id);
  assert.equal(getCampaignById(doomed.id), null);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ?`).get(doomed.id).n, 0);
  assert.equal(exists("uploads", "doomed-cover.webp"), false);
  assert.equal(exists("uploads", "doomed-cover.w256.webp"), false);
  assert.equal(exists("uploads", "doomed-cover.w1024.webp"), false);
  assert.equal(exists("generated", "1700000000000-42-comfyui-a-cave.png"), false);
  assert.equal(exists("generated", "1700000000000-42-comfyui-a-cave.w1024.webp"), false);
  assert.equal(exists("generated-audio", doomed.id), false);
});

test("art another row still names stays, and so does the other table", () => {
  assert.equal(exists("uploads", "shared-cover.png"), true);
  assert.equal(exists("uploads", "library-portrait.jpg"), true);
  // Named only in the prose of the other table's message: still kept.
  assert.equal(exists("generated", "1700000000001-openai-a-map.webp"), true);
  assert.equal(exists("generated-audio", kept.id, "m9.mp3"), true);
  assert.ok(getCampaignById(kept.id));
});

test("built-in art and a crafted path are never touched", () => {
  assert.equal(exists("assets", "placeholders", "fantasy.png"), true);
  assert.equal(exists("secret.png"), true);
});

console.log(`\n${passed} campaign-deletion tests passed.`);
removeTempDir(dir);
