import { BEAT_KINDS, boardGraph, routeOf, type BeatLinks, type Beat, type BeatKind, type BoardNode } from "./board.ts";

// Compiling a storyboard into campaign structure.
//
// This is the test of whether the node kinds were chosen correctly: every
// kind has to land somewhere that already exists at the campaign end
// (docs/workshop-plan.md phase 7). Nothing new gets built to receive the
// board. If a kind had nowhere to go, the right fix would have been to
// delete the kind.
//
//   setting, backstory  -> lore_entries
//   event, npc_moment   -> the story arc's beats
//   hook                -> the quest log
//   encounter           -> encounter_templates, and a beat when the arrows
//                          put the fight in the story's path
//   secret              -> DM-only campaign notes
//
// Arrows decide which scenes the party MUST play. A card reached by plain
// arrows from the start of the board is on the spine and becomes a beat. A
// card reached only through a "choice" or "optional" arrow (board.ts) is a
// route that may not be taken, so it becomes a planned moment (an arc
// event the storyteller fires or drops when the party gets there) rather
// than a beat the arc would wait on (#157). Routes that meet again rejoin
// the spine where they meet.
//
// Cards carry their links through the compile as SOURCE ids. Which campaign
// row each one becomes is the rim's question (src/lib/db/workshop-
// storyboard.ts), because only the rim knows what travelled.
//
// Pure by design: no "@/" imports and no I/O, so the whole decision table is
// testable. The rim that writes the rows is src/lib/db/content-import.ts.

export type CompiledLore = { cardId: string; category: "history" | "geography"; title: string; body: string; links: BeatLinks };
// `encounterId` and `mapId` are the fight and map the card picked, when it
// picked them (#156); `inArc` says a beat or a moment names this fight.
export type CompiledEncounter = {
  cardId: string;
  name: string;
  notes: string;
  encounterId?: string;
  mapId?: string;
  inArc: boolean;
};
export type CompiledNote = { cardId: string; title: string; body: string };
// A beat the party plays: its line, and the card's links, which the rim
// turns into waypoints the server ticks (src/lib/dm/waypoint-logic.ts).
export type CompiledBeat = { cardId: string; kind: BeatKind; text: string; links: BeatLinks };
// A scene on a route that may not be taken.
export type CompiledMoment = {
  cardId: string;
  kind: BeatKind;
  name: string;
  detail: string;
  trigger: string;
  links: BeatLinks;
};

export type CompiledBoard = {
  lore: CompiledLore[];
  // In reading order, following the edges the DM drew. The lines alone, for
  // the summary and the older callers; `arcPlan` is the same beats whole.
  arcBeats: string[];
  arcPlan: CompiledBeat[];
  // Scenes on alternative and optional routes.
  moments: CompiledMoment[];
  quests: string[];
  questCards: string[];
  encounters: CompiledEncounter[];
  notes: CompiledNote[];
  // What the arc will be about, taken from the board rather than invented:
  // the first backstory or place card. An arc with no premise is refused by
  // normalizeStoryArc, so this decides whether an arc can be written at all.
  premise: string;
  // Every kind that produced nothing, so the import can say what a board
  // does NOT contain before it is pressed.
  emptyKinds: BeatKind[];
};

// An arc beat is one line of what happens. The body is folded in behind the
// title because a beat is read aloud in prompt context, where two fields
// would only become two fields to keep consistent.
function beatLine(title: string, body: string): string {
  const detail = body.split("\n")[0]?.trim() ?? "";
  return detail ? `${title}: ${detail}` : title;
}

// normalizeStoryArc refuses an arc with fewer than two beats
// (src/lib/dm/arc-logic.ts), which is the honest floor: one thing happening
// is not a spine.
export const MIN_ARC_BEATS = 2;

// The cards that play out as a story: things that happen, somebody's
// moment, and a fight the arrows put in the way. A fight card nobody drew an
// arrow to or from is prep, not a scene the party has to reach.
function arcCard(node: BoardNode): boolean {
  return (
    node.kind === "event" ||
    node.kind === "npc_moment" ||
    (node.kind === "encounter" && (node.in.length > 0 || node.out.length > 0))
  );
}

// Which cards the party must play through: the spine. Seeded with the cards
// nothing leads to (or the first card of a board that is all loop), grown
// along plain arrows, and grown at the places where every route of one
// choice meets again.
function spineOf(nodes: BoardNode[], order: string[]): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => node.in.length === 0).map((node) => node.id);
  // A board that is all loop has no start; it reads from its first card,
  // the same fallback readingOrder walks.
  const spine = new Set<string>(roots.length ? roots : order.slice(0, 1));
  const reach = new Map<string, Set<string>>();
  const reachable = (start: string): Set<string> => {
    const cached = reach.get(start);
    if (cached) {
      return cached;
    }
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      for (const next of byId.get(queue.shift() as string)?.out ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    reach.set(start, seen);
    return seen;
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (spine.has(node.id)) {
        continue;
      }
      const plainFromSpine = node.in.some(
        (from) => spine.has(from) && routeOf(byId.get(from) as BoardNode, node.id) === "then",
      );
      const rejoin = nodes.some((origin) => {
        if (!spine.has(origin.id)) {
          return false;
        }
        const choices = origin.out.filter((target) => routeOf(origin, target) === "choice");
        return (
          choices.length >= 2 &&
          !choices.includes(node.id) &&
          choices.every((choice) => reachable(choice).has(node.id))
        );
      });
      if (plainFromSpine || rejoin) {
        spine.add(node.id);
        grew = true;
      }
    }
  }
  return spine;
}

// Why a scene off the spine happens, in the fiction's terms: the condition
// on the arrow into it, which card it follows, and the routes it excludes.
function triggerFor(node: BoardNode, byId: Map<string, BoardNode>): string {
  const from = node.in.map((id) => byId.get(id)).filter((entry): entry is BoardNode => Boolean(entry));
  const routed = from.find((origin) => routeOf(origin, node.id) !== "then") ?? from[0];
  if (!routed) {
    return "When the story comes to it.";
  }
  const route = routed.routes?.[node.id];
  if (route?.kind === "choice") {
    const others = routed.out
      .filter((target) => target !== node.id && routeOf(routed, target) === "choice")
      .map((target) => byId.get(target)?.title)
      .filter(Boolean);
    return `One route out of "${routed.title}"${route.label ? `, ${route.label}` : ""}${
      others.length ? `; taking it means not "${others.join('" or "')}"` : ""
    }.`;
  }
  if (route?.kind === "optional") {
    return `Only ${route.label || "if the party goes looking for it"}, after "${routed.title}".`;
  }
  return `After "${routed.title}".`;
}

export function compileBoard(beats: Beat[]): CompiledBoard {
  const board = boardGraph(beats);
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  // Reading order, so the arc beats come out in the order the DM's arrows
  // say they happen rather than in the order the cards were typed.
  const ordered = board.order.map((id) => byId.get(id)!).filter(Boolean);
  const spine = spineOf(board.nodes, board.order);

  const compiled: CompiledBoard = {
    lore: [],
    arcBeats: [],
    arcPlan: [],
    moments: [],
    quests: [],
    questCards: [],
    encounters: [],
    notes: [],
    premise: "",
    emptyKinds: [],
  };

  for (const node of ordered) {
    if (arcCard(node)) {
      if (spine.has(node.id)) {
        compiled.arcPlan.push({
          cardId: node.id,
          kind: node.kind,
          text: beatLine(node.title, node.body),
          links: node.links,
        });
      } else {
        compiled.moments.push({
          cardId: node.id,
          kind: node.kind,
          name: node.title,
          detail: beatLine(node.title, node.body),
          trigger: triggerFor(node, byId),
          links: node.links,
        });
      }
    }
    switch (node.kind) {
      case "setting":
        compiled.lore.push({
          cardId: node.id,
          category: "geography",
          title: node.title,
          body: node.body,
          links: node.links,
        });
        break;
      case "backstory":
        compiled.lore.push({ cardId: node.id, category: "history", title: node.title, body: node.body, links: node.links });
        break;
      case "hook":
        compiled.quests.push(node.title);
        compiled.questCards.push(node.id);
        break;
      case "encounter":
        compiled.encounters.push({
          cardId: node.id,
          name: node.title,
          notes: node.body,
          ...(node.links.encounterId ? { encounterId: node.links.encounterId } : {}),
          ...(node.links.mapId ? { mapId: node.links.mapId } : {}),
          inArc: arcCard(node),
        });
        break;
      case "secret":
        // A secret is the one kind that must NOT become anything the party
        // can read. campaign_notes carries a visibility column and a DM
        // author kind, which is exactly the shape for it.
        compiled.notes.push({ cardId: node.id, title: node.title, body: node.body });
        break;
    }
  }
  compiled.arcBeats = compiled.arcPlan.map((beat) => beat.text);

  // The premise is the first thing on the board that says what the world is:
  // its history if there is any, otherwise where it happens.
  const premiseNode =
    ordered.find((node) => node.kind === "backstory") ??
    ordered.find((node) => node.kind === "setting");
  compiled.premise = premiseNode
    ? beatLine(premiseNode.title, premiseNode.body).slice(0, 600)
    : "";

  // Counted from the CARDS rather than from the output, because two kinds
  // compile to the same place: a board with events and no character moments
  // is still missing character moments.
  const present = new Set(ordered.map((node) => node.kind));
  compiled.emptyKinds = BEAT_KINDS.filter((kind) => !present.has(kind));

  return compiled;
}

export type CompileSummary = {
  // One line per thing the import will create, for the confirmation screen.
  lines: string[];
  // Why the arc will not be written, or "" when it will be.
  arcRefusal: string;
  total: number;
};

// What pressing the button will do, said before it is pressed.
//
// `targetHasArc` matters more than anything else here: a campaign already
// running has a spine the table has been playing, and replacing it with a
// board would silently delete everything the party has done. The board's
// beats are refused in that case unless the DM asks for them to join it as
// the next act, and the rest of the compile still lands.
export function summarizeCompile(
  compiled: CompiledBoard,
  targetHasArc: boolean,
  arcMode: "leave" | "append" = "leave",
): CompileSummary {
  const lines: string[] = [];
  if (compiled.lore.length) {
    lines.push(`${compiled.lore.length} lore ${compiled.lore.length === 1 ? "entry" : "entries"}`);
  }
  if (compiled.quests.length) {
    lines.push(`${compiled.quests.length} quest${compiled.quests.length === 1 ? "" : "s"}`);
  }
  if (compiled.encounters.length) {
    lines.push(
      `${compiled.encounters.length} prepared encounter${compiled.encounters.length === 1 ? "" : "s"}`,
    );
  }
  if (compiled.notes.length) {
    lines.push(`${compiled.notes.length} DM-only note${compiled.notes.length === 1 ? "" : "s"}`);
  }
  if (compiled.moments.length) {
    lines.push(
      `${compiled.moments.length} planned moment${compiled.moments.length === 1 ? "" : "s"} on routes that may not be taken`,
    );
  }

  let arcRefusal = "";
  if (targetHasArc && arcMode === "append") {
    if (compiled.arcBeats.length) {
      lines.push(`a new act of up to ${compiled.arcBeats.length} beat${compiled.arcBeats.length === 1 ? "" : "s"}`);
    } else {
      arcRefusal = "The board has nothing that happens on its main line, so there is no act to add.";
    }
  } else if (targetHasArc) {
    arcRefusal =
      "This campaign already has a story arc the table has been playing, so the board's beats are left here rather than written over it.";
  } else if (!compiled.premise) {
    arcRefusal =
      "The arc needs something that says what this world is. Add a place or a piece of history and it can be written.";
  } else if (compiled.arcBeats.length < MIN_ARC_BEATS) {
    arcRefusal = `An arc needs at least ${MIN_ARC_BEATS} things that happen; the board has ${compiled.arcBeats.length}.`;
  } else {
    lines.push(`a story arc of ${compiled.arcBeats.length} beats`);
  }

  return { lines, arcRefusal, total: lines.length };
}
