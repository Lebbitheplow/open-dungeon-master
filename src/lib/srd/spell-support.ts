// How much of a spell the server settles (docs/dnd-rules-audit-2026-10-09-extent.md,
// F27 and F29). Most spells are resolved by an engine. The ones below are
// not, or only in part, and the parts left to the table are named here so
// the player reads them before picking the spell (the spell book's tiles)
// and the DM reads them when it is cast (the cast's result).
//
//   - "partial": the server spends the slot and keeps what its row covers
//     (the concentration, the duration, a save it rolls); the named parts
//     are the DM's.
//   - "narrated": the server spends the slot and keeps the concentration;
//     the effect is the table's to describe and rule.
//
// Pure data, safe for the client. Keys are lowercased SRD names.

export type SpellSupport = { kind: "partial" | "narrated"; manual: string };

const PARTIAL = (manual: string): SpellSupport => ({ kind: "partial", manual });
const NARRATED = (manual: string): SpellSupport => ({ kind: "narrated", manual });

const ROWS: Record<string, SpellSupport> = {
  "alter self": PARTIAL("The natural weapons (1d6, magic, +1 to attack and damage) and Aquatic Adaptation's swim speed and water breathing are the DM's to apply."),
  "astral projection": NARRATED("The astral forms, the silver cord and the return to the bodies are the DM's."),
  awaken: NARRATED("The awakened creature's INT 10, its language and its 30 days charmed are the DM's."),
  clone: NARRATED("The vessel, its 120 days to mature and the soul's move into it are the DM's."),
  "contact other plane": PARTIAL("The server rolls the DC 15 INT save and the 6d6 psychic; the five answers and how long the insanity lasts are the DM's."),
  "control weather": NARRATED("The weather's stages, how they change over time and what they do are the DM's."),
  "detect thoughts": PARTIAL("The WIS save to probe deeper and the INT check to end the probe are the DM's; the server keeps the concentration."),
  "dimension door": PARTIAL("Arriving in an occupied space (4d6 force each, and the spell fails) is the DM's; tokens are moved by hand."),
  dream: PARTIAL("The WIS save against a hostile messenger, the 3d6 psychic and the lost rest are the DM's."),
  forbiddance: PARTIAL("The 5d10 radiant or necrotic to the chosen creature types entering or starting a turn there is the DM's to deal."),
  geas: PARTIAL("The server rolls the WIS save and keeps the charm for its days; the 5d10 psychic for acting against the command, once a day, is the DM's to deal."),
  "glyph of warding": PARTIAL("The trigger, the explosive rune's DEX save and 5d8, or the stored spell, are the DM's when the glyph goes off."),
  hallow: PARTIAL("The extra effect (courage, darkness, energy vulnerability and the rest) and the CHA save against it are the DM's."),
  light: PARTIAL("A hostile creature holding or wearing the object makes a DEX save to avoid it; that save is the DM's."),
  "magic circle": PARTIAL("The CHA save to cross, the barrier and the disadvantage on attacks are the DM's."),
  "magic jar": PARTIAL("The CHA save to possess, the host's statistics and the soul's return are the DM's."),
  "meld into stone": PARTIAL("Damage to the stone (6d6 bludgeoning when partly destroyed, 50 force and expulsion when destroyed) is the DM's."),
  "planar binding": PARTIAL("The CHA save and the bound creature's service are the DM's."),
  "project image": NARRATED("The illusion's movement, the Investigation check to see through it and sensing through it are the DM's."),
  scrying: PARTIAL("The WIS save, its modifiers for knowledge and connection, and the sensor are the DM's."),
  seeming: PARTIAL("The CHA save of an unwilling creature and the Investigation check to see through it are the DM's."),
  simulacrum: NARRATED("The copy (half the hit points, no slots regained, 100 gp per hit point to repair), its obedience and the one-at-a-time limit are the DM's; it joins as a companion by hand."),
  "speak with plants": NARRATED("The plants' answers, the terrain they move and their cooperation are the DM's."),
  telekinesis: PARTIAL("The contested STR check against the caster's ability modifier and the moving of a creature or object are the DM's."),
  teleport: PARTIAL("The familiarity table's d100, a mishap's 3d10 force and reroll, and an off-target or similar-area arrival are the DM's."),
  "time stop": NARRATED("The 1d4 + 1 turns in a row, and the spell ending when an action affects another creature, are the DM's."),
  wish: PARTIAL("Duplicating a spell of 8th level or lower casts that spell; any other effect, and the stress (2d10 necrotic per spell until a long rest, STR 3 for 2d4 days, a 33 percent chance of never casting Wish again), are the DM's."),
  "zone of truth": PARTIAL("The CHA save on entering or starting a turn there, and each creature's awareness of it, are the DM's."),
};

export function spellSupportFor(name: string): SpellSupport | null {
  const key = name.trim().toLowerCase().replace(/^[a-z]+'s\s+/, "");
  return ROWS[key] ?? null;
}

// The word on a spell tile.
export function spellSupportWord(support: SpellSupport): string {
  return support.kind === "partial" ? "partly by hand" : "narrated";
}

// The line a cast's result carries, so the success text says what the
// server did and what it did not.
export function spellSupportLine(name: string): string | null {
  const support = spellSupportFor(name);
  if (!support) {
    return null;
  }
  return support.kind === "partial"
    ? `${name} is settled in part by the server. Left to the DM: ${support.manual}`
    : `${name}'s effect is the table's to narrate and rule; the server spent the cost and keeps any concentration. ${support.manual}`;
}
