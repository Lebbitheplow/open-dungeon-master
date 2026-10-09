import { getDatabase, parseJson } from "@/lib/db/core";
import { setQuestLog, setStoryArc, type Campaign } from "@/lib/db/campaigns";
import { insertQuest, listQuests } from "@/lib/db/quests";
import { appendBoardAct, normalizeStoryArc, type ArcEvent, type ArcEventKind, type Waypoint } from "@/lib/dm/arc-logic";
import { dedupeName, type ArcMode, type LinkKind } from "@/lib/workshop/import";
import type { BeatKind, BeatLinks } from "@/lib/workshop/board";
import type { CompiledBoard, CompiledEncounter } from "@/lib/workshop/board-compile";

// Writing a compiled storyboard into a campaign.
//
// The storyboard is the one import kind that is COMPILED rather than copied:
// one board becomes lore entries, quests, prepared encounters, DM-only notes,
// arc beats and planned moments (src/lib/workshop/board-compile.ts decides
// what becomes what). Nothing new is built at the campaign end to receive
// it, which is the test of whether the node kinds were chosen correctly.
//
// What a card PICKED travels too (#156). A fight card that picks a prepared
// fight becomes that fight's campaign copy, roster and all, instead of a
// second, empty encounter named after the card; who and where a scene
// involves become waypoints on its beat, which the server ticks from the
// storyteller's own tool calls. Which row a link lands on is the resolver's
// answer, handed in by src/lib/db/content-import.ts, because only the import
// knows what travelled, what an earlier import brought, and what the source's
// shared workshop holds (#159).
//
// Split from content-import.ts to keep both files under the project's
// 500-line cap. Both halves still run inside that module's transaction:
// getDatabase() is a singleton connection, so a statement issued here during
// the enclosing db.transaction() is part of it and rolls back with it.

export type BoardResolver = {
  // The campaign row a card's link lands on, or null when nothing carries
  // it. May copy a row in (a linked fight that was not ticked, a record from
  // the shared workshop), which is why it is a function and not a map.
  link: (kind: LinkKind, id: string) => string | null;
  // The row an earlier import of this same board compiled a card into, so a
  // second import keeps it instead of numbering a duplicate.
  compiled: (kind: "board-lore" | "board-fight" | "board-note", cardId: string) => string | null;
  // Records which card a compiled row came from.
  record: (kind: "board-lore" | "board-fight" | "board-note", rowId: string, cardId: string) => void;
};

// The fight each fight card became, for the waypoints that name it.
export type BoardFights = Map<string, { name: string; roster: string }>;

type TemplateRow = { name: string; enemies_json: string; map_json: string; notes: string };

function rosterLine(enemiesJson: string): string {
  return (parseJson<Array<{ monster?: unknown; count?: unknown }>>(enemiesJson, []) ?? [])
    .filter((row) => typeof row?.monster === "string" && row.monster)
    .map((row) => {
      const count = Math.max(1, Math.round(Number(row.count) || 1));
      return count > 1 ? `${count} ${String(row.monster)}` : String(row.monster);
    })
    .join(", ");
}

function rowName(table: "npcs" | "locations" | "encounter_templates", id: string): string {
  const row = getDatabase().prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as
    | { name: string }
    | undefined;
  return row?.name ?? "";
}

// A linked fight takes the card's words and map where they add something:
// the card's prose joins the notes once, and the card's map binds a fight
// that was drawn on none. Neither ever overwrites what the fight already
// says.
function annotateFight(id: string, entry: CompiledEncounter, resolver: BoardResolver) {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT name, enemies_json, map_json, notes FROM encounter_templates WHERE id = ?`)
    .get(id) as TemplateRow | undefined;
  if (!row) {
    return;
  }
  const words = entry.notes.trim();
  const notes =
    words && !row.notes.includes(words)
      ? `${row.notes.trim() ? `${row.notes.trim()}\n\n` : ""}From the storyboard card "${entry.name}": ${words}`.slice(0, 8_000)
      : row.notes;
  const map = parseJson<Record<string, unknown>>(row.map_json, {});
  const cardMap = entry.mapId ? resolver.link("maps", entry.mapId) : null;
  if (cardMap && !map.mapId) {
    map.mapId = cardMap;
  }
  db.prepare(`UPDATE encounter_templates SET notes = ?, map_json = ? WHERE id = ?`).run(
    notes,
    JSON.stringify(map),
    id,
  );
}

// The rows. Runs inside the import transaction.
export function writeStoryboardRows(
  campaignId: string,
  ownerUserId: string,
  compiled: CompiledBoard,
  now: string,
  resolver: BoardResolver,
): { written: number; fights: BoardFights } {
  const db = getDatabase();
  let written = 0;
  const fights: BoardFights = new Map();

  // Every link resolved now, inside the import's transaction, because
  // resolving can copy a row in (a shared workshop's NPC, a fight that was
  // not ticked). The waypoints written after the transaction then only read
  // what this already settled.
  for (const card of [...compiled.arcPlan, ...compiled.moments]) {
    for (const [field, kind] of [
      ["npcId", "npcs"],
      ["locationId", "locations"],
      ["encounterId", "encounters"],
    ] as const) {
      const id = card.links[field];
      if (id) {
        resolver.link(kind, id);
      }
    }
  }

  // Places and history become lore, through the same table the lore kind
  // copies into, so a board and a hand-written world bible are
  // indistinguishable once they arrive.
  const loreTaken = new Set(
    (
      db.prepare(`SELECT title FROM lore_entries WHERE campaign_id = ?`).all(campaignId) as Array<{
        title: string;
      }>
    ).map((row) => row.title.trim().toLowerCase()),
  );
  for (const entry of compiled.lore) {
    if (!resolver.compiled("board-lore", entry.cardId)) {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO lore_entries
           (id, campaign_id, category, title, body, tags_json, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '["storyboard"]', 0, ?, ?)`,
      ).run(id, campaignId, entry.category, dedupeName(entry.title, loreTaken), entry.body, now, now);
      resolver.record("board-lore", id, entry.cardId);
      written += 1;
    }
    // A place card that names both the place and the map it stands on
    // binds them, when the place is not already standing on one.
    const place = entry.links.locationId ? resolver.link("locations", entry.links.locationId) : null;
    const map = entry.links.mapId ? resolver.link("maps", entry.links.mapId) : null;
    if (place && map) {
      db.prepare(
        `UPDATE locations SET prepared_map_id = ?
          WHERE id = ? AND campaign_id = ? AND (prepared_map_id IS NULL OR prepared_map_id = '')`,
      ).run(map, place, campaignId);
    }
  }

  // A fight card that picked a prepared fight IS that fight (#156). One
  // that picked nothing becomes a prepared encounter with an EMPTY roster:
  // the board says a fight belongs here, not what is in it, and a roster
  // invented from a card title would be a fight nobody wrote. The DM fills
  // it in, and the difficulty readout tells them what it costs.
  const encounterTaken = new Set(
    (
      db
        .prepare(`SELECT name FROM encounter_templates WHERE campaign_id = ?`)
        .all(campaignId) as Array<{ name: string }>
    ).map((row) => row.name.trim().toLowerCase()),
  );
  for (const entry of compiled.encounters) {
    let id = entry.encounterId ? resolver.link("encounters", entry.encounterId) : null;
    if (id) {
      annotateFight(id, entry, resolver);
    } else {
      id = resolver.compiled("board-fight", entry.cardId);
    }
    if (!id) {
      id = crypto.randomUUID();
      const map = entry.mapId ? resolver.link("maps", entry.mapId) : null;
      db.prepare(
        `INSERT INTO encounter_templates
           (id, campaign_id, name, enemies_json, battlefield, map_json, notes,
            created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, '[]', '', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        campaignId,
        dedupeName(entry.name, encounterTaken),
        JSON.stringify(map ? { mapId: map } : {}),
        entry.notes,
        ownerUserId,
        now,
        now,
      );
      resolver.record("board-fight", id, entry.cardId);
      written += 1;
    }
    const row = db
      .prepare(`SELECT name, enemies_json FROM encounter_templates WHERE id = ?`)
      .get(id) as { name: string; enemies_json: string } | undefined;
    if (row) {
      fights.set(entry.cardId, { name: row.name, roster: rosterLine(row.enemies_json) });
    }
  }

  // Secrets become DM-only notes. campaign_notes carries a visibility column
  // and a "dm" author kind, which is exactly the shape for something the
  // party must not read, and the one thing a secret must never compile into
  // is anything they can.
  let seq =
    (
      db
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_notes WHERE campaign_id = ?`)
        .get(campaignId) as { seq: number } | undefined
    )?.seq ?? 0;
  for (const entry of compiled.notes) {
    if (resolver.compiled("board-note", entry.cardId)) {
      continue;
    }
    seq += 1;
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO campaign_notes
         (id, campaign_id, character_id, author_user_id, author_kind, visibility,
          status, pinned, title, body, seq, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'dm', 'private', 'active', 0, ?, ?, ?, ?, ?)`,
    ).run(id, campaignId, ownerUserId, entry.title.slice(0, 120), entry.body.slice(0, 2000), seq, now, now);
    resolver.record("board-note", id, entry.cardId);
    written += 1;
  }

  return { written, fights };
}

const WAYPOINT_TEXT = 120;

// What a card picked, as the steps its beat waits on: be at the place, meet
// the person, win the fight. Only links that landed on a campaign row
// become waypoints; a name the campaign has no row for would be a step the
// server could never tick.
function waypointsFor(
  cardId: string,
  kind: BeatKind,
  links: BeatLinks,
  resolver: BoardResolver,
  fights: BoardFights,
): Waypoint[] {
  const waypoints: Waypoint[] = [];
  const place = links.locationId ? resolver.link("locations", links.locationId) : null;
  if (place) {
    waypoints.push({ kind: "place", text: rowName("locations", place).slice(0, WAYPOINT_TEXT), done: false });
  }
  const person = links.npcId ? resolver.link("npcs", links.npcId) : null;
  if (person) {
    waypoints.push({ kind: "npc", text: rowName("npcs", person).slice(0, WAYPOINT_TEXT), done: false });
  }
  // A fight waypoint is ticked by the foes end_encounter reports, so it
  // names the roster as well as the fight.
  let fight = kind === "encounter" ? fights.get(cardId) : undefined;
  if (!fight && links.encounterId) {
    const id = resolver.link("encounters", links.encounterId);
    const row = id
      ? (getDatabase().prepare(`SELECT name, enemies_json FROM encounter_templates WHERE id = ?`).get(id) as
          | { name: string; enemies_json: string }
          | undefined)
      : undefined;
    fight = row ? { name: row.name, roster: rosterLine(row.enemies_json) } : undefined;
  }
  if (fight) {
    waypoints.push({
      kind: "fight",
      text: (fight.roster ? `${fight.roster} (${fight.name})` : fight.name).slice(0, WAYPOINT_TEXT),
      done: false,
    });
  }
  return waypoints.filter((waypoint) => waypoint.text);
}

const MOMENT_KIND: Record<BeatKind, ArcEventKind> = {
  setting: "setpiece",
  backstory: "setpiece",
  event: "setpiece",
  encounter: "setpiece",
  hook: "setpiece",
  secret: "discovery",
  npc_moment: "npc_encounter",
};

// The two single columns on campaigns, written after the transaction the way
// the house rules are: one write each rather than a loop. Returns what was
// written and how many beats joined the arc.
export function writeStoryboardColumns(
  campaign: Campaign,
  compiled: CompiledBoard,
  now: string,
  options: { resolver: BoardResolver; fights: BoardFights; arcMode: ArcMode; title: string },
): { written: number; beatsAdded: number } {
  let written = 0;
  const { resolver, fights } = options;

  // Hooks become quests, appended rather than replacing: a campaign in
  // progress has a quest log the party is working through. A quest already
  // on the log is not added twice, which is what makes a second import of
  // the same board harmless.
  //
  // Into the quest log the Quests panel shows and the storyteller reads
  // (the quests table, src/lib/db/quests.ts) as well as the older one-line
  // log on the campaign row. The old log alone was read by the storyteller
  // only while a campaign had no arc, so a board that also wrote an arc
  // delivered hooks nobody at the table, model or person, ever saw.
  const logged = new Set(campaign.questLog.map((quest) => quest.trim().toLowerCase()));
  const quests = compiled.quests.filter((quest) => !logged.has(quest.trim().toLowerCase()));
  if (quests.length) {
    setQuestLog(campaign.id, [...campaign.questLog, ...quests]);
    written += 1;
  }
  const listed = new Set(listQuests(campaign.id).map((quest) => quest.title.trim().toLowerCase()));
  for (const title of compiled.quests) {
    if (!listed.has(title.trim().toLowerCase())) {
      insertQuest({ campaignId: campaign.id, title, source: "dm", visibility: "party" });
      listed.add(title.trim().toLowerCase());
    }
  }

  const beats = compiled.arcPlan.map((beat) => ({
    text: beat.text,
    waypoints: waypointsFor(beat.cardId, beat.kind, beat.links, resolver, fights),
  }));
  const events: Array<Omit<ArcEvent, "id" | "status">> = compiled.moments.map((moment) => {
    const along = waypointsFor(moment.cardId, moment.kind, moment.links, resolver, fights)
      .map((waypoint) => (waypoint.kind === "fight" ? `Fight: ${waypoint.text}.` : waypoint.kind === "npc" ? `With ${waypoint.text}.` : `At ${waypoint.text}.`))
      .join(" ");
    return {
      kind: MOMENT_KIND[moment.kind],
      name: moment.name.slice(0, 80),
      detail: `${moment.detail}${along ? ` ${along}` : ""}`.slice(0, 300),
      trigger: moment.trigger.slice(0, 200),
      actHint: null,
    };
  });

  // A campaign in progress has an arc with beats marked done and detail
  // accreted from actual play; overwriting that with a prep document would
  // delete the campaign's memory of itself. So an arc is only ever WRITTEN
  // where there is none, and only ever ADDED TO, as its next act, when the
  // DM asked for that (#157).
  if (campaign.storyArc) {
    if (options.arcMode !== "append") {
      return { written, beatsAdded: 0 };
    }
    const joined = appendBoardAct(campaign.storyArc, beats, events, options.title);
    if (joined.added) {
      setStoryArc(campaign.id, joined.arc);
      written += 1;
    }
    return { written, beatsAdded: joined.added };
  }
  const arc = normalizeStoryArc({
    version: 3,
    premise: compiled.premise,
    stakes: "",
    antagonist: "",
    beats: beats.map((beat) => ({ text: beat.text, status: "pending", act: 1, waypoints: beat.waypoints })),
    acts: 1,
    finale: "",
    saga: null,
    cast: [],
    events: events.map((event) => ({ ...event, actHint: 1, status: "pending" })),
    subArcs: [],
    worldArcs: [],
    updatedAt: now,
  });
  // normalizeStoryArc refuses an arc with no premise or fewer than two beats,
  // and a refusal is the right answer: half a spine is worse than none,
  // because the engine would treat it as the whole plan.
  if (arc) {
    setStoryArc(campaign.id, arc);
    written += 1;
    return { written, beatsAdded: arc.beats.length };
  }
  return { written, beatsAdded: 0 };
}
