import { BEAT_LABELS, BODY_MAX, ROUTE_LABELS, TITLE_MAX, boardGraph, type Beat, type BeatLinks } from "../workshop/board.ts";
import { parseRef } from "./model.ts";

// The storyboard as WorldForge scenes, and what that conversion cannot
// carry (audit WF-19). A WorldForge story is a list of scenes in order,
// each with a title, a gist, a point-of-view character, a place and a
// cast. A storyboard is a graph of typed cards: arrows that branch, routes
// that say what each arrow means, and picks of a battle map and a prepared
// fight. Everything a list cannot hold is named here, card by card, before
// a file is written, the way WF-06 names what an entry loses. The whole
// adventure travels in a workshop bundle (src/lib/workshop/bundle.ts).
//
// The contract, both ways:
//   - out: cards in reading order (board.ts boardGraph), title and text as
//     the scene's title and gist, Who and Where as its point of view and
//     place when those records are in the world;
//   - in: each story a row of "Something happens" cards in the file's
//     order, each leading to the next, Who and Where from the scene's
//     point of view and place when the file has them as a Cast member and
//     a place.
// Pure: the database half is src/lib/db/world-forge-io.ts.

// What one scene loses, by its title.
export type SceneLoss = { scene: string; lost: string[] };

const quoted = (text: string) => `“${text}”`;

// Scene losses as plain lines, for the places that list losses as text.
export function sceneLossLines(scenes: SceneLoss[]): string[] {
  return scenes.map((scene) => `Scene ${quoted(scene.scene)} loses ${scene.lost.join("; ")}.`);
}

export type SceneExportPlan = {
  // The cards in the order the file lists them.
  order: Beat[];
  scenes: SceneLoss[];
  notes: string[];
};

// `inWorld` says whether a card's Who or Where travels as a world entry;
// `nameOf` names what a card picked, for the report.
export function planSceneExport(
  beats: Beat[],
  inWorld: (field: "npcId" | "locationId", id: string) => boolean,
  nameOf: (field: keyof BeatLinks, id: string) => string | undefined = () => undefined,
): SceneExportPlan {
  const board = boardGraph(beats);
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  const order = board.order.map((id) => byId.get(id)!).filter(Boolean);
  const titleOf = (id: string) => quoted(byId.get(id)?.title ?? "a card");
  const picked = (what: string, field: keyof BeatLinks, id: string) => {
    const name = nameOf(field, id);
    return name ? `${what}, ${quoted(name)}` : what;
  };
  const scenes: SceneLoss[] = [];
  order.forEach((card, at) => {
    const node = byId.get(card.id)!;
    const next = order[at + 1]?.id;
    const lost: string[] = [];
    if (node.kind !== "event") lost.push(`its kind, ${quoted(BEAT_LABELS[node.kind])} (it comes back as ${quoted(BEAT_LABELS.event)})`);
    for (const target of node.out) {
      const route = node.routes?.[target];
      const meaning = route ? `${ROUTE_LABELS[route.kind]}${route.label ? `: ${quoted(route.label)}` : ""}` : "";
      if (target !== next) lost.push(`its arrow to ${titleOf(target)}${meaning ? ` (${meaning})` : ""}`);
      else if (meaning) lost.push(`what its arrow to ${titleOf(target)} means (${meaning})`);
    }
    // A list leads each scene to the next: an arrow the board does not
    // have comes back on the other side.
    if (next && !node.out.includes(next)) lost.push(`its place in the line: it comes back leading to ${titleOf(next)}, which it does not lead to here`);
    if (node.links.mapId) lost.push(picked("its battle map", "mapId", node.links.mapId));
    if (node.links.encounterId) lost.push(picked("its prepared fight", "encounterId", node.links.encounterId));
    if (node.links.npcId && !inWorld("npcId", node.links.npcId)) lost.push(`${picked("its Who", "npcId", node.links.npcId)}, who is not in this world`);
    if (node.links.locationId && !inWorld("locationId", node.links.locationId)) lost.push(`${picked("its Where", "locationId", node.links.locationId)}, which is not in this world`);
    if (lost.length) scenes.push({ scene: node.title, lost });
  });
  const notes = order.length
    ? ["The storyboard goes out as one story of scenes in reading order. Where each card sits on the board is not kept, and a card opened elsewhere comes back as one in a row."]
    : [];
  return { order, scenes, notes };
}

// ---- in ----

// A scene as a storyboard card. `wfId` is the scene's own id in the file,
// which is how a second import of the same world finds the card it made.
// `pov` and `place` are the file's stand-in refs (format.ts).
export type ImportedBeat = { wfId: string; title: string; body: string; story: string; order: number; pov: string; place: string };

type Raw = Record<string, unknown>;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// A file's scenes as cards in each story's order, and what each scene holds
// that a card does not. `refOf` turns a file's entity id into its stand-in
// ref ("" when the file has no such entry), `key` cleans a file id, and
// `nameOf` names a stand-in ref. `leftOut` counts scenes with no title or
// no order, which have no place on a board.
export function readScenes(input: {
  scenes: Raw[];
  bodies: Raw;
  stories: Map<string, string>;
  refOf: (value: unknown) => string;
  key: (value: unknown) => string;
  nameOf: (ref: string) => string | undefined;
}): { beats: ImportedBeat[]; sceneLosses: SceneLoss[]; leftOut: number } {
  const { refOf, key, nameOf } = input;
  const placed = input.scenes.filter((scene) => text(scene.title, TITLE_MAX) && typeof scene.order === "number");
  const sceneLosses: SceneLoss[] = [];
  const beats = placed
    .sort((a, b) => text(a.storyId, 80).localeCompare(text(b.storyId, 80)) || (a.order as number) - (b.order as number))
    .map((scene) => {
      const title = text(scene.title, TITLE_MAX);
      const lost: string[] = [];
      if (text(scene.title, 1_000).length > TITLE_MAX) lost.push(`the end of its title (a card's title holds ${TITLE_MAX} characters)`);
      // The gist and the scene's written text, one after the other on the
      // card when both fit; the gist alone when they do not.
      const gist = text(scene.gist, Infinity);
      const written = text(input.bodies[key(scene.id)], Infinity);
      let body = gist && written && gist !== written ? `${gist}\n\n${written}` : gist || written;
      if (body.length > BODY_MAX) {
        if (gist && written && gist.length <= BODY_MAX) {
          lost.push(`its written text (${written.length.toLocaleString("en")} characters), which does not fit on a card beside its gist`);
          body = gist;
        } else {
          lost.push(`the end of its text (a card holds ${BODY_MAX.toLocaleString("en")} characters)`);
          body = body.slice(0, BODY_MAX).trimEnd();
        }
      }
      // A card's Who is one Cast member and its Where one place.
      const pick = (value: unknown, shelf: "npc" | "location", what: string, needs: string) => {
        if (!key(value)) return "";
        const ref = refOf(value);
        if (!ref) lost.push(`its ${what}, which names an entry the file does not have`);
        else if (parseRef(ref)?.shelf !== shelf) lost.push(`its ${what}, ${quoted(nameOf(ref) ?? "an entry")}, which is not ${needs}`);
        return ref;
      };
      const pov = pick(scene.povEntityId, "npc", "point of view", "a Cast member");
      const place = pick(scene.locationEntityId, "location", "place", "a place");
      const listed = Array.isArray(scene.castEntityIds) ? scene.castEntityIds.slice(0, 60) : [];
      const cast = [...new Set(listed.filter((id) => key(id)).map((id) => refOf(id) || `?${key(id)}`))].filter((ref) => ref !== pov);
      if (cast.length) {
        const named = cast.map((ref) => (nameOf(ref) !== undefined ? quoted(nameOf(ref)!) : "an entry the file does not have"));
        lost.push(`its cast beyond its point of view: ${named.join(", ")} (a card names one Who)`);
      }
      if (lost.length) sceneLosses.push({ scene: title, lost });
      return { wfId: key(scene.id), title, body, story: input.stories.get(key(scene.storyId)) ?? "", order: scene.order as number, pov, place };
    });
  return { beats, sceneLosses, leftOut: input.scenes.length - placed.length };
}
