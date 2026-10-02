// What a card says once it is chosen: the outcome preview, the sentence the
// engine reads, the structured intent beside it, and the turn bookkeeping
// (docs/visual-overhaul-plan.md 5.2 and 5.3). Pure, tested by
// scripts/test-hand.mjs.
import { spendAction, spendAttack } from "@/lib/dm/action-budget";
import { BONUS_SPELL, LEVELLED_SPELL } from "@/lib/dm/cast-rules";
import { attackContext, mergeAdvantage } from "@/lib/dm/condition-logic";
import { asPercent, attackOdds, averageDetail } from "@/lib/srd/odds";
import {
  budgetOf,
  type HandAttackOption,
  type HandAttackOptionId,
  type HandCard,
  type HandCost,
  type HandIntent,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { areaArgs, describePick, hasPick, type AreaPick, type HandArea } from "@/lib/battlemap/hand-area";

// Who a card is aimed at. `ac` only ever arrives in the DM's projection; a
// player's preview works from the challenge rating, which they can see.
// `edge` is the board's own verdict on the line from the player's token to
// this one (src/lib/battlemap/view-tactics.ts, the engine's coverFor and
// flanking): absent off the map.
export type HandAim = {
  id: string;
  name: string;
  kind: "enemy" | "ally" | "self";
  ac?: number;
  cr?: number;
  conditions?: string[];
  edge?: { cover: 0 | 2 | 5; flanking: boolean; adjacent: boolean; blocked?: boolean; hostileBeside?: boolean };
};

// What the player chose on the raised card beyond its target.
export type HandChoices = {
  options?: HandAttackOptionId[];
  trigger?: string;
  // The card's one pick (HandCard.choice): a spell's form, a readied spell.
  choice?: string;
  // Where an area spell is laid (HandCard.area), picked on the board.
  area?: AreaPick;
};

// The value a card's pick sends: the player's, else the card's fallback,
// else its first option.
export function chosenValue(card: HandCard, choices: HandChoices = {}): string | null {
  const choice = card.choice;
  if (!choice) return null;
  const picked = choices.choice;
  if (picked !== undefined && choice.options.some((option) => option.value === picked)) return picked;
  return choice.fallback ?? choice.options[0]?.value ?? null;
}

function chosenLabel(card: HandCard, choices: HandChoices): string | null {
  const value = chosenValue(card, choices);
  if (!value) return null;
  return card.choice?.options.find((option) => option.value === value)?.label ?? value;
}

export type PreviewRow = { key: string; value: string; tone: "damage" | "heal" | "plain" | "save" | "muted" | "applies" | "cost" };

// The armour class a creature of this challenge usually carries (the SRD's
// monster statistics by challenge rating). An estimate, and labelled as one.
export function typicalAcForCr(cr: number): number {
  if (cr < 4) return 13;
  if (cr < 5) return 14;
  if (cr < 8) return 15;
  if (cr < 10) return 16;
  if (cr < 13) return 17;
  if (cr < 17) return 18;
  return 19;
}

const COST_LABEL: Record<HandCost, string> = {
  action: "Action",
  bonus: "Bonus action",
  reaction: "Reaction",
  rider: "Rider",
  free: "Free",
};

export function costLabel(cost: HandCost): string {
  return COST_LABEL[cost];
}

function mean(expression: string): string | null {
  const detail = averageDetail(expression);
  return Number.isFinite(detail.average) && detail.exact ? detail.average.toFixed(1) : null;
}

// The rows of the outcome preview. Arithmetic, not hints: the mean of the
// dice, the real d20 odds against the armour class, the save and its DC.
export function previewRows(
  card: HandCard,
  aim: HandAim | null,
  attackerConditions: string[] = [],
  choices: HandChoices = {},
): PreviewRow[] {
  const rows: PreviewRow[] = [];
  if (card.dice) {
    rows.push({ key: card.heals ? "Restores" : card.damage ? "Damage" : "Effect", value: card.dice, tone: card.heals ? "heal" : card.damage ? "damage" : "plain" });
  }
  if (card.damage) {
    const expected = mean(card.damage);
    if (expected) rows.push({ key: card.heals ? "Expected" : "Expected dmg", value: card.heals ? `+${expected}` : expected, tone: "plain" });
  }
  if (card.save) {
    rows.push({ key: "Save", value: card.save.dc ? `${card.save.ability} save vs DC ${card.save.dc}` : `${card.save.ability} save`, tone: "save" });
  } else if (card.toHit !== null) {
    const bonus = card.toHit >= 0 ? `+${card.toHit}` : `${card.toHit}`;
    const enemy = aim && aim.kind === "enemy" ? aim : null;
    const known = enemy?.ac;
    const base = known ?? (enemy?.cr !== undefined ? typicalAcForCr(enemy.cr) : null);
    if (base === null) {
      rows.push({ key: "To hit", value: bonus, tone: "plain" });
    } else {
      // The board's verdict, when there is one: how far apart, whether the
      // line gives cover (+2, +5), whether an ally flanks with you.
      const edge = enemy?.edge;
      const adjacent = edge ? edge.adjacent : card.melee;
      const context = attackContext({
        attackerConditions,
        targetConditions: enemy?.conditions ?? [],
        melee: card.melee,
        adjacent,
        requested: "none",
      });
      const sources = [context.advantage];
      if (edge?.flanking && card.melee) sources.push("advantage");
      if (choices.options?.includes("reckless")) sources.push("advantage");
      if (choices.options?.includes("useInspiration")) sources.push("advantage");
      // A ranged attack with a hostile creature beside the attacker is at
      // disadvantage; the board says whether one is.
      if (edge?.hostileBeside && !card.melee) sources.push("disadvantage");
      const advantage = mergeAdvantage(sources);
      const cover = edge?.cover ?? 0;
      const ac = base + cover;
      const odds = attackOdds({ attackBonus: card.toHit, ac, advantage });
      const mark = advantage === "none" ? "" : ` · ${advantage}`;
      rows.push({
        key: "To hit",
        value: edge?.blocked
          ? "no line to it (total cover)"
          : `${bonus} vs AC ${known === undefined ? "~" : ""}${ac} · ${asPercent(odds.hit)}${mark}`,
        tone: "plain",
      });
      if (cover && !edge?.blocked) {
        rows.push({ key: "Cover", value: `${cover === 2 ? "half" : "three-quarters"} +${cover} AC`, tone: "muted" });
      }
      if (edge?.flanking && card.melee) {
        rows.push({ key: "Flanking", value: "an ally opposite: advantage", tone: "muted" });
      }
    }
  } else if (card.roll) {
    rows.push({ key: "Roll", value: card.roll, tone: "muted" });
  }
  if (card.damageType) rows.push({ key: "Type", value: card.damageType, tone: "muted" });
  if (card.condition) rows.push({ key: "Applies", value: card.condition, tone: "applies" });
  rows.push({ key: "Cost", value: card.resource ? `${costLabel(card.cost)} · ${card.resource}` : costLabel(card.cost), tone: "cost" });
  return rows;
}

// ---- the sentence ----

function riderClause(rider: HandCard): string {
  if (rider.intent.card !== "rider") return "";
  if (rider.intent.rider === "Divine Smite") {
    const slot = rider.intent.slotLevel ? ` with a level ${rider.intent.slotLevel} slot` : "";
    return ` If it hits, I use Divine Smite${slot}.`;
  }
  return ` I use ${rider.intent.rider} on this attack.`;
}

// The prose the engine reads. Written the way the token HUD already writes
// it ("I attack Wight 1."), so the DM's tools see nothing new; names are left
// exactly as the sheet and the tracker spell them, because the engine matches
// on them.
const OPTION_CLAUSE: Record<HandAttackOptionId, string> = {
  reckless: " I attack recklessly.",
  stunningStrike: " If it hits, I use Stunning Strike.",
  nonlethal: " I strike to knock them out, not to kill.",
  useInspiration: " I spend my Inspiration on it.",
  strokeOfLuck: " If it misses, I use Stroke of Luck.",
  hurlThroughHell: " If it hits, I use Hurl Through Hell.",
  rapidStrike: " I trade its advantage for Rapid Strike.",
  "openHand:prone": " If it hits, Open Hand Technique knocks them prone.",
  "openHand:push": " If it hits, Open Hand Technique pushes them away.",
  "openHand:no reactions": " If it hits, Open Hand Technique takes their reactions.",
};

const BONUS_ATTACK_NAME: Record<string, string> = { frenzy: "Frenzy", "martial arts": "Martial Arts" };

export function composeSentence(
  card: HandCard,
  aim: HandAim | null,
  riders: HandCard[] = [],
  choices: HandChoices = {},
): string {
  const who = aim?.kind === "self" ? "myself" : aim?.name ?? "";
  const intent = card.intent;
  if (intent.card === "attack") {
    const how = intent.weapon === "Unarmed strike" ? "an unarmed strike" : `my ${intent.weapon}`;
    const bonusAttack = intent.attack?.bonusAttack;
    const lead = intent.offHand
      ? `I make my off-hand attack${who ? ` against ${who}` : ""} with ${how} as a bonus action.`
      : bonusAttack
        ? `I attack ${who || "the nearest enemy"} with ${how} as a bonus action (${BONUS_ATTACK_NAME[bonusAttack] ?? card.name.replace(/ attack$/, "")}).`
        : `I attack ${who || "the nearest enemy"} with ${how}.`;
    const options = (choices.options ?? []).map((id) => OPTION_CLAUSE[id]).join("");
    return lead + options + riders.map(riderClause).join("");
  }
  if (intent.card === "reaction") {
    const at = !who ? "" : aim?.kind === "enemy" ? ` at ${who}` : ` for ${who}`;
    return intent.spell
      ? `I cast ${intent.spell}${at} as a reaction${intent.slotLevel && intent.slotLevel > 1 ? ` using a level ${intent.slotLevel} slot` : ""}.`
      : `I use ${intent.feature}${at} as my reaction.`;
  }
  if (intent.card === "spell") {
    const where = !who ? "" : aim?.kind === "enemy" ? ` at ${who}` : ` on ${who}`;
    const slot = intent.slotLevel ? ` using a level ${intent.slotLevel} slot` : "";
    const how = card.cost === "bonus" ? " as a bonus action" : card.cost === "reaction" ? " as a reaction" : "";
    const picked = chosenLabel(card, choices);
    // The square the player picked on the board, in the engine's (x,y).
    const laid = card.area && hasPick(card.area, choices.area) ? ` ${describePick(card.area, choices.area ?? {})}` : "";
    return `I cast ${intent.spell}${picked ? ` (${picked})` : ""}${where}${laid}${how}${slot}.`;
  }
  if (intent.card === "feature") {
    const where = !who || aim?.kind === "self" ? "" : ` on ${who}`;
    const how = card.cost === "bonus" ? " as a bonus action" : "";
    // A pool is spent by amount; the blank is where the player says how much.
    const picked = chosenLabel(card, choices);
    const named = `${card.name}${picked ? ` (${picked})` : ""}`;
    return card.compose ? `I use ${named}${where} for  ${card.unit ?? "hit points"}.` : `I use ${named}${where}${how}.`;
  }
  if (intent.card === "rider") {
    return `I use ${intent.rider} on my next hit.`;
  }
  // The feature that routes it to the bonus action is the card's name
  // before the colon ("Cunning Action: Dash").
  const route = intent.bonus ? card.name.split(":")[0].trim() : "";
  const bonus = route ? ` as a bonus action (${route})` : "";
  switch (intent.action) {
    case "dodge":
      return `I take the Dodge action${bonus}.`;
    case "dash":
      return `I Dash${bonus}.`;
    case "disengage":
      return `I Disengage${bonus} and step away.`;
    case "help":
      return `I take the Help action for ${who || "my ally"}.`;
    case "hide":
      return `I Hide${bonus}.`;
    case "search":
      return "I take the Search action.";
    case "escape":
      // A spell's hold names its spell on the card ("Escape: Web").
      return card.name.startsWith("Escape: ") ? `I try to break free of ${card.name.slice("Escape: ".length)}.` : "I try to escape the grapple.";
    case "ready": {
      const trigger = choices.trigger?.trim().replace(/\.$/, "");
      const held = chosenValue(card, choices) || "an attack";
      return trigger ? `I ready ${held} for when ${trigger}.` : "I ready an action: ";
    }
    case "grapple":
      return `I try to grapple ${who || "the nearest enemy"}.`;
    case "shove":
      return `I shove ${who || "the nearest enemy"}.`;
    case "use-object":
      return `I use an object${bonus}: `;
    case "end-turn":
      return "I end my turn.";
    case "stand-up":
      return "I stand up.";
  }
}

// The optional structured half of the commit. The action route validates
// `content` and `kind` and drops what it does not know, so this costs an
// older server nothing and gives a newer one the card without parsing prose.
export type HandIntentBody = HandIntent & {
  targetId?: string;
  targetName?: string;
  targetKind?: HandAim["kind"];
  riders?: string[];
};

export function intentBody(
  card: HandCard,
  aim: HandAim | null,
  riders: HandCard[] = [],
  choices: HandChoices = {},
): HandIntentBody {
  const chosen = (choices.options ?? []).filter((id) =>
    card.options?.some((option) => option.id === id && !option.disabled),
  );
  // "openHand:push" is pc_attack's openHand "push"; the rest are flags.
  const args = Object.fromEntries(
    chosen.map((id) => {
      const [key, value] = id.split(":");
      return [key, value ?? true];
    }),
  );
  const attack =
    card.intent.card === "attack" && (chosen.length || card.intent.attack)
      ? { attack: { ...card.intent.attack, ...args } }
      : {};
  const trigger = card.asks === "trigger" && choices.trigger?.trim() ? { trigger: choices.trigger.trim() } : {};
  const value = chosenValue(card, choices);
  const pick =
    !value || !card.choice
      ? {}
      : card.choice.arg === "readySpell"
        ? { readySpell: value, ...(card.choice.levels?.[value] ? { readyLevel: card.choice.levels[value] } : {}) }
        : { [card.choice.arg]: value };
  const area = card.area && choices.area ? areaArgs(card.area, choices.area) : {};
  return {
    ...card.intent,
    ...attack,
    ...trigger,
    ...pick,
    ...area,
    ...(aim ? { targetId: aim.id, targetName: aim.name, targetKind: aim.kind } : {}),
    ...(riders.length ? { riders: riders.map((rider) => rider.name) } : {}),
  };
}

// A press on an option chip: a flag turns on or off; an option of a group
// (Open Hand's three riders) replaces the one chosen before it, and a second
// press takes it back.
export function toggleOption(
  options: HandAttackOption[],
  current: HandAttackOptionId[],
  id: HandAttackOptionId,
): HandAttackOptionId[] {
  if (current.includes(id)) return current.filter((entry) => entry !== id);
  const group = options.find((option) => option.id === id)?.group;
  const kept = group ? current.filter((entry) => options.find((option) => option.id === entry)?.group !== group) : current;
  return [...kept, id];
}

// ---- the turn as the engine will count it ----

// What playing this card would spend, in the engine's own marks. The Hand
// itself never keeps this (the engine's projection is the count); the tests
// use it to walk a turn card by card. `allowed` is the swings the Attack
// action grants (1 + Extra Attack).
export function afterCommit(turn: HandTurn, card: HandCard, allowed = 1): HandTurn {
  const intent = card.intent;
  const swing = intent.card === "attack" && !intent.offHand && !intent.attack?.bonusAttack;
  const contest = intent.card === "basic" && (intent.action === "grapple" || intent.action === "shove");
  // The engine's own spend functions do the counting (Extra Attack, Haste's
  // one weapon attack, Action Surge, Flurry of Blows).
  const budget = budgetOf(turn, { id: "hand" }, allowed);
  const result =
    swing || contest
      ? spendAttack(budget, "", { unarmed: intent.card === "attack" && intent.weapon === "Unarmed strike", hasteOk: !contest })
      : card.cost === "action" || card.cost === "bonus" || card.cost === "reaction"
        ? spendAction(budget, card.cost, card.name, "")
        : null;
  const spent = result && result.ok ? result.budget : budget;
  const next: HandTurn = {
    ...turn,
    actionUsed: spent.actionUsed,
    bonusUsed: spent.bonusUsed,
    reactionUsed: spent.reactionUsed,
    attacksMade: spent.attacksMade,
    extraActions: spent.extraActions,
    grantedActions: spent.grantedActions,
    flurryStrikes: spent.flurryStrikes,
    marks: spent.oncePerTurn,
  };
  // The cast guard's marks (cast-rules.ts turnCharge): a bonus-action spell,
  // or a levelled spell with the action, leaves room for a cantrip only.
  if (card.intent.card === "spell" && (card.cost === "action" || card.cost === "bonus")) {
    const mark = card.cost === "bonus" ? BONUS_SPELL : card.resource !== "Cantrip" ? LEVELLED_SPELL : null;
    if (mark && !(next.marks ?? []).includes(mark)) next.marks = [...(next.marks ?? []), mark];
  }
  // Action Surge grants a whole additional action (the engine's
  // grantedActions), not Haste's restricted one.
  if (card.intent.card === "feature" && card.intent.resourceId === "action_surge") {
    next.grantedActions = (turn.grantedActions ?? 0) + 1;
  }
  return next;
}

// ---- a target picked on the board ----

// The board's targeting mode already reaches the composer as a sentence
// ("I attack Wight 1.", "I cast  at Wight 1."). While a card is raised that
// sentence is read as the pick, so a tap on the map aims the card without the
// board knowing the Hand exists. Longest name first, so "Wight 12" is never
// taken for "Wight 1".
export function targetFromComposedText(text: string, names: string[]): string | null {
  const match = /^I (?:attack|cast\s+at)\s+(.+?)\.?\s*$/i.exec(text.trim());
  if (!match) return null;
  const said = match[1].trim().toLowerCase();
  const sorted = [...names].sort((a, b) => b.length - a.length);
  return sorted.find((name) => name.trim().toLowerCase() === said) ?? null;
}

// Window events a board can use to aim a raised card directly: the Hand
// announces the aim, and listens for a pick by tracker id or by name.
export const HAND_AIM_EVENT = "odm:hand-aim";
export const HAND_TARGET_EVENT = "odm:hand-target";
export type HandAimDetail = {
  active: boolean;
  cardId: string | null;
  target: HandCard["target"] | null;
  // An area spell's shape and the squares picked for it so far, so the board
  // can take the taps and draw the area (src/lib/battlemap/hand-area.ts).
  area?: HandArea | null;
  pick?: AreaPick;
};
export type HandTargetDetail = { id?: string; name?: string };
