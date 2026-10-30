// The rules an entry's text uses that the engine does not have (issue #570,
// "Rules and content"): Level Up's strife, fatigue, rattled, expertise
// dice, exertion and maneuvers and its "while bloodied" triggers, and Deep
// Magic's ley lines. Nothing in the SRD uses them; the content pack's
// Level Up books (a5e, the Monstrous Menagerie, the Adventurer's Guide and
// its other guides) and Kobold Press's ley line spells do. A 5.1 table that
// meets one plays it by the GM's call, so the entry says what it needs
// (src/lib/content/levelup-logic.ts keeps them out of play and labels them in
// search).
//
// Read from the text the engine plays, never from a condition immunity:
// Level Up prints "fatigue" where 5.1 prints exhaustion in a creature's
// immunities, and the engine already reads that as exhaustion
// (src/lib/bestiary/defences.ts).

export const NEEDS = ["strife", "fatigue", "rattled", "expertise dice", "exertion", "maneuvers", "bloodied", "ley lines"] as const;
export type Need = (typeof NEEDS)[number];

// Level Up's documents in the pack.
export const LEVEL_UP_DOCUMENTS = new Set(["a5e", "a5e-ag", "a5e-ddg", "a5e-gpg", "a5e-mm", "menagerie"]);

const PATTERNS: Array<[Need, RegExp]> = [
  ["strife", /\blevels? of strife\b|\bstrife (?:level|track)\b|\b(?:gains?|suffers?|takes?|removes?|loses?) (?:a |one |two |three |\d+ )?(?:levels? of )?strife\b|\bstrife\b(?= and fatigue|\s*\()/i],
  ["fatigue", /\blevels? of fatigue\b|\bfatigue (?:level|track)\b|\b(?:gains?|suffers?|takes?|removes?|loses?) (?:a |one |two |three |\d+ )?(?:levels? of )?fatigue\b|\bfatigued\b|\bfatigue\b(?= and strife|\s*\()/i],
  ["rattled", /\brattled\b/i],
  // A Level Up spell's expertise die is already read as a d4 (src/lib/
  // content/spell-overrides.ts translated, issue #116), which leaves its
  // label: "(Level Up's expertise die)".
  ["expertise dice", /(?<!Level Up's )\bexpertise di(?:e|ce)\b/i],
  ["exertion", /\bexertion\b/i],
  ["bloodied", /\bwhile (?:it is |you are |they are |the [\w -]{1,30} is )?bloodied\b|\b(?:first )?becomes? bloodied\b|\bwhen (?:it is |you are |the [\w -]{1,30} is )bloodied\b/i],
  ["ley lines", /\bley lines?\b/i],
];

// Level Up's combat maneuvers: only its own books mean them ("the
// creature maneuvers out of reach" in a Tome of Beasts block is a verb).
const MANEUVER = /(?<!Level Up's )\bmaneuver dc\b|\bcombat maneuvers?\b|\bmaneuvers? (?:of|from) (?:the )?[\w-]+ (?:tradition|school)\b|\b[A-Z][\w']+(?: [A-Z][\w']+)* maneuver\b/;

// Every text field a reader plays, without the ones that only list what
// the entry resists or ignores.
const SKIPPED = new Set(["condition_immunities", "damage_immunities", "damage_resistances", "damage_vulnerabilities", "img_main", "document__url", "document__license_url"]);

function textOf(value: unknown, key = ""): string {
  if (SKIPPED.has(key)) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => textOf(entry)).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([field, entry]) => textOf(entry, field))
      .join("\n");
  }
  return "";
}

// What an entry needs that the engine lacks, in NEEDS order.
export function mechanicsNeeded(row: { documentSlug: string; data: Record<string, unknown> }): Need[] {
  const text = textOf(row.data);
  const found = new Set<Need>(PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([need]) => need));
  if (LEVEL_UP_DOCUMENTS.has(row.documentSlug) && MANEUVER.test(text)) {
    found.add("maneuvers");
  }
  return NEEDS.filter((need) => found.has(need));
}

// The words a table reads beside an entry that needs one.
export const NEED_LABELS: Record<Need, string> = {
  strife: "strife",
  fatigue: "fatigue",
  rattled: "rattled",
  "expertise dice": "expertise dice",
  exertion: "exertion",
  maneuvers: "maneuvers",
  bloodied: "a bloodied trigger",
  "ley lines": "ley lines",
};
