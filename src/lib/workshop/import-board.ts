import {
  IMPORT_KIND_LABELS,
  LINK_KINDS,
  LINK_WORDS,
  type BoardFacts,
  type ImportKind,
  type ImportPlan,
  type ImportWarning,
  type LinkKind,
} from "./import-kinds.ts";
import type { PlanInput } from "./import.ts";

// Planning the storyboard kind of an import (#156, #157, #159): what the
// board's cards pick that the import is or is not bringing, what the source's
// shared workshop brings, and how the board's beats meet the campaign's arc.
// Split from src/lib/workshop/import.ts to keep it under the project's
// 500-line cap. Pure, like the planner.

// What the board needs that this import is or is not bringing, and how its
// beats meet the campaign's arc. Everything here is said before the button
// because none of it is visible afterwards: a card that lost its NPC looks
// like a card that never had one.
export function planBoard(
  input: PlanInput,
  board: BoardFacts,
  arrives: (kind: ImportKind, id: string | undefined) => boolean,
  warnings: ImportWarning[],
  notes: ImportWarning[],
): NonNullable<ImportPlan["board"]> {
  const commonIds = (kind: LinkKind) => new Set(board.common?.links[kind] ?? []);
  const inSource = (kind: LinkKind, id: string) => (input.source[kind] ?? []).some((row) => row.id === id);
  let fightsAlong = 0;
  let missing = 0;
  for (const kind of LINK_KINDS) {
    const common = commonIds(kind);
    let lost = 0;
    for (const id of new Set(board.links[kind])) {
      if (common.has(id) || arrives(kind, id)) {
        continue;
      }
      if (!inSource(kind, id)) {
        missing += 1;
      } else if (kind === "encounters") {
        // A fight card keeps the fight its author picked, roster and all,
        // even when the encounters were not ticked (#156).
        fightsAlong += 1;
      } else {
        lost += 1;
      }
    }
    if (lost) {
      warnings.push({
        kind: "storyboard",
        message: `${lost} of the board's ${LINK_WORDS[kind]} ${lost === 1 ? "is" : "are"} not coming along, so the cards that pick ${lost === 1 ? "it" : "them"} arrive without ${lost === 1 ? "it" : "them"}. Tick ${IMPORT_KIND_LABELS[kind]} to keep those links.`,
      });
    }
  }
  if (missing) {
    warnings.push({
      kind: "storyboard",
      message: `${missing} card link${missing === 1 ? " points" : "s point"} at something that is no longer in the workshop and ${missing === 1 ? "is" : "are"} dropped.`,
    });
  }
  if (fightsAlong) {
    notes.push({
      kind: "storyboard",
      message: `${fightsAlong} fight card${fightsAlong === 1 ? " brings the prepared fight it picks" : "s bring the prepared fights they pick"} (roster, map settings, rewards) even though Prepared encounters is not ticked.`,
    });
  }
  if (board.common) {
    let reused = 0;
    let copied = 0;
    for (const kind of LINK_KINDS) {
      const already = new Set(input.commonHere?.[kind] ?? []);
      for (const id of new Set(board.common.links[kind])) {
        if (already.has(id)) {
          reused += 1;
        } else {
          copied += 1;
        }
      }
    }
    if (reused || copied) {
      notes.push({
        kind: "storyboard",
        message: `From the shared workshop "${board.common.title}": ${[
          copied ? `${copied} record${copied === 1 ? "" : "s"} copied in` : "",
          reused ? `${reused} already in this campaign and reused` : "",
        ]
          .filter(Boolean)
          .join(", ")}.`,
      });
    }
  }
  if (board.moments) {
    notes.push({
      kind: "storyboard",
      message: `${board.moments} scene${board.moments === 1 ? " sits" : "s sit"} on an alternative or optional route. ${board.moments === 1 ? "It arrives" : "They arrive"} as planned moments the storyteller fires or drops when the party gets there, not as beats the party must play.`,
    });
  }

  const arc = input.targetArc ?? (input.targetHasArc ? { beats: [], acts: 1, room: 0, actRoom: false } : null);
  const mode = input.arcMode ?? "leave";
  const known = new Set((arc?.beats ?? []).map((beat) => beat.trim().toLowerCase()));
  const fresh = board.beats.filter((beat) => !known.has(beat.trim().toLowerCase()));
  const plan = {
    targetHasArc: Boolean(arc),
    arcMode: mode,
    beats: board.beats.length,
    newBeats: arc ? Math.min(fresh.length, arc.room) : board.beats.length,
    act: arc ? arc.acts + 1 : 1,
  };
  if (!arc) {
    if (board.arcProblem && board.beats.length) {
      warnings.push({ kind: "storyboard", message: `${board.arcProblem} Until then the board's beats are left out.` });
    }
    return plan;
  }
  if (mode === "leave") {
    warnings.push({
      kind: "storyboard",
      message: `This campaign already has a story arc. The board's places, quests, fights and notes still land; its beats do not overwrite the spine the table has been playing.${board.beats.length ? " Add them as the next act to keep them." : ""}`,
    });
    plan.newBeats = 0;
    return plan;
  }
  if (!arc.actRoom || !arc.room) {
    warnings.push({
      kind: "storyboard",
      message: "This arc is already as long as an arc gets, so the board's beats cannot join it.",
    });
    plan.newBeats = 0;
    return plan;
  }
  const repeated = board.beats.length - fresh.length;
  if (repeated) {
    notes.push({
      kind: "storyboard",
      message: `${repeated} of the board's beats ${repeated === 1 ? "is" : "are"} already in the arc, so ${repeated === 1 ? "it is" : "they are"} not added twice.`,
    });
  }
  if (fresh.length > arc.room) {
    warnings.push({
      kind: "storyboard",
      message: `The arc has room for ${arc.room} more beat${arc.room === 1 ? "" : "s"}; the last ${fresh.length - arc.room} of the board's are left out.`,
    });
  }
  if (plan.newBeats) {
    notes.push({
      kind: "storyboard",
      message: `${plan.newBeats} beat${plan.newBeats === 1 ? "" : "s"} arrive${plan.newBeats === 1 ? "s" : ""} as act ${plan.act}, after the ${arc.beats.length} already in the arc. Played and skipped beats, and the acts already recapped, are untouched.`,
    });
  }
  return plan;
}

