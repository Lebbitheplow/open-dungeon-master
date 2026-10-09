import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  MAX_BEATS,
  normalizeBeatKind,
  normalizeLinks,
  normalizeRoutes,
  type Beat,
  type BeatKind,
  type BeatLinks,
  type EdgeRoute,
} from "@/lib/workshop/board";
import type { ImportIdMap } from "@/lib/db/content-import";

// Storage for the storyboard. Rows are cards: a kind, a title, some prose,
// optional links to other things in the same workshop, and the arrows the DM
// drew between them.
//
// Nothing here decides anything. The graph, the suggestions and the compile
// are all in src/lib/workshop/board.ts and board-compile.ts, which are pure.

type BeatRow = {
  id: string;
  campaign_id: string;
  kind: BeatKind;
  title: string;
  body: string;
  links_json: string;
  edges_json: string;
  routes_json: string | null;
  x: number;
  y: number;
  created_at: string;
  updated_at: string;
};

function mapBeat(row: BeatRow): Beat {
  const edges = parseJson<string[]>(row.edges_json, []);
  return {
    id: row.id,
    kind: normalizeBeatKind(row.kind),
    title: row.title,
    body: row.body ?? "",
    links: normalizeLinks(parseJson<BeatLinks>(row.links_json, {})),
    edges,
    routes: normalizeRoutes(parseJson<unknown>(row.routes_json ?? "{}", {}), edges),
    x: row.x,
    y: row.y,
  };
}

export function listBeats(campaignId: string): Beat[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM workshop_beats WHERE campaign_id = ? ORDER BY created_at`)
    .all(campaignId) as BeatRow[];
  return rows.map(mapBeat);
}

export function getBeat(beatId: string): Beat | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM workshop_beats WHERE id = ?`)
    .get(beatId) as BeatRow | undefined;
  return row ? mapBeat(row) : null;
}

// Scoped to a campaign, so a card id from one workshop cannot be reached
// through another workshop's route. Every write path goes through this.
export function getBeatIn(campaignId: string, beatId: string): Beat | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM workshop_beats WHERE id = ? AND campaign_id = ?`)
    .get(beatId, campaignId) as BeatRow | undefined;
  return row ? mapBeat(row) : null;
}

export function countBeats(campaignId: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM workshop_beats WHERE campaign_id = ?`)
    .get(campaignId) as { n: number };
  return row.n;
}

export function insertBeat(
  campaignId: string,
  beat: Omit<Beat, "id">,
): Beat | { error: string } {
  // A board is a thinking space, not a database: past a certain size it has
  // stopped being one board and the DM wants a second workshop.
  if (countBeats(campaignId) >= MAX_BEATS) {
    return { error: `A board holds ${MAX_BEATS} cards. Split this into a second workshop.` };
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO workshop_beats
         (id, campaign_id, kind, title, body, links_json, edges_json, routes_json, x, y, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      campaignId,
      beat.kind,
      beat.title,
      beat.body,
      JSON.stringify(beat.links),
      JSON.stringify(beat.edges),
      JSON.stringify(beat.routes ?? {}),
      beat.x,
      beat.y,
      now,
      now,
    );
  return getBeat(id) as Beat;
}

export function updateBeat(
  campaignId: string,
  beatId: string,
  beat: Omit<Beat, "id">,
): Beat | null {
  if (!getBeatIn(campaignId, beatId)) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE workshop_beats SET kind = ?, title = ?, body = ?, links_json = ?,
         edges_json = ?, routes_json = ?, x = ?, y = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      beat.kind,
      beat.title,
      beat.body,
      JSON.stringify(beat.links),
      JSON.stringify(beat.edges),
      JSON.stringify(beat.routes ?? {}),
      beat.x,
      beat.y,
      nowIso(),
      beatId,
    );
  return getBeat(beatId);
}

// Deleting a card also removes every arrow pointing at it, and the route
// that arrow carried. The graph would survive without this (boardGraph drops
// edges to missing cards), but leaving them would mean the brokenEdges count
// grew every time a DM changed their mind, and a warning that fires
// constantly is a warning nobody reads.
export function deleteBeat(campaignId: string, beatId: string): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    const result = db
      .prepare(`DELETE FROM workshop_beats WHERE id = ? AND campaign_id = ?`)
      .run(beatId, campaignId);
    if (!result.changes) {
      return false;
    }
    for (const row of db
      .prepare(`SELECT id, edges_json, routes_json FROM workshop_beats WHERE campaign_id = ?`)
      .all(campaignId) as Array<{ id: string; edges_json: string; routes_json: string | null }>) {
      const edges = parseJson<string[]>(row.edges_json, []);
      if (edges.includes(beatId)) {
        const kept = edges.filter((edge) => edge !== beatId);
        db.prepare(`UPDATE workshop_beats SET edges_json = ?, routes_json = ?, updated_at = ? WHERE id = ?`).run(
          JSON.stringify(kept),
          JSON.stringify(normalizeRoutes(parseJson<unknown>(row.routes_json ?? "{}", {}), kept)),
          nowIso(),
          row.id,
        );
      }
    }
    return true;
  })();
}

// Copies a whole board into another workshop, which is what cloning one
// means. The board is the only thing a clone cannot get from
// src/lib/db/content-import.ts, because that module COMPILES a storyboard
// into lore and quests rather than copying cards; compiling is right when
// the board reaches a table and wrong when it reaches another workshop.
//
// Both kinds of pointer are rewritten through the copy: arrows (and what
// each arrow means) through the new card ids, and links through the id map
// the content import returned. A link whose target did not travel is dropped
// rather than left pointing at the original workshop's row, which the board
// would render as a card attached to somebody else's NPC. The one exception
// is a link into the shared workshop both boards draw on (#159), which
// `keepLink` vouches for: that row is the same row from either board.
const BEAT_LINK_KINDS = {
  npcId: "npcs",
  mapId: "maps",
  encounterId: "encounters",
  locationId: "locations",
} as const;

export function copyBeats(
  sourceId: string,
  targetId: string,
  idMap: ImportIdMap,
  keepLink: (kind: string, id: string) => boolean = () => false,
): number {
  const beats = listBeats(sourceId).slice(0, MAX_BEATS);
  if (!beats.length) {
    return 0;
  }
  const db = getDatabase();
  const now = nowIso();
  // Every new id up front, so an arrow between two cards that both travel
  // can be rewritten in the same pass.
  const newIds = new Map(beats.map((beat) => [beat.id, crypto.randomUUID()]));
  const insert = db.prepare(
    `INSERT INTO workshop_beats
       (id, campaign_id, kind, title, body, links_json, edges_json, routes_json, x, y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const beat of beats) {
      const links: BeatLinks = {};
      for (const [field, kind] of Object.entries(BEAT_LINK_KINDS)) {
        const original = beat.links[field as keyof BeatLinks];
        const copy = original
          ? idMap.get(`${kind}:${original}`) ?? (keepLink(kind, original) ? original : undefined)
          : undefined;
        if (copy) {
          links[field as keyof BeatLinks] = copy;
        }
      }
      const routes: Record<string, EdgeRoute> = {};
      for (const [edge, route] of Object.entries(beat.routes ?? {})) {
        const copy = newIds.get(edge);
        if (copy) {
          routes[copy] = route;
        }
      }
      insert.run(
        newIds.get(beat.id),
        targetId,
        beat.kind,
        beat.title,
        beat.body,
        JSON.stringify(links),
        JSON.stringify(beat.edges.map((edge) => newIds.get(edge)).filter(Boolean)),
        JSON.stringify(routes),
        beat.x,
        beat.y,
        now,
        now,
      );
    }
  })();
  return beats.length;
}
