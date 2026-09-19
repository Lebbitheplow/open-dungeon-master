import { getDatabase, parseJson } from "@/lib/db/core";

// Declared enemy intent as the encounter row stores it
// (docs/visual-overhaul-plan.md 5.6). A sibling of encounters.ts rather than
// part of it so that file stays readable; this one imports only the core, so
// encounters.ts may import it without a cycle.

// One declared intent as stored: refs, never token ids, so a token that is
// re-placed mid-round still carries its threat.
export type DeclaredIntent = {
  verb: string;
  verbKind?: "melee" | "ranged" | "spell" | "move" | "other";
  // character_sheets.id of the mark, or null for an intent with none.
  targetRef: string | null;
  expected: number | null;
};

export type EncounterIntents = { round: number; byActor: Record<string, DeclaredIntent> };

const INTENT_KINDS = new Set(["melee", "ranged", "spell", "move", "other"]);

export function normalizeIntents(raw: unknown): EncounterIntents {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const round = typeof record.round === "number" ? record.round : 0;
  const byActor: Record<string, DeclaredIntent> = {};
  const rawActors =
    record.byActor && typeof record.byActor === "object"
      ? (record.byActor as Record<string, unknown>)
      : {};
  for (const [actor, value] of Object.entries(rawActors)) {
    const entry = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    if (!entry || typeof entry.verb !== "string" || !entry.verb.trim()) {
      continue;
    }
    byActor[actor] = {
      verb: entry.verb,
      ...(typeof entry.verbKind === "string" && INTENT_KINDS.has(entry.verbKind)
        ? { verbKind: entry.verbKind as DeclaredIntent["verbKind"] }
        : {}),
      targetRef: typeof entry.targetRef === "string" && entry.targetRef ? entry.targetRef : null,
      expected:
        typeof entry.expected === "number" && Number.isFinite(entry.expected)
          ? entry.expected
          : null,
    };
  }
  return { round, byActor };
}

// One enemy's declared intent for this round. Its own narrow write for the
// reason recordEncounterTarget has one: a handler holding a stale Encounter
// must not clobber it. Keyed by round, so a new round supersedes the old
// declarations without anything having to clear them.
export function recordEncounterIntent(
  encounterId: string,
  round: number,
  actorRef: string,
  intent: DeclaredIntent,
) {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT intents_json FROM encounters WHERE id = ?`)
    .get(encounterId) as { intents_json: string | null } | undefined;
  if (!row) {
    return;
  }
  const current = normalizeIntents(parseJson<unknown>(row.intents_json ?? "{}", {}));
  const byActor = current.round === round ? current.byActor : {};
  byActor[actorRef] = intent;
  db.prepare(`UPDATE encounters SET intents_json = ? WHERE id = ?`).run(
    JSON.stringify({ round, byActor }),
    encounterId,
  );
}
