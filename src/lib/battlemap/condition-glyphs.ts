// One glyph per condition the engine can put on a creature, drawn as an SVG
// symbol once in the board's <defs> and referenced by every token that
// carries it. The paths are 16-unit Lucide-style strokes, hand-reduced so
// forty tokens with four badges each cost 160 <use> nodes and nothing more.
// Pure and dependency-free so the board and the tracker share it.

export type GlyphTone = "harm" | "ward" | "bless" | "neutral";

export type ConditionGlyph = {
  id: string;
  label: string;
  tone: GlyphTone;
  // SVG path data on a 0..16 grid, stroked, no fill.
  path: string;
};

const HARM = "harm";
const WARD = "ward";
const BLESS = "bless";
const NEUTRAL = "neutral";

export const CONDITION_GLYPHS: Record<string, ConditionGlyph> = {
  blinded: { id: "blinded", label: "Blinded", tone: HARM, path: "M2 2l12 12M2 8c2-3 4-4 6-4 1 0 2 .3 3 .8M14 8c-2 3-4 4-6 4-1 0-2-.3-3-.8" },
  charmed: { id: "charmed", label: "Charmed", tone: NEUTRAL, path: "M8 14s-6-3.5-6-8a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4.5-6 8-6 8z" },
  deafened: { id: "deafened", label: "Deafened", tone: HARM, path: "M4 6a4 4 0 0 1 8 0c0 2-2 3-2 5a2 2 0 0 1-4 0M2 2l12 12" },
  frightened: { id: "frightened", label: "Frightened", tone: HARM, path: "M8 2a5 5 0 0 1 5 5v7l-2-2-1.5 2L8 12l-1.5 2L5 12l-2 2V7a5 5 0 0 1 5-5zM6 7h1M9 7h1" },
  grappled: { id: "grappled", label: "Grappled", tone: HARM, path: "M3 9V5a1.5 1.5 0 0 1 3 0v3M6 8V4a1.5 1.5 0 0 1 3 0v4M9 8V5a1.5 1.5 0 0 1 3 0v4c0 3-2 5-4.5 5S3 12 3 9" },
  incapacitated: { id: "incapacitated", label: "Incapacitated", tone: HARM, path: "M2 8h12M5 5l2 2M11 5l-2 2M5 11l2-2M11 11l-2-2" },
  invisible: { id: "invisible", label: "Invisible", tone: WARD, path: "M2 8c2-3 4-4 6-4s4 1 6 4c-2 3-4 4-6 4s-4-1-6-4z M8 6.5a1.5 1.5 0 1 0 0 3" },
  paralyzed: { id: "paralyzed", label: "Paralyzed", tone: HARM, path: "M9 2L4 9h4l-1 5 5-7H8l1-5z" },
  petrified: { id: "petrified", label: "Petrified", tone: HARM, path: "M3 13l2-8 3-3 3 3 2 8H3zM6 9h4" },
  poisoned: { id: "poisoned", label: "Poisoned", tone: HARM, path: "M8 2c2 3 4 5 4 8a4 4 0 0 1-8 0c0-3 2-5 4-8z" },
  prone: { id: "prone", label: "Prone", tone: NEUTRAL, path: "M2 12h12M4 12c0-3 2-5 5-5h3v5M12 5a1.5 1.5 0 1 0 0-3" },
  restrained: { id: "restrained", label: "Restrained", tone: HARM, path: "M4 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 6l4 4" },
  stunned: { id: "stunned", label: "Stunned", tone: HARM, path: "M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.4 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" },
  unconscious: { id: "unconscious", label: "Unconscious", tone: HARM, path: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM5 9c1 1.5 5 1.5 6 0M6 6h1M9 6h1" },
  exhaustion: { id: "exhaustion", label: "Exhaustion", tone: HARM, path: "M3 3h10M3 13h10M5 3c0 3 3 4 3 5s-3 2-3 5M11 3c0 3-3 4-3 5s3 2 3 5" },
  concentrating: { id: "concentrating", label: "Concentrating", tone: BLESS, path: "M8 2v3M8 11v3M2 8h3M11 8h3M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" },
  dodging: { id: "dodging", label: "Dodging", tone: WARD, path: "M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4l5-2z" },
  raging: { id: "raging", label: "Raging", tone: HARM, path: "M8 2l2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1 2-4z" },
  hidden: { id: "hidden", label: "Hidden", tone: WARD, path: "M8 2C4 2 2 6 2 8s2 6 6 6 6-4 6-6-2-6-6-6zM5 8h6" },
  blessed: { id: "blessed", label: "Blessed", tone: BLESS, path: "M8 2v12M4 6h8M5 11h6" },
  hasted: { id: "hasted", label: "Hasted", tone: BLESS, path: "M2 5h6M2 8h9M2 11h6M11 4l3 4-3 4" },
  slowed: { id: "slowed", label: "Slowed", tone: HARM, path: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3l2 2" },
  cursed: { id: "cursed", label: "Cursed", tone: HARM, path: "M3 3l10 10M13 3L3 13M8 2v12" },
  marked: { id: "marked", label: "Marked", tone: HARM, path: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 7a1 1 0 1 0 0 2" },
  shielded: { id: "shielded", label: "Shielded", tone: WARD, path: "M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4l5-2zM6 8l1.5 1.5L10.5 6" },
  flying: { id: "flying", label: "Flying", tone: NEUTRAL, path: "M2 9c2-4 4-5 6-5s4 1 6 5c-2-1-4-1-6 0-2-1-4-1-6 0z" },
  burrowing: { id: "burrowing", label: "Burrowing", tone: NEUTRAL, path: "M2 7h12M4 7c1 3 2 5 4 5s3-2 4-5" },
};

const DEFAULT_GLYPH: ConditionGlyph = {
  id: "effect",
  label: "Effect",
  tone: NEUTRAL,
  path: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v4M8 11v.5",
};

// Conditions arrive as free text ("exhaustion 2", "Hidden", "raging").
// Normalise, then look for the longest known key the text starts with.
export function glyphFor(condition: string): ConditionGlyph {
  const key = condition.trim().toLowerCase();
  if (CONDITION_GLYPHS[key]) {
    return CONDITION_GLYPHS[key];
  }
  const head = key.split(/[\s:(]/)[0] ?? "";
  if (CONDITION_GLYPHS[head]) {
    return CONDITION_GLYPHS[head];
  }
  return { ...DEFAULT_GLYPH, label: condition.trim() || DEFAULT_GLYPH.label };
}

export const GLYPH_TONE_COLOR: Record<GlyphTone, string> = {
  harm: "#e0703a",
  ward: "#7fb8e6",
  bless: "#d4ab3a",
  neutral: "#d6cfc2",
};

// How many badges fit on a token before the rest collapse into a count.
export const MAX_BADGES = 4;
