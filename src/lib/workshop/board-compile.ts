import { BEAT_KINDS, boardGraph, type Beat, type BeatKind } from "./board.ts";

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
//   encounter           -> encounter_templates
//   secret              -> DM-only campaign notes
//
// Pure by design: no "@/" imports and no I/O, so the whole decision table is
// testable. The rim that writes the rows is src/lib/db/content-import.ts.

export type CompiledLore = { category: "history" | "geography"; title: string; body: string };
export type CompiledEncounter = { name: string; notes: string };
export type CompiledNote = { title: string; body: string };

export type CompiledBoard = {
  lore: CompiledLore[];
  // In reading order, following the edges the DM drew.
  arcBeats: string[];
  quests: string[];
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

export function compileBoard(beats: Beat[]): CompiledBoard {
  const board = boardGraph(beats);
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  // Reading order, so the arc beats come out in the order the DM's arrows
  // say they happen rather than in the order the cards were typed.
  const ordered = board.order.map((id) => byId.get(id)!).filter(Boolean);

  const compiled: CompiledBoard = {
    lore: [],
    arcBeats: [],
    quests: [],
    encounters: [],
    notes: [],
    premise: "",
    emptyKinds: [],
  };

  for (const node of ordered) {
    switch (node.kind) {
      case "setting":
        compiled.lore.push({
          category: "geography",
          title: node.title,
          body: node.body,
        });
        break;
      case "backstory":
        compiled.lore.push({ category: "history", title: node.title, body: node.body });
        break;
      case "event":
      case "npc_moment":
        compiled.arcBeats.push(beatLine(node.title, node.body));
        break;
      case "hook":
        compiled.quests.push(node.title);
        break;
      case "encounter":
        compiled.encounters.push({ name: node.title, notes: node.body });
        break;
      case "secret":
        // A secret is the one kind that must NOT become anything the party
        // can read. campaign_notes carries a visibility column and a DM
        // author kind, which is exactly the shape for it.
        compiled.notes.push({ title: node.title, body: node.body });
        break;
    }
  }

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
// beats are refused in that case, and the rest of the compile still lands.
export function summarizeCompile(
  compiled: CompiledBoard,
  targetHasArc: boolean,
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

  let arcRefusal = "";
  if (targetHasArc) {
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
