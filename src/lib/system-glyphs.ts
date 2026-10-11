// The icon a system line is drawn with, stored with the line
// (campaign_messages.glyph) by the code that writes it, which knows what
// happened: read from the line's words, it only worked in English. The ids
// are painted glyphs (src/lib/painted-icons.json).
export const SYSTEM_GLYPHS = [
  "die-d20",
  "rest-long",
  "rest-short",
  "cue-death",
  "cue-heal",
  "cue-battle",
  "cue-coin",
  "cue-travel",
  "cue-bell",
  "system-party",
] as const;
export type SystemGlyph = (typeof SYSTEM_GLYPHS)[number];

export function isSystemGlyph(value: unknown): value is SystemGlyph {
  return SYSTEM_GLYPHS.includes(value as SystemGlyph);
}
