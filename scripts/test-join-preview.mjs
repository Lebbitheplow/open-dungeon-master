// The invite landing page's preview: thin on purpose, and honest about
// whether a seat is actually open.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-join-preview-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { joinPreviewFor } = await import("../src/lib/join-preview.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, findCampaignByInviteCode, setCampaignCover } = await import(
  "../src/lib/db/campaigns.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const owner = createUser("preview-owner", "password-1234");
const created = createCampaign(owner.id, {
  title: "The Sunless Citadel",
  description: "A secret premise nobody outside should read.",
  theme: "",
  maxPlayers: 5,
  startingLevel: 3,
  difficulty: "normal",
});

test("a lobby table previews its shape and nothing private", () => {
  const campaign = findCampaignByInviteCode(created.inviteCode);
  const preview = joinPreviewFor(campaign);
  assert.equal(preview.title, "The Sunless Citadel");
  assert.equal(preview.status, "lobby");
  assert.equal(preview.playerCount, 1);
  assert.equal(preview.maxPlayers, 5);
  assert.equal(preview.startingLevel, 3);
  assert.equal(preview.genre, "High fantasy");
  assert.equal(
    joinPreviewFor({ ...campaign, gameSettings: { ...campaign.gameSettings, genre: "dark_fantasy" } })
      .genre,
    "Dark fantasy",
  );
  assert.equal(preview.cover, null);
  assert.equal(preview.seatOpen, true);
  assert.equal("description" in preview, false);
  assert.equal("inviteCode" in preview, false);
  assert.equal("ownerUserId" in preview, false);
});

test("the cover rides along as a bare url", () => {
  assert.equal(setCampaignCover(created.id, { id: "c1", url: "/uploads/c1.png" }), true);
  const preview = joinPreviewFor(findCampaignByInviteCode(created.inviteCode));
  assert.deepEqual(preview.cover, { url: "/uploads/c1.png" });
});

test("an active table only has a seat when mid-game joining is open", () => {
  const campaign = findCampaignByInviteCode(created.inviteCode);
  const active = { ...campaign, status: "active" };
  assert.equal(joinPreviewFor(active).seatOpen, false);
  assert.equal(
    joinPreviewFor({
      ...active,
      gameSettings: { ...active.gameSettings, midGameJoinOpen: true },
    }).seatOpen,
    true,
  );
  assert.equal(joinPreviewFor({ ...campaign, status: "ended" }).seatOpen, false);
});

console.log(`\n${passed} join-preview tests passed`);
removeTempDir(dir);
