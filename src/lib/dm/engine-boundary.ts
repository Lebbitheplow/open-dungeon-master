// The engine boundary: one authoritative statement of which facts the server
// owns, plus the deterministic guard that checks the DM's finished prose
// against the outcomes the turn's tools actually resolved.
//
// Pure by design: no "@/" imports and no I/O, so scripts/test-engine-boundary.mjs
// can import it directly. The DB/model rim lives in dm/narration-guard.ts.
//
// The guard exists because ODM already owns the ground truth (every hit, every
// damage number, every HP total came from a tool result in this same turn) and
// used to throw it away the moment the narration was assembled. Nothing here
// mutates mechanical state; a detection at most costs one corrective model call.

// ---------------------------------------------------------------------------
// Part 1: the contract block
// ---------------------------------------------------------------------------

// Consolidates rules that were (and still are) scattered through DM_SYSTEM,
// ENCOUNTER_RULES and REAL_DICE_RULE into one labelled contract the rest can
// point at. Nothing was deleted: the detailed per-tool rules still carry the
// argument-level instructions the model needs, and this block states the
// principle they all share, in one place, at the top of the prompt where it is
// hardest to lose. Consolidated here: never state a die result yourself
// (DM_SYSTEM, dice rule), never decide whether an attack hits (ENCOUNTER_RULES,
// pc_attack rule), sheets change only through tools (DM_SYSTEM, sheet rule),
// never narrate a death the tools have not reported (DM_SYSTEM, dying rule),
// the slot and resource spend rule, the condition-tool rule, the XP and
// level-up rule, the purchase and loot rule, and the DM-SECRET enemy numbers
// rule (ENCOUNTER_RULES).
export const ENGINE_BOUNDARY_RULES = `ENGINE BOUNDARY (read this first; the numbered rules below are all applications of it):
The server is the rules engine and you are its voice. It rolls the dice, adjudicates the attacks, and holds every number on every sheet and stat block. Your job is the prose; the engine's job is the math. These eight kinds of fact are ENGINE-OWNED: you ask for them with a tool, you read the result, and you narrate exactly that. You never compute them, invent them, override them, pre-empt them, or quote the raw numbers behind them.
- Dice outcomes. Every die is rolled by the server through a tool. You choose what is uncertain and how hard it is; the number and the success or failure are not yours.
- Hit and miss. Whether an attack lands is decided by the server rolling against real AC. A reported miss is narrated as a miss even when the moment begs for a hit.
- Damage numbers. The server rolls and applies damage. Narrate the wound at exactly the number reported, never a number you chose.
- HP and death. Current hit points, dropping to 0, death saves, stabilizing, and dying are all server-tracked. A creature is dead, down, or recovered ONLY when a tool result says so.
- Spell slots and resources. Slots, pact slots, limited-use features, and consumables are spent by their tools before the effect exists. A spell narrated without its tool call was never cast.
- Conditions and durations. Conditions land, tick, and expire through their tools, on characters and enemies alike. Never narrate one taking hold or lifting without the call that records it.
- XP and level. The server awards XP and reports when a level-up is available. You never set a level, hit points, feature, or spell yourself.
- Gold and inventory. Coins, loot, purchases, and items move through their tools, which refuse what a purse cannot cover. Never let money or gear change hands in narration alone.
If a tool result has not come back, the thing it decides has NOT happened yet: call the tool, or write around it. If a tool returns an error, the attempt failed, and that failure is what you narrate. If an expected number is simply absent, proceed without it and never fabricate the value. Enemy stat-block numbers exist so you can run the fight and are never spoken aloud.`;

// Appended to the contract only when the table leaves the guard on, so the
// prompt never promises a check that is switched off.
export const ENGINE_BOUNDARY_CHECK = ` The server compares your finished narration against the results it actually returned before the table sees it, so prose that contradicts a tool result comes straight back to you for a rewrite.`;

// ---------------------------------------------------------------------------
// Part 2: reading the turn's ground truth
// ---------------------------------------------------------------------------

// Structurally what a chat conversation entry looks like, declared locally so
// this module needs no imports.
export type GuardMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export type ToolExchange = {
  name: string;
  arguments: string;
  result: Record<string, unknown> | null;
};

export type CreatureFact = {
  // The name as the engine printed it ("Goblin 2"), for the message.
  display: string;
  hp: number | null;
  maxHp: number | null;
  dead: boolean;
  downed: boolean;
  // Two different creatures whose names collapse to the same key (Goblin 1 and
  // Goblin 2) make every claim about "the goblin" unattributable, so the whole
  // key is skipped.
  ambiguous: boolean;
};

export type AttackFact = {
  display: string;
  hit: boolean;
  // Set when the turn resolved conflicting outcomes against this target, or
  // when one call rolled several swings that did not agree (a Multiattack that
  // missed once and hit once).
  ambiguous: boolean;
};

export type ResolvedOutcomes = {
  attacks: Map<string, AttackFact>;
  creatures: Map<string, CreatureFact>;
  // Every number the engine produced this turn, from anywhere in any result.
  numbers: Set<number>;
  // The subset that plausibly reads as damage or healing in prose; used to
  // allow narration that sums several hits into one figure.
  damageNumbers: number[];
  // Spells the turn actually accounted for: a slot spent, a ritual declared, a
  // cantrip acknowledged, a resource burned.
  spells: Set<string>;
  toolResultCount: number;
};

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Pairs each assistant tool call with the tool result that answered it. Calls
// that parked (a physical-dice pc_attack) keep a null result; results whose
// call id never matched still surface, so their payload is not lost.
export function collectExchanges(conversation: readonly GuardMessage[]): ToolExchange[] {
  const calls: Array<{ id: string; name: string; args: string }> = [];
  const results = new Map<string, Record<string, unknown> | null>();
  const orphans: Array<Record<string, unknown> | null> = [];

  for (const message of conversation) {
    if (Array.isArray(message.tool_calls)) {
      for (const raw of message.tool_calls) {
        const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
        const name = typeof call?.function?.name === "string" ? call.function.name : "";
        if (!name) {
          continue;
        }
        calls.push({
          id: typeof call.id === "string" ? call.id : "",
          name,
          args: typeof call.function?.arguments === "string" ? call.function.arguments : "",
        });
      }
    }
    if (message.role === "tool") {
      const id = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      const parsed = parseJsonObject(message.content);
      if (id) {
        results.set(id, parsed);
      } else {
        orphans.push(parsed);
      }
    }
  }

  const exchanges: ToolExchange[] = calls.map((call) => ({
    name: call.name,
    arguments: call.args,
    result: call.id ? results.get(call.id) ?? null : null,
  }));
  for (const orphan of orphans) {
    exchanges.push({ name: "", arguments: "", result: orphan });
  }
  return exchanges;
}

// "Goblin 2" and "the Goblin" are the same creature to prose; the trailing
// designator and any article are dropped so the matchers can look for the word
// a narrator would actually write.
export function normalizeCreatureName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\s+(?:#\s*\d+|\d+|[a-z])$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Models decorate spell names freely ("Hunter's Mark" with a curly apostrophe,
// "Fireball (3rd level)"), and a name that fails to match its own tool call
// would read as a spell nobody paid for. Everything is folded to one shape
// before either side is compared.
export function normalizeSpellName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hpPair(raw: unknown): { hp: number; maxHp: number } | null {
  if (typeof raw !== "string") {
    return null;
  }
  const match = /^(\d{1,4})\s*\/\s*(\d{1,4})$/.exec(raw.trim());
  return match ? { hp: Number(match[1]), maxHp: Number(match[2]) } : null;
}

// Keys whose values really are damage or healing. A bare `total` is excluded on
// purpose: request_roll returns d20 totals under that name, and letting attack
// rolls into the subset sums below would allow almost any two-digit figure.
const DAMAGE_KEYS = new Set([
  "damage",
  "totalDamage",
  "damageApplied",
  "amount",
  "healed",
  "healing",
]);

function walkNumbers(value: unknown, numbers: Set<number>, damage: number[], key = "") {
  if (typeof value === "number" && Number.isFinite(value)) {
    numbers.add(value);
    if (DAMAGE_KEYS.has(key)) {
      damage.push(value);
    }
    return;
  }
  if (typeof value === "string") {
    const pair = hpPair(value);
    if (pair) {
      numbers.add(pair.hp);
      numbers.add(pair.maxHp);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkNumbers(entry, numbers, damage, key);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      walkNumbers(entryValue, numbers, damage, entryKey);
    }
  }
}

function recordCreature(
  creatures: Map<string, CreatureFact>,
  display: string,
  update: { hp?: number | null; maxHp?: number | null; dead?: boolean; downed?: boolean },
) {
  const key = normalizeCreatureName(display);
  if (key.length < 3) {
    return;
  }
  const existing = creatures.get(key);
  if (!existing) {
    creatures.set(key, {
      display,
      hp: update.hp ?? null,
      maxHp: update.maxHp ?? null,
      dead: update.dead === true,
      downed: update.downed === true,
      ambiguous: false,
    });
    return;
  }
  // Later results win on hit points; death and downing are sticky, so a
  // creature this turn killed can never be un-killed by an earlier line.
  existing.dead = existing.dead || update.dead === true;
  existing.downed = existing.downed || update.downed === true;
  if (update.hp !== undefined && update.hp !== null) {
    existing.hp = update.hp;
  }
  if (update.maxHp !== undefined && update.maxHp !== null) {
    existing.maxHp = update.maxHp;
  }
  if (existing.display !== display) {
    existing.ambiguous = true;
  }
}

// Creature state hides in nested payloads too (aoe_damage lists a row per
// target), so this walks the whole result rather than the top level only.
function walkCreatures(value: unknown, creatures: Map<string, CreatureFact>) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkCreatures(entry, creatures);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  const dead = record.dead === true || record.slain === true;
  const downed = record.dropped === true || record.downed === true;
  const name = typeof record.name === "string" ? record.name : "";
  const target = typeof record.target === "string" ? record.target : "";
  const ownHp = hpPair(record.hp);
  // aoe_damage writes one row per victim as { target, hp, dead }, so a bare
  // `hp` belongs to the target when the row names nobody else.
  const targetHp = hpPair(record.targetHp) ?? (name ? null : hpPair(record.hp));

  if (name && (ownHp || dead)) {
    recordCreature(creatures, name, {
      hp: ownHp?.hp ?? null,
      maxHp: ownHp?.maxHp ?? null,
      dead,
      // A `dropped` flag next to a `name` belongs to that name only when no
      // separate target is named in the same payload.
      downed: downed && !target,
    });
  }
  if (target && (targetHp || downed)) {
    recordCreature(creatures, target, {
      hp: targetHp?.hp ?? null,
      maxHp: targetHp?.maxHp ?? null,
      dead: dead && !name,
      downed,
    });
  }
  for (const entry of Object.values(record)) {
    if (entry && typeof entry === "object") {
      walkCreatures(entry, creatures);
    }
  }
}

const SPELL_ACCOUNTING_TOOLS = new Set([
  "use_spell_slot",
  "cast_buff",
  "cast_at_enemy",
  "cast_at_player",
  "aoe_damage",
  "pc_attack",
  "heal",
  "use_resource",
  "use_item",
]);

export function resolveOutcomes(exchanges: readonly ToolExchange[]): ResolvedOutcomes {
  const attacks = new Map<string, AttackFact>();
  const creatures = new Map<string, CreatureFact>();
  const numbers = new Set<number>();
  const damageNumbers: number[] = [];
  const spells = new Set<string>();
  let toolResultCount = 0;

  for (const exchange of exchanges) {
    // A named spell counts as accounted for the moment its tool ran without an
    // error, whether that spent a slot, a pact slot, a resource, or nothing at
    // all (rituals and cantrips legitimately spend nothing).
    if (SPELL_ACCOUNTING_TOOLS.has(exchange.name)) {
      const args = parseJsonObject(exchange.arguments);
      const named = typeof args?.spell === "string" ? normalizeSpellName(args.spell) : "";
      if (named && !(exchange.result && "error" in exchange.result)) {
        spells.add(named);
      }
    }
    const result = exchange.result;
    if (!result || "error" in result) {
      continue;
    }
    toolResultCount += 1;
    walkNumbers(result, numbers, damageNumbers);
    walkCreatures(result, creatures);

    if (typeof result.hit === "boolean") {
      const display =
        typeof result.target === "string"
          ? result.target
          : typeof result.name === "string"
            ? result.name
            : "";
      const key = normalizeCreatureName(display);
      if (key.length >= 3) {
        // A Multiattack routine resolves several swings inside one call; when
        // they disagree, no single clause about "the blow" can be checked.
        const swings = Array.isArray(result.swings) ? result.swings : [];
        const swingOutcomes = swings
          .map((swing) =>
            swing && typeof swing === "object"
              ? (swing as Record<string, unknown>).hit
              : undefined,
          )
          .filter((value): value is boolean => typeof value === "boolean");
        const mixedSwings =
          swingOutcomes.length > 1 && swingOutcomes.some((value) => value !== swingOutcomes[0]);
        const existing = attacks.get(key);
        if (!existing) {
          attacks.set(key, { display, hit: result.hit, ambiguous: mixedSwings });
        } else {
          existing.ambiguous =
            existing.ambiguous ||
            mixedSwings ||
            existing.hit !== result.hit ||
            existing.display !== display;
        }
      }
    }
  }

  // Two enemies whose names collapse together (Goblin 1 and Goblin 2) make
  // every claim about "the goblin" unattributable, whichever map noticed the
  // collision, so the doubt propagates both ways.
  for (const [key, creature] of creatures) {
    const attack = attacks.get(key);
    if (!attack) {
      continue;
    }
    if (creature.ambiguous) {
      attack.ambiguous = true;
    }
    if (attack.ambiguous) {
      creature.ambiguous = true;
    }
  }

  return { attacks, creatures, numbers, damageNumbers, spells, toolResultCount };
}

// ---------------------------------------------------------------------------
// Part 3: reading the prose
// ---------------------------------------------------------------------------

// Quoted speech is a character talking, and characters lie, boast, and swear
// oaths about deaths that never happened. Every matcher runs on prose with the
// dialogue cut out, which is what makes "It's dead, I swear it!" safe.
export function stripQuotedSpeech(text: string): string {
  const paired = text.replace(/"[^"\n]*"/g, " ").replace(/“[^”\n]*”/g, " ");
  // An unbalanced quote means the dialogue runs to the end of its line; drop
  // the rest of that line rather than guess where the speech ended.
  return paired
    .split("\n")
    .map((line) => {
      const opener = line.search(/["“”]/);
      return opener === -1 ? line : line.slice(0, opener);
    })
    .join("\n");
}

// Clause-level, not sentence-level: a semicolon or a dash joins two separate
// claims, and checking them apart keeps a name in one clause from being read as
// the subject of the next.
export function narrationClauses(narration: string): string[] {
  return stripQuotedSpeech(narration.replace(/\[roll:[^\]]*\]/g, " "))
    .split(/\n+|(?<=[.!?…;:])\s+|\s+—\s*|\s*—\s+|\s+--\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

// Anything that turns a statement into a comparison, a possibility, or a report
// of what somebody believes or says. Every matcher skips clauses carrying one:
// a guard that misfires on "the blow felt like death" is worse than one that
// misses a real contradiction, so hedged prose is never checked at all.
const HEDGE =
  /\b(?:if|unless|almost|nearly|barely|would|wouldn't|will|won't|could|couldn't|might|may|must|should|shall|seem|seems|seemed|look|looks|looked|appear|appears|appeared|sound|sounds|sounded|feel|feels|felt|as if|as though|like|unlike|imagine|imagines|imagined|dream|dreams|dreamt|perhaps|maybe|about to|threaten|threatens|threatened|hope|hopes|hoped|fear|fears|feared|think|thinks|thought|believe|believes|believed|pretend|pretends|claim|claims|claimed|insist|insists|swear|swears|say|says|said|shout|shouts|shouted|call|calls|called|mutter|mutters|muttered|whisper|whispers|whispered|snarl|snarls|snarled|promise|promises|promised|warn|warns|warned|ask|asks|asked|wonder|wonders|wondered|expect|expects|expected|remember|remembers|remembered|scarcely|hardly|were it|had it|report|reports|reported|tell|tells|told|announce|announces|announced|declare|declares|declared|boast|boasts|boasted|cry|cries|cried|yell|yells|yelled|murmur|murmurs|murmured|hear|hears|heard|sense|senses|sensed|guess|guesses|guessed|doubt|doubts|doubted|assume|assumes|assumed|pray|prays|prayed|vow|vows|vowed)\b/i;

// Applied on top of the hedge filter for the assertion matchers: a clause that
// denies its own verb is not the claim we are looking for.
const NEGATION =
  /\b(?:not|n't|never|no longer|nothing|neither|nor|fails? to|failed to|without)\b/i;

function hedged(clause: string): boolean {
  return HEDGE.test(clause);
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The name as prose would write it, with flexible internal whitespace.
function namePattern(name: string): string {
  return escapeRegExp(name).replace(/\s+/g, "\\s+");
}

export type Contradiction = {
  kind: "hit" | "miss" | "death" | "number" | "spell";
  detail: string;
  clause: string;
};

// A hit verb must take the target as its object. "strikes AT the goblin" and
// "swings toward the goblin" are attempts, not outcomes, so the lookahead
// throws them out.
const HIT_VERBS =
  "hits|strikes|slashes|stabs|slams into|smashes into|bites into|sinks into|tears into|rips into|cuts into|slices into|connects with|impales|skewers|bludgeons|gashes|wounds|batters|crashes into|carves into|hammers into";
const HIT_VERB_NOT =
  "at\\b|toward|towards|past\\b|for\\b|through the air|the air\\b|nothing\\b|only\\b|air\\b";
const MISS_PHRASES =
  "misses|missed|whiffs|goes wide|went wide|glances off|glanced off|deflects off|sails past|sailed past|whistles past|falls short|fell short|clangs off|bounces off|finds nothing but air|found nothing but air|turns the blade aside";

function hitClaimPatterns(name: string): RegExp[] {
  const target = namePattern(name);
  return [
    new RegExp(
      `\\b(?:${HIT_VERBS})\\s+(?!${HIT_VERB_NOT})(?:the|that|this|a|an|his|her|its|their)?\\s*${target}\\b`,
      "i",
    ),
    new RegExp(
      `\\b${target}\\b[^.;]{0,25}?\\bis\\s+(?:struck|hit|wounded|impaled|skewered|gashed)\\b`,
      "i",
    ),
    new RegExp(
      `\\b${target}\\b[^.;]{0,25}?\\btakes\\s+the\\s+(?:blow|hit|strike|full force)\\b`,
      "i",
    ),
    new RegExp(
      `\\b${target}\\b[^.;]{0,25}?\\breels\\s+(?:back\\s+)?from\\s+the\\s+(?:blow|hit|strike|impact)\\b`,
      "i",
    ),
  ];
}

// The name must be the thing MISSED, never the thing missing. The attacks map
// is keyed by target, so "the goblin swipes back and misses" is about the
// goblin's own swing (which this turn's results may say nothing about) and is
// deliberately unmatched: only a miss phrase that takes the name as its object
// counts.
function missClaimPatterns(name: string): RegExp[] {
  const target = namePattern(name);
  return [
    new RegExp(
      `\\b(?:${MISS_PHRASES})\\s+(?:of\\s+|by\\s+|over\\s+)?(?:the|that|this|his|her|its|their)?\\s*${target}\\b`,
      "i",
    ),
  ];
}

function deathClaimPatterns(name: string): RegExp[] {
  const target = namePattern(name);
  return [
    new RegExp(
      `\\b${target}\\b[^.;]{0,25}?\\b(?:dies|drops dead|falls dead|is dead|lies dead|is slain|is killed|breathes (?:its|his|her|their) last|goes limp and still|is no more)\\b`,
      "i",
    ),
    new RegExp(
      `\\b${target}\\b[^.;]{0,25}?\\b(?:crumples|collapses|slumps|folds)(?:,| and)\\s+(?:dead|lifeless)\\b`,
      "i",
    ),
    new RegExp(
      `\\b(?:kills|slays|finishes off|cuts down|strikes down|fells|puts down)\\s+(?:the|that|this)?\\s*${target}\\b`,
      "i",
    ),
    new RegExp(`\\b${target}(?:'s|s')?\\s+(?:corpse|lifeless body|dead body)\\b`, "i"),
  ];
}

function downedClaimPatterns(name: string): RegExp[] {
  const target = namePattern(name);
  return [
    new RegExp(
      `\\b${target}\\b[^.;]{0,25}?\\b(?:falls|drops|collapses|slumps)\\s+unconscious\\b`,
      "i",
    ),
    new RegExp(
      `\\b${target}\\b[^.;]{0,25}?\\b(?:falls|drops)\\s+to\\s+0\\s+(?:hp|hit points)\\b`,
      "i",
    ),
  ];
}

// A number in an explicitly mechanical frame. The lookbehind keeps "2d6 damage"
// from reading as "6 damage", and the frame is narrow enough that "twenty gold"
// and "the third bell" never reach the check.
const NUMBER_CLAIM = /(?<![\dd])(\d{1,3})\s+(?:points?\s+of\s+)?(damage|healing)\b/gi;

// Only leveled SRD spells whose casting genuinely costs a slot. Cantrips are
// absent on purpose: casting one spends nothing, so their absence from the
// turn's tool calls would prove nothing.
const LEVELED_SPELLS = [
  "burning hands",
  "charm person",
  "cure wounds",
  "detect magic",
  "disguise self",
  "faerie fire",
  "false life",
  "feather fall",
  "find familiar",
  "fog cloud",
  "healing word",
  "hellish rebuke",
  "hex",
  "hunter's mark",
  "identify",
  "inflict wounds",
  "magic missile",
  "mage armor",
  "protection from evil and good",
  "shield of faith",
  "sleep",
  "thunderwave",
  "bless",
  "bane",
  "aid",
  "blur",
  "darkness",
  "enhance ability",
  "hold person",
  "invisibility",
  "lesser restoration",
  "levitate",
  "mirror image",
  "misty step",
  "moonbeam",
  "pass without trace",
  "scorching ray",
  "shatter",
  "silence",
  "spike growth",
  "spiritual weapon",
  "suggestion",
  "web",
  "animate dead",
  "bestow curse",
  "call lightning",
  "counterspell",
  "dispel magic",
  "fear",
  "fireball",
  "fly",
  "haste",
  "hypnotic pattern",
  "lightning bolt",
  "mass healing word",
  "revivify",
  "sleet storm",
  "slow",
  "spirit guardians",
  "stinking cloud",
  "vampiric touch",
  "banishment",
  "blight",
  "confusion",
  "dimension door",
  "greater invisibility",
  "ice storm",
  "polymorph",
  "wall of fire",
  "cloudkill",
  "cone of cold",
  "dominate person",
  "flame strike",
  "hold monster",
  "mass cure wounds",
  "raise dead",
  "wall of force",
  "chain lightning",
  "disintegrate",
  "sunbeam",
  "true seeing",
  "finger of death",
  "plane shift",
  "resurrection",
  "teleport",
  "dominate monster",
  "power word stun",
  "sunburst",
  "meteor swarm",
  "power word kill",
  "time stop",
  "wish",
].map(normalizeSpellName);

// Every subset sum of the turn's damage numbers, so prose that adds two hits
// into one figure ("nine damage in all") is never called a contradiction.
function allowedNumbers(outcomes: ResolvedOutcomes): Set<number> {
  const allowed = new Set(outcomes.numbers);
  const damage = outcomes.damageNumbers.slice(0, 6);
  for (let mask = 1; mask < 1 << damage.length; mask += 1) {
    let sum = 0;
    for (let index = 0; index < damage.length; index += 1) {
      if (mask & (1 << index)) {
        sum += damage[index];
      }
    }
    allowed.add(sum);
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Part 4: the matchers
// ---------------------------------------------------------------------------

export function findNarrationContradictions(
  narration: string,
  outcomes: ResolvedOutcomes,
  partyNames: readonly string[] = [],
): Contradiction[] {
  const clauses = narrationClauses(narration);
  if (!clauses.length) {
    return [];
  }
  const found: Contradiction[] = [];
  const seen = new Set<string>();
  const add = (contradiction: Contradiction) => {
    const key = `${contradiction.kind}|${contradiction.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(contradiction);
    }
  };
  const allowed = outcomes.numbers.size ? allowedNumbers(outcomes) : null;
  const casters = partyNames.map((name) => name.trim()).filter((name) => name.length >= 3);

  for (const clause of clauses) {
    if (hedged(clause)) {
      continue;
    }
    const negated = NEGATION.test(clause);

    // 1. A hit claimed on a resolved miss, a miss claimed on a resolved hit.
    for (const [key, attack] of outcomes.attacks) {
      if (attack.ambiguous) {
        continue;
      }
      if (!attack.hit && !negated && hitClaimPatterns(key).some((rx) => rx.test(clause))) {
        add({
          kind: "hit",
          detail: `the attack on ${attack.display} MISSED, but the narration lands it`,
          clause,
        });
      }
      if (attack.hit && !negated && missClaimPatterns(key).some((rx) => rx.test(clause))) {
        add({
          kind: "miss",
          detail: `the attack on ${attack.display} HIT, but the narration has it miss`,
          clause,
        });
      }
    }

    // 2. A death or a drop claimed against live, resolved hit points.
    if (!negated) {
      for (const [key, creature] of outcomes.creatures) {
        if (creature.ambiguous || creature.dead || creature.downed) {
          continue;
        }
        if (creature.hp === null || creature.hp <= 0) {
          continue;
        }
        const hpLabel = `${creature.hp}${creature.maxHp === null ? "" : `/${creature.maxHp}`}`;
        if (deathClaimPatterns(key).some((rx) => rx.test(clause))) {
          add({
            kind: "death",
            detail: `${creature.display} is alive at ${hpLabel} HP, but the narration kills it`,
            clause,
          });
        }
        if (downedClaimPatterns(key).some((rx) => rx.test(clause))) {
          add({
            kind: "death",
            detail: `${creature.display} is still up at ${hpLabel} HP, but the narration drops it`,
            clause,
          });
        }
      }
    }

    // 3. A stated damage or healing figure the engine never produced. Only runs
    // when the turn produced numbers at all: with no ground truth there is
    // nothing to contradict.
    if (allowed) {
      NUMBER_CLAIM.lastIndex = 0;
      let match = NUMBER_CLAIM.exec(clause);
      while (match) {
        const stated = Number(match[1]);
        if (!allowed.has(stated)) {
          add({
            kind: "number",
            detail: `the narration states ${stated} ${match[2].toLowerCase()}, which no roll this turn produced`,
            clause,
          });
        }
        match = NUMBER_CLAIM.exec(clause);
      }
    }

    // 4. A party character casting a leveled spell the turn never accounted
    // for. Enemy casters are excluded (their spells run through other tools and
    // spend nothing), and only the present tense counts, so a recap of an
    // earlier casting is left alone.
    if (casters.length && /\bcasts\b/i.test(clause)) {
      for (const caster of casters) {
        for (const spell of LEVELED_SPELLS) {
          if (outcomes.spells.has(spell)) {
            continue;
          }
          // Either apostrophe spelling reads as the same spell in prose.
          const spellInProse = namePattern(spell).replace(/'/g, "['‘’]");
          const pattern = new RegExp(
            `\\b${namePattern(caster)}\\b[^.;]{0,30}?\\bcasts\\s+(?:the\\s+)?(?:spell\\s+)?${spellInProse}\\b`,
            "i",
          );
          if (pattern.test(clause)) {
            add({
              kind: "spell",
              detail: `${caster} casts ${spell}, but no spell slot or resource was spent for it this turn`,
              clause,
            });
          }
        }
      }
    }
  }

  return found;
}

// The whole guard: read the turn's tool exchanges, then check the prose.
export function checkNarration(input: {
  conversation: readonly GuardMessage[];
  narration: string;
  partyNames?: readonly string[];
}): Contradiction[] {
  const narration = (input.narration ?? "").trim();
  if (!narration) {
    return [];
  }
  const outcomes = resolveOutcomes(collectExchanges(input.conversation));
  return findNarrationContradictions(narration, outcomes, input.partyNames ?? []);
}

// The correction the model is asked to make. Kept here so the wording is
// testable without a model call.
export function buildCorrectionPrompt(contradictions: readonly Contradiction[]): string {
  const lines = contradictions
    .slice(0, 6)
    .map((entry) => `- ${entry.detail}. You wrote: "${entry.clause}"`)
    .join("\n");
  return `[System] Your narration contradicts what the dice and tools actually resolved this turn. The tool results are the truth; the prose is what is wrong.
${lines}
Rewrite the whole narration so it matches the real results exactly. Keep everything else: the same scene, the same length, the same voice, the same closing beat. Change only what contradicts the results. Do not call any tool, do not mention this correction, and reply with the corrected narration only.`;
}

// ---------------------------------------------------------------------------
// Part 5: fights announced in prose alone
// ---------------------------------------------------------------------------

// The model sometimes writes the encounter it was supposed to start:
// "**Start Encounter: Ward Construct (CR 1/4)** **Enemies:** 1x ..." with no
// start_encounter call behind it. Nothing exists behind that text: no
// enemies, no initiative order, no HP, and the next player action has nothing
// to swing at. The matchers are deliberately narrow, in the spirit of the
// rest of this file: an announcement header, a call for initiative, or a
// stat-block style enemy roster; never mere talk of fighting.
export function announcesEncounterStart(narration: string): boolean {
  const clauses = narrationClauses(narration);
  const phrase =
    /\bstart(?:s|ing|ed)?\s+(?:the\s+|an?\s+)?encounter\b|\bencounter\s+(?:start(?:s|ed)?|begins|began)\b|\broll\s+(?:for\s+)?initiative\b/i;
  if (clauses.some((clause) => !hedged(clause) && phrase.test(clause))) {
    return true;
  }
  // A roster line ("**Enemies:** 1x ...") only counts alongside another
  // stat-block field, so a shopping list or a scouting report never fires.
  const text = stripQuotedSpeech(narration);
  const roster = /(?:^|[\n*#>-])\s*\**enemies\**\s*:/i.test(text);
  return roster && /\bCR\s*\d|\(\s*CR\b|\**surprise\**\s*:|\binitiative\b/i.test(text);
}

// What the turn loop sends back when a fight was announced with no
// start_encounter behind it. Kept beside the other correction text so the
// wording is testable without a model call.
export const FAKE_ENCOUNTER_PROMPT = `[System] Your narration announced a fight starting, but you never called start_encounter, so no encounter exists: no enemies, no initiative, no hit points. Combat runs only on server-tracked enemies. Call start_encounter now with the enemies you announced, then narrate the fight breaking out from the tool results. Do not restate enemy counts, CR, or stat-block details in prose; the encounter panel shows the table those.`;
