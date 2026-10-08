// Names the engine looks up are compared by Unicode case and form, never by
// SQLite's ASCII-only NOCASE/LOWER: "église" after "Église" is the same
// place, NPC, faction, relationship subject or effect. Real encrypted
// throwaway database; every lookup is also checked against a second
// campaign holding the same names, which it must never find.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-name-folding-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { getLocationByName, listLocations, upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getNpcByName, nearestNpcName, upsertNpc } = await import("../src/lib/db/npcs.ts");
const { handleSocialCheck } = await import("../src/lib/dm/social-tools.ts");
const { handleRelationshipBeat } = await import("../src/lib/dm/relationship-tools.ts");
const { beatSpec, RELATIONSHIP_BEAT_NAMES } = await import("../src/lib/dm/relationship-logic.ts");
const { findFactionByName, insertFaction } = await import("../src/lib/db/factions.ts");
const { ensureRelationship, getRelationship, listRelationshipsForSubject } = await import(
  "../src/lib/db/relationships.ts"
);
const { deleteEffectsByName, insertEffect, listEffects } = await import("../src/lib/db/active-effects.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const owner = createUser("owner", "x");
const newCampaign = (tableLanguage) =>
  createCampaign(owner.id, {
    title: "Table",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: { tableLanguage },
  });
const french = newCampaign("french");
const other = newCampaign("french");

test("a place named with another case of a non-ASCII letter is the known place", () => {
  const first = upsertCurrentLocation({ campaignId: french.id, name: "Église Saint-Martin" });
  const again = upsertCurrentLocation({ campaignId: french.id, name: "église saint-martin" });
  assert.equal(again.id, first.id);
  assert.equal(listLocations(french.id).length, 1);
  assert.equal(getLocationByName(french.id, "ÉGLISE SAINT-MARTIN").id, first.id);
  // ASCII as before.
  const mill = upsertCurrentLocation({ campaignId: french.id, name: "The Mill" });
  assert.equal(getLocationByName(french.id, "the mill").id, mill.id);
  // Accents are not folded away: a different word is a different place.
  assert.equal(getLocationByName(french.id, "eglise saint-martin"), null);
  assert.equal(getLocationByName(other.id, "Église Saint-Martin"), null);
});

test("an NPC, a faction and a relationship subject resolve across Unicode case", () => {
  const npc = upsertNpc({ campaignId: french.id, name: "Élodie" });
  assert.equal(getNpcByName(french.id, "ÉLODIE")?.id, npc.id);
  assert.equal(getNpcByName(french.id, "élodie")?.id, npc.id);
  assert.equal(getNpcByName(other.id, "Élodie"), null);
  // A canonical name wins over another NPC's alias that differs only in case.
  const sister = upsertNpc({ campaignId: french.id, name: "Odile" });
  const younger = upsertNpc({ campaignId: french.id, name: "Élodie la Jeune" });
  assert.notEqual(younger.id, sister.id);
  getDatabase().prepare("UPDATE npcs SET aliases_json = ? WHERE id = ?").run(JSON.stringify(["élodie la jeune"]), sister.id);
  assert.equal(getNpcByName(french.id, "ÉLODIE LA JEUNE")?.id, younger.id);
  assert.equal(getNpcByName(french.id, "Odile")?.id, sister.id);
  assert.equal(getNpcByName(french.id, "   "), null);

  const faction = insertFaction(french.id, { name: "La Cour des Roseaux" });
  assert.equal(findFactionByName(french.id, "LA COUR DES ROSEAUX")?.id, faction.id);
  // The loose match finds one name inside the other, so the article does
  // not matter.
  assert.equal(findFactionByName(french.id, "cour des roseaux")?.id, faction.id);
  assert.equal(findFactionByName(other.id, "La Cour des Roseaux"), null);

  const relationship = ensureRelationship({
    campaignId: french.id,
    characterId: "kara",
    characterName: "Kara",
    subjectKind: "npc",
    subjectName: "Élodie",
  });
  assert.equal(getRelationship(french.id, "kara", "ÉLODIE")?.id, relationship.id);
  assert.deepEqual(
    listRelationshipsForSubject(french.id, "élodie").map((entry) => entry.id),
    [relationship.id],
  );
  assert.equal(getRelationship(other.id, "kara", "Élodie"), null);
});

test("an effect is lifted by name whatever the case of its accented letters", () => {
  const target = { kind: "character", id: "kara" };
  const effect = (campaignId) =>
    insertEffect({
      campaignId,
      targetKind: target.kind,
      targetId: target.id,
      name: "Bénédiction",
      source: "le prêtre",
      modifiers: [],
      duration: "rounds",
      remaining: 10,
      saveAbility: "",
      saveDc: 0,
      visible: true,
    });
  effect(french.id);
  effect(other.id);
  assert.equal(deleteEffectsByName(french.id, target, "BÉNÉDICTION"), 1);
  assert.equal(listEffects(french.id, target).length, 0);
  assert.equal(listEffects(other.id, target).length, 1, "another campaign's effect stays");
});

// A name that only nearly matches is never resolved (the lead confirms it),
// but the tool that missed it names the known one, so the model can use it
// rather than register the same person twice.
test("a tool that finds no NPC by a name names the near match, from its own campaign only", () => {
  upsertNpc({ campaignId: french.id, name: "Warden" });
  upsertNpc({ campaignId: french.id, name: "Harbourmaster" });
  upsertNpc({ campaignId: other.id, name: "Gruber" });
  assert.equal(getNpcByName(french.id, "the Warden"), null);
  assert.equal(nearestNpcName(french.id, "the Warden"), "Warden");
  assert.equal(nearestNpcName(french.id, "Harbormaster"), "Harbourmaster", "a typo away");
  assert.equal(nearestNpcName(french.id, "Hans Gruber"), null, "another campaign's NPC");
  assert.equal(nearestNpcName(french.id, "Bruno"), null);

  const sheet = { id: "kara", name: "Kara" };
  const sheets = [sheet];
  const byId = new Map([[sheet.id, sheet]]);
  const social = handleSocialCheck(french, {}, JSON.stringify({ characterId: "kara", npc: "the Warden", approach: "persuade" }), sheets, byId);
  assert.equal(
    social.error,
    'No tracked NPC named "the Warden". If you mean "Warden", use that name. Someone new? Register them with set_npc or npc_reaction first.',
  );
  const beat = RELATIONSHIP_BEAT_NAMES.find((name) => beatSpec(name).track !== "romantic");
  const relation = handleRelationshipBeat(french, {}, JSON.stringify({ characterId: "kara", subject: "the Warden", beat }), sheets, byId);
  assert.match(relation.error, /named "the Warden"\. If you mean "Warden", use that name\. Someone new\? Register them with set_npc/);
  // Nothing near: the error is as it was.
  const none = handleSocialCheck(french, {}, JSON.stringify({ characterId: "kara", npc: "Bruno", approach: "persuade" }), sheets, byId);
  assert.equal(none.error, 'No tracked NPC named "Bruno". Register them with set_npc or npc_reaction first.');
});

console.log(`\n${passed} name folding tests passed`);
removeTempDir(dir);
