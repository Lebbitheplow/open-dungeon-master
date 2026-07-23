import { stripReasoningArtifacts } from "../story-prompt.ts";

// Pure lore-check parsing, kept free of alias imports so node test scripts
// (scripts/test-lore-check.mjs) can load it directly.

export const LORE_CHECK_CATEGORIES = [
  "wrong_fact",
  "contradicts_lore",
  "wrong_npc_place",
  "tone_mismatch",
  "out_of_character",
] as const;
export type LoreCheckCategory = (typeof LORE_CHECK_CATEGORIES)[number];

export const LORE_CATEGORY_LABELS: Record<LoreCheckCategory, string> = {
  wrong_fact: "Wrong fact",
  contradicts_lore: "Contradicts lore",
  wrong_npc_place: "Wrong NPC or place",
  tone_mismatch: "Tone mismatch",
  out_of_character: "Out of character",
};

export type LoreVerdict = "consistent" | "unsupported" | "contradicts";

export type LoreCitation = {
  kind: "fact" | "chapter" | "scene" | "summary";
  ref: string;
  quote: string;
};

export type LoreCheckResult = {
  verdict: LoreVerdict;
  explanation: string;
  citations: LoreCitation[];
  rewrite: string | null;
};

export function isLoreCheckCategory(value: unknown): value is LoreCheckCategory {
  return LORE_CHECK_CATEGORIES.includes(value as LoreCheckCategory);
}

const CITATION_KINDS = ["fact", "chapter", "scene", "summary"] as const;

// Parses the verdict JSON with the usual fence-strip and bracket salvage;
// null when nothing usable came back (the route reports a soft failure).
export function parseLoreCheckJson(raw: string): LoreCheckResult | null {
  const cleaned = stripReasoningArtifacts(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      verdict?: unknown;
      explanation?: unknown;
      citations?: unknown;
      rewrite?: unknown;
    };
    const verdict = String(parsed.verdict ?? "").toLowerCase();
    if (verdict !== "consistent" && verdict !== "unsupported" && verdict !== "contradicts") {
      return null;
    }
    const citations: LoreCitation[] = (Array.isArray(parsed.citations) ? parsed.citations : [])
      .map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        const kind = String(record.kind ?? "");
        const quote = String(record.quote ?? "").trim().slice(0, 300);
        if (!CITATION_KINDS.includes(kind as LoreCitation["kind"]) || !quote) {
          return null;
        }
        return {
          kind: kind as LoreCitation["kind"],
          ref: String(record.ref ?? "").trim().slice(0, 80),
          quote,
        };
      })
      .filter((entry): entry is LoreCitation => entry !== null)
      .slice(0, 5);
    const rewrite = typeof parsed.rewrite === "string" ? parsed.rewrite.trim() : "";
    return {
      verdict,
      explanation: String(parsed.explanation ?? "").trim().slice(0, 600),
      citations,
      // A rewrite makes no sense for a consistent passage.
      rewrite: verdict === "consistent" || !rewrite ? null : rewrite.slice(0, 4000),
    };
  } catch {
    return null;
  }
}
