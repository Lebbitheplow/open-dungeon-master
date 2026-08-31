// The storyboard: the prep a DM does that is not a map, a monster or a
// person, but the shape of what is going to happen.
//
// It is the one genuinely new subsystem in the workshop, so it stays small on
// purpose (docs/workshop-plan.md phase 7). A board is typed nodes with edges
// between them, and the type list is short because each type has to have
// somewhere to LAND at the campaign end. A node kind that compiles into
// nothing is a node kind that should not exist, which is the test
// board-compile.ts applies.
//
// Pure by design: no "@/" imports and no I/O, so
// scripts/test-workshop-board.mjs can drive the whole thing without a
// database. The rim is src/lib/db/workshop-beats.ts.

export const BEAT_KINDS = [
  "setting",
  "backstory",
  "event",
  "encounter",
  "hook",
  "secret",
  "npc_moment",
] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];

export const BEAT_LABELS: Record<BeatKind, string> = {
  setting: "Place",
  backstory: "What happened before",
  event: "Something happens",
  encounter: "A fight",
  hook: "A reason to go",
  secret: "Something hidden",
  npc_moment: "Somebody's moment",
};

// What each kind is FOR, in the DM's own terms. Shown on the card, because a
// board whose node types have to be explained in documentation is a board
// nobody will use correctly.
export const BEAT_HINTS: Record<BeatKind, string> = {
  setting: "Somewhere the party can stand. Becomes a lore entry.",
  backstory: "What is already true when the campaign opens. Becomes a lore entry.",
  event: "A thing that happens, whether or not the party is there. Becomes an arc beat.",
  encounter: "A fight worth preparing. Becomes a prepared encounter.",
  hook: "Why the party would walk toward any of this. Becomes a quest.",
  secret: "What the party is not told. Becomes a DM-only note.",
  npc_moment: "The scene somebody has been waiting for. Becomes an arc beat.",
};

export const TITLE_MAX = 120;
export const BODY_MAX = 2_000;
export const MAX_EDGES = 8;
export const MAX_BEATS = 120;

// What a beat can point at. All optional, all ids of rows in the SAME
// workshop, because a beat linking something in another campaign would break
// the moment it was imported.
export type BeatLinks = {
  npcId?: string;
  mapId?: string;
  encounterId?: string;
  locationId?: string;
};

export type Beat = {
  id: string;
  kind: BeatKind;
  title: string;
  body: string;
  links: BeatLinks;
  // Beats this one leads to. Direction matters: it is what makes a hook with
  // no payoff detectable.
  edges: string[];
  x: number;
  y: number;
};

export function normalizeBeatKind(raw: unknown): BeatKind {
  return (BEAT_KINDS as readonly string[]).includes(raw as string)
    ? (raw as BeatKind)
    : "event";
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function id(value: unknown): string | undefined {
  const trimmed = text(value, 64);
  return trimmed || undefined;
}

export function normalizeLinks(raw: unknown): BeatLinks {
  const source = (raw ?? {}) as Record<string, unknown>;
  const links: BeatLinks = {};
  for (const field of ["npcId", "mapId", "encounterId", "locationId"] as const) {
    const value = id(source[field]);
    if (value) {
      links[field] = value;
    }
  }
  return links;
}

export type BeatCheck = { beat: Omit<Beat, "id"> } | { error: string };

// A beat needs a title. Everything else is optional, because the board is
// where half-formed ideas go and a form that refuses one is a form a DM
// stops opening.
export function checkBeat(raw: unknown): BeatCheck {
  const source = (raw ?? {}) as Record<string, unknown>;
  const title = text(source.title, TITLE_MAX);
  if (!title) {
    return { error: "A card needs a title, even a bad one." };
  }
  const edges = (Array.isArray(source.edges) ? source.edges : [])
    .map((edge) => text(edge, 64))
    .filter(Boolean)
    .slice(0, MAX_EDGES);
  const coordinate = (value: unknown) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(4_000, Math.max(0, number)) : 0;
  };
  return {
    beat: {
      kind: normalizeBeatKind(source.kind),
      title,
      body: text(source.body, BODY_MAX),
      links: normalizeLinks(source.links),
      edges: [...new Set(edges)],
      x: coordinate(source.x),
      y: coordinate(source.y),
    },
  };
}

// ---- the graph ----

export type BoardNode = Beat & {
  // Edges that survived: an edge to a card that has been deleted is dropped
  // rather than rendered as a line to nowhere.
  out: string[];
  in: string[];
};

export type Board = {
  nodes: BoardNode[];
  // Reading order, for anything that has to turn a board into a list.
  order: string[];
  // Edges naming a card that no longer exists, so the panel can say a link
  // was lost rather than quietly losing it.
  brokenEdges: number;
};

// A board is a graph a person drew, so it can have cycles. Depth-first
// ordering with a visited set handles that: the answer is the order the
// cards read in, not a proof that the story is acyclic.
function readingOrder(nodes: BoardNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const order: string[] = [];
  const walk = (nodeId: string) => {
    if (seen.has(nodeId)) {
      return;
    }
    seen.add(nodeId);
    order.push(nodeId);
    for (const next of byId.get(nodeId)?.out ?? []) {
      walk(next);
    }
  };
  // Roots first, so a chain reads from its beginning. A board that is all
  // cycles has no roots, and the fallback below walks it in stored order.
  for (const node of nodes.filter((entry) => entry.in.length === 0)) {
    walk(node.id);
  }
  for (const node of nodes) {
    walk(node.id);
  }
  return order;
}

export function boardGraph(beats: Beat[]): Board {
  const ids = new Set(beats.map((beat) => beat.id));
  let brokenEdges = 0;
  const nodes: BoardNode[] = beats.map((beat) => {
    const out = beat.edges.filter((edge) => {
      const ok = ids.has(edge) && edge !== beat.id;
      if (!ok) {
        brokenEdges += 1;
      }
      return ok;
    });
    return { ...beat, out, in: [] };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const edge of node.out) {
      byId.get(edge)?.in.push(node.id);
    }
  }
  return { nodes, order: readingOrder(nodes), brokenEdges };
}

// ---- suggestions ----

// What the workshop already holds, so the board can notice something written
// that nothing on the board uses.
export type BoardInventory = {
  npcs: Array<{ id: string; name: string }>;
  maps: Array<{ id: string; name: string }>;
  encounters: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
};

export function emptyInventory(): BoardInventory {
  return { npcs: [], maps: [], encounters: [], locations: [] };
}

export type Suggestion = {
  // Stable across reloads: derived from what the suggestion is about, not
  // from where it landed in the list.
  id: string;
  kind: BeatKind;
  title: string;
  reason: string;
  aboutBeatId: string | null;
  weight: number;
};

export const MAX_SUGGESTIONS = 8;

// What is missing from a board, worked out by counting.
//
// This is deliberately NOT a model call. dm/assist-logic.ts is the precedent:
// a suggestion a DM can check is worth more than one they have to trust, and
// "you have written four factions and no reason for the party to care about
// any of them" is arithmetic, not insight. The model is offered on top, for
// the prose of a card once a DM has decided to write it.
export function suggestTopics(beats: Beat[], inventory: BoardInventory): Suggestion[] {
  const board = boardGraph(beats);
  const suggestions: Suggestion[] = [];
  const has = (kind: BeatKind) => board.nodes.some((node) => node.kind === kind);
  const add = (suggestion: Suggestion) => suggestions.push(suggestion);

  // The structural gaps: a board missing one of these is missing a whole
  // half of the prep, and no amount of detail elsewhere makes up for it.
  if (board.nodes.length && !has("hook")) {
    add({
      id: "missing:hook",
      kind: "hook",
      title: "Why would they go?",
      reason:
        "There is nothing on the board a party would walk toward. Everything here happens whether they turn up or not.",
      aboutBeatId: null,
      weight: 6,
    });
  }
  if (board.nodes.length && !has("setting")) {
    add({
      id: "missing:setting",
      kind: "setting",
      title: "Where this happens",
      reason: "Nothing on the board is anywhere. The first question at the table is where they are.",
      aboutBeatId: null,
      weight: 5,
    });
  }
  if (has("backstory") && !has("event")) {
    add({
      id: "missing:event",
      kind: "event",
      title: "What it leads to",
      reason:
        "There is history here and nothing happening. Backstory the party never collides with is backstory they never learn.",
      aboutBeatId: null,
      weight: 5,
    });
  }

  for (const node of board.nodes) {
    // A hook that leads nowhere is a promise with no payoff: the party takes
    // the job and the prep runs out.
    if (node.kind === "hook" && node.out.length === 0) {
      add({
        id: `payoff:${node.id}`,
        kind: "event",
        title: `What happens when they follow "${node.title}"`,
        reason: `"${node.title}" is a reason to go somewhere, and nothing on the board is what they find.`,
        aboutBeatId: node.id,
        weight: 4,
      });
    }
    // A fight nobody has a reason to be in.
    if (node.kind === "encounter" && node.in.length === 0) {
      add({
        id: `reason:${node.id}`,
        kind: "hook",
        title: `Why they are at "${node.title}"`,
        reason: `"${node.title}" is a fight with nothing leading into it.`,
        aboutBeatId: node.id,
        weight: 3,
      });
    }
    // A secret nothing reveals stays secret forever, which makes it scenery.
    if (node.kind === "secret" && node.in.length === 0) {
      add({
        id: `reveal:${node.id}`,
        kind: "event",
        title: `How they find out about "${node.title}"`,
        reason: `Nothing on the board reveals "${node.title}". A secret with no way in is one the table never learns.`,
        aboutBeatId: node.id,
        weight: 3,
      });
    }
    // A character moment floating on its own.
    if (node.kind === "npc_moment" && node.in.length === 0 && node.out.length === 0) {
      add({
        id: `context:${node.id}`,
        kind: "event",
        title: `What sets up "${node.title}"`,
        reason: `"${node.title}" is somebody's big scene with nothing on either side of it.`,
        aboutBeatId: node.id,
        weight: 3,
      });
    }
  }

  // Things written elsewhere in the workshop that the board never uses. This
  // is the check a DM cannot do by eye once the workshop has thirty NPCs.
  const linked = (field: keyof BeatLinks) =>
    new Set(board.nodes.map((node) => node.links[field]).filter(Boolean) as string[]);
  const unused: Array<[keyof BeatLinks, keyof BoardInventory, BeatKind, string]> = [
    ["npcId", "npcs", "npc_moment", "never appears in anything on the board"],
    ["mapId", "maps", "encounter", "is a map nobody visits"],
    ["encounterId", "encounters", "hook", "is a prepared fight nothing leads to"],
    ["locationId", "locations", "setting", "is a place nothing happens in"],
  ];
  for (const [field, bucket, kind, why] of unused) {
    const used = linked(field);
    for (const entry of inventory[bucket]) {
      if (!used.has(entry.id)) {
        add({
          id: `unused:${bucket}:${entry.id}`,
          kind,
          title: entry.name,
          reason: `${entry.name} ${why}.`,
          aboutBeatId: null,
          weight: 2,
        });
      }
    }
  }

  // A card nobody drew a line to or from. Places and history are allowed to
  // sit on their own; anything that HAPPENS is not.
  for (const node of board.nodes) {
    const floating =
      node.in.length === 0 &&
      node.out.length === 0 &&
      node.kind !== "setting" &&
      node.kind !== "backstory" &&
      !suggestions.some((suggestion) => suggestion.aboutBeatId === node.id);
    if (floating) {
      add({
        id: `link:${node.id}`,
        kind: node.kind,
        title: node.title,
        reason: `"${node.title}" is not connected to anything else on the board.`,
        aboutBeatId: node.id,
        weight: 1,
      });
    }
  }

  return suggestions.sort((a, b) => b.weight - a.weight).slice(0, MAX_SUGGESTIONS);
}
