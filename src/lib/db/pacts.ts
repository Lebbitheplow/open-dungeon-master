import { getDatabase, nowIso } from "@/lib/db/core";
import {
  approachArgs,
  PACT_PLANS,
  PACT_TACTICS,
  parseMembers,
  parseSecrets,
  type Pact,
  type PactMember,
  type PactPlan,
  type PactStatus,
  type PactTactic,
  type PactTrigger,
} from "@/lib/dm/pact-logic";

// The storage half of pacts (issue 503 Phases 5 and 7): one row a pact, in
// the rewind's snapshot set (src/lib/dm/rollback-logic.ts). The rules are
// src/lib/dm/pact-logic.ts. A pact is a storyteller secret
// (src/lib/dm/viewer.ts): nothing here decides who may read one; every
// reader that shows it to someone asks.

type PactRow = {
  id: string;
  campaign_id: string;
  status: string;
  leader_npc_id: string;
  plan: string;
  tactic: string;
  trigger_kind: string;
  members_json: string;
  secrets_json: string;
  notes_json: string;
  created_at: number;
  fired_at: number | null;
  how: string;
};

type Notes = { approached?: unknown; refusedBy?: unknown; toldTo?: unknown; exposed?: unknown };

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 40) : []);

function mapPact(row: PactRow): Pact {
  let notes: Notes = {};
  try {
    notes = JSON.parse(row.notes_json || "{}") as Notes;
  } catch {
    notes = {};
  }
  const trigger: PactTrigger = row.trigger_kind === "road" || row.trigger_kind === "fight" ? row.trigger_kind : "night_watch";
  return {
    id: row.id,
    campaignId: row.campaign_id,
    leaderNpcId: row.leader_npc_id,
    members: parseMembers(row.members_json),
    plan: (PACT_PLANS as readonly string[]).includes(row.plan) ? (row.plan as PactPlan) : "leave",
    tactic: (PACT_TACTICS as readonly string[]).includes(row.tactic) ? (row.tactic as PactTactic) : null,
    trigger,
    status: row.status === "fired" || row.status === "broken" ? row.status : "forming",
    approached: strings(notes.approached),
    refusedBy: strings(notes.refusedBy),
    toldTo: strings(notes.toldTo),
    exposed: notes.exposed === true,
    secrets: parseSecrets(row.secrets_json),
    createdAt: row.created_at,
    firedAt: row.fired_at,
    how: row.how,
  };
}

export function insertPact(input: {
  campaignId: string;
  leaderNpcId: string;
  members: PactMember[];
  plan: PactPlan;
  tactic: PactTactic | null;
  trigger: PactTrigger;
  createdAt: number;
}): Pact {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO pacts (id, campaign_id, status, leader_npc_id, plan, tactic, trigger_kind, members_json, created_at, updated_at)
       VALUES (?, ?, 'forming', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.campaignId, input.leaderNpcId, input.plan, input.tactic ?? "", input.trigger, JSON.stringify(input.members), input.createdAt, nowIso());
  return getPact(id)!;
}

export function getPact(id: string): Pact | null {
  const row = getDatabase().prepare(`SELECT * FROM pacts WHERE id = ?`).get(id) as PactRow | undefined;
  return row ? mapPact(row) : null;
}

export function savePact(pact: Pact): Pact {
  getDatabase()
    .prepare(
      `UPDATE pacts SET status = ?, leader_npc_id = ?, plan = ?, tactic = ?, trigger_kind = ?, members_json = ?,
         secrets_json = ?, notes_json = ?, fired_at = ?, how = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      pact.status satisfies PactStatus,
      pact.leaderNpcId,
      pact.plan,
      pact.tactic ?? "",
      pact.trigger,
      JSON.stringify(pact.members),
      JSON.stringify(pact.secrets),
      JSON.stringify({ approached: pact.approached, refusedBy: pact.refusedBy, toldTo: pact.toldTo, exposed: pact.exposed }),
      pact.firedAt,
      pact.how.slice(0, 600),
      nowIso(),
      pact.id,
    );
  return getPact(pact.id) ?? pact;
}

// The pacts still forming at a table, oldest first.
export function listFormingPacts(campaignId: string): Pact[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM pacts WHERE campaign_id = ? AND status = 'forming' ORDER BY created_at ASC, rowid ASC`)
    .all(campaignId) as PactRow[];
  return rows.map(mapPact);
}

export function listPacts(campaignId: string): Pact[] {
  const rows = getDatabase().prepare(`SELECT * FROM pacts WHERE campaign_id = ? ORDER BY created_at ASC, rowid ASC`).all(campaignId) as PactRow[];
  return rows.map(mapPact);
}

// The forming pact a companion's row, or a player's character, belongs to.
export function pactOfNpc(campaignId: string, npcId: string): Pact | null {
  return listFormingPacts(campaignId).find((pact) => pact.members.some((member) => member.kind === "companion" && member.npcId === npcId)) ?? null;
}

export function pactOfCharacter(campaignId: string, characterId: string): Pact | null {
  return listFormingPacts(campaignId).find((pact) => pact.members.some((member) => member.kind === "player" && member.characterId === characterId)) ?? null;
}

// Once per long rest (src/lib/dm/pact-logic.ts attemptAllowed): the round
// in which this companion last tried to recruit.
export function pactTriedAt(npcId: string): number | null {
  const row = getDatabase().prepare(`SELECT pact_tried_at FROM npcs WHERE id = ?`).get(npcId) as { pact_tried_at: number | null } | undefined;
  return row?.pact_tried_at ?? null;
}

export function markPactTried(npcId: string, at: number) {
  getDatabase().prepare(`UPDATE npcs SET pact_tried_at = ? WHERE id = ?`).run(at, npcId);
}

// A pact's approach left unanswered lapses as a refusal nobody else hears
// of (src/lib/db/item-proposals.ts announceLapsed).
export function approachLapsed(argsJson: string, characterName: string) {
  const args = approachArgs(argsJson);
  const pact = args ? getPact(args.pactId) : null;
  if (pact && characterName && !pact.refusedBy.includes(characterName)) {
    savePact({ ...pact, refusedBy: [...pact.refusedBy, characterName] });
  }
}
