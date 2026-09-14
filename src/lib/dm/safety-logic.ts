// Safety, strictness and tone (docs/vtt-parity-implementation-plan.md
// section 9): the pure half. Lines are hard limits the narration may not
// cross, veils are things that happen off the page, boundaries set the
// stock tone limit and the picture negatives; strictness shifts the DC
// ladder and reaction rolls; tone becomes adjectives and a bed bias. The
// routes, the prompt and the guard call this; the test loads it directly.

export const BOUNDARIES = ["family", "standard", "mature"] as const;
export type Boundaries = (typeof BOUNDARIES)[number];

export const STRICTNESS = ["lenient", "standard", "harsh"] as const;
export type Strictness = (typeof STRICTNESS)[number];

export const TONES = ["grim", "hopeful", "whimsical", "epic", "intimate", "pulpy", "eerie", "political"] as const;
export type Tone = (typeof TONES)[number];

export type SafetySettings = { xCard: boolean; lines: string[]; veils: string[]; boundaries: Boundaries };
export type GmSettings = { strictness: Strictness; tone: Tone[] };

export const LINE_MAX = 12;
export const LINE_LENGTH_MAX = 60;
export const TONE_MAX = 3;

export function normalizeSafety(raw: unknown): SafetySettings {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (value: unknown) =>
    Array.isArray(value)
      ? [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().slice(0, LINE_LENGTH_MAX)).filter(Boolean))].slice(0, LINE_MAX)
      : [];
  return {
    xCard: record.xCard !== false,
    lines: list(record.lines),
    veils: list(record.veils),
    boundaries: BOUNDARIES.includes(record.boundaries as Boundaries) ? (record.boundaries as Boundaries) : "standard",
  };
}

export function normalizeGm(raw: unknown): GmSettings {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tone = Array.isArray(record.tone)
    ? [...new Set(record.tone.filter((entry): entry is Tone => TONES.includes(entry as Tone)))].slice(0, TONE_MAX)
    : [];
  return {
    strictness: STRICTNESS.includes(record.strictness as Strictness) ? (record.strictness as Strictness) : "standard",
    tone,
  };
}

// ---- lines and veils in the prompt and the guard ----

const BOUNDARY_TEXT: Record<Boundaries, string> = {
  family:
    "This table plays for all ages: no gore, no sexual content, no cruelty dwelt on, violence kept quick and bloodless, fear kept to the spooky rather than the horrifying.",
  standard:
    "This table plays at the level of a mainstream fantasy novel: violence may be vivid but never lingered over, romance fades to black, nothing sexual involving minors, no torture described in detail.",
  mature:
    "This table plays for adults and accepts dark themes, but never sexual content involving minors and never sexual violence described on the page.",
};

export function renderSafetyBlock(safety: SafetySettings): string {
  const parts: string[] = [`TABLE SAFETY (hard limits; these outrank tone and genre):\n- ${BOUNDARY_TEXT[safety.boundaries]}`];
  if (safety.lines.length) {
    parts.push(`- LINES, never on the page in any form, not even implied or off-screen: ${safety.lines.join("; ")}.`);
  }
  if (safety.veils.length) {
    parts.push(`- VEILS, may happen but only off the page (cut away, summarise after, no detail): ${safety.veils.join("; ")}.`);
  }
  parts.push("- If a player's action would cross a line, the world simply does not go there: narrate around it without comment.");
  return parts.join("\n");
}

// The line a narration crossed, if any. A line is matched as a whole
// phrase or as each of its words of four letters or more, so "spiders"
// catches "spider" and "harm to children" catches "children".
export function lineViolations(text: string, lines: string[]): string[] {
  const haystack = text.toLowerCase();
  const out: string[] = [];
  for (const line of lines) {
    const phrase = line.trim().toLowerCase();
    if (!phrase) {
      continue;
    }
    const stems = phrase.split(/\s+/).filter((word) => word.length >= 4).map((word) => word.replace(/(s|es|ing|ed)$/u, ""));
    const hit =
      haystack.includes(phrase) ||
      stems.some((stem) => new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "i").test(haystack));
    if (hit) {
      out.push(line);
    }
  }
  return out;
}

export function buildLinePrompt(violations: string[]): string {
  return `Your passage touches a subject this table has ruled out entirely: ${violations.join("; ")}. Rewrite the whole passage so that subject never appears, is not implied, and is not replaced with a wink at it. Keep every dice result and mechanical outcome exactly as it was. Reply with the rewritten passage only.`;
}

// The picture negatives for the boundary (docs/vtt-parity-implementation-
// plan.md 9.1): what the image backend is told to leave out.
export function boundaryNegativeTerms(boundaries: Boundaries): string {
  switch (boundaries) {
    case "family":
      return "gore, blood, wounds, nudity, sexual, horror, corpse, torture";
    case "standard":
      return "nudity, sexual, explicit gore, torture";
    case "mature":
      return "nudity, sexual";
  }
}

// ---- strictness and tone ----

export function strictnessShift(strictness: Strictness): number {
  return strictness === "lenient" ? -2 : strictness === "harsh" ? 2 : 0;
}

// One step on the hostile / indifferent / friendly ladder, toward friendly
// when lenient and toward hostile when harsh.
export function reactionBias(strictness: Strictness): number {
  return strictness === "lenient" ? 1 : strictness === "harsh" ? -1 : 0;
}

const STRICTNESS_TEXT: Record<Strictness, string> = {
  lenient:
    "Rulings lean generous: when a call could go either way it goes the party's way, difficulty tiers sit two lower than the book, and strangers warm a step faster.",
  standard: "",
  harsh:
    "Rulings lean hard: the world does not bend for the party, difficulty tiers sit two higher than the book, strangers are a step warier, and consequences land.",
};

const TONE_TEXT: Record<Tone, string> = {
  grim: "grim and unsparing",
  hopeful: "hopeful even in the dark",
  whimsical: "whimsical and light on its feet",
  epic: "epic in scale and stakes",
  intimate: "intimate, close on the people in the room",
  pulpy: "pulpy, fast and bright",
  eerie: "eerie, with a chill under the ordinary",
  political: "political, every room a negotiation",
};

export function renderGmBlock(gm: GmSettings): string {
  const parts: string[] = [];
  if (STRICTNESS_TEXT[gm.strictness]) {
    parts.push(STRICTNESS_TEXT[gm.strictness]);
  }
  if (gm.tone.length) {
    parts.push(`The tone this table asked for: ${gm.tone.map((tone) => TONE_TEXT[tone]).join("; ")}. Let it colour word choice and pacing, not the rules.`);
  }
  return parts.length ? `GM STYLE:\n- ${parts.join("\n- ")}` : "";
}

// A bed for the tone when the scene names none (docs/vtt-parity-
// implementation-plan.md 9.2): eerie rooms drip, epic ones ring.
const TONE_BED: Partial<Record<Tone, string>> = {
  eerie: "cave",
  grim: "rain",
  epic: "wind",
  whimsical: "market",
  political: "tavern",
  intimate: "camp",
};

export function toneBedBias(tone: Tone[]): string | null {
  for (const entry of tone) {
    const bed = TONE_BED[entry];
    if (bed) {
      return bed;
    }
  }
  return null;
}
