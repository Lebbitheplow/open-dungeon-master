import { getDatabase, nowIso } from "@/lib/db/core";
import { getNpcById, listNpcs, type Npc } from "@/lib/db/npcs";
import { attractionBlank, attractionJson, type Attraction } from "@/lib/attraction";
import { derivePersonality } from "@/lib/dm/npc-logic";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The person behind a lasting AI companion (#503 Phase 0.1, landed with
// issue 501). A companion's sheet carries a free-text personality brief and
// nothing a rule can read, so every deed landed at face value on them and a
// companion suitor had no warmth to break a tie with. Each lasting companion
// now has an npcs row linked by companion_sheet_id, holding personality axes
// seeded from its name and brief (derivePersonality: deterministic, no model
// call) and who it is drawn to. The row outlives the sheet: after a dismissal
// the relationship tools still find who they were.
//
// Guests are scene-scoped and never get one, and a creature a spell made is
// not a person. The row is made the first time anything asks, so a companion
// recruited before this existed gets one too.

type CompanionLike = Pick<CharacterSheet, "id" | "campaignId" | "name" | "isCompanion" | "companionKind" | "personality" | "gender"> & {
  attraction?: Attraction;
  summon?: CharacterSheet["summon"];
};

export function lastingCompanion(sheet: CompanionLike): boolean {
  return sheet.isCompanion && sheet.companionKind !== "guest" && !sheet.summon;
}

export function companionNpcFor(sheet: CompanionLike): Npc | null {
  if (!lastingCompanion(sheet)) {
    return null;
  }
  const db = getDatabase();
  const linked = db
    .prepare(`SELECT id FROM npcs WHERE campaign_id = ? AND companion_sheet_id = ?`)
    .get(sheet.campaignId, sheet.id) as { id: string } | undefined;
  if (linked) {
    return getNpcById(linked.id);
  }
  // An NPC the party already knew who joins them is the same person, and a
  // companion written back in after leaving picks up the row they left.
  const named = listNpcs(sheet.campaignId).find((npc) => textKey(npc.name) === textKey(sheet.name));
  const now = nowIso();
  if (named) {
    db.prepare(
      `UPDATE npcs SET companion_sheet_id = ?, attitude = 'friendly',
         gender = CASE WHEN gender = '' THEN ? ELSE gender END,
         attraction_json = CASE WHEN attraction_json = '' THEN ? ELSE attraction_json END,
         personality_json = CASE WHEN personality_json = '' THEN ? ELSE personality_json END,
         updated_at = ?
       WHERE id = ?`,
    ).run(
      sheet.id,
      sheet.gender ?? "",
      attractionJson(sheet.attraction),
      JSON.stringify(derivePersonality(sheet.name, "friendly", sheet.personality ?? "")),
      now,
      named.id,
    );
    return getNpcById(named.id);
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO npcs
       (id, campaign_id, name, attitude, trait, location, gender, attraction_json, personality_json,
        companion_sheet_id, last_shift_turn, created_at, updated_at)
     VALUES (?, ?, ?, 'friendly', ?, '', ?, ?, ?, ?, '', ?, ?)`,
  ).run(
    id,
    sheet.campaignId,
    sheet.name.trim(),
    (sheet.personality ?? "").trim().slice(0, 200),
    sheet.gender ?? "",
    attractionJson(sheet.attraction),
    JSON.stringify(derivePersonality(sheet.name, "friendly", sheet.personality ?? "")),
    sheet.id,
    now,
    now,
  );
  return getNpcById(id);
}

// Who a companion is drawn to: the sheet's, else what the DM set on the row
// behind it (set_npc writes the row once).
export function companionAttraction(sheet: CompanionLike, npc: Npc | null): Attraction | null {
  if (!attractionBlank(sheet.attraction)) {
    return sheet.attraction ?? null;
  }
  return npc && !attractionBlank(npc.attraction) ? npc.attraction : null;
}
