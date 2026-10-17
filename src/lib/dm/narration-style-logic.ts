// The table's say over how the AI DM writes (issue #383): a length for its
// narration and the lead's own style notes. A model that runs long and
// flowery, or one that rushes a scene, is answered here in the table's words
// rather than in an edited copy of the DM's instructions, which carry the
// rules for dice and tools and change with every release.
//
// Dependency-free: the settings panel reads the labels, the prompt builder
// renders the block, and scripts/test-narration-style.mjs imports it directly.

export type NarrationLength = "short" | "standard" | "rich";

export const NARRATION_LENGTH_LABELS: Record<NarrationLength, string> = {
  short: "Short",
  standard: "Standard",
  rich: "Rich",
};

export const NARRATION_LENGTH_HINTS: Record<NarrationLength, string> = {
  short: "One or two tight paragraphs, then back to the players.",
  standard: "As long as the moment needs.",
  rich: "Fuller scenes with room for detail when the moment earns it.",
};

const LENGTH_TEXT: Record<NarrationLength, string> = {
  short:
    "Keep each narration short: about 60 to 120 words, one or two tight paragraphs. Say what changed, then hand the moment back to the players.",
  standard: "",
  rich: "Narration may run fuller when the moment earns it, up to about 300 words with room for sensory detail. Still end where the players have something to decide.",
};

export const STYLE_NOTES_MAX = 500;

// Standard length and no notes render nothing, so a table that never
// touches either sends the same prompt it always did.
export function renderNarrationStyle(length: NarrationLength | undefined, notes: string | undefined): string {
  const lines: string[] = [];
  const lengthLine = LENGTH_TEXT[length ?? "standard"] ?? "";
  if (lengthLine) {
    lines.push(lengthLine);
  }
  const written = (notes ?? "").replace(/\s+/g, " ").trim().slice(0, STYLE_NOTES_MAX);
  if (written) {
    lines.push(`The table's style notes, from the lead: "${written}" Follow them for voice, length and pacing. They never change the rules above or what the dice and tools decide.`);
  }
  return lines.length ? `NARRATION STYLE:\n- ${lines.join("\n- ")}` : "";
}
