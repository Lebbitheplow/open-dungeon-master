// Forgiving argument normalizers for model-supplied tool-call enums. The
// model's wording drifts ("wisdom" for "wis", "adv" for "advantage",
// "short_rest" for "short"), and a strict z.enum used to reject the whole
// call, leaving the narration ahead of the state (the stuck-encounter bug,
// generalized). Each normalizer maps synonyms onto the canonical value and
// returns the input untouched when nothing matches, so zod still reports
// genuinely wrong arguments. Pure and dependency-free for the test suite;
// used via z.preprocess at every enum site.

const ABILITY_NAMES: Record<string, string> = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

// "Wisdom" / "wis." / "DEX save" -> the three-letter id. Only genuine
// prefixes of the full ability name map ("charm" stays "charm").
export function normalizeAbility(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const cleaned = value.trim().toLowerCase().replace(/[^a-z]/g, " ").trim();
  const first = cleaned.split(/\s+/)[0] ?? "";
  for (const [id, full] of Object.entries(ABILITY_NAMES)) {
    if (first === id || (first.length >= 3 && full.startsWith(first))) {
      return id;
    }
  }
  return value;
}

// "adv" / "with advantage" / "disadv" / "normal" -> the canonical enum.
export function normalizeAdvantage(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const cleaned = value.trim().toLowerCase();
  if (/dis/.test(cleaned)) {
    return "disadvantage";
  }
  if (/adv/.test(cleaned)) {
    return "advantage";
  }
  if (/^$|none|normal|straight|no\b|flat/.test(cleaned)) {
    return "none";
  }
  return value;
}

// "save" / "saving throw" / "skill" / "init" / "ability" / "attack roll" /
// "dmg" -> the request_roll kind enum.
export function normalizeRollKind(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const cleaned = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    ["skill_check", "saving_throw", "ability_check", "attack", "damage", "initiative", "custom"].includes(
      cleaned,
    )
  ) {
    return cleaned;
  }
  if (/sav/.test(cleaned)) {
    return "saving_throw";
  }
  if (/init/.test(cleaned)) {
    return "initiative";
  }
  if (/abilit/.test(cleaned)) {
    return "ability_check";
  }
  if (/skill|check/.test(cleaned)) {
    return "skill_check";
  }
  if (/attack|hit/.test(cleaned)) {
    return "attack";
  }
  if (/damage|dmg/.test(cleaned)) {
    return "damage";
  }
  return value;
}

// "short_rest" / "a long rest" / "breather" -> short|long.
export function normalizeRestKind(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const cleaned = value.trim().toLowerCase();
  if (/long|night|sleep/.test(cleaned)) {
    return "long";
  }
  if (/short|breather|hour/.test(cleaned)) {
    return "short";
  }
  return value;
}

// learn_spell: "learn"/"teach"/"gain" -> add, "forget"/"lose" -> remove.
// purchase: "purchase"/"buying" -> buy, "sale"/"selling" -> sell.
export function normalizeListAction(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const cleaned = value.trim().toLowerCase();
  if (["add", "remove", "buy", "sell"].includes(cleaned)) {
    return cleaned;
  }
  // Removal patterns first: "unlearn" contains "learn".
  if (/forget|lose|strip|remov|unlearn/.test(cleaned)) {
    return "remove";
  }
  if (/learn|teach|gain|grant|copy/.test(cleaned)) {
    return "add";
  }
  if (/buy|purchas|acquir|barter/.test(cleaned)) {
    return "buy";
  }
  if (/sell|sale|pawn|fence/.test(cleaned)) {
    return "sell";
  }
  return value;
}

// record_event kinds fall back to "story" instead of erroring: a milestone
// is always worth recording under some kind.
export function normalizeEventKind(value: unknown, known: readonly string[]): string {
  const cleaned = String(value ?? "story").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (known.includes(cleaned)) {
    return cleaned;
  }
  const match = known.find((kind) => cleaned.includes(kind) || kind.includes(cleaned));
  if (match && cleaned.length >= 3) {
    return match;
  }
  if (/bond|friend|ally|romance|rival/.test(cleaned)) {
    return "relationship";
  }
  if (/loot|treasure|artifact|weapon|gear/.test(cleaned)) {
    return "item";
  }
  if (/victor|defeat|slay|complete|quest|milestone|feat\b/.test(cleaned)) {
    return "achievement";
  }
  if (/die|dead|kill|fallen/.test(cleaned)) {
    return "death";
  }
  return "story";
}
