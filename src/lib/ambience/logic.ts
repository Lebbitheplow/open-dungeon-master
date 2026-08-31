// What is playing at this table, and the rules for changing it.
//
// Three layers, and only three, because a table can hold three things in
// their heads: a BED (where they are), MUSIC (what the scene is doing to
// them) and a STING (one thing, once). Beds and music are state and persist;
// a sting is an event and is gone the moment it has played.
//
// Two callers write this state and they are not equals. A person or the AI
// DM naming a cue outright is a DECISION; the engine inferring one from a
// place description is a GUESS. A guess never overwrites a decision that was
// held, which is the whole reason `held` exists: without it, a DM who set
// the tavern bed by hand would watch the next `move_party` throw it away.
//
// Pure by design: no imports beyond the catalog, no I/O.
// scripts/test-ambience.mjs loads it directly.
import { AMBIENCE_CUES, cueById, type AmbienceCue, type AmbienceLayer } from "@/lib/ambience/catalog";

const BY_LAYER: Record<AmbienceLayer, AmbienceCue[]> = {
  bed: AMBIENCE_CUES.filter((cue) => cue.layer === "bed"),
  music: AMBIENCE_CUES.filter((cue) => cue.layer === "music"),
  sting: AMBIENCE_CUES.filter((cue) => cue.layer === "sting"),
};

export type AmbienceState = {
  // Cue ids, or null for silence on that layer.
  bed: string | null;
  music: string | null;
  // Layers the table pinned. Automatic scene tracking leaves these alone
  // until somebody names another cue outright or unpins them.
  held: AmbienceLayer[];
  updatedAt: string;
};

export const EMPTY_AMBIENCE: AmbienceState = {
  bed: null,
  music: null,
  held: [],
  updatedAt: "",
};

function cueOfLayer(value: unknown, layer: AmbienceLayer): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const cue = cueById(value);
  // A cue id from a catalog that has since dropped it, or one filed under
  // the wrong layer, reads as silence rather than as a 404 every client
  // retries forever.
  return cue && cue.layer === layer ? cue.id : null;
}

export function normalizeAmbience(raw: unknown): AmbienceState {
  if (!raw || typeof raw !== "object") {
    return EMPTY_AMBIENCE;
  }
  const record = raw as Record<string, unknown>;
  const bed = cueOfLayer(record.bed, "bed");
  const music = cueOfLayer(record.music, "music");
  const rawHeld: unknown[] = Array.isArray(record.held) ? record.held : [];
  const held = (["bed", "music"] as const).filter((layer) => rawHeld.includes(layer));
  return {
    bed,
    music,
    // Holding a layer that is silent means nothing and would quietly block
    // every future inference, so it is dropped on the way in.
    held: held.filter((layer) => (layer === "bed" ? bed : music) !== null),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

export function sameAmbience(a: AmbienceState, b: AmbienceState): boolean {
  return (
    a.bed === b.bed &&
    a.music === b.music &&
    a.held.length === b.held.length &&
    a.held.every((layer) => b.held.includes(layer))
  );
}

// A decision: somebody named this cue. Passing null silences the layer, and
// silence is never held (there is nothing to protect).
export function setCue(
  state: AmbienceState,
  layer: "bed" | "music",
  cueId: string | null,
  options: { hold?: boolean; at?: string } = {},
): { state: AmbienceState; changed: boolean } {
  const resolved = cueId === null ? null : cueOfLayer(cueId, layer);
  const hold = Boolean(options.hold) && resolved !== null;
  const held = state.held.filter((entry) => entry !== layer);
  if (hold) {
    held.push(layer);
  }
  const next: AmbienceState = {
    ...state,
    [layer]: resolved,
    held,
    updatedAt: options.at ?? state.updatedAt,
  };
  return { state: next, changed: !sameAmbience(state, next) };
}

// A guess: the engine read the scene and thinks this fits. Held layers are
// left alone, and so is a layer the guess has no opinion about (undefined,
// which is not the same as null: null is "make it silent").
export function applyAuto(
  state: AmbienceState,
  guess: { bed?: string | null; music?: string | null },
  at?: string,
): { state: AmbienceState; changed: boolean } {
  let next = state;
  for (const layer of ["bed", "music"] as const) {
    const value = guess[layer];
    if (value === undefined || state.held.includes(layer)) {
      continue;
    }
    next = setCue(next, layer, value, { at }).state;
  }
  return { state: next, changed: !sameAmbience(state, next) };
}

// ---- reading a scene ----

// Word-boundary matching on a space-padded, letters-only copy of the text,
// so "sea" never fires on "season" and a two-word keyword still matches.
function padded(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

export type CueGuess = { cueId: string; score: number } | null;

// The best cue for a piece of narration or a place description, or null when
// nothing in it says anything about sound. Longer keyword phrases outscore
// shorter ones ("dark forest" beats "forest"), so the specific cue wins.
export function inferCue(text: string, layer: AmbienceLayer): CueGuess {
  const haystack = padded(String(text ?? ""));
  if (haystack.trim().length < 3) {
    return null;
  }
  let best: CueGuess = null;
  for (const cue of BY_LAYER[layer]) {
    let score = 0;
    for (const keyword of cue.keywords) {
      const needle = padded(keyword);
      if (needle.trim() && haystack.includes(needle)) {
        score += needle.trim().split(" ").length;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { cueId: cue.id, score };
    }
  }
  return best;
}

export function inferBedCue(text: string): string | null {
  return inferCue(text, "bed")?.cueId ?? null;
}

// ---- describing it ----

// One line for the table note and for the tool result the model reads back.
export function describeAmbience(state: AmbienceState): string {
  const bed = state.bed ? cueById(state.bed)?.label : null;
  const music = state.music ? cueById(state.music)?.label : null;
  if (!bed && !music) {
    return "The room goes quiet.";
  }
  const parts = [bed ? bed.toLowerCase() : null, music ? `${music.toLowerCase()} music` : null];
  return `Now playing: ${parts.filter(Boolean).join(", ")}.`;
}
