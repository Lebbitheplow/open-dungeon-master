// The reactions a player may take right now against an attack the engine
// recorded (src/lib/dm/last-hit.ts, projected as PublicEncounter.lastHits):
// Shield, Uncanny Dodge, Deflect Missiles and Hellish Rebuke for the
// character just hit, Slow Fall after a fall, Cutting Words and Protection
// for an ally just hit, and the subclass reactions the authored layer
// resolves (src/lib/srd/authored-effects.ts). Absorb Elements is not offered:
// it is not an SRD 5.1 spell and use_reaction does not resolve it.
// use_reaction re-resolves the recorded
// attack and gives back what the rules give back; these cards only offer
// the choice while the engine would still accept it, and carry the engine's
// own refusals (can-act, the cast guard's rules, the reaction budget).
//
// Pure; scripts/test-hand-engine.mjs drives it.
import { casterStateProblem, componentProblem } from "@/lib/dm/cast-rules";
import type { PublicLastHit } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { gateHolds, heldAuthored, type AuthoredReaction } from "@/lib/srd/authored-effects";

type ReactionDoes = AuthoredReaction["does"];
import {
  costGate,
  gated,
  lowestSlot,
  slotLine,
  spellKey,
  standingGate,
  type Gate,
  type HandCard,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { spellNames } from "@/lib/battlemap/hand-spells";

const holds = (sheet: CharacterSheet, fragment: string) =>
  sheet.features.some((feature) => feature.name.toLowerCase().includes(fragment));

function base(
  id: string,
  name: string,
  prompt: string,
  target: HandTarget,
  intent: HandCard["intent"],
  extra: Partial<HandCard> = {},
): HandCard {
  return {
    id: `reaction:${id}`,
    type: "ward",
    name,
    cost: "reaction",
    range: "Self",
    dice: "",
    roll: "no roll",
    rules: "",
    resource: "",
    condition: "",
    icon: { kind: "feature", key: name, family: null },
    target,
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    intent,
    prompt,
    ...extra,
  };
}

function what(hit: PublicLastHit, whom: string): string {
  if (hit.source === "fall") return `${whom} fell for ${hit.damage}`;
  return `${hit.attacker}'s ${hit.attack} hit ${whom}${hit.damage ? ` for ${hit.damage}${hit.type ? ` ${hit.type}` : ""}` : ""}`;
}

// A reaction spell the sheet holds, gated as the cast guard gates it.
function spellReaction(
  sheet: CharacterSheet,
  turn: HandTurn,
  spell: string,
  prompt: string,
  rules: string,
  target: HandTarget,
  extra: Partial<HandCard> = {},
): HandCard | null {
  if (!spellNames(sheet).some((name) => spellKey(name) === spellKey(spell))) return null;
  const facts = bundledSpellFacts(spell);
  const slot = lowestSlot(sheet, facts?.level ?? 1);
  const card = base(
    spellKey(spell).replace(/\s+/g, "-"),
    spell,
    prompt,
    target,
    { card: "reaction", feature: spell, spell, slotLevel: slot?.level ?? null },
    { type: "spell", rules, resource: slot ? slotLine(slot) : "No slots", icon: { kind: "spell", key: spell, family: null }, ...extra },
  );
  const problem = (text: string | null): Gate => (text ? { reason: text, spent: false } : null);
  return gated(
    card,
    standingGate(sheet, turn, "reaction"),
    problem(casterStateProblem(sheet)),
    problem(componentProblem(sheet, facts)),
    slot ? null : { reason: `${sheet.name} has no spell slot left for ${spell}.`, spent: true },
    costGate("reaction", turn, sheet, spell),
  );
}

// Every reaction card the moment offers, the character's own hit first.
export function reactionCards(
  sheet: CharacterSheet,
  turn: HandTurn,
  hits: PublicLastHit[],
  party: Array<Pick<CharacterSheet, "id" | "name">>,
): HandCard[] {
  const cards: HandCard[] = [];
  const answered = (hit: PublicLastHit, name: string) =>
    hit.answered.some((entry) => entry.toLowerCase() === name.toLowerCase());
  const feature = (hit: PublicLastHit, name: string, prompt: string, rules: string, target: HandTarget = "none") => {
    if (answered(hit, name)) return;
    const card = base(
      `${spellKey(name).replace(/\s+/g, "-")}:${hit.characterId}`,
      name,
      prompt,
      target,
      {
        card: "reaction",
        feature: name,
      },
      { rules },
    );
    cards.push(gated(card, standingGate(sheet, turn, "reaction"), costGate("reaction", turn, sheet, name)));
  };

  const mine = hits.find((hit) => hit.characterId === sheet.id && hit.hit);
  if (mine) {
    const prompt = what(mine, "you");
    if (mine.source === "attack") {
      const shield = !answered(mine, "Shield")
        ? spellReaction(sheet, turn, "Shield", prompt, "+5 AC against the attack that hit: a swing the +5 beats misses.", "none")
        : null;
      if (shield) cards.push(shield);
      if (holds(sheet, "uncanny dodge")) {
        feature(mine, "Uncanny Dodge", prompt, "Halve the damage of the attack that hit you.");
      }
      if (mine.ranged && holds(sheet, "deflect missiles")) {
        feature(mine, "Deflect Missiles", prompt, "Take 1d10 + DEX + monk level off a ranged weapon hit.");
      }
      if (mine.attackerId && !answered(mine, "Hellish Rebuke")) {
        const rebuke = spellReaction(
          sheet,
          turn,
          "Hellish Rebuke",
          prompt,
          `${mine.attacker} makes a DEX save against 2d10 fire.`,
          "enemy",
        );
        if (rebuke) cards.push(rebuke);
      }
    }
    if (mine.source === "fall" && holds(sheet, "slow fall")) {
      feature(mine, "Slow Fall", prompt, "Take five times your monk level off the fall.");
    }
    if (mine.source === "attack") {
      for (const held of subclassReactions(sheet, mine, "self")) {
        feature(mine, held.name, prompt, held.rules, held.target);
      }
    }
  }

  // An ally's hit: Cutting Words from a Lore bard, Protection from a
  // protector with a shield. The engine checks the reach and the holder.
  for (const hit of hits) {
    if (hit.characterId === sheet.id || !hit.hit || hit.source !== "attack") continue;
    const ally = party.find((entry) => entry.id === hit.characterId);
    if (!ally) continue;
    const prompt = what(hit, ally.name);
    if (holds(sheet, "cutting words") && (sheet.resources.bardic_inspiration?.max ?? 0) > (sheet.resources.bardic_inspiration?.used ?? 0)) {
      feature(hit, "Cutting Words", prompt, "Spend a Bardic Inspiration die off the roll or the damage.", "ally");
    }
    if (holds(sheet, "protection")) {
      feature(hit, "Protection", prompt, "Impose disadvantage on the attack: it is rolled again.", "ally");
    }
    for (const held of subclassReactions(sheet, hit, "ally")) {
      feature(hit, held.name, prompt, held.rules, "ally");
    }
  }
  return cards;
}

// The reaction cards the moment offers, then the hand without the cards they
// answer for: a prepared Shield sits in the hand as a spell card, and while
// the prompt offers Shield against the hit it is one choice, shown once.
export function withReactions(reactions: HandCard[], hand: HandCard[]): HandCard[] {
  if (!reactions.length) return hand;
  const offered = new Set(reactions.map((card) => spellKey(card.name)));
  return [...reactions, ...hand.filter((card) => !(card.cost === "reaction" && offered.has(spellKey(card.name))))];
}

// What a subclass reaction does, in a line for its card.
function reactionRules(does: ReactionDoes): string {
  switch (does.kind) {
    case "reduce":
      return does.amount === "half" ? "Halve the damage of the attack that hit." : "Take damage off the attack that hit.";
    case "ac_vs_hit":
      return "Raise the AC against the attack that hit: a swing it beats misses.";
    case "disadv_vs_hit":
      return "The attack that hit is rolled again at disadvantage.";
    case "resist_instance":
      return "Resistance to the damage of the attack that hit.";
    case "take_for_ally":
      return "Take the hit in your ally's place.";
    case "strike_back":
      return `Strike back: ${does.type} damage at the attacker.`;
    case "redirect":
      return "The hit lands on the creature beside you instead.";
    case "force_miss":
      return `The hit becomes a miss, for ${does.exhaustion} level${does.exhaustion === 1 ? "" : "s"} of exhaustion.`;
    default:
      return "";
  }
}

// The subclass reactions the character holds that answer this hit, on
// themselves ("self") or on an ally ("ally"), with their gate and their pool
// asked as use_reaction asks them.
function subclassReactions(
  sheet: CharacterSheet,
  hit: PublicLastHit,
  whose: "self" | "ally",
): Array<{ name: string; rules: string; target: HandTarget }> {
  const out: Array<{ name: string; rules: string; target: HandTarget }> = [];
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      if ((reaction.usedBy ?? "holder") !== "holder" || !gateHolds(reaction.gate, sheet, held)) continue;
      const pool = reaction.pool;
      if (pool && "id" in pool) {
        const state = sheet.resources[pool.id];
        if (!state || state.max - state.used < (pool.amount ?? 1)) continue;
      }
      const does = reaction.does;
      const typed = (types?: string[]) => !types?.length || types.includes(hit.type);
      const answers =
        whose === "self"
          ? (does.kind === "reduce" && does.who !== "ally" && typed(does.types)) ||
            does.kind === "ac_vs_hit" ||
            does.kind === "disadv_vs_hit" ||
            (does.kind === "resist_instance" && typed(does.types)) ||
            does.kind === "redirect" ||
            does.kind === "force_miss" ||
            (does.kind === "strike_back" && Boolean(hit.attackerId))
          : (does.kind === "reduce" && does.who !== "self" && typed(does.types)) ||
            does.kind === "take_for_ally" ||
            (does.kind === "resist_instance" && typed(does.types));
      if (!answers) continue;
      const rules = reactionRules(does);
      if (!rules) continue;
      out.push({ name: reaction.name, rules, target: does.kind === "strike_back" ? "enemy" : whose === "ally" ? "ally" : "none" });
    }
  }
  return out;
}

// The ally or attacker a reaction card is aimed at, fixed by the hit it
// answers rather than picked.
export function reactionAim(
  card: HandCard,
  hits: PublicLastHit[],
  sheetId: string,
  party: Array<Pick<CharacterSheet, "id" | "name">>,
): { id: string; name: string; kind: "enemy" | "ally" } | null {
  if (card.target === "enemy") {
    const mine = hits.find((hit) => hit.characterId === sheetId && hit.attackerId);
    return mine?.attackerId ? { id: mine.attackerId, name: mine.attacker, kind: "enemy" } : null;
  }
  if (card.target === "ally") {
    const allyId = card.id.split(":").pop() ?? "";
    const ally = party.find((entry) => entry.id === allyId);
    return ally ? { id: ally.id, name: ally.name, kind: "ally" } : null;
  }
  return null;
}
