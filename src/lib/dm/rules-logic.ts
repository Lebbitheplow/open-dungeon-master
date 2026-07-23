// Pure logic for the rules manager: house-rules chunking, flag carryover
// across re-chunks, keyword fallback scoring, and the VARIANT RULES /
// HOUSE RULES prompt blocks. No DB access and no "@/" imports so
// scripts/test-rules-chunk.mjs can load it directly; the impure rim is
// src/lib/db/rules.ts.

export const HOUSE_RULES_MAX = 20_000;
const CHUNK_MIN = 300;
const CHUNK_MAX = 900;

export type RuleChunkDraft = { heading: string; text: string };

export type RuleChunkFlags = { enabled: boolean; pinned: boolean };

// Variant-rule shape mirrors gameSettingsSchema.variantRules; duplicated
// here (not imported) to keep this file alias-free for the node tests.
export type VariantRules = {
  flanking: boolean;
  criticalFumbles: boolean;
  encumbrance: boolean;
  lingeringInjuries: boolean;
  restVariant: "standard" | "gritty" | "heroic";
};

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (/^#{1,6}\s+\S/.test(trimmed)) {
    return true;
  }
  // A short standalone line ending in a colon reads as a section label.
  return trimmed.length <= 60 && /:$/.test(trimmed) && !/[.!?]/.test(trimmed.slice(0, -1));
}

function cleanHeading(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, "").replace(/:$/, "").slice(0, 80);
}

// Splits the house-rules text into retrieval chunks: heading lines start a
// new section, blank lines separate paragraphs, and paragraphs merge until
// a chunk reaches a comfortable size. Oversized paragraphs are split hard.
export function chunkHouseRules(text: string): RuleChunkDraft[] {
  const lines = text.slice(0, HOUSE_RULES_MAX).split(/\r?\n/);
  type Section = { heading: string; paragraphs: string[] };
  const sections: Section[] = [];
  let current: Section = { heading: "", paragraphs: [] };
  let paragraph: string[] = [];
  const flushParagraph = () => {
    const joined = paragraph.join("\n").trim();
    if (joined) {
      current.paragraphs.push(joined);
    }
    paragraph = [];
  };
  for (const line of lines) {
    if (isHeadingLine(line)) {
      flushParagraph();
      if (current.paragraphs.length || current.heading) {
        sections.push(current);
      }
      current = { heading: cleanHeading(line), paragraphs: [] };
    } else if (!line.trim()) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  if (current.paragraphs.length || current.heading) {
    sections.push(current);
  }

  const chunks: RuleChunkDraft[] = [];
  for (const section of sections) {
    let buffer = "";
    const flushChunk = () => {
      if (buffer.trim()) {
        chunks.push({ heading: section.heading, text: buffer.trim() });
      }
      buffer = "";
    };
    for (const para of section.paragraphs) {
      if (para.length > CHUNK_MAX) {
        flushChunk();
        for (let start = 0; start < para.length; start += CHUNK_MAX) {
          chunks.push({ heading: section.heading, text: para.slice(start, start + CHUNK_MAX).trim() });
        }
        continue;
      }
      if (buffer && buffer.length + para.length + 2 > CHUNK_MAX) {
        flushChunk();
      }
      buffer = buffer ? `${buffer}\n\n${para}` : para;
      if (buffer.length >= CHUNK_MIN) {
        flushChunk();
      }
    }
    flushChunk();
  }
  return chunks;
}

function fingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

// Carries enabled/pinned flags across a re-chunk: a chunk keeps its flags
// when an old chunk shares its heading, else when one starts with the same
// normalized first 80 characters. New chunks default to enabled, unpinned.
export function carryChunkFlags(
  drafts: RuleChunkDraft[],
  previous: Array<RuleChunkDraft & RuleChunkFlags>,
): Array<RuleChunkDraft & RuleChunkFlags> {
  const byFingerprint = new Map<string, RuleChunkFlags>();
  const byHeading = new Map<string, RuleChunkFlags>();
  for (const old of previous) {
    byFingerprint.set(fingerprint(old.text), { enabled: old.enabled, pinned: old.pinned });
    if (old.heading && !byHeading.has(old.heading)) {
      byHeading.set(old.heading, { enabled: old.enabled, pinned: old.pinned });
    }
  }
  return drafts.map((draft) => {
    const flags =
      byFingerprint.get(fingerprint(draft.text)) ??
      (draft.heading ? byHeading.get(draft.heading) : undefined) ?? {
        enabled: true,
        pinned: false,
      };
    return { ...draft, ...flags };
  });
}

export function scoreRuleByKeywords(query: string, chunk: RuleChunkDraft): number {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2);
  if (!words.length) {
    return 0;
  }
  const haystack = `${chunk.heading} ${chunk.text}`.toLowerCase();
  let hits = 0;
  for (const word of words) {
    if (haystack.includes(word)) {
      hits += 1;
    }
  }
  return hits / words.length;
}

export const VARIANT_RULE_LINES: Record<
  Exclude<keyof VariantRules, "restVariant">,
  string
> = {
  flanking:
    "Flanking: two allies on opposite sides of a creature give each other advantage on melee attacks against it.",
  criticalFumbles:
    "Critical fumbles: a natural 1 on an attack roll causes a minor mishap the DM narrates (never damage to the fumbler).",
  encumbrance:
    "Encumbrance: carrying more than 5 times Strength in pounds slows a character by 10 feet; track heavy hauls.",
  lingeringInjuries:
    "Lingering injuries: a critical hit or dropping to 0 HP can leave a lasting injury the DM narrates and tracks.",
};

export const REST_VARIANT_LINES: Record<VariantRules["restVariant"], string> = {
  standard: "",
  gritty:
    "Gritty realism rests: a short rest takes 8 hours (overnight) and a long rest takes 7 days of downtime.",
  heroic:
    "Heroic rests: a short rest takes 5 minutes and a long rest only requires 1 hour of downtime.",
};

// One line per non-default toggle; empty string when everything is stock.
export function renderVariantRules(variant: VariantRules): string {
  const lines: string[] = [];
  for (const key of Object.keys(VARIANT_RULE_LINES) as Array<
    Exclude<keyof VariantRules, "restVariant">
  >) {
    if (variant[key]) {
      lines.push(`- ${VARIANT_RULE_LINES[key]}`);
    }
  }
  if (variant.restVariant !== "standard") {
    lines.push(`- ${REST_VARIANT_LINES[variant.restVariant]}`);
  }
  if (!lines.length) {
    return "";
  }
  return `VARIANT RULES (in effect at this table):\n${lines.join("\n")}`;
}

// The HOUSE RULES prompt block: pinned enabled chunks first, then the
// retrieved ones, cut off at the character budget.
export function renderHouseRules(
  pinned: RuleChunkDraft[],
  retrieved: RuleChunkDraft[],
  budget = 1_200,
): string {
  const lines: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const chunk of [...pinned, ...retrieved]) {
    const key = fingerprint(chunk.text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const line = `- ${chunk.heading ? `${chunk.heading}: ` : ""}${chunk.text}`;
    if (used + line.length > budget) {
      break;
    }
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) {
    return "";
  }
  return `HOUSE RULES (set by the party lead; they override the standard rules):\n${lines.join("\n")}`;
}
