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
import type { Speaker } from "./speech.ts";
import { QUOTE, quotedText, speakerMatchers } from "./speech-prose.ts";
import { textKey, words } from "../language/text-logic.ts";
import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { DEED_KINDS, type DeedKind } from "./companion-values-logic.ts";

export const CLAIM_KINDS = ["hit", "miss", "dies", "downed", "amount", "cast", "fight_start", "roll_ask", "aside", "speaker", "turn_over", "deed"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const ROLL_ASK_CHECKS = ["skill", "ability", "save", "initiative"] as const;
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

// What survives the checks. Targets are the engine's creature keys
// (engine-boundary.ts normalizeCreatureName); a cast names its caster as the
// party writes them and its spell normalized as the guard compares it; a
// roll ask names a character id or "all"; a speaker claim holds the quoted
// line's own words and who speaks it (src/lib/dm/speech.ts SpokenLine).
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
    }
  | { kind: "aside"; quote: string }
  | { kind: "speaker"; line: string; speaker: Speaker }
  | { kind: "turn_over"; quote: string }
  // A deed a party character commits now (issue 503): who, by id and name.
  | { kind: "deed"; character: string; name: string; deed: DeedKind; quote: string };

// Which claims a piece of narration could contradict or trigger, from
// engine state alone. A kind the turn gives no ground truth for is never
// asked, and a read with nothing to ask is never made.
export type ReaderGate = {
  // The table keeps the narration guard on (game settings).
  guard: boolean;
  // This turn resolved an attack, so a hit or a miss can be checked.
  attacks: boolean;
  // A fight runs, so a hit or a miss on an enemy no tool touched this turn
  // can be caught as an attack the prose alone resolved.
  fight?: boolean;
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
  // The passage holds a quoted line, so who speaks it can be stored with
  // the message.
  speech: boolean;
  // The turn rolled no damage yet, and the one correction for a blow landed
  // in prose is unspent.
  unrolled: boolean;
  // The passage may reach the table as narration, so a sentence where the
  // narrator talks to itself about its next steps can be kept off it.
  aside?: boolean;
  // A fight waits on a player's character whose turn this DM turn has not
  // ended, so prose that hands the turn on can end it (dm/claims.ts
  // turnOverFor).
  turnOver?: boolean;
  // A lasting companion whose conscience weighs deeds travels with the
  // party (issue 503), so a deed the narration shows unrecorded is noted.
  deeds?: boolean;
};

// One read of a passage: the kinds it was asked and the claims that
// survived the checks. A kind it was not asked says nothing either way.
export type PartRead = { kinds: readonly ClaimKind[]; claims: readonly NarrationClaim[] };

export function claimKindsFor(gate: ReaderGate): ClaimKind[] {
  const kinds: ClaimKind[] = [];
  if (gate.guard && (gate.attacks || gate.fight)) {
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
  if (gate.aside) {
    kinds.push("aside");
  }
  if (gate.speech) {
    kinds.push("speaker");
  }
  if (gate.turnOver) {
    kinds.push("turn_over");
  }
  if (gate.guard && gate.deeds) {
    kinds.push("deed");
  }
  return kinds;
}

const KIND_LINES: Record<ClaimKind, string> = {
  hit: '{"kind":"hit","target":REF,"quote":Q}: an attack hits that creature. target is the creature struck, never the attacker.',
  miss: '{"kind":"miss","target":REF,"quote":Q}: an attack aimed at that creature misses it. target is the creature attacked, never the attacker: "an arrow from the bandit flies past Mira" is a miss on Mira, not on the bandit.',
  dies: '{"kind":"dies","target":REF,"quote":Q}: that creature dies, is killed, or is now a corpse.',
  downed: '{"kind":"downed","target":REF,"quote":Q}: that creature falls unconscious or drops.',
  amount: '{"kind":"amount","value":N,"of":"damage"|"healing","quote":Q}: a figure of damage or healing written in digits.',
  // spent is kept out of the template: shown in it, a small local model
  // tied a cast beside a spend to that spend, even a spell the narration
  // named, so the cast went unflagged (measured on the reader's test
  // cases; a hosted model read them the same either way).
  cast: '{"kind":"cast","caster":PARTY_REF,"spell":"English spell name","quote":Q}: a party character casts a spell now. Add "spent":SPENT_REF only when what the narration describes is really the effect of something that character spent this turn, as the message lists it under "Spent refs": a feature, an item or an action is no spell, whatever spell it looks like. Never for a spell the narration names or says is cast: that is a cast of its own, even beside a spend.',
  // An ambush told as story counts: gpt-oss-20b narrated goblins bursting
  // from the cliffs and closing in, with no start_encounter, and the reader
  // read no fight in it, so the fight began a turn late (2026-10-20). Words,
  // gestures, weapons drawn and fights between others stay out by name: a
  // claim here makes the model start an encounter (gpt-oss read a threat, an
  // ogre's jabbing finger and sparring guards as fights before they did).
  fight_start:
    '{"kind":"fight_start","quote":Q}: a fight begins now. Report it for any one of: a call to roll initiative; a stat-block style enemy roster (enemy counts with challenge ratings, a surprise field); hostile creatures attacking a party character now: an ambush springing on them, enemies charging, leaping or rushing at them, a blow struck or a shot loosed at one of them (the attack beginning is enough, landed or not). quote is the words of that attack or that call. Never for words, threats, demands, warnings or gestures, or weapons drawn or aimed with no attack made yet; a fight between others that no party character is in (sparring, a brawl across the room); a fight that might come, is told as past, or is over.',
  roll_ask:
    '{"kind":"roll_ask","character":PARTY_REF|"all","check":"skill"|"ability"|"save"|"initiative","skill":SKILL,"ability":"str"|"dex"|"con"|"int"|"wis"|"cha","dc":N,"quote":Q}: the narration asks a party character to roll now. skill only for a skill check; ability for a save or a bare ability check; dc only when stated.',
  // Narrow on purpose: a sentence it names is cut from the narration, so
  // everything that only sounds like an aside is listed as not one.
  aside:
    '{"kind":"aside","quote":Q}: the narrator steps out of the story to talk to itself about its own work: what it will do, check, look up or set up next, or the game\'s bookkeeping that work waits on ("The quay is not on the map yet.", "I\'ll check how the table records that first."). Unlike the other kinds it is not about what happens in the story. One claim per such sentence; quote is copied from that one sentence. Never for: any character\'s words, however they are written (quoted in any style, a letter, an inscription, a song, a voice in someone\'s head); an out-of-character answer to a player; a question or an offer to the players ("What do you do?", "Let me know if you search the boat."); the story itself, even told by a narrator who says "I" because the table asked for one.',
  turn_over:
    '{"kind":"turn_over","quote":Q}: the narration says the acting character\'s own turn is over now, or hands the turn to whoever acts next ("Your turn ends.", "It is now Bram\'s turn.", "The goblins act next."); in a player\'s words, that they end their turn ("...then I end my turn.", "That\'s my turn."). Never for a question about what they do next, or an offer of what they could still do.',
  deed: `{"kind":"deed","actor":PARTY_REF,"deed":DEED,"quote":Q}: a party character commits one of these deeds now. DEED is one of: murder_helpless (kills someone who cannot fight back: a prisoner, the bound, the surrendered, the sleeping), torture, theft_from_poor, necromancy (raises or commands the dead), desecration (of graves, the dead or a holy place), slaving (takes, sells or keeps slaves), cruelty, betrayal (of an ally), broke_word, mercy (spares a beaten foe who could be killed). Never for a threat, a plan, a deed someone else does, or killing an enemy who is still fighting.`,
  speaker:
    '{"kind":"speaker","ref":SPEAKER_REF,"quote":Q}: the one claim about quoted dialogue, saying only who speaks a line of it; quote is copied from inside that line\'s quotation marks. Only when the words around the line tie it to one listed person: a tag that names them or one of their other names, the person the narration is about just before or after it, or a word like "she" that points back to them. Leave the line out when its tag names nobody listed ("a guard calls", "you say"), when it answers the line before with no tag of its own, or when you would be guessing: a line left out stays the narrator\'s, and a line given to the wrong person is a mistake. One claim per quoted line.',
};

// The plain English ways a player ends their turn, read only at an English
// table, beside the reader's turn_over claim on their words (dm/claims.ts
// readTurnEndInWords): gpt-oss-20b as the reader found "then I end my turn"
// in one reading and missed it in the next. A miss here costs what a table in
// any other language pays: the reader's reading alone.
const ENGLISH_ENDS_TURN = /\b(?:end(?:s|ing)?|finish(?:es|ing)?) (?:my|the|his|her|their) turn\b|\bthat'?s (?:it for )?my turn\b|\bmy turn is (?:over|done)\b/i;

export function englishEndsTurn(text: string): boolean {
  return ENGLISH_ENDS_TURN.test(text);
}

// The reader's instructions. Every claim kind about the game is listed so the
// system prompt is the same on every call; the request says which kinds to
// use. Who speaks a line is listed only on a read that asks it: offered on
// every read, it made the other kinds' reads worse (measured on the reader's
// test cases, three runs with it and three without).
// A read that asks who speaks beside the other kinds is told to answer for
// every line: among the other kinds, a small local model let the rule
// against quoted dialogue win and named nobody (recorded narration, five
// languages). A read asking only who speaks is not: told the same, it
// guessed.
export function readerSystem(skillIds: readonly string[], speakers: boolean, alongside = false): string {
  const kinds = CLAIM_KINDS.filter((kind) => speakers || kind !== "speaker");
  return `You read one passage of a tabletop RPG game master's narration and list what it states as happening now, as claims. You do not judge whether a claim is true: the game engine does that. The narration may be in any language; spell names in claims are the English SRD names (the narration may use its own language's name).

Answer with exactly one JSON object and nothing else: {"claims":[ ... ]}. Use only the claim kinds the message lists under "Ask"; with nothing to report, answer {"claims":[]}.

Claim kinds:
${kinds.map((kind) => `- ${KIND_LINES[kind]}`).join("\n")}
SKILL is one of: ${skillIds.join(", ")}.

Rules:
- A passage headed "Player's words" is asked only for turn_over: there the player's own word that their turn ends is the claim.
- A claim only for what the narrator states as a fact happening now. Never for:
  - anything inside quoted dialogue, numbers included;
  - what a character reports, boasts, swears or claims ("the innkeeper insists the boar was slain" is no death);
  - comparisons, metaphors and similes; hedged, possible, nearly-happening, hypothetical or negated statements ("the wyvern barely clings to life" is no death; "your blade would miss from here" and "it cannot reach him" are no miss);
  - attempts ("swings at", "strikes toward");
  - events in the past ("yesterday's fireball");
  - a spell cast by anyone outside the party.
- target, caster${speakers ? ", character and ref are" : " and character are"} a ref copied exactly as the message lists it in quotes ("goblin", never "Goblin 1" or "goblin (Goblin 1)"). If the narration doesn't say which listed creature it means, leave the claim out.
- quote: copy the words from the narration exactly, a short span that contains the claim.
- A roll ask that names nobody: "all" when it addresses everyone; the only character when the party has one; otherwise leave it out.${
    speakers && alongside
      ? `
- speaker is the one kind that reads quoted dialogue: give a speaker claim for every quoted line the words around it tie to a listed person, however many lines the passage has. Someone the narration describes who has no speaker ref (a sentry, a passer-by, "the cook") speaks their own lines: leave those out, even when a listed person is close by.`
      : ""
  }`;
}

export type ReaderRefs = {
  // Creature keys with the name the engine prints.
  creatures: Array<{ ref: string; display: string }>;
  party: Array<{ ref: string; name: string }>;
  // Everyone who may speak a line, by ref, when speakers are asked.
  speakers: Array<{ ref: string; name: string; aliases?: readonly string[] }>;
  // What the party spent this turn, by ref, with who spent it.
  spent: Array<{ ref: string; name: string; by: string }>;
};

// A player's own words are read only for turn_over (claims.ts
// readTurnEndInWords), under their own heading.
export function renderReaderInput(kinds: readonly ClaimKind[], refs: ReaderRefs, text: string, heading: "Narration" | "Player's words" = "Narration"): string {
  const creatures = refs.creatures.map((entry) => `"${entry.ref}" for ${entry.display}`).join(", ") || "(none)";
  const party = refs.party.map((entry) => `"${entry.ref}" for ${entry.name}`).join(", ") || "(none)";
  const speakers = kinds.includes("speaker")
    ? `\nSpeaker refs: ${refs.speakers.map((entry) => `"${entry.ref}" for ${entry.name}${entry.aliases?.length ? ` (also: ${entry.aliases.join(", ")})` : ""}`).join(", ") || "(none)"}`
    : "";
  const spent =
    kinds.includes("cast") && refs.spent.length
      ? `\nSpent refs: ${refs.spent.map((entry) => `"${entry.ref}" for ${entry.name} (${entry.by})`).join(", ")}`
      : "";
  return `Ask: ${kinds.join(", ")}\nCreature refs: ${creatures}\nParty refs: ${party}${spent}${speakers}\n\n${heading}:\n<<<\n${text}\n>>>`;
}

// The reply, read once at the boundary: a claim that is not shaped as its
// kind says is dropped, the others still count.
const quoteField = z.string().trim().min(1).max(600);
const claimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["hit", "miss", "dies", "downed"]), target: z.string().min(1).max(120), quote: quoteField }),
  z.object({ kind: z.literal("amount"), value: z.number().int().min(0).max(999), of: z.enum(["damage", "healing"]), quote: quoteField }),
  z.object({
    kind: z.literal("cast"),
    caster: z.string().min(1).max(120),
    spell: z.string().min(1).max(120),
    // A model writes null for a field it leaves empty: that is no spend,
    // and the cast still counts.
    spent: z.string().max(20).nullable().optional(),
    quote: quoteField,
  }),
  z.object({ kind: z.literal("fight_start"), quote: quoteField }),
  z.object({
    kind: z.literal("roll_ask"),
    character: z.string().min(1).max(120),
    check: z.enum(ROLL_ASK_CHECKS),
    // A model writes null for a field it leaves empty: the ask still counts,
    // as if the field were left out (checkClaims).
    skill: z.string().max(40).nullable().optional(),
    ability: z.enum(ABILITIES).nullable().optional(),
    dc: z.number().int().min(1).max(40).nullable().optional(),
    quote: quoteField,
  }),
  z.object({ kind: z.literal("aside"), quote: quoteField }),
  z.object({ kind: z.literal("turn_over"), quote: quoteField }),
  z.object({ kind: z.literal("speaker"), ref: z.string().min(1).max(120), quote: quoteField }),
  z.object({ kind: z.literal("deed"), actor: z.string().min(1).max(120), deed: z.enum(DEED_KINDS), quote: quoteField }),
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
  return textKey(text.replace(/[“”«»„"]/g, '"').replace(/[‘’]/g, "'"));
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
  // Spend ref to the party character id who spent it.
  spent: ReadonlyMap<string, string>;
  // Speaker ref to who it is: the people the passage names (namedSpeakers).
  speakers: ReadonlyMap<string, Speaker>;
};

// The people a passage names outside its quoted lines: the only ones the
// reader may say a line belongs to, so it never names someone the prose
// hides ("the hooded figure" stays nobody's), and the only ones its request
// lists. A word of a longer name counts only written as a name: "the pike"
// is a weapon, not Old Pike.
export function namedSpeakers(text: string, speakers: ReadonlyMap<string, Speaker>): Map<string, Speaker> {
  const prose = text.replace(QUOTE, " ");
  return new Map(
    [...speakers].filter(([, speaker]) => {
      const [{ pattern, short }] = speakerMatchers([speaker]);
      return [...prose.matchAll(pattern)].some((found) => !short.has(textKey(found[0])) || /^\p{Lu}/u.test(found[0]));
    }),
  );
}

// The quoted line a speaker claim's quote comes from, when exactly one line
// of the passage holds it. A quote copied with the line's own quotation
// marks («…», as small local models do) stands for the words inside them.
function speakerLine(text: string, quote: string): string | null {
  const [marked] = quote.trim().matchAll(QUOTE);
  const words = marked?.[0] === quote.trim() ? quotedText(marked) : quote;
  const lines = [...text.matchAll(QUOTE)].map(quotedText).filter((line) => squash(line).includes(squash(words)));
  return lines.length === 1 ? lines[0] : null;
}

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
        // A blow on a creature the turn attacked is checked against the roll;
        // one on a creature of the fight that no tool touched is a blow the
        // prose alone resolved (engine-boundary.ts unrolledBlow).
        if (context.attackRefs.has(claim.target) || context.creatureRefs.has(claim.target)) {
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
      case "aside":
      case "turn_over":
        kept.push(claim);
        break;
      case "cast": {
        const caster = context.party.get(claim.caster);
        // Tied to what its own caster spent, the cast is that spend, which
        // its tool already resolved. A tie to anyone else's spend, or to none
        // the turn made, excuses nothing.
        const paid = claim.spent ? context.spent.get(claim.spent) === claim.caster : false;
        if (caster && context.leveledSpells.has(context.normalizeSpell(claim.spell)) && !paid) {
          kept.push({ kind: "cast", caster, spell: claim.spell, quote: claim.quote });
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
        // Only the fields the reader filled go on: a null DC would otherwise
        // reach request_roll as one (rolls.ts rollAsksFromClaims).
        const { skill, ability, dc, ...ask } = claim;
        kept.push({ ...ask, ...(skill ? { skill } : {}), ...(ability ? { ability } : {}), ...(dc ? { dc } : {}) });
        break;
      }
      case "deed": {
        // Only a party character's: what the engine can ask them about.
        const name = context.party.get(claim.actor);
        if (name) {
          kept.push({ kind: "deed", character: claim.actor, name, deed: claim.deed, quote: claim.quote });
        }
        break;
      }
      case "speaker": {
        const speaker = context.speakers.get(claim.ref);
        const line = speaker ? speakerLine(context.text, claim.quote) : null;
        if (speaker && line) {
          kept.push({ kind: "speaker", line, speaker });
        }
        break;
      }
    }
  }
  return kept;
}

// The passage with every sentence that holds one of the quotes cut out: how
// a roll asked in words (rolls.ts rollAsksFromClaims) and the narrator's
// asides leave the narration. A sentence runs to its end mark or the end of
// its line; a quote that runs over several sentences cuts each of them.
export function withoutSentences(text: string, quotes: readonly string[]): string {
  if (!text || !quotes.length) {
    return text;
  }
  // Where each cut sentence starts, and where it ends.
  const removals = new Map<number, number>();
  const sentences = [...text.matchAll(/[^.!?\n]+[.!?]*/g)];
  const cut = (quote: string) => {
    const sentence = sentences.find((match) => squash(match[0]).includes(quote));
    if (sentence?.index === undefined) {
      return false;
    }
    // Swallow trailing bold markers so no orphan ** litters the narration
    // (leading ones sit inside the sentence match already).
    let end = sentence.index + sentence[0].length;
    if (text.slice(end, end + 2) === "**") {
      end += 2;
    }
    removals.set(sentence.index, end);
    return true;
  };
  for (const quote of quotes) {
    if (!cut(squash(quote))) {
      for (const piece of quote.match(/[^.!?\n]+[.!?]*/g) ?? []) {
        if (squash(piece)) {
          cut(squash(piece));
        }
      }
    }
  }
  let cleaned = "";
  let cursor = 0;
  for (const [start, end] of [...removals].sort((a, b) => a[0] - b[0])) {
    cleaned += text.slice(cursor, start);
    cursor = end;
  }
  cleaned += text.slice(cursor);
  return cleaned
    .replace(/(^|\s)\*\*(\s|$)/g, "$1$2")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A reply's prose with the narrator's asides cut out, by the reader's aside
// claims; empty when no word of the story is left (a stray quote mark or
// bold marker is not one), which is how a reply that was only the model's
// plan reads.
// What a small model writes about the turn rather than in it, found without
// the reader (Gemma4 e4b's reader, the same small model, quoted none of it):
// its own input format echoed back ("Bram | attempt to ask the merchant..."),
// a table note copied out, and sentences about tool calls and corrections
// ("I will correct this by calling the necessary tool to resolve the attack
// properly"). The phrasings are English, read only at an English table; the
// reader's asides cover every language. A sentence holding a quotation is
// speech and is never taken.
const ENGLISH_META_SENTENCE =
  /\btool[ -]?calls?\b|\b(?:the|this|a) tool'?s? (?:output|result)s?\b|\bcalling the (?:necessary |right |appropriate |correct )?tools?\b|\bnarrate the results?\b|\bunwarranted assumption\b|\bmy (?:previous|last|earlier) (?:response|reply|narration|message)\b/i;
const ECHOED_LINE = /^[ \t]*(?:\[[^\]\n]{1,80}\|\s*attempt\][^\n]*|[^\n|[\]]{1,60}\s\|\s*attempt\b[^\n]*|\[Table note\][^\n]*)$/gim;
// The game state copied into the story by a small model (Qwen3.5 9B): the
// turn order recited as a numbered list under its English heading (read only
// at an English table), and the board squares it reads, "(7,13)", at every
// table. The board shows both; the prose never needs them.
const ENGLISH_ORDER_BLOCK = /^[ \t]*\**[ \t]*(?:current[ \t]+)?(?:initiative(?:[ \t]+order)?|turn[ \t]+order)[ \t]*(?::\**|\**[ \t]*:)[^\n]*(?:\n[ \t]*\d+\.[^\n]*)*/gim;
const GRID_SQUARE = /\(\s*\d{1,3}\s*,\s*\d{1,3}\s*\)/;

export function metaQuotes(text: string, language: TableLanguage): string[] {
  const quotes = [...text.matchAll(ECHOED_LINE)].map((match) => match[0].trim());
  for (const match of text.matchAll(/[^.!?\n]+[.!?]*/g)) {
    if (((language === "english" && ENGLISH_META_SENTENCE.test(match[0])) || GRID_SQUARE.test(match[0])) && !/["\u201c\u201d\u00ab\u00bb]/.test(match[0])) {
      quotes.push(match[0].trim());
    }
  }
  return quotes.filter(Boolean);
}

export function withoutAsides(text: string, claims: readonly NarrationClaim[], language: TableLanguage): string {
  // A recited turn order under its English heading goes whole, heading and
  // list, at an English table only (cut sentence by sentence, its "3." would
  // match the wrong line); at any table the reader's asides and the board
  // squares quoted still go.
  const unlisted = language === "english" ? text.replace(ENGLISH_ORDER_BLOCK, "").replace(/\n{3,}/g, "\n\n").trim() : text.trim();
  const source = unlisted === text.trim() ? text : unlisted;
  const quotes = [...claims.flatMap((claim) => (claim.kind === "aside" ? [claim.quote] : [])), ...metaQuotes(source, language)];
  if (!quotes.length) {
    return words(source).length ? source : "";
  }
  const kept = withoutSentences(source, quotes);
  return words(kept).length ? kept : "";
}
