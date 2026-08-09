import {
  reseatActiveBeat,
  type ArcBeat,
  type StoryArc,
} from "./arc-logic.ts";

// The party lead's hand on the arc's main beats.
//
// Today the only lever is POST /arc, which throws the whole spine away and
// generates a new one. That is a sledgehammer: a lead who dislikes one beat
// loses the antagonist, the cast, the events, and every act sketch with it.
//
// The idea of a directly editable outline comes from NarrativeEngine-P's
// story-outline panel (MIT, Copyright (c) 2026 Sagesheep), where the GM edits
// beats in place. ODM's constraint is stricter, and it is the constraint that
// shapes this module: beat TEXT is immutable once settled. A done or skipped
// beat is a record of what happened at the table, so nothing here can rename
// it, move it, or reopen it. Every operation below either targets an unsettled
// beat or is refused with a reason.
//
// Deterministic and model-free: this is the lead typing, not the DM thinking.
//
// Alias-free so scripts/test-arc-edit.mjs can import it directly.

export const MAX_BEAT_TEXT = 220;
// Matches MAX_BEATS in arc-logic.ts. A lead adding beats one at a time must
// not be able to walk past the cap the model's own additions respect.
export const MAX_TOTAL_BEATS = 40;

export type BeatEdit =
  | { op: "rename"; beat: number; text: string }
  | { op: "move"; beat: number; direction: "up" | "down" }
  | { op: "skip"; beat: number }
  | { op: "setNow"; beat: number }
  | { op: "add"; act: number; text: string };

export type EditResult = { arc: StoryArc } | { error: string };

export function isEditError(result: EditResult): result is { error: string } {
  return "error" in result;
}

function settled(beat: ArcBeat): boolean {
  return beat.status === "done" || beat.status === "skipped";
}

// Only the beats are ever touched here, so a shallow clone of that one array
// is the whole copy. Saga, cast, events, and sub-arcs are shared by reference
// with the input on purpose: nothing below can reach them.
function withBeats(arc: StoryArc, beats: ArcBeat[]): StoryArc {
  return { ...arc, beats, updatedAt: new Date().toISOString() };
}

function copyBeats(arc: StoryArc): ArcBeat[] {
  return arc.beats.map((beat) => ({ ...beat }));
}

export function clampBeatText(raw: string): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BEAT_TEXT);
}

export function applyBeatEdit(arc: StoryArc, edit: BeatEdit): EditResult {
  if (edit.op === "add") {
    const text = clampBeatText(edit.text);
    if (!text) {
      return { error: "A beat needs some text." };
    }
    if (arc.beats.length >= MAX_TOTAL_BEATS) {
      return { error: `The arc is already at its ${MAX_TOTAL_BEATS}-beat limit.` };
    }
    const act = Math.floor(edit.act);
    if (!Number.isFinite(act) || act < 1 || act > arc.acts) {
      return { error: "That act does not exist yet." };
    }
    const beats = copyBeats(arc);
    // Appended after the last beat of its act rather than at the very end, so
    // acts stay contiguous and the [NOW] cursor keeps advancing in order.
    let insertAt = 0;
    beats.forEach((beat, index) => {
      if (beat.act <= act) {
        insertAt = index + 1;
      }
    });
    beats.splice(insertAt, 0, { text, status: "pending", act });
    // A brand-new beat can become [NOW] only when nothing else is unsettled,
    // which is exactly what reseating with no request works out.
    if (!beats.some((beat) => beat.status === "active")) {
      reseatActiveBeat(beats, null);
    }
    return { arc: withBeats(arc, beats) };
  }

  const index = Math.floor(edit.beat) - 1;
  const target = arc.beats[index];
  if (!target) {
    return { error: "That beat does not exist." };
  }

  if (edit.op === "rename") {
    if (settled(target)) {
      return { error: "That beat already played. Its text is part of the record now." };
    }
    const text = clampBeatText(edit.text);
    if (!text) {
      return { error: "A beat needs some text." };
    }
    const beats = copyBeats(arc);
    beats[index].text = text;
    return { arc: withBeats(arc, beats) };
  }

  if (edit.op === "skip") {
    if (settled(target)) {
      return { error: "That beat is already settled." };
    }
    const beats = copyBeats(arc);
    beats[index].status = "skipped";
    // Skipping the beat the DM is steering by has to hand [NOW] onward, or
    // the arc stalls with no active beat at all.
    reseatActiveBeat(beats, null);
    return { arc: withBeats(arc, beats) };
  }

  if (edit.op === "setNow") {
    if (settled(target)) {
      return { error: "That beat already played; the story cannot go back to it." };
    }
    const beats = copyBeats(arc);
    reseatActiveBeat(beats, index + 1);
    return { arc: withBeats(arc, beats) };
  }

  // move
  const swapWith = edit.direction === "up" ? index - 1 : index + 1;
  const neighbour = arc.beats[swapWith];
  if (!neighbour) {
    return { error: "There is nothing to swap with in that direction." };
  }
  if (settled(target) || settled(neighbour)) {
    return { error: "Played beats stay where they are." };
  }
  if (target.act !== neighbour.act) {
    return { error: "Beats can only be reordered within their own act." };
  }
  const beats = copyBeats(arc);
  // Statuses stay with their positions, not with the text: swapping a pending
  // beat into the [NOW] slot is the point of moving it up.
  const movedText = beats[index].text;
  const movedDetail = beats[index].detail;
  beats[index].text = beats[swapWith].text;
  beats[index].detail = beats[swapWith].detail;
  beats[swapWith].text = movedText;
  beats[swapWith].detail = movedDetail;
  return { arc: withBeats(arc, beats) };
}
