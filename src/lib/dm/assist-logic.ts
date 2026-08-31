// Shaping for the DM's assist rail: turning a player's stated intent into a
// shortlist of adjudications, and reading back what the model proposed.
//
// The ranking here is deliberately dumb and deliberately first. A keyword
// score over the catalog is instant, works with no model at all, and is never
// empty; the model call that follows only has to choose among a handful and
// fill in the arguments. That ordering is what keeps the feature usable on a
// slow local model and honest when there is none.
//
// Pure and dependency-free apart from the catalog's own types, so
// scripts/test-assist.mjs can import it.

import type { CatalogEntry } from "@/lib/dm/catalog-types";

// Words that appear in half the catalog and in most sentences, so matching on
// them tells us nothing.
const STOP_WORDS = new Set([
  "a", "all", "an", "and", "any", "are", "at", "back", "be", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "get", "go", "goes",
  "had", "has", "have", "he", "her", "him", "his", "how", "i", "in", "into",
  "is", "it", "its", "just", "me", "my", "not", "of", "off", "on", "one",
  "or", "our", "out", "past", "she", "so", "some", "that", "the", "their",
  "them", "then", "there", "they", "this", "to", "try", "up", "us", "want",
  "wants", "was", "we", "what", "when", "where", "who", "why", "will",
  "with", "would", "you", "your",
]);

export function intentTokens(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

// Extra words that should reach an entry even though they are not in its
// label. A player says "I stab him", never "resolve a player attack".
const SYNONYMS: Record<string, string[]> = {
  pc_attack: ["attack", "attacks", "stab", "swing", "shoot", "strike", "hit", "slash", "fire", "loose"],
  // The largest list by far, because most of what a player says at a table is
  // "can I", and the answer is almost always a check.
  request_roll: [
    "check", "roll", "save", "saving", "perception", "stealth", "athletics",
    "insight", "sneak", "sneaks", "hide", "hides", "climb", "climbs", "search",
    "searches", "listen", "listens", "spot", "spots", "notice", "notices",
    "look", "looks", "examine", "examines", "investigate", "jump", "jumps",
    "swim", "swims", "pick", "picks", "disarm", "disarms", "recall", "remember",
    "lift", "shove", "grapple", "track", "tracks", "balance",
  ],
  cast_at_enemy: ["cast", "casts", "spell", "magic", "incant", "bolt", "smite"],
  cast_at_player: ["cast", "casts", "spell", "bless", "shield", "protect"],
  cast_buff: ["cast", "casts", "buff", "bless", "haste", "enlarge"],
  aoe_damage: ["fireball", "blast", "explosion", "breath", "everyone", "area"],
  split_damage: ["explosion", "blast", "fireball", "breath", "area", "everyone"],
  apply_damage: ["damage", "hurt", "wound", "burn", "crush", "falls", "falling"],
  heal: ["heal", "heals", "healing", "cure", "mend", "potion", "bandage"],
  stabilize: ["stabilize", "stabilise", "dying", "bleeding", "unconscious"],
  start_encounter: ["ambush", "ambushes", "combat", "fight", "fights", "initiative", "battle"],
  grant_item: ["give", "gives", "hand", "hands", "loot", "find", "finds", "reward"],
  remove_item: ["drop", "drops", "lose", "loses", "break", "breaks", "steal", "steals"],
  modify_gold: ["gold", "coin", "coins", "pay", "pays", "buy", "buys", "purse", "price"],
  purchase: ["buy", "buys", "shop", "shops", "purchase", "merchant", "trade"],
  set_condition: ["poisoned", "prone", "grappled", "frightened", "stunned", "blinded", "restrained"],
  take_rest: ["rest", "rests", "sleep", "sleeps", "camp", "camps", "night", "breather"],
  npc_reaction: ["persuade", "convince", "bribe", "intimidate", "haggle", "talk", "talks", "ask", "asks"],
  social_check: ["persuade", "deceive", "lie", "lies", "intimidate", "charm", "perform"],
  roll_treasure: ["treasure", "hoard", "loot", "reward", "spoils", "chest"],
  travel: ["travel", "travels", "journey", "march", "ride", "rides", "road", "days"],
  move_party: ["leave", "leaves", "head", "heads", "enter", "enters", "walk", "walks", "arrive"],
  group_check: ["everyone", "party", "together", "all"],
  damage_object: ["door", "smash", "smashes", "break", "breaks", "chest", "lock"],
};

// Every key above has to be a real adjudication. A tool renamed out from
// under this map would silently stop being suggested, which is invisible in a
// way a missing button is not; scripts/test-assist.mjs asserts against the
// catalog.
export function synonymKeys(): string[] {
  return Object.keys(SYNONYMS);
}

export type AdjudicationSuggestion = {
  entry: CatalogEntry;
  score: number;
};

// Highest first. Ties keep catalog order, which groups by category and puts
// the common things first inside each one.
export function rankAdjudications(
  intent: string,
  entries: CatalogEntry[],
  options: { inEncounter?: boolean; limit?: number } = {},
): AdjudicationSuggestion[] {
  const tokens = intentTokens(intent);
  if (!tokens.length) {
    return [];
  }
  const unique = new Set(tokens);
  const scored: AdjudicationSuggestion[] = [];
  for (const entry of entries) {
    // A fight tool with no fight running is not the answer to anything.
    if (entry.needsEncounter && options.inEncounter === false) {
      continue;
    }
    const haystack = new Set([
      ...intentTokens(entry.name.replace(/_/g, " ")),
      ...intentTokens(entry.label),
      ...intentTokens(entry.summary),
    ]);
    let score = 0;
    for (const token of unique) {
      // A word in the name is worth more than the same word buried in the
      // one-line summary.
      if (haystack.has(token)) {
        score += intentTokens(entry.name.replace(/_/g, " ")).includes(token) ? 3 : 1;
      }
      if (SYNONYMS[entry.name]?.includes(token)) {
        score += 3;
      }
    }
    if (score > 0) {
      scored.push({ entry, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 5);
}

export type ParsedSuggestion = {
  name: string;
  args: Record<string, unknown>;
  why: string;
};

// The model answers with JSON naming one catalog entry and its arguments.
// Returns null on anything unusable, because the keyword shortlist is already
// on screen and a wrong prefill is worse than none.
export function parseSuggestionJson(raw: string): ParsedSuggestion | null {
  const text = String(raw ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) {
      return null;
    }
    const args =
      parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {};
    return {
      name,
      args,
      why: typeof parsed.why === "string" ? parsed.why.slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}
