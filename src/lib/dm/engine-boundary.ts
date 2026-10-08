// The engine boundary: one authoritative statement of which facts the server
// owns, plus the deterministic guard that rules on what the DM's finished
// prose claims against the outcomes the turn's tools actually resolved. The
// prose itself is read by a model, in the table's language
// (dm/claims-logic.ts, dm/claims.ts); the ruling is here.
//
// Pure by design: no "@/" imports and no I/O, so scripts/test-engine-boundary.mjs
// can import it directly. The DB/model rim lives in dm/narration-guard.ts.
//
// The guard exists because ODM already owns the ground truth (every hit, every
// damage number, every HP total came from a tool result in this same turn) and
// used to throw it away the moment the narration was assembled. Nothing here
// mutates mechanical state; a detection at most costs one corrective model call.

import type { NarrationClaim } from "./claims-logic.ts";

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
The server is the rules engine and you are its voice. It rolls the dice, adjudicates the attacks, and holds every number on every sheet and stat block. Your job is the prose; the engine's job is the math. These eleven kinds of fact are ENGINE-OWNED: you ask for them with a tool, you read the result, and you narrate exactly that. You never compute them, invent them, override them, pre-empt them, or quote the raw numbers behind them.
- Dice outcomes. Every die is rolled by the server through a tool. You choose what is uncertain and how hard it is; the number and the success or failure are not yours.
- Hit and miss. Whether an attack lands is decided by the server rolling against real AC. A reported miss is narrated as a miss even when the moment begs for a hit.
- Damage numbers. The server rolls and applies damage. Narrate the wound at exactly the number reported, never a number you chose.
- HP and death. Current hit points, dropping to 0, death saves, stabilizing, and dying are all server-tracked. A creature is dead, down, or recovered ONLY when a tool result says so.
- Spell slots and resources. Slots, pact slots, limited-use features, and consumables are spent by their tools before the effect exists. A spell narrated without its tool call was never cast.
- Conditions and durations. Conditions land, tick, and expire through their tools, on characters and enemies alike. Never narrate one taking hold or lifting without the call that records it.
- XP and level. The server awards XP and reports when a level-up is available. You never set a level, hit points, armor class, or a level's features and spells yourself: the player levels up from their sheet. A lasting gift the story grants is a story feature through update_sheet, and a spell the story teaches is learn_spell.
- Gold and inventory. Coins, loot, purchases, and items move through their tools, which refuse what a purse cannot cover. Never let money or gear change hands in narration alone.
- The weather and the hour. The clock and the sky in GAME STATE are what the world is doing; time passes through travel, rests and pass_time, and the sky rolls with it. Never narrate a dusk or a storm the state does not show.
- Faction standing. The party's reputation with each faction moves only through adjust_reputation; a member's welcome and the DCs they set follow it.
- Shop prices. What a shelf asks and pays is the server's; buy_item, sell_item and haggle move the coin and the goods. Never quote a price of your own.
If a tool result has not come back, the thing it decides has NOT happened yet: call the tool, or write around it. If a tool refuses on the rules (refused "rules"), the attempt failed, and that failure is what you narrate; if it marks the error retry, the mistake is in your call, so fix the call and send it again instead of narrating it. If an expected number is simply absent, proceed without it and never fabricate the value. Enemy stat-block numbers exist so you can run the fight and are never spoken aloud.`;

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

// The encounter as it stands when the narration is checked, read by the rim
// (dm/narration-guard.ts). It is what makes a claim checkable on a turn
// whose tools said nothing about a creature: a kill narrated with no call
// at all, or a hit on an attack the engine refused.
export type LiveEnemy = { id: string; name: string; hp: number; maxHp: number; status: string };
export type LiveState = { enemies: readonly LiveEnemy[] };

export type ResolvedOutcomes = {
  attacks: Map<string, AttackFact>;
  creatures: Map<string, CreatureFact>;
  // A fight is running: a damage figure in prose then needs a roll behind
  // it even on a turn whose tools produced no numbers at all.
  liveFight?: boolean;
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

// Tools whose refusal means a blow never landed on the enemy they named.
const ATTACK_TOOLS = new Set(["pc_attack", "cast_at_enemy", "pet_attack"]);

export function resolveOutcomes(
  exchanges: readonly ToolExchange[],
  live: LiveState | null = null,
): ResolvedOutcomes {
  const attacks = new Map<string, AttackFact>();
  const creatures = new Map<string, CreatureFact>();
  const numbers = new Set<number>();
  const damageNumbers: number[] = [];
  const spells = new Set<string>();
  const refusedTargets: string[] = [];
  let toolResultCount = 0;

  for (const exchange of exchanges) {
    if (ATTACK_TOOLS.has(exchange.name) && exchange.result && "error" in exchange.result) {
      const args = parseJsonObject(exchange.arguments);
      if (typeof args?.targetEnemyId === "string") {
        refusedTargets.push(args.targetEnemyId);
      }
    }
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

  if (live) {
    // How many live enemies answer to each name a narrator would write: two
    // goblins make "the goblin" nobody in particular.
    const perKey = new Map<string, number>();
    for (const enemy of live.enemies) {
      const key = normalizeCreatureName(enemy.name);
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }
    // A refused attack landed nothing. It is a fact about the target only
    // when no call this turn resolved an attack on it (a retried swing that
    // hit is the truth then).
    for (const id of refusedTargets) {
      const enemy = live.enemies.find((entry) => entry.id === id);
      const key = enemy ? normalizeCreatureName(enemy.name) : "";
      if (enemy && key.length >= 3 && !attacks.has(key)) {
        attacks.set(key, { display: enemy.name, hit: false, ambiguous: (perKey.get(key) ?? 0) > 1 });
      }
    }
    // The encounter's own hit points come last, so they win: they are the
    // state after every call this turn made.
    for (const enemy of live.enemies) {
      if (enemy.status !== "alive" && enemy.status !== "dead") {
        continue;
      }
      recordCreature(creatures, enemy.name, {
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        dead: enemy.status === "dead",
      });
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

  return {
    attacks,
    creatures,
    liveFight: Boolean(live?.enemies.length),
    numbers,
    damageNumbers,
    spells,
    toolResultCount,
  };
}

// ---------------------------------------------------------------------------
// Part 3: ruling on what the narration claims
// ---------------------------------------------------------------------------

// The claims arrive already checked against the narration and the engine's
// refs (dm/claims-logic.ts); what follows decides, from the engine's own
// state alone, which of them contradict it.

export type Contradiction = {
  kind: "hit" | "miss" | "death" | "number" | "spell";
  detail: string;
  clause: string;
};

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

export function ruleClaims(claims: readonly NarrationClaim[], outcomes: ResolvedOutcomes): Contradiction[] {
  const found: Contradiction[] = [];
  const seen = new Set<string>();
  const add = (contradiction: Contradiction) => {
    const key = `${contradiction.kind}|${contradiction.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(contradiction);
    }
  };
  // A figure is only checked when the turn produced numbers or a fight is
  // running: with no ground truth there is nothing to contradict, and in a
  // fight a figure no roll produced is invented whether or not a tool ran.
  const allowed = outcomes.numbers.size || outcomes.liveFight ? allowedNumbers(outcomes) : null;

  for (const claim of claims) {
    switch (claim.kind) {
      // 1. A hit claimed on a resolved miss, a miss claimed on a resolved hit.
      case "hit":
      case "miss": {
        const attack = outcomes.attacks.get(claim.target);
        if (!attack || attack.ambiguous) {
          break;
        }
        if (claim.kind === "hit" && !attack.hit) {
          add({ kind: "hit", detail: `the attack on ${attack.display} MISSED, but the narration lands it`, clause: claim.quote });
        }
        if (claim.kind === "miss" && attack.hit) {
          add({ kind: "miss", detail: `the attack on ${attack.display} HIT, but the narration has it miss`, clause: claim.quote });
        }
        break;
      }
      // 2. A death or a drop claimed against live, resolved hit points.
      case "dies":
      case "downed": {
        const creature = outcomes.creatures.get(claim.target);
        if (!creature || creature.ambiguous || creature.dead || creature.downed) {
          break;
        }
        if (creature.hp === null || creature.hp <= 0) {
          break;
        }
        const hpLabel = `${creature.hp}${creature.maxHp === null ? "" : `/${creature.maxHp}`}`;
        add({
          kind: "death",
          detail:
            claim.kind === "dies"
              ? `${creature.display} is alive at ${hpLabel} HP, but the narration kills it`
              : `${creature.display} is still up at ${hpLabel} HP, but the narration drops it`,
          clause: claim.quote,
        });
        break;
      }
      // 3. A stated damage or healing figure the engine never produced.
      case "amount":
        if (allowed && !allowed.has(claim.value)) {
          add({
            kind: "number",
            detail: `the narration states ${claim.value} ${claim.of}, which no roll this turn produced`,
            clause: claim.quote,
          });
        }
        break;
      // 4. A party character casting a leveled spell the turn never
      // accounted for. Enemy casters are never claims (their spells run
      // through other tools and spend nothing).
      case "cast":
        if (!outcomes.spells.has(claim.spell)) {
          add({
            kind: "spell",
            detail: `${claim.caster} casts ${claim.spell}, but no spell slot or resource was spent for it this turn`,
            clause: claim.quote,
          });
        }
        break;
      case "fight_start":
      case "roll_ask":
        break;
    }
  }
  return found;
}

// The ground truth the claims are ruled against: the turn's tool exchanges
// and the encounter as it stands.
export function guardOutcomes(conversation: readonly GuardMessage[], live: LiveState | null): ResolvedOutcomes {
  return resolveOutcomes(collectExchanges(conversation), live);
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
// Part 4: fights announced in prose alone
// ---------------------------------------------------------------------------

// The model sometimes writes the encounter it was supposed to start:
// "**Start Encounter: Ward Construct (CR 1/4)** **Enemies:** 1x ..." with no
// start_encounter call behind it. Nothing exists behind that text: no
// enemies, no initiative order, no HP, and the next player action has nothing
// to swing at. The reader reports it as a fight_start claim: an announcement,
// a call for initiative, or a stat-block style roster; never mere talk of
// fighting.
export function fightAnnounced(claims: readonly NarrationClaim[]): boolean {
  return claims.some((claim) => claim.kind === "fight_start");
}

// What the turn loop sends back when a fight was announced with no
// start_encounter behind it. Kept beside the other correction text so the
// wording is testable without a model call.
export const FAKE_ENCOUNTER_PROMPT = `[System] Your narration announced a fight starting, but you never called start_encounter, so no encounter exists: no enemies, no initiative, no hit points. Combat runs only on server-tracked enemies. Call start_encounter now with the enemies you announced, then narrate the fight breaking out from the tool results. Do not restate enemy counts, CR, or stat-block details in prose; the encounter panel shows the table those.`;

// ---------------------------------------------------------------------------
// Part 5: blows landed in prose alone
// ---------------------------------------------------------------------------

// A whole number standing on its own, never a piece of an id or of dice
// notation ("2d6", "a8b1-...").
const BARE_NUMBER = /(?<![\w.-])\d{1,3}(?![\w-])/g;

// The model sometimes resolves a blow it was supposed to ask for: "The
// Resonance Weaver attacks Alden with Resonance Blast. Hit! 8 damage." with
// no attack call behind it (issue 91). Nothing happened: the sheet keeps its
// hit points, and the fight that follows contradicts its own opening. The
// ruling above is no help outside a fight, where it has no ground truth to
// hold the figure against. This is narrower and comes earlier: a damage or
// healing figure on a turn whose tools rolled none, that nothing the model
// was shown carries either (a table note for a blow the server dealt itself,
// an earlier line being recalled). Returns the claim's quote, or null.
export function unrolledFigure(claims: readonly NarrationClaim[], conversation: readonly GuardMessage[]): string | null {
  const outcomes = resolveOutcomes(collectExchanges(conversation));
  // The turn rolled damage: a figure that misquotes it is the rewrite's to
  // fix, and sending the model back to the tools would land the blow twice.
  if (outcomes.damageNumbers.length) {
    return null;
  }
  const shown = new Set(outcomes.numbers);
  for (const message of conversation) {
    if (message.role === "system" || typeof message.content !== "string") {
      continue;
    }
    for (const match of message.content.matchAll(BARE_NUMBER)) {
      shown.add(Number(match[0]));
    }
  }
  for (const claim of claims) {
    if (claim.kind === "amount" && !shown.has(claim.value)) {
      return claim.quote;
    }
  }
  return null;
}

// What the turn loop sends back for it. Kept beside the other correction
// text so the wording is testable without a model call.
export function unrolledDamagePrompt(clause: string): string {
  return `[System] Your narration states a damage or healing figure that no tool rolled this turn ("${clause}"), so it has not happened: no hit points changed, and the sheets the table reads do not show it. If that blow belongs in the story, resolve it now with its tool and narrate from the result: start_encounter first when no fight is running, then the attack or spell tool on the turn of whoever acts; apply_hazard or apply_damage for a trap, a fall or anything outside a fight. Otherwise write the moment again without it. Never state a hit, a miss or a figure the server did not return.`;
}
