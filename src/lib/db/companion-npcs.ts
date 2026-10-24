import { getDatabase, nowIso } from "@/lib/db/core";
import { getNpcById, listNpcs, type Npc } from "@/lib/db/npcs";
import { attractionBlank, attractionJson, type Attraction } from "@/lib/attraction";
import { derivePersonality } from "@/lib/dm/npc-logic";
import { defaultValues } from "@/lib/dm/companion-values-logic";
import { departedSheet, saveDepartedSheet, seedCompanionValues, type DepartedSheet } from "@/lib/db/companion-conscience";
import { companionDeparture } from "@/lib/db/companion-departures";
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
//
// Issue 503 Phase 1 adds what they hold to: values seeded once from their
// class and alignment (src/lib/dm/companion-values-logic.ts), kept on the
// row like the axes; and Phase 0.4 the sheet they left with, written as they
// are dismissed, so a return brings back the same person.

type CompanionLike = Pick<CharacterSheet, "id" | "campaignId" | "name" | "isCompanion" | "companionKind" | "personality" | "gender"> & {
  attraction?: Attraction;
  summon?: CharacterSheet["summon"];
  class?: string;
  alignment?: string;
};

export function lastingCompanion(sheet: CompanionLike): boolean {
  return sheet.isCompanion && sheet.companionKind !== "guest" && !sheet.summon;
}

export function companionNpcFor(sheet: CompanionLike): Npc | null {
  if (!lastingCompanion(sheet)) {
    return null;
  }
  const npc = linkedRow(sheet);
  if (npc) {
    seedCompanionValues(npc.id, defaultValues(sheet.class ?? "", sheet.alignment));
  }
  return npc;
}

function linkedRow(sheet: CompanionLike): Npc | null {
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

// Written as a lasting companion is dismissed, before its sheet goes: the
// sheet as it stood, so a return re-instantiates the same person rather than
// building a stranger with their name.
export function rememberDepartingSheet(sheet: CharacterSheet) {
  const npc = companionNpcFor(sheet);
  if (!npc) {
    return;
  }
  saveDepartedSheet(npc.id, { level: sheet.level, xp: sheet.xp, sheet: { ...sheet }, at: nowIso() });
}

// A companion who left and is being written back in: the row behind them,
// by the name the DM uses, with the sheet they left with. Null for anyone
// else, and for a companion still in the party.
export function departedCompanion(campaignId: string, name: string): { npc: Npc; departed: DepartedSheet } | null {
  const key = textKey(name);
  const live = new Set(
    (getDatabase().prepare(`SELECT id FROM character_sheets WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string }>).map(
      (entry) => entry.id,
    ),
  );
  for (const npc of listNpcs(campaignId)) {
    if (!npc.companionSheetId || live.has(npc.companionSheetId)) {
      continue;
    }
    // By the name the row is linked by, as companionNpcFor relinks it.
    if (textKey(npc.name) !== key) {
      continue;
    }
    const departed = departedSheet(npc.id);
    if (departed) {
      return { npc, departed };
    }
  }
  return null;
}

export function forgetDepartedSheet(npcId: string) {
  saveDepartedSheet(npcId, null);
}

// The Party panel's Gone list (issue 503): every lasting companion who has
// left this party and not come back, newest first, with how they went as
// the table saw it (their conscience's words, or a plain parting). Never a
// plan one still in the party holds; that is not here at all.
export type GoneCompanion = {
  name: string;
  how: string;
  // When they went, for ordering.
  at: string;
  portraitUrl: string;
  race: string;
  class: string;
  gender: string;
};

export function goneCompanions(campaignId: string): GoneCompanion[] {
  const live = new Set(
    (getDatabase().prepare(`SELECT id FROM character_sheets WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string }>).map(
      (entry) => entry.id,
    ),
  );
  const gone: GoneCompanion[] = [];
  for (const npc of listNpcs(campaignId)) {
    if (!npc.companionSheetId || live.has(npc.companionSheetId)) {
      continue;
    }
    const departed = departedSheet(npc.id);
    if (!departed) {
      continue;
    }
    const sheet = departed.sheet as { portrait?: { url?: unknown }; race?: unknown; class?: unknown; gender?: unknown; deathSaves?: { dead?: unknown } };
    const how = companionDeparture(npc.id).gone?.how ?? (sheet.deathSaves?.dead === true ? "Fell" : "Left the party");
    gone.push({
      name: npc.name,
      how,
      at: departed.at,
      portraitUrl: typeof sheet.portrait?.url === "string" ? sheet.portrait.url : "",
      race: typeof sheet.race === "string" ? sheet.race : "",
      class: typeof sheet.class === "string" ? sheet.class : "",
      gender: typeof sheet.gender === "string" ? sheet.gender : "",
    });
  }
  return gone.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
