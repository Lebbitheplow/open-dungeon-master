// The last attack against each character, kept so a reaction can answer it.
//
// An enemy's attack is rolled and its damage applied in one call
// (src/lib/dm/enemy-attack.ts), so Shield, Uncanny Dodge, Deflect
// Missiles, Cutting Words and Protection, which the rules resolve against
// that attack, arrive after the damage has landed. Before this the tool text
// told the model to "heal the difference" or "narrate accordingly", and the
// sheet kept the full blow while the story said the attack missed.
//
// The record holds what re-resolving needs: every swing's roll (its d20
// faces, the total, the AC it met), the damage each hit rolled and its type,
// whether the attack was ranged, who made it, and the character as they
// stood before the first swing (hit points, temporary hit points, a beast
// form's pool, the death track, conditions, Relentless Endurance, and the
// concentration the hit may have broken with the effects that went with
// it). src/lib/dm/reaction-refund.ts turns a corrected outcome back into
// state from it.
//
// One record per character per campaign, replaced by the next attack. It
// answers a reaction only while it is fresh: in a fight, the same round and
// the same turn; out of one, the last ten minutes. The table is this
// module's own and is created on first use, so the schema file does not
// have to know about it; old databases simply start without records.

import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getActiveEncounter, listEnemies, turnKey } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { RollResult, Advantage } from "@/lib/dice";
import type { RollAttacker } from "@/lib/db/rolls";
import { spellMechanicsFor } from "@/lib/content";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type SwingRecord = {
  // The attack roll's total and the d20 faces it was made of.
  total: number;
  faces: number[];
  natural: number | null;
  advantage: Advantage;
  // The Armor Class it was compared against.
  vsAc: number;
  hit: boolean;
  crit: boolean;
  // Damage sent to the damage path on a hit, 0 on a miss, with the type it
  // was sent under (resistance applies there to that type) and whether the
  // swing was ranged. Absent type and ranged read the record's own.
  raw: number;
  type?: string;
  ranged?: boolean;
};

export type HolderSnapshot = {
  kind: "sheet" | "enemy";
  id: string;
  conditions: string[];
  meta: Record<string, unknown>;
};

export type VitalsSnapshot = {
  currentHp: number;
  tempHp: number;
  wildShape: CharacterSheet["wildShape"];
  conditions: string[];
  conditionMeta: CharacterSheet["conditionMeta"];
  deathSaves: CharacterSheet["deathSaves"] | null;
  relentless: { max: number; used: number } | null;
  concentratingOn: string | null;
  // The conditions the concentration spell held on every creature, so a
  // hit that is undone can put back what breaking it took away.
  held: { spell: string; names: string[]; holders: HolderSnapshot[] } | null;
};

export type LastHit = {
  characterId: string;
  encounterId: string | null;
  // The turn it landed in (turnKey), "" out of a fight.
  turn: string;
  attacker: { kind: "enemy" | "hazard"; id: string | null; name: string };
  attack: string;
  type: string;
  ranged: boolean;
  // What made the damage: an attack (with swings) or a fall.
  source: "attack" | "fall";
  swings: SwingRecord[];
  before: VitalsSnapshot;
  after: { currentHp: number; tempHp: number; beastHp: number | null };
  // The reactions already answered with it, so one cannot be taken twice.
  answered: string[];
  // When the attack began (the first swing) and when it was recorded.
  startedAt: string;
  at: string;
};

// Who rolls the recorded attack again (Protection and its kin): the enemy
// that made it; a hazard is nobody.
export function rerollAttacker(record: LastHit): RollAttacker | null {
  return record.attacker.kind === "enemy" && record.attacker.id
    ? { kind: "enemy", id: record.attacker.id, name: record.attacker.name }
    : null;
}

const ensured = new WeakSet<object>();

function db() {
  const database = getDatabase();
  if (!ensured.has(database)) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS last_hits (
        campaign_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (campaign_id, character_id)
      );
    `);
    ensured.add(database);
  }
  return database;
}

export function writeLastHit(campaignId: string, record: LastHit) {
  db()
    .prepare(
      `INSERT INTO last_hits (campaign_id, character_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (campaign_id, character_id)
       DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
    )
    .run(campaignId, record.characterId, JSON.stringify(record), record.at);
}

export function readLastHit(campaignId: string, characterId: string): LastHit | null {
  const row = db()
    .prepare(`SELECT payload_json FROM last_hits WHERE campaign_id = ? AND character_id = ?`)
    .get(campaignId, characterId) as { payload_json: string } | undefined;
  return row ? parseJson<LastHit | null>(row.payload_json, null) : null;
}

export function clearLastHit(campaignId: string, characterId: string) {
  db()
    .prepare(`DELETE FROM last_hits WHERE campaign_id = ? AND character_id = ?`)
    .run(campaignId, characterId);
}

const FRESH_MS = 10 * 60 * 1000;

// The record a reaction may still answer, or null: the same encounter, and
// in a fight the same round and turn; out of one, the last ten minutes.
export function freshLastHit(campaignId: string, characterId: string): LastHit | null {
  const record = readLastHit(campaignId, characterId);
  if (!record) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  if ((encounter?.id ?? null) !== record.encounterId) {
    return null;
  }
  if (encounter) {
    return turnKey(encounter) === record.turn ? record : null;
  }
  return Date.now() - Date.parse(record.at) <= FRESH_MS ? record : null;
}

function concentrationHeld(
  campaignId: string,
  sheet: CharacterSheet,
): VitalsSnapshot["held"] {
  const spell = sheet.concentratingOn;
  if (!spell) {
    return null;
  }
  const resolved = spellMechanicsFor({ spell, userId: sheet.userId });
  const names = [
    resolved?.mech.buff?.condition,
    ...(resolved?.mech.buff?.variants ?? []),
    resolved?.mech.condition?.name,
  ]
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
  if (!names.length) {
    return { spell, names, holders: [] };
  }
  const holders: HolderSnapshot[] = [];
  for (const other of listSheets(campaignId)) {
    if (other.conditions.some((entry) => names.includes(entry.toLowerCase()))) {
      holders.push({ kind: "sheet", id: other.id, conditions: other.conditions, meta: other.conditionMeta });
    }
  }
  const encounter = getActiveEncounter(campaignId);
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    if (enemy.conditions.some((entry) => names.includes(entry.toLowerCase()))) {
      holders.push({ kind: "enemy", id: enemy.id, conditions: enemy.conditions, meta: enemy.conditionMeta });
    }
  }
  return { spell, names, holders };
}

export function snapshotVitals(campaignId: string, sheet: CharacterSheet): VitalsSnapshot {
  const relentless = sheet.resources?.relentless_endurance ?? null;
  return {
    currentHp: sheet.currentHp,
    tempHp: sheet.tempHp,
    wildShape: sheet.wildShape ?? null,
    conditions: [...sheet.conditions],
    conditionMeta: { ...sheet.conditionMeta },
    deathSaves: sheet.deathSaves ?? null,
    relentless: relentless ? { max: relentless.max, used: relentless.used } : null,
    concentratingOn: sheet.concentratingOn ?? null,
    held: concentrationHeld(campaignId, sheet),
  };
}

// The d20 faces of an attack roll, as the dice engine stored them.
export function d20FacesOf(outcome: RollResult): number[] {
  const term = outcome.terms.find((entry) => entry.kind === "dice" && entry.sides === 20);
  return term && term.kind === "dice" ? term.dice.map((die) => die.value) : [];
}

// Opened before an attack's first swing and closed after its last, by the
// code that rolled it (enemy-attack.ts, opportunity.ts):
//
//   const hitLog = openLastHit(campaign.id, target.id);
//   hitLog.swing(hitOutcome, vsAc, { hit, crit, raw, advantage });
//   hitLog.close({ attacker, attack, type, ranged });
export function openLastHit(campaignId: string, characterId: string) {
  const sheet = getSheetById(characterId);
  const before = sheet ? snapshotVitals(campaignId, sheet) : null;
  const startedAt = nowIso();
  const swings: SwingRecord[] = [];
  return {
    swing(
      outcome: RollResult,
      vsAc: number,
      result: {
        hit: boolean;
        crit: boolean;
        raw: number;
        advantage: Advantage;
        type?: string;
        ranged?: boolean;
      },
    ) {
      swings.push({
        total: outcome.total,
        faces: d20FacesOf(outcome),
        natural: outcome.natural ?? null,
        advantage: result.advantage,
        vsAc,
        hit: result.hit,
        crit: result.crit,
        raw: result.hit ? Math.max(0, result.raw) : 0,
        ...(result.type !== undefined ? { type: result.type } : {}),
        ...(result.ranged !== undefined ? { ranged: result.ranged } : {}),
      });
    },
    close(what: {
      attacker: LastHit["attacker"];
      attack: string;
      type: string;
      ranged: boolean;
      source?: LastHit["source"];
    }) {
      const now = getSheetById(characterId);
      if (!before || !now) {
        return;
      }
      const encounter = getActiveEncounter(campaignId);
      writeLastHit(campaignId, {
        characterId,
        encounterId: encounter?.id ?? null,
        turn: encounter ? turnKey(encounter) : "",
        attacker: what.attacker,
        attack: what.attack,
        type: what.type,
        ranged: what.ranged,
        source: what.source ?? "attack",
        swings,
        before,
        after: {
          currentHp: now.currentHp,
          tempHp: now.tempHp,
          beastHp: now.wildShape?.beastHp ?? null,
        },
        answered: [],
        startedAt,
        at: nowIso(),
      });
    },
  };
}

// A fall, kept the same way so Slow Fall and Feather Fall can answer it:
// one "swing" that always hits for the rolled falling damage.
export function recordFall(
  campaignId: string,
  characterId: string,
  before: VitalsSnapshot,
  raw: number,
  startedAt: string,
) {
  const now = getSheetById(characterId);
  if (!now) {
    return;
  }
  const encounter = getActiveEncounter(campaignId);
  writeLastHit(campaignId, {
    characterId,
    encounterId: encounter?.id ?? null,
    turn: encounter ? turnKey(encounter) : "",
    attacker: { kind: "hazard", id: null, name: "the fall" },
    attack: "falling",
    type: "bludgeoning",
    ranged: false,
    source: "fall",
    swings: [{ total: 0, faces: [], natural: null, advantage: "none", vsAc: 0, hit: true, crit: false, raw }],
    before,
    after: { currentHp: now.currentHp, tempHp: now.tempHp, beastHp: now.wildShape?.beastHp ?? null },
    answered: [],
    startedAt,
    at: nowIso(),
  });
}

// Opened before a fall's damage lands and closed after, by the falling
// hazard (src/lib/dm/hazard-tools.ts).
export function openFall(campaignId: string, characterId: string) {
  const sheet = getSheetById(characterId);
  const before = sheet ? snapshotVitals(campaignId, sheet) : null;
  const startedAt = nowIso();
  return {
    close(raw: number) {
      if (before) {
        recordFall(campaignId, characterId, before, raw, startedAt);
      }
    },
  };
}
