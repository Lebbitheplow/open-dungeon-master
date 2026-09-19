import { normalizeLegendaryState, type LegendaryState } from "@/lib/dm/legendary-logic";
import type { EncounterSummary } from "@/lib/dm/encounter-summary";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import type { ConditionMetaMap } from "@/lib/schemas/sheet";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { normalizeIntents, type EncounterIntents } from "@/lib/db/encounter-intents";

// Server-authoritative combat state. Enemy HP lives here and changes ONLY
// through the encounter tools; the AI DM narrates from tool results, never
// from imagination. Nothing in this file is client-safe: what a player is
// allowed to know is src/lib/db/encounter-view.ts, which carries vague
// health states and no numbers.

export type OrderEntry =
  | { kind: "pc"; characterId: string; userId: string; name: string; initiative: number }
  | { kind: "enemy"; enemyId: string; name: string; initiative: number }
  // A slot a human DM added by hand: an allied captain, a neutral bystander,
  // a swarm counted as one thing. It has no stat block and no hit points
  // because the DM is running it out of their own notes; the engine treats
  // it exactly as it treats an enemy slot, which is to say it walks past it
  // and lets the DM narrate. Only src/lib/dm/initiative-edit.ts creates one.
  | { kind: "npc"; npcId: string; name: string; initiative: number };

// The id that identifies an order entry, whichever kind it is. Every caller
// that used to write `entry.kind === "pc" ? entry.characterId : entry.enemyId`
// asks this instead, so a fourth kind would not need finding them again.
export function orderEntryId(entry: OrderEntry): string {
  if (entry.kind === "pc") {
    return entry.characterId;
  }
  return entry.kind === "enemy" ? entry.enemyId : entry.npcId;
}

export type EncounterStatus = "active" | "ended";
export type EnemyStatus = "alive" | "dead" | "fled";

// A fight, or a tactical board with nobody to fight on it. Scenes exist so a
// DM can put the party's tokens on a map outside combat; they share this
// table because battle_maps hang off an encounter id, and they are marked
// rather than inferred from "no enemies" so that getActiveEncounter keeps
// meaning "a fight is running" everywhere it is already asked.
export type EncounterKind = "fight" | "scene";

export type Encounter = {
  id: string;
  campaignId: string;
  status: EncounterStatus;
  kind: EncounterKind;
  round: number;
  turnIndex: number;
  // False while initiative entries are still being collected in `order`.
  orderReady: boolean;
  order: OrderEntry[];
  // Campaign seq when the pointer landed on the current PC; advancement
  // requires a player message from them with a later seq.
  waitingSeq: number;
  // Action economy of the combatant currently acting; null before anyone
  // has spent anything. Owned by src/lib/dm/action-budget.ts.
  turnBudget: TurnBudget | null;
  // Combatants who lose their first turn to surprise (character sheet ids
  // and enemy ids). Emptied when round 1 ends.
  surprisedIds: string[];
  // Enemies that have spent their reaction this round (src/lib/dm/opportunity.ts).
  reactionsUsed: string[];
  // Ammunition spent in this fight, keyed "<characterId>|<inventory line>".
  // Empty unless the `ammunition` variant rule is on (src/lib/srd/ammunition.ts).
  ammoSpent: Record<string, number>;
  // Who attacked whom this round (attacker ref id to target ref ids), so
  // every client draws the same hairlines. Only meaningful while `round`
  // matches the encounter's; written by recordEncounterTarget.
  targets: { round: number; pairs: Record<string, string[]> };
  // What the DM has declared each enemy is about to do (enemy id to the
  // declared intent). Only meaningful while `round` matches the encounter's;
  // written by recordEncounterIntent (src/lib/dm/intent.ts reads it).
  intents: EncounterIntents;
  // Legendary action and resistance pools per enemy, and whether this
  // fight is in a lair (src/lib/dm/legendary-logic.ts).
  legendary: LegendaryState;
  outcome: string;
  summary: string;
  // The after-the-fight card, once the fight has ended.
  summaryCard: EncounterSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type EncounterEnemy = {
  id: string;
  encounterId: string;
  campaignId: string;
  slug: string;
  displayName: string;
  maxHp: number;
  currentHp: number;
  ac: number;
  initiative: number | null;
  status: EnemyStatus;
  cr: number;
  xp: number;
  conditions: string[];
  conditionMeta: ConditionMetaMap;
  // Spell this enemy is concentrating on, or null. Best-effort server
  // tracking (src/lib/dm/enemy-damage.ts breaks it on damage).
  concentration: string | null;
  stats: EnemyStats;
  createdAt: string;
  updatedAt: string;
};

type EncounterRow = {
  id: string;
  campaign_id: string;
  status: EncounterStatus;
  kind: EncounterKind;
  round: number;
  turn_index: number;
  order_ready: number;
  order_json: string;
  waiting_seq: number;
  turn_budget_json: string | null;
  surprised_ids_json: string | null;
  reactions_used_json: string | null;
  ammo_spent_json: string | null;
  targets_json: string | null;
  intents_json: string | null;
  outcome: string;
  summary: string;
  legendary_json: string | null;
  summary_json: string | null;
  created_at: string;
  updated_at: string;
};

type EnemyRow = {
  id: string;
  encounter_id: string;
  campaign_id: string;
  slug: string;
  display_name: string;
  max_hp: number;
  current_hp: number;
  ac: number;
  initiative: number | null;
  status: EnemyStatus;
  cr: number;
  xp: number;
  conditions_json: string;
  condition_meta_json: string | null;
  concentration: string | null;
  stat_json: string;
  created_at: string;
  updated_at: string;
};

function normalizeTargets(raw: unknown): Encounter["targets"] {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const round = typeof record.round === "number" ? record.round : 0;
  const pairs: Record<string, string[]> = {};
  const rawPairs =
    record.pairs && typeof record.pairs === "object"
      ? (record.pairs as Record<string, unknown>)
      : {};
  for (const [attacker, targets] of Object.entries(rawPairs)) {
    if (Array.isArray(targets)) {
      pairs[attacker] = targets.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return { round, pairs };
}

// One attacker naming one target this round. Kept separate from
// saveEncounter so a handler holding a stale Encounter cannot clobber it,
// and keyed by round so a new round simply supersedes the old lines.
export function recordEncounterTarget(
  encounterId: string,
  round: number,
  attackerRef: string,
  targetRef: string,
) {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT targets_json FROM encounters WHERE id = ?`)
    .get(encounterId) as { targets_json: string | null } | undefined;
  if (!row) {
    return;
  }
  const current = normalizeTargets(parseJson<unknown>(row.targets_json ?? "{}", {}));
  const pairs = current.round === round ? current.pairs : {};
  const list = pairs[attackerRef] ?? [];
  if (!list.includes(targetRef)) {
    pairs[attackerRef] = [...list, targetRef].slice(-6);
  }
  db.prepare(`UPDATE encounters SET targets_json = ? WHERE id = ?`).run(
    JSON.stringify({ round, pairs }),
    encounterId,
  );
}

function mapEncounter(row: EncounterRow): Encounter {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    status: row.status,
    kind: row.kind === "scene" ? "scene" : "fight",
    round: row.round,
    turnIndex: row.turn_index,
    orderReady: Boolean(row.order_ready),
    order: parseJson<OrderEntry[]>(row.order_json, []),
    waitingSeq: row.waiting_seq,
    turnBudget: parseJson<TurnBudget | null>(row.turn_budget_json, null),
    surprisedIds: parseJson<string[]>(row.surprised_ids_json, []),
    reactionsUsed: parseJson<string[]>(row.reactions_used_json, []),
    ammoSpent: parseJson<Record<string, number>>(row.ammo_spent_json, {}),
    targets: normalizeTargets(parseJson<unknown>(row.targets_json ?? "{}", {})),
    intents: normalizeIntents(parseJson<unknown>(row.intents_json ?? "{}", {})),
    legendary: normalizeLegendaryState(parseJson<unknown>(row.legendary_json ?? "{}", {})),
    outcome: row.outcome,
    summary: row.summary,
    summaryCard: parseJson<EncounterSummary | null>(row.summary_json ?? "null", null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEnemy(row: EnemyRow): EncounterEnemy {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    campaignId: row.campaign_id,
    slug: row.slug,
    displayName: row.display_name,
    maxHp: row.max_hp,
    currentHp: row.current_hp,
    ac: row.ac,
    initiative: row.initiative,
    status: row.status,
    cr: row.cr,
    xp: row.xp,
    conditions: parseJson<string[]>(row.conditions_json, []),
    conditionMeta: parseJson<ConditionMetaMap>(row.condition_meta_json, {}),
    concentration: row.concentration ?? null,
    stats: parseJson<EnemyStats>(row.stat_json, {
      ac: row.ac,
      maxHp: row.max_hp,
      dexMod: 0,
      speed: "30",
      attacks: [],
      traits: [],
      resist: "",
      immune: "",
      vulnerable: "",
      conditionImmune: "",
      cr: row.cr,
      xp: row.xp,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createEncounter(
  campaignId: string,
  summary: string,
  kind: EncounterKind = "fight",
): Encounter | null {
  // One board at a time, and the fight always wins it. A fight breaking out
  // on an exploration map closes the scene here rather than in each caller,
  // so two active rows can never both claim to own the battle map; a scene
  // asked for while a fight is running is refused instead, because a fight
  // is not something to quietly clear off the table.
  if (getActiveEncounter(campaignId)) {
    return null;
  }
  const scene = getActiveScene(campaignId);
  if (scene) {
    if (kind === "scene") {
      return null;
    }
    endEncounter(scene.id, "the fight began");
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO encounters (id, campaign_id, status, kind, summary, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(id, campaignId, kind, summary.slice(0, 300), now, now);
  return getEncounter(id);
}

export function getEncounter(id: string): Encounter | null {
  const row = getDatabase().prepare(`SELECT * FROM encounters WHERE id = ?`).get(id) as
    | EncounterRow
    | undefined;
  return row ? mapEncounter(row) : null;
}

// "Is a fight running?" Scenes are deliberately invisible here: every combat
// rule in the engine asks this question, and none of them should fire because
// the party is standing on an exploration map.
export function getActiveEncounter(campaignId: string): Encounter | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM encounters WHERE campaign_id = ? AND status = 'active' AND kind = 'fight'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(campaignId) as EncounterRow | undefined;
  return row ? mapEncounter(row) : null;
}

export function getActiveScene(campaignId: string): Encounter | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM encounters WHERE campaign_id = ? AND status = 'active' AND kind = 'scene'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(campaignId) as EncounterRow | undefined;
  return row ? mapEncounter(row) : null;
}

// Whatever owns the tactical board right now. Only the map layer asks this:
// the fight comes first, because createEncounter closes any scene the moment
// one starts, so the two can never both be open.
export function getActiveBoard(campaignId: string): Encounter | null {
  return getActiveEncounter(campaignId) ?? getActiveScene(campaignId);
}

export function saveEncounter(encounter: Encounter) {
  getDatabase()
    .prepare(
      `UPDATE encounters SET status = ?, round = ?, turn_index = ?, order_ready = ?,
       order_json = ?, waiting_seq = ?, turn_budget_json = ?, surprised_ids_json = ?,
       reactions_used_json = ?, ammo_spent_json = ?, legendary_json = ?, outcome = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      encounter.status,
      encounter.round,
      encounter.turnIndex,
      encounter.orderReady ? 1 : 0,
      JSON.stringify(encounter.order),
      encounter.waitingSeq,
      encounter.turnBudget ? JSON.stringify(encounter.turnBudget) : null,
      JSON.stringify(encounter.surprisedIds),
      JSON.stringify(encounter.reactionsUsed),
      JSON.stringify(encounter.ammoSpent),
      JSON.stringify(encounter.legendary),
      encounter.outcome,
      nowIso(),
      encounter.id,
    );
}

export function setEncounterSummary(encounterId: string, summary: EncounterSummary, line: string) {
  getDatabase()
    .prepare(`UPDATE encounters SET summary_json = ?, summary = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(summary), line.slice(0, 600), nowIso(), encounterId);
}

export function endEncounter(id: string, outcome: string) {
  getDatabase()
    .prepare(`UPDATE encounters SET status = 'ended', outcome = ?, updated_at = ? WHERE id = ?`)
    .run(outcome.slice(0, 60), nowIso(), id);
}

export function insertEnemy(input: {
  encounterId: string;
  campaignId: string;
  slug: string;
  displayName: string;
  initiative: number;
  stats: EnemyStats;
}): EncounterEnemy {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO encounter_enemies (
        id, encounter_id, campaign_id, slug, display_name, max_hp, current_hp,
        ac, initiative, status, cr, xp, stat_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'alive', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.encounterId,
      input.campaignId,
      input.slug,
      input.displayName.slice(0, 80),
      input.stats.maxHp,
      input.stats.maxHp,
      input.stats.ac,
      input.initiative,
      input.stats.cr,
      input.stats.xp,
      JSON.stringify(input.stats),
      now,
      now,
    );
  const enemy = getEnemy(id);
  if (!enemy) {
    throw new Error("Failed to create encounter enemy.");
  }
  return enemy;
}

export function getEnemy(id: string): EncounterEnemy | null {
  const row = getDatabase().prepare(`SELECT * FROM encounter_enemies WHERE id = ?`).get(id) as
    | EnemyRow
    | undefined;
  return row ? mapEnemy(row) : null;
}

export function listEnemies(encounterId: string): EncounterEnemy[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM encounter_enemies WHERE encounter_id = ? ORDER BY created_at ASC`)
    .all(encounterId) as EnemyRow[];
  return rows.map(mapEnemy);
}

// A prepared encounter's overrides: this one is called Snik, that one has
// 3 hit points. Written before anybody has acted, so max and current move
// together and the stat snapshot keeps the printed block.
export function patchEnemyIdentity(
  enemyId: string,
  patch: { displayName?: string; maxHp?: number },
): EncounterEnemy | null {
  const existing = getEnemy(enemyId);
  if (!existing) {
    return null;
  }
  const displayName = patch.displayName?.trim().slice(0, 80) || existing.displayName;
  const maxHp = patch.maxHp && patch.maxHp > 0 ? Math.round(patch.maxHp) : existing.maxHp;
  getDatabase()
    .prepare(
      `UPDATE encounter_enemies SET display_name = ?, max_hp = ?, current_hp = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(displayName, maxHp, maxHp, nowIso(), enemyId);
  return getEnemy(enemyId);
}

export function patchEnemyHp(
  enemyId: string,
  currentHp: number,
  status: EnemyStatus,
): EncounterEnemy | null {
  getDatabase()
    .prepare(
      `UPDATE encounter_enemies SET current_hp = ?, status = ?, updated_at = ? WHERE id = ?`,
    )
    .run(currentHp, status, nowIso(), enemyId);
  return getEnemy(enemyId);
}

export function patchEnemyConditions(
  enemyId: string,
  conditions: string[],
  conditionMeta?: ConditionMetaMap,
): EncounterEnemy | null {
  if (conditionMeta !== undefined) {
    getDatabase()
      .prepare(
        `UPDATE encounter_enemies SET conditions_json = ?, condition_meta_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(conditions.slice(0, 10)), JSON.stringify(conditionMeta), nowIso(), enemyId);
  } else {
    getDatabase()
      .prepare(`UPDATE encounter_enemies SET conditions_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(conditions.slice(0, 10)), nowIso(), enemyId);
  }
  return getEnemy(enemyId);
}

export function setEnemyConcentration(
  enemyId: string,
  spell: string | null,
): EncounterEnemy | null {
  getDatabase()
    .prepare(`UPDATE encounter_enemies SET concentration = ?, updated_at = ? WHERE id = ?`)
    .run(spell, nowIso(), enemyId);
  return getEnemy(enemyId);
}
