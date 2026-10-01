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
  // What the later engine waves write (spells, subclass features, the turn's
  // end): each keyed by its name or its first word.
  inspiration: { id: "inspiration", label: "Inspiration", tone: BLESS, path: "M8 2l1.8 4 4.2.4-3.2 2.8 1 4.2L8 11.2 4.2 13.4l1-4.2L2 6.4 6.2 6 8 2z" },
  halted: { id: "halted", label: "Halted", tone: HARM, path: "M5 3h6l3 3v4l-3 3H5l-3-3V6l3-3zM6 8h4" },
  retching: { id: "retching", label: "Retching", tone: HARM, path: "M4 5c1-2 7-2 8 0M5 9c0 2 1.5 3 3 3s3-1 3-3M8 9v5" },
  wandering: { id: "wandering", label: "Wandering", tone: HARM, path: "M3 13c2-6 4 0 6-5s3-4 4-5M11 3h2v2" },
  dazed: { id: "dazed", label: "Dazed", tone: HARM, path: "M8 3a5 2 0 1 0 0 .1M4 9l1 1M12 9l-1 1M6 12h4" },
  commanded: { id: "commanded", label: "Commanded", tone: HARM, path: "M3 6h4l4-3v10l-4-3H3V6z" },
  enclosed: { id: "enclosed", label: "Enclosed", tone: WARD, path: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM4 6c2-1 6-1 8 0" },
  hurled: { id: "hurled", label: "Hurled through hell", tone: HARM, path: "M8 2c3 3 4 5 2 8-1 2-3 3-4 4 0-2-2-3-2-5 0-3 2-4 4-7zM8 14v0" },
  "no reactions (open hand)": { id: "reeling", label: "No reactions", tone: HARM, path: "M3 8h10M8 3v10M4 4l8 8" },
  undead: { id: "dread", label: "Undead dread", tone: HARM, path: "M4 3h8v6a4 4 0 0 1-8 0V3zM6 7h1M9 7h1M6 13h4" },
  "poisoned weapon": { id: "coated", label: "Poisoned weapon", tone: BLESS, path: "M3 13l7-7M10 6l2-4 2 2-4 2M5 9c-1 1-2 3 0 4" },
  squeezing: { id: "squeezing", label: "Squeezing", tone: NEUTRAL, path: "M2 3v10M14 3v10M5 8h6M6 6l-2 2 2 2M10 6l2 2-2 2" },
  holy: { id: "nimbus", label: "Holy nimbus", tone: BLESS, path: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13" },
  unmoved: { id: "unmoved", label: "Unmoved", tone: WARD, path: "M4 13V7l4-4 4 4v6H4zM7 10h2" },
  mocked: { id: "mocked", label: "Mocked", tone: HARM, path: "M3 5c2 1 3 1 5 0s3-1 5 0M5 10c1 2 5 2 6 0" },
  searing: { id: "searing", label: "Searing metal", tone: HARM, path: "M8 2c2 3 4 4 4 7a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-2 0-4 0-6z" },
  sickened: { id: "sickened", label: "Sickened", tone: HARM, path: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM5 10c1-1 5-1 6 0M6 6h1M9 6h1" },
  levitating: { id: "levitating", label: "Levitating", tone: NEUTRAL, path: "M8 2v8M5 5l3-3 3 3M4 13h8" },
  suggested: { id: "suggested", label: "Suggested", tone: NEUTRAL, path: "M3 4h10v6H7l-3 3v-3H3V4z" },
  gaseous: { id: "gaseous", label: "Gaseous form", tone: WARD, path: "M3 10c-1-3 2-5 4-4 1-3 6-2 6 1 2 0 2 3 0 3H3zM4 13h8" },
  enfeebled: { id: "enfeebled", label: "Enfeebled", tone: HARM, path: "M3 12l3-4 2 2 5-6M3 4h3" },
  regenerating: { id: "regenerating", label: "Regenerating", tone: BLESS, path: "M8 3v10M3 8h10M13 3a6 6 0 0 1 0 10" },
  foresight: { id: "foresight", label: "Foresight", tone: BLESS, path: "M2 8c2-3 4-4 6-4s4 1 6 4c-2 3-4 4-6 4s-4-1-6-4zM8 6v4M6 8h4" },
  mind: { id: "mindblank", label: "Mind blank", tone: WARD, path: "M8 2a5 5 0 0 0-5 5c0 2 1 3 2 4v3h6v-3c1-1 2-2 2-4a5 5 0 0 0-5-5zM6 7h4" },
  dancing: { id: "dancing", label: "Dancing", tone: HARM, path: "M8 2a1.5 1.5 0 1 0 0 3M8 5v4l-3 4M8 9l3 4M5 7l3-1 3 2" },
  // The SRD's diseases and madness (src/lib/srd/affliction-conditions.ts):
  // a sickness, the eye that rots, a mind that spirals, and the two remedies.
  cackle: { id: "cackle", label: "Cackle fever", tone: HARM, path: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M4 12l2-2" },
  sewer: { id: "sewer", label: "Sewer plague", tone: HARM, path: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M4 12l2-2" },
  sight: { id: "sightrot", label: "Sight rot", tone: HARM, path: "M2 7c2-3 4-4 6-4s4 1 6 4c-2 3-4 4-6 4s-4-1-6-4zM8 11v3M5 12v1M11 12v1" },
  madness: { id: "madness", label: "Madness", tone: HARM, path: "M8 8a1 1 0 1 1 1 1 2 2 0 1 1-2-2 3 3 0 1 1 3 3 4 4 0 1 1-4-4" },
  indefinite: { id: "indefinite", label: "Indefinite madness", tone: HARM, path: "M8 8a1 1 0 1 1 1 1 2 2 0 1 1-2-2 3 3 0 1 1 3 3 4 4 0 1 1-4-4" },
  hallucinating: { id: "hallucinating", label: "Hallucinating", tone: HARM, path: "M8 8a1 1 0 1 1 1 1 2 2 0 1 1-2-2 3 3 0 1 1 3 3 4 4 0 1 1-4-4" },
  paranoid: { id: "paranoid", label: "Paranoid", tone: HARM, path: "M8 8a1 1 0 1 1 1 1 2 2 0 1 1-2-2 3 3 0 1 1 3 3 4 4 0 1 1-4-4" },
  babbling: { id: "babbling", label: "Babbling", tone: HARM, path: "M8 8a1 1 0 1 1 1 1 2 2 0 1 1-2-2 3 3 0 1 1 3 3 4 4 0 1 1-4-4" },
  tremors: { id: "tremors", label: "Tremors", tone: HARM, path: "M2 5l2-2 2 2 2-2 2 2 2-2 2 2M2 11l2-2 2 2 2-2 2 2 2-2 2 2" },
  truth: { id: "truth", label: "Truth serum", tone: NEUTRAL, path: "M3 4h10v6H7l-3 3v-3H3V4zM6 7l1.5 1.5L10 6" },
  recuperated: { id: "recuperated", label: "Recuperated", tone: BLESS, path: "M8 14s-6-3.5-6-8a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4.5-6 8-6 8zM8 6v4M6 8h4" },
  eyebright: { id: "eyebright", label: "Eyebright ointment", tone: WARD, path: "M2 8c2-3 4-4 6-4s4 1 6 4c-2 3-4 4-6 4s-4-1-6-4zM6 8l1.5 1.5L10.5 6.5" },
  // The last spell rows (src/lib/srd/condition-effects-last.ts, -tail.ts):
  // the planes, the mind, the ways of moving a spell grants. Several words
  // spell names, so those are keyed by the whole name.
  blink: { id: "blink", label: "Blink", tone: WARD, path: "M8 2v3M8 11v3M3 8h2M11 8h2M5 5l1 1M10 10l1 1M11 5l-1 1M5 11l1-1" },
  blinked: { id: "blinked", label: "Blinked away", tone: WARD, path: "M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM8 3v10" },
  ethereal: { id: "ethereal", label: "Ethereal", tone: WARD, path: "M4 13c0-6 1-10 4-10s4 4 4 10l-2-1-2 1-2-1-2 1zM6.5 7h.5M9 7h.5" },
  etherealness: { id: "etherealness", label: "Etherealness", tone: WARD, path: "M4 13c0-6 1-10 4-10s4 4 4 10l-2-1-2 1-2-1-2 1zM6.5 7h.5M9 7h.5" },
  "see invisibility": { id: "seeinvis", label: "See invisibility", tone: BLESS, path: "M2 8c2-3 4-4 6-4s4 1 6 4c-2 3-4 4-6 4s-4-1-6-4zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" },
  "true seeing": { id: "trueseeing", label: "True seeing", tone: BLESS, path: "M2 8c2-3 4-4 6-4s4 1 6 4c-2 3-4 4-6 4s-4-1-6-4zM8 6a2 2 0 1 0 0 4M8 1v2M8 13v2" },
  feebleminded: { id: "feebleminded", label: "Feebleminded", tone: HARM, path: "M8 2a5 5 0 0 0-5 5c0 2 1 3 2 4v3h6v-3c1-1 2-2 2-4a5 5 0 0 0-5-5zM5 5l6 6" },
  feeblemind: { id: "feeblemind", label: "Feebleminded", tone: HARM, path: "M8 2a5 5 0 0 0-5 5c0 2 1 3 2 4v3h6v-3c1-1 2-2 2-4a5 5 0 0 0-5-5zM5 5l6 6" },
  mazed: { id: "mazed", label: "In a maze", tone: HARM, path: "M2 2h12v12H2zM5 2v9h6V5H8v3" },
  "in a maze": { id: "inamaze", label: "In a maze", tone: HARM, path: "M2 2h12v12H2zM5 2v9h6V5H8v3" },
  imprisoned: { id: "imprisoned", label: "Imprisoned", tone: HARM, path: "M3 3h10v10H3zM6 3v10M10 3v10" },
  calmed: { id: "calmed", label: "Calmed", tone: NEUTRAL, path: "M2 9c2-2 4-2 6 0s4 2 6 0M2 5c2-2 4-2 6 0s4 2 6 0" },
  "calm emotions": { id: "calmemotions", label: "Calm emotions", tone: NEUTRAL, path: "M2 9c2-2 4-2 6 0s4 2 6 0M2 5c2-2 4-2 6 0s4 2 6 0" },
  fleeing: { id: "fleeing", label: "Fleeing", tone: HARM, path: "M3 8h9M9 5l3 3-3 3M3 4h4M3 12h4" },
  "freedom of movement": { id: "freedom", label: "Freedom of movement", tone: BLESS, path: "M3 13l4-4M7 9l2-5 4 2-5 2M3 3l3 3" },
  "spider climb": { id: "spiderclimb", label: "Spider climb", tone: BLESS, path: "M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 3l4 4M14 3l-4 4M2 13l4-4M14 13l-4-4" },
  "water walk": { id: "waterwalk", label: "Water walk", tone: BLESS, path: "M2 12c2-1.5 4-1.5 6 0s4 1.5 6 0M6 9V4M10 9V4" },
  "jump (spell)": { id: "jumpspell", label: "Jump", tone: BLESS, path: "M3 13c2-8 8-8 10 0M13 13l-1-3M13 13l-3-1" },
  jumping: { id: "jumping", label: "Jump", tone: BLESS, path: "M3 13c2-8 8-8 10 0M13 13l-1-3M13 13l-3-1" },
  "wind walk": { id: "windwalk", label: "Wind walk", tone: WARD, path: "M2 6h8a2 2 0 1 0-2-2M2 10h10a2 2 0 1 1-2 2" },
  "heroes' feast": { id: "heroesfeast", label: "Heroes' feast", tone: BLESS, path: "M3 7h10a5 5 0 0 1-10 0zM8 2v3M5 3v2M11 3v2" },
  "heroes feast": { id: "heroesfeast2", label: "Heroes' feast", tone: BLESS, path: "M3 7h10a5 5 0 0 1-10 0zM8 2v3M5 3v2M11 3v2" },
  "dispel evil and good": { id: "dispelevil", label: "Dispel evil and good", tone: WARD, path: "M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4l5-2zM8 5v6M5.5 8h5" },
  "acid arrow": { id: "acidarrow", label: "Acid arrow", tone: HARM, path: "M3 13l8-8M8 4h3v3M4 9c-1 1-1 3 0 3s1-2 0-3" },
  "phantasmal killer": { id: "phantasmal", label: "Phantasmal killer", tone: HARM, path: "M4 13V7a4 4 0 0 1 8 0v6l-2-1-2 1-2-1-2 1zM6 7h1M9 7h1" },
  weird: { id: "weird", label: "Weird", tone: HARM, path: "M4 13V7a4 4 0 0 1 8 0v6l-2-1-2 1-2-1-2 1zM6 7h1M9 7h1M2 3l2 1M14 3l-2 1" },
  insane: { id: "insane", label: "Insane", tone: HARM, path: "M8 8a1 1 0 1 1 1 1 2 2 0 1 1-2-2 3 3 0 1 1 3 3 4 4 0 1 1-4-4M2 2l2 2M14 2l-2 2" },
  "indigo ray": { id: "indigoray", label: "Indigo ray", tone: HARM, path: "M2 13L13 2M9 2h4v4M3 10l3 3" },
  "violet ray": { id: "violetray", label: "Violet ray", tone: HARM, path: "M2 13L13 2M9 2h4v4M2 2l12 12" },
  "flesh to stone": { id: "fleshtostone", label: "Flesh to stone", tone: HARM, path: "M3 13l2-8 3-3 3 3 2 8H3zM6 9h4M6 11h4" },
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

// The painted condition icons (public/assets/icons/condition) cover the SRD
// conditions and the states the board shows most; every other glyph borrows
// the painting closest in meaning, so a chip never asks for a file that is
// not there. scripts/test-hand-look.mjs checks every glyph against disk.
const GLYPH_ICON: Record<string, string> = {
  effect: "marked",
  inspiration: "blessed",
  halted: "restrained",
  retching: "poisoned",
  wandering: "charmed",
  dazed: "stunned",
  commanded: "charmed",
  enclosed: "shielded",
  hurled: "cursed",
  reeling: "incapacitated",
  dread: "frightened",
  coated: "poisoned",
  squeezing: "restrained",
  nimbus: "blessed",
  unmoved: "shielded",
  mocked: "cursed",
  searing: "cursed",
  sickened: "poisoned",
  levitating: "flying",
  suggested: "charmed",
  gaseous: "flying",
  enfeebled: "exhaustion",
  regenerating: "blessed",
  foresight: "blessed",
  mindblank: "shielded",
  dancing: "charmed",
  cackle: "poisoned",
  sewer: "poisoned",
  sightrot: "blinded",
  madness: "frightened",
  indefinite: "frightened",
  hallucinating: "charmed",
  paranoid: "frightened",
  babbling: "charmed",
  tremors: "exhaustion",
  truth: "charmed",
  recuperated: "blessed",
  eyebright: "blessed",
  blink: "invisible",
  blinked: "invisible",
  ethereal: "invisible",
  etherealness: "invisible",
  seeinvis: "invisible",
  trueseeing: "invisible",
  feebleminded: "incapacitated",
  feeblemind: "incapacitated",
  mazed: "incapacitated",
  inamaze: "incapacitated",
  imprisoned: "restrained",
  calmed: "charmed",
  calmemotions: "charmed",
  fleeing: "frightened",
  freedom: "hasted",
  spiderclimb: "hasted",
  waterwalk: "hasted",
  jumpspell: "hasted",
  jumping: "hasted",
  windwalk: "flying",
  heroesfeast: "blessed",
  heroesfeast2: "blessed",
  dispelevil: "shielded",
  acidarrow: "poisoned",
  phantasmal: "frightened",
  weird: "frightened",
  insane: "frightened",
  indigoray: "restrained",
  violetray: "blinded",
  fleshtostone: "petrified",
};

// The painted icon a glyph shows: its own painting, or the one it borrows.
export function glyphIconKey(glyph: Pick<ConditionGlyph, "id">): string {
  return GLYPH_ICON[glyph.id] ?? glyph.id;
}

// The painted icon a condition chip shows, from the condition's free text.
export function conditionIconKey(condition: string): string {
  return glyphIconKey(glyphFor(condition));
}

// Every glyph id the board can show, the fallback's included (for the test).
export function allGlyphIds(): string[] {
  return [...new Set([...Object.values(CONDITION_GLYPHS).map((glyph) => glyph.id), DEFAULT_GLYPH.id])];
}

export const GLYPH_TONE_COLOR: Record<GlyphTone, string> = {
  harm: "#e0703a",
  ward: "#7fb8e6",
  bless: "#d4ab3a",
  neutral: "#d6cfc2",
};

// How many badges fit on a token before the rest collapse into a count.
export const MAX_BADGES = 4;
