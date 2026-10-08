// Reading what a narration states, in any language: the pure half of the
// claims reader. A model call (src/lib/dm/claims.ts) reads the prose and
// returns claims, never verdicts; this module decides which kinds of claim a
// turn is asked for, renders the request, and checks every claim the reply
// makes before any of it acts. The engine then rules on what survives with
// its own deterministic conditions (engine-boundary.ts ruleClaims), so the
// rules enforcement never depends on the model's judgement, only on its
// reading. Pure, so scripts/test-claims.mjs loads it directly.

import { z } from "zod";
import { replyJsonObject } from "../reply-json-logic.ts";

export const CLAIM_KINDS = ["hit", "miss", "dies", "downed", "amount", "cast", "fight_start", "roll_ask"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const ROLL_ASK_CHECKS = ["skill", "ability", "save", "initiative"] as const;
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

// What survives the checks. Targets are the engine's creature keys
// (engine-boundary.ts normalizeCreatureName); a cast names its caster as the
// party writes them and its spell normalized as the guard compares it; a
// roll ask names a character id or "all".
export type NarrationClaim =
  | { kind: "hit" | "miss" | "dies" | "downed"; target: string; quote: string }
  | { kind: "amount"; value: number; of: "damage" | "healing"; quote: string }
  | { kind: "cast"; caster: string; spell: string; quote: string }
  | { kind: "fight_start"; quote: string }
  | {
      kind: "roll_ask";
      character: string;
      check: (typeof ROLL_ASK_CHECKS)[number];
      skill?: string;
      ability?: Ability;
      dc?: number;
      quote: string;
    };

// Which claims a piece of narration could contradict or trigger, from
// engine state alone. A kind the turn gives no ground truth for is never
// asked, and a read with nothing to ask is never made.
export type ReaderGate = {
  // The table keeps the narration guard on (game settings).
  guard: boolean;
  // This turn resolved an attack, so a hit or a miss can be checked.
  attacks: boolean;
  // A creature's hit points are known (this turn's results or the live
  // encounter), so a death or a drop can be checked.
  creatures: boolean;
  // A figure can be checked: this turn produced numbers, or a fight runs.
  numbers: boolean;
  // There is a party to cast a spell or be asked to roll.
  party: boolean;
  // The reply may still ask a roll the turn can make (not the last call,
  // and the reply does not already call request_roll).
  rollAsk: boolean;
  // No fight runs, and the one correction for a fight announced in prose
  // is unspent.
  fightStart: boolean;
  // The turn rolled no damage yet, and the one correction for a blow landed
  // in prose is unspent.
  unrolled: boolean;
};

// One read of a passage: the kinds it was asked and the claims that
// survived the checks. A kind it was not asked says nothing either way.
export type PartRead = { kinds: readonly ClaimKind[]; claims: readonly NarrationClaim[] };

export function claimKindsFor(gate: ReaderGate): ClaimKind[] {
  const kinds: ClaimKind[] = [];
  if (gate.guard && gate.attacks) {
    kinds.push("hit", "miss");
  }
  if (gate.guard && gate.creatures) {
    kinds.push("dies", "downed");
  }
  if ((gate.guard && gate.numbers) || gate.unrolled) {
    kinds.push("amount");
  }
  if (gate.guard && gate.party) {
    kinds.push("cast");
  }
  if (gate.fightStart) {
    kinds.push("fight_start");
  }
  if (gate.rollAsk && gate.party) {
    kinds.push("roll_ask");
  }
  return kinds;
}

const KIND_LINES: Record<ClaimKind, string> = {
  hit: '{"kind":"hit","target":REF,"quote":Q}: an attack hits that creature. target is the creature struck, never the attacker.',
  miss: '{"kind":"miss","target":REF,"quote":Q}: an attack aimed at that creature misses it. target is the creature attacked, never the attacker: "an arrow from the bandit flies past Mira" is a miss on Mira, not on the bandit.',
  dies: '{"kind":"dies","target":REF,"quote":Q}: that creature dies, is killed, or is now a corpse.',
  downed: '{"kind":"downed","target":REF,"quote":Q}: that creature falls unconscious or drops.',
  amount: '{"kind":"amount","value":N,"of":"damage"|"healing","quote":Q}: a figure of damage or healing written in digits.',
  cast: '{"kind":"cast","caster":PARTY_REF,"spell":"English spell name","quote":Q}: a party character casts a spell now.',
  fight_start:
    '{"kind":"fight_start","quote":Q}: the narration announces to the players that a fight begins now: a call to roll initiative, or a stat-block style enemy roster (enemy counts with challenge ratings, a surprise field).',
  roll_ask:
    '{"kind":"roll_ask","character":PARTY_REF|"all","check":"skill"|"ability"|"save"|"initiative","skill":SKILL,"ability":"str"|"dex"|"con"|"int"|"wis"|"cha","dc":N,"quote":Q}: the narration asks a party character to roll now. skill only for a skill check; ability for a save or a bare ability check; dc only when stated.',
};

// The reader's instructions. Every claim kind is listed so the system prompt
// is the same on every call; the request says which kinds to use.
export function readerSystem(skillIds: readonly string[]): string {
  return `You read one passage of a tabletop RPG game master's narration and list what it states as happening now, as claims. You do not judge whether a claim is true: the game engine does that. The narration may be in any language; spell names in claims are the English SRD names (the narration may use its own language's name).

Answer with exactly one JSON object and nothing else: {"claims":[ ... ]}. Use only the claim kinds the message lists under "Ask"; with nothing to report, answer {"claims":[]}.

Claim kinds:
${CLAIM_KINDS.map((kind) => `- ${KIND_LINES[kind]}`).join("\n")}
SKILL is one of: ${skillIds.join(", ")}.

Rules:
- A claim only for what the narrator states as a fact happening now. Never for:
  - anything inside quoted dialogue, numbers included;
  - what a character reports, boasts, swears or claims ("the innkeeper insists the boar was slain" is no death);
  - comparisons, metaphors and similes; hedged, possible, nearly-happening or negated statements ("the wyvern barely clings to life" is no death);
  - attempts ("swings at", "strikes toward");
  - events in the past ("yesterday's fireball");
  - a spell cast by anyone outside the party.
- target, caster and character are a ref copied exactly as the message lists it in quotes ("goblin", never "Goblin 1" or "goblin (Goblin 1)"). If the narration doesn't say which listed creature it means, leave the claim out.
- quote: copy the words from the narration exactly, a short span that contains the claim.
- A roll ask that names nobody: "all" when it addresses everyone; the only character when the party has one; otherwise leave it out.`;
}

export type ReaderRefs = {
  // Creature keys with the name the engine prints.
  creatures: Array<{ ref: string; display: string }>;
  party: Array<{ ref: string; name: string }>;
};

export function renderReaderInput(kinds: readonly ClaimKind[], refs: ReaderRefs, text: string): string {
  const creatures = refs.creatures.map((entry) => `"${entry.ref}" for ${entry.display}`).join(", ") || "(none)";
  const party = refs.party.map((entry) => `"${entry.ref}" for ${entry.name}`).join(", ") || "(none)";
  return `Ask: ${kinds.join(", ")}\nCreature refs: ${creatures}\nParty refs: ${party}\n\nNarration:\n<<<\n${text}\n>>>`;
}

// The reply, read once at the boundary: a claim that is not shaped as its
// kind says is dropped, the others still count.
const quoteField = z.string().trim().min(1).max(600);
const claimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["hit", "miss", "dies", "downed"]), target: z.string().min(1).max(120), quote: quoteField }),
  z.object({ kind: z.literal("amount"), value: z.number().int().min(0).max(999), of: z.enum(["damage", "healing"]), quote: quoteField }),
  z.object({ kind: z.literal("cast"), caster: z.string().min(1).max(120), spell: z.string().min(1).max(120), quote: quoteField }),
  z.object({ kind: z.literal("fight_start"), quote: quoteField }),
  z.object({
    kind: z.literal("roll_ask"),
    character: z.string().min(1).max(120),
    check: z.enum(ROLL_ASK_CHECKS),
    skill: z.string().max(40).optional(),
    ability: z.enum(ABILITIES).optional(),
    dc: z.number().int().min(1).max(40).optional(),
    quote: quoteField,
  }),
]);
const replySchema = z.object({ claims: z.array(z.unknown()).max(40) });

// The claims in a reply, fences and stray prose around its JSON object
// ignored; null when there is no such object.
export function parseReaderReply(raw: string): unknown[] | null {
  const reply = replySchema.safeParse(replyJsonObject(raw));
  return reply.success ? reply.data.claims : null;
}

// Quotes are compared with their quote marks, apostrophes, spacing and case
// folded, so a reader that straightens a curly quote still matches.
export function squash(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[“”«»„"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type ClaimContext = {
  kinds: readonly ClaimKind[];
  text: string;
  // outcomes.attacks keys, for a hit or a miss.
  attackRefs: ReadonlySet<string>;
  // outcomes.creatures keys, for a death or a drop.
  creatureRefs: ReadonlySet<string>;
  // Party character id to name.
  party: ReadonlyMap<string, string>;
  // Every leveled spell the spell data knows, normalized (cantrips cost
  // nothing, so a cast of one proves nothing).
  leveledSpells: ReadonlySet<string>;
  normalizeSpell: (name: string) => string;
  skills: ReadonlySet<string>;
};

// The claims that may act: shaped as their kind, asked for, quoting the
// narration word for word, and naming only refs, spells, skills and
// abilities the engine knows. Anything else is dropped, so an invented
// claim never acts.
export function checkClaims(raw: readonly unknown[], context: ClaimContext): NarrationClaim[] {
  const text = squash(context.text);
  const asked = new Set(context.kinds);
  const kept: NarrationClaim[] = [];
  for (const entry of raw) {
    const parsed = claimSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const claim = parsed.data;
    if (!asked.has(claim.kind) || !text.includes(squash(claim.quote))) {
      continue;
    }
    switch (claim.kind) {
      case "hit":
      case "miss":
        if (context.attackRefs.has(claim.target)) {
          kept.push(claim);
        }
        break;
      case "dies":
      case "downed":
        if (context.creatureRefs.has(claim.target)) {
          kept.push(claim);
        }
        break;
      case "amount":
      case "fight_start":
        kept.push(claim);
        break;
      case "cast": {
        const caster = context.party.get(claim.caster);
        const spell = context.normalizeSpell(claim.spell);
        if (caster && context.leveledSpells.has(spell)) {
          kept.push({ kind: "cast", caster, spell, quote: claim.quote });
        }
        break;
      }
      case "roll_ask": {
        if (claim.character !== "all" && !context.party.has(claim.character)) {
          break;
        }
        if (claim.check === "skill" && !(claim.skill && context.skills.has(claim.skill))) {
          break;
        }
        if ((claim.check === "ability" || claim.check === "save") && !claim.ability) {
          break;
        }
        kept.push(claim);
        break;
      }
    }
  }
  return kept;
}
