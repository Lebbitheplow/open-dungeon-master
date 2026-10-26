// Handouts the model shows: GAME STATE and search_lore name a lore entry by
// its title, never its id, so show_handout takes the title; a person's
// console still sends the id, and no campaign reaches another's entries.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-handouts-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");
const { binderTools, handleShowHandout } = await import("../src/lib/dm/binder-tools.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
const live = () => getCampaignById(campaign.id);
const ai = { actor: "ai" };
const letter = insertLoreEntry({ campaignId: campaign.id, category: "history", title: "The Miller's Letter", body: "Meet me at the weir.", tags: [] });
insertLoreEntry({ campaignId: campaign.id, category: "magic", title: "The Lich's Phylactery", body: "Under the altar.", tags: [], visibility: "dm" });

test("the model shows an entry by its title, or by the ref search_lore gives it", () => {
  for (const ref of ["the miller's letter", "history: The Miller's Letter"]) {
    const out = handleShowHandout(live(), ai, JSON.stringify({ lore: ref }));
    assert.equal(out.shown, "The Miller's Letter", ref);
  }
  assert.equal(handleShowHandout(live(), ai, JSON.stringify({ lore: letter.id })).shown, "The Miller's Letter", "the console's id works");
});

test("an unknown title is refused with the entries the table may see, never the DM's secrets", () => {
  const out = handleShowHandout(live(), ai, JSON.stringify({ lore: "The Map" }));
  assert.match(out.error, /The Miller's Letter/);
  assert.doesNotMatch(out.error, /Phylactery/);
  assert.match(handleShowHandout(live(), ai, JSON.stringify({ lore: "The Lich's Phylactery" })).error, /secret/);
});

test("another campaign cannot show this one's entry by its title or its id", () => {
  const other = createCampaign(dm.id, { title: "Elsewhere", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  const byTitle = handleShowHandout(getCampaignById(other.id), ai, JSON.stringify({ lore: "The Miller's Letter" }));
  assert.match(byTitle.error, /There is none to use/, "nothing of the first campaign is listed");
  assert.ok("error" in handleShowHandout(getCampaignById(other.id), ai, JSON.stringify({ lore: letter.id })), "nor reached by its id");
});

test("the model is offered no upload path to fill: nothing it reads holds one", () => {
  const tool = binderTools.find((entry) => entry.function.name === "show_handout").function;
  assert.deepEqual(Object.keys(tool.parameters.properties), ["lore", "caption"]);
});

console.log(`test-handouts: ${passed} passed`);
