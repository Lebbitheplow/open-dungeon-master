import { getDatabase } from "@/lib/db/core";
import { beatOrigins, getBeatIn, insertBeat, listBeats, updateBeat } from "@/lib/db/workshop-beats";
import { copiesFrom, recordOrigin } from "@/lib/db/content-origins";
import { MAX_BEATS, MAX_EDGES, type Beat, type BeatLinks } from "@/lib/workshop/board";
import { planSceneExport, type SceneExportPlan } from "@/lib/worldforge/scenes";
import type { ImportedBeat } from "@/lib/worldforge/format";
import { firstReadings, hashOf, mergeValues, originFrom, originKey } from "@/lib/worldforge/import-merge";
import { parseRef, refOf, type WorldDoc } from "@/lib/worldforge/model";
import { textKey } from "@/lib/language/text-logic";

// A WorldForge file's scenes on the storyboard, and the storyboard out as
// scenes (audit WF-19; the contract is src/lib/worldforge/scenes.ts).
//
// Each card a file brings remembers the world and the scene it came from
// (content_origins, kind "beats"), so opening the same file again finds the
// card rather than adding another. What the file says about a card it
// brought before (title, text, Who, Where) is merged value by value like an
// entry's (src/lib/worldforge/import-merge.ts): what nobody changed here
// takes the file's reading, an edit made here stands, and a value both
// changed is reported. The readings live in the world document's origins
// under "beats/<card id>". What only the board holds (the card's kind, its
// arrows and routes, its battle map and fight, where it sits) is never
// touched by a reimport.

export type SceneLanding = { created: number; updated: number; conflicts: string[]; matched: string[]; skipped: string[] };

const SCENE_WORDS: Record<string, string> = { title: "title", body: "text", npcId: "Who", locationId: "Where" };

type SceneValues = { title: string; body: string; npcId?: string; locationId?: string };

const valuesOf = (card: Pick<Beat, "title" | "body" | "links">): SceneValues => ({
  title: card.title,
  body: card.body,
  npcId: card.links.npcId,
  locationId: card.links.locationId,
});

export function landScenes(
  campaignId: string,
  doc: WorldDoc,
  source: string,
  scenes: ImportedBeat[],
  refMap: Map<string, string>,
): SceneLanding {
  const origins = (doc.origins ??= {});
  const live = listBeats(campaignId);
  // The cards an earlier import of this world brought, by scene id.
  const copies = new Map(
    [...copiesFrom(campaignId, source)].filter(([key]) => key.startsWith("beats:")).map(([key, id]) => [key.slice("beats:".length), id]),
  );
  // Cards brought in before cards remembered their scene: matched by title,
  // as they were then, and only among cards with no origin at all.
  const placed = beatOrigins(campaignId);
  const byTitle = new Map(live.filter((card) => !placed[card.id]).map((card) => [textKey(card.title), card.id]));
  let room = MAX_BEATS - live.length;
  const top = live.length ? Math.max(...live.map((card) => card.y)) + 220 : 40;
  const landing: SceneLanding = { created: 0, updated: 0, conflicts: [], matched: [], skipped: [] };
  let overflow = 0;
  const stories = [...new Set(scenes.map((scene) => scene.story))];
  for (const [row, story] of stories.entries()) {
    const line: string[] = [];
    const fresh = new Set<string>();
    for (const scene of scenes.filter((entry) => entry.story === story)) {
      const pov = parseRef(refMap.get(scene.pov));
      const place = parseRef(refMap.get(scene.place));
      const theirs: SceneValues = {
        title: scene.title,
        body: scene.body,
        npcId: pov?.shelf === "npc" ? pov.id : undefined,
        locationId: place?.shelf === "location" ? place.id : undefined,
      };
      const from = originFrom(source, "scenes", scene.wfId || textKey(scene.title));
      let cardId = (scene.wfId && copies.get(scene.wfId)) || "";
      if (!cardId && byTitle.has(textKey(scene.title))) {
        cardId = byTitle.get(textKey(scene.title))!;
        landing.matched.push(scene.title);
      }
      const card = cardId ? getBeatIn(campaignId, cardId) : null;
      if (card) {
        byTitle.delete(textKey(card.title));
        const key = originKey("beats", card.id);
        const prior = origins[key]?.from === from ? origins[key] : undefined;
        const merged = mergeValues(prior, valuesOf(card), theirs);
        const take = merged.take as Partial<SceneValues>;
        const links: BeatLinks = { ...card.links };
        for (const field of ["npcId", "locationId"] as const) {
          if (field in take) {
            if (take[field]) links[field] = take[field];
            else delete links[field];
          }
        }
        const { id, ...rest } = card;
        const next = { ...rest, title: take.title ?? card.title, body: take.body ?? card.body, links };
        updateBeat(campaignId, id, next);
        const written = valuesOf(next);
        for (const item of merged.pending) merged.at[item.key] = `${item.source}.${hashOf(written[item.key as keyof SceneValues])}`;
        origins[key] = { from, at: merged.at };
        for (const clash of merged.clashes) landing.conflicts.push(`Scene “${card.title}”: kept your ${SCENE_WORDS[clash] ?? clash} over the file's.`);
        if (scene.wfId) recordOrigin(campaignId, "beats", card.id, source, scene.wfId);
        landing.updated += 1;
        line.push(card.id);
        continue;
      }
      if (room <= 0) {
        overflow += 1;
        continue;
      }
      const made = insertBeat(campaignId, {
        kind: "event",
        title: theirs.title,
        body: theirs.body,
        links: { ...(theirs.npcId ? { npcId: theirs.npcId } : {}), ...(theirs.locationId ? { locationId: theirs.locationId } : {}) },
        edges: [],
        routes: {},
        x: 40 + fresh.size * 280,
        y: top + row * 220,
      });
      if ("error" in made) {
        overflow += 1;
        continue;
      }
      room -= 1;
      if (scene.wfId) {
        recordOrigin(campaignId, "beats", made.id, source, scene.wfId);
        copies.set(scene.wfId, made.id);
      }
      origins[originKey("beats", made.id)] = { from, at: firstReadings(theirs) };
      fresh.add(made.id);
      landing.created += 1;
      line.push(made.id);
    }
    // Each scene leads to the next, as the story lists them. A card brought
    // in before keeps the arrows it has; a new one is drawn into the line.
    line.slice(0, -1).forEach((id, at) => {
      const to = line[at + 1];
      if (!fresh.has(id) && !fresh.has(to)) return;
      const card = getBeatIn(campaignId, id);
      if (!card || card.edges.includes(to) || card.edges.length >= MAX_EDGES) return;
      const { id: cardId, ...rest } = card;
      updateBeat(campaignId, cardId, { ...rest, edges: [...card.edges, to] });
    });
  }
  if (overflow) {
    landing.skipped.push(`${overflow.toLocaleString("en")} ${overflow === 1 ? "scene" : "scenes"}: a storyboard holds ${MAX_BEATS} cards, so ${overflow === 1 ? "it does" : "they do"} not fit.`);
  }
  return landing;
}

// How many of a file's scenes would be new cards here, and so need room on
// the board: those an earlier import of the same world did not bring.
export function scenesWithoutRoom(campaignId: string, source: string, scenes: ImportedBeat[]): number {
  const live = listBeats(campaignId);
  const copies = copiesFrom(campaignId, source);
  const placed = beatOrigins(campaignId);
  const titles = new Set(live.filter((card) => !placed[card.id]).map((card) => textKey(card.title)));
  const fresh = new Set(scenes.filter((scene) => !(scene.wfId && copies.has(`beats:${scene.wfId}`)) && !titles.has(textKey(scene.title))).map((scene) => scene.wfId || textKey(scene.title)));
  return Math.max(0, fresh.size - (MAX_BEATS - live.length));
}

const NAME_TABLES: Record<keyof BeatLinks, string> = {
  npcId: "npcs",
  locationId: "locations",
  mapId: "prepared_maps",
  encounterId: "encounter_templates",
};

// The storyboard as the file will list it, and what each card loses on
// the way (src/lib/worldforge/scenes.ts). `inWorld` holds the refs of the
// records the file carries.
export function planBoardExport(campaignId: string, inWorld: Set<string>): SceneExportPlan {
  const db = getDatabase();
  return planSceneExport(
    listBeats(campaignId),
    (field, id) => inWorld.has(refOf(field === "npcId" ? "npc" : "location", id)),
    (field, id) => (db.prepare(`SELECT name FROM ${NAME_TABLES[field]} WHERE id = ?`).get(id) as { name?: string } | undefined)?.name,
  );
}
