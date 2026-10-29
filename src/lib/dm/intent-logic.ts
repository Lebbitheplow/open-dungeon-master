// The structured half of a player's action: the card they played from their
// hand (src/lib/battlemap/hand-play.ts intentBody), carried beside the
// sentence it composed.
//
// The sentence alone left the whole action to the model: a card resolved only
// if the model called the right tool with the right ids, and nothing checked
// that it did. Kept on the message, the card does three things. The actions
// route asks the engine up front whether it may be played at all
// (src/lib/dm/intent-check.ts), the prompt shows it to the model as a
// structured line naming the tool, and a turn that answered an attack or a
// cast with no call that carried it out gets one corrective call
// (src/lib/dm/turn.ts).
//
// Pure: the schema, the prompt line and the correction are testable without
// a database.
import { z } from "zod";
import { HAND_GEAR_ACTIONS, HAND_INTENT_ACTIONS, describeHandExtras, handExtraArgs, handIntentExtras } from "@/lib/battlemap/hand-intent";
import { textKey } from "@/lib/language/text-logic";
import type { SpellMech } from "@/lib/srd/spell-mech-types";

const text = (max: number) => z.string().trim().min(1).max(max);

export const messageIntentSchema = z.object({
  ...handIntentExtras,
  card: z.enum(["attack", "rider", "spell", "feature", "basic", "reaction", "gear"]),
  weapon: text(80).optional(),
  offHand: z.boolean().optional(),
  rider: text(80).optional(),
  spell: text(80).optional(),
  slotLevel: z.number().int().min(0).max(9).nullable().optional(),
  resourceId: text(80).optional(),
  action: z
    .enum(["dodge", "dash", "disengage", "help", "hide", "ready", "grapple", "shove", "use-object", "end-turn", ...HAND_INTENT_ACTIONS, ...HAND_GEAR_ACTIONS])
    .optional(),
  targetId: text(120).optional(),
  targetName: text(120).optional(),
  targetKind: z.enum(["enemy", "ally", "self"]).optional(),
  riders: z.array(text(80)).max(6).optional(),
});

export type MessageIntent = z.infer<typeof messageIntentSchema>;

// Reads a stored or posted intent; anything malformed is no intent at all,
// so an older client or a damaged row costs the turn nothing.
export function parseMessageIntent(raw: unknown): MessageIntent | null {
  const parsed = messageIntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const SPELL_TOOLS = [
  "cast_at_enemy",
  "cast_buff",
  "aoe_damage",
  "pc_attack",
  "heal",
  "use_spell_slot",
  "use_reaction",
];

// The tools that resolve a card. Empty for a card with nothing to resolve.
export function intentTools(intent: MessageIntent): string[] {
  switch (intent.card) {
    case "attack":
    case "rider":
      return ["pc_attack"];
    case "spell":
      return SPELL_TOOLS;
    case "feature":
      return ["use_resource"];
    case "basic":
      return intent.action === "end-turn"
        ? ["end_turn"]
        : intent.action === "stand-up"
          ? ["clear_condition"]
          : intent.action === "stabilize"
            ? ["stabilize"]
            : intent.action === "dismount"
              ? ["dismount"]
              : ["take_action"];
    case "reaction":
      return ["use_reaction"];
    case "gear":
      return intent.action === "use" ? ["use_item"] : ["handle_item"];
  }
}

// The tool call a card stands for when every choice the engine needs is on
// the card: a weapon attack at a named enemy (its class options ride under
// pc_attack's own names), or Dodge, Dash or Disengage. The turn runs it
// before the narrator is asked (src/lib/dm/turn.ts directCard), so the
// dice land at once and the first model call narrates from the result.
// Null leaves the card to the model: a spell (slot, area and concentration
// choices), a rider card (the attack and its rider are one call the model
// composes), a target the card did not fix, or any other card.
export function directCardCall(intent: MessageIntent, characterId: string): { name: string; args: Record<string, unknown> } | null {
  switch (intent.card) {
    case "attack":
      if (intent.targetKind !== "enemy" || !intent.targetId || intent.riders?.length) {
        return null;
      }
      return {
        name: "pc_attack",
        args: {
          characterId,
          targetEnemyId: intent.targetId,
          ...(intent.weapon ? { weapon: intent.weapon } : {}),
          ...(intent.offHand ? { offHand: true } : {}),
          ...(intent.attack ?? {}),
        },
      };
    case "basic":
      if (intent.action === "dodge" || intent.action === "dash" || intent.action === "disengage") {
        return { name: "take_action", args: { characterId, action: intent.action, ...(intent.bonus ? { bonus: true } : {}) } };
      }
      return null;
    default:
      return null;
  }
}

// Only a card that resolves an attack or a cast is chased with a
// corrective call: those are the ones whose outcome a model most often
// narrates instead of rolling.
export function intentNeedsTool(intent: MessageIntent): boolean {
  return intent.card === "attack" || intent.card === "spell" || intent.card === "reaction";
}

function target(intent: MessageIntent): string {
  if (!intent.targetName && !intent.targetId) {
    return "";
  }
  if (intent.targetKind === "self") {
    return " on themselves";
  }
  const id = intent.targetId
    ? intent.targetKind === "enemy"
      ? ` (enemyId=${intent.targetId})`
      : ` (characterId=${intent.targetId})`
    : "";
  return ` ${intent.targetKind === "enemy" ? "at" : "on"} ${intent.targetName ?? "the target"}${id}`;
}

function what(intent: MessageIntent): string {
  switch (intent.card) {
    case "attack":
      return `${intent.offHand ? "an off-hand attack" : "an attack"} with ${intent.weapon ?? "their weapon"}${target(intent)}${intent.riders?.length ? `, with ${intent.riders.join(" and ")}` : ""}`;
    case "rider":
      return `${intent.rider ?? "a rider"} on their next hit`;
    case "spell":
      return `${intent.spell ?? "a spell"}${intent.slotLevel ? ` from a level ${intent.slotLevel} slot` : ""}${target(intent)}`;
    case "feature":
      return `the feature ${intent.resourceId ?? ""}${target(intent)}`.trim();
    case "basic":
      if (intent.action === "stabilize") {
        return `stabilizing ${intent.targetName ?? "a dying ally"}${intent.targetId ? ` (stabilize characterId=${intent.targetId}, the actor as healerId)` : ""}`;
      }
      return `the ${intent.action ?? "basic"} action${target(intent)}`;
    case "reaction":
      return `the reaction ${intent.feature ?? intent.spell ?? ""}${target(intent)}`;
    case "gear": {
      const item = intent.item ?? "an item";
      switch (intent.action) {
        case "hand":
          return `handing ${item} to ${intent.targetName ?? "an ally"}${intent.targetId ? ` (handle_item action=hand, toCharacterId=${intent.targetId})` : ""}`;
        case "use":
          return `using ${item}${target(intent)}`;
        default:
          return `handle_item action=${intent.action ?? "equip"} on ${item}`;
      }
    }
  }
}

// The line the model reads under the player's words.
export function describeIntent(intent: MessageIntent, characterId: string | null): string {
  const tools = intentTools(intent);
  const who = characterId ? ` for characterId=${characterId}` : "";
  return `[Card played${who}: ${what(intent)}${describeHandExtras(intent)}. Resolve it with ${tools.length > 1 ? `the spell's tool (${tools.join(", ")})` : tools[0]}.]`;
}

// The card a turn answers, with how its spell resolves when the content
// knows (SpellMech.resolution), so the check knows which tools can cast it.
export type PlayedCard = {
  intent: MessageIntent;
  characterId: string | null;
  name: string;
  resolution?: SpellMech["resolution"] | null;
};

// One call the turn made: its name, the arguments it was sent, and the
// engine's answer. The answer is null while the call waits on the table's
// dice, and for a call in the reply being read, which has not run yet.
export type TurnCall = { name: string; args: Record<string, unknown>; result: Record<string, unknown> | null };

// The spells a slot spent with use_spell_slot does not cast: the engine
// rolls their attack, their save or their healing (src/lib/dm/cast-redirect.ts).
// A buff or a summon the engine cannot apply is sent to use_spell_slot by
// cast_buff itself, and a utility spell has nothing else to call.
const ROLLED_SPELLS: ReadonlySet<SpellMech["resolution"]> = new Set(["attack", "save", "auto", "heal"]);

function slotFallsShort(card: PlayedCard): boolean {
  return card.intent.card === "spell" && Boolean(card.resolution && ROLLED_SPELLS.has(card.resolution));
}

function cardTools(card: PlayedCard): Set<string> {
  const tools = intentTools(card.intent);
  return new Set(slotFallsShort(card) ? tools.filter((tool) => tool !== "use_spell_slot") : tools);
}

// The tools take a creature by its id or by the name the table sees
// (resolveEnemyRef, resolveSheetRef), so a ref matches either.
function refMatches(ref: string, id: string | null | undefined, name: string | null | undefined): boolean {
  return ref.trim() === id || Boolean(name && textKey(ref) === textKey(name));
}

function refsOf(args: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = args[key];
    return typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  });
}

// Who acts in a call: most tools name them characterId, but heal's
// characterId is the one healed (casterId casts), and aoe_damage names a
// player's casting casterCharacterId.
function actorRef(call: TurnCall): unknown {
  return call.name === "heal" ? call.args.casterId : call.name === "aoe_damage" ? call.args.casterCharacterId : call.args.characterId;
}

const ENEMY_KEYS = ["targetEnemyId", "secondTargetEnemyId", "enemyIds"];
const ALLY_KEYS = ["targetCharacterId", "targetCharacterIds", "characterIds"];

// Whether this call carried out this card: one of the card's tools, for the
// card's character, at the card's target, casting the card's spell, and not
// sent back to be called again. A rules refusal does count: the engine
// answered, and the refusal is what the narration tells. An argument the
// call left out is not held against it; one that names someone or something
// else is.
function callResolves(card: PlayedCard, call: TurnCall, wanted: ReadonlySet<string>): boolean {
  const { intent } = card;
  if (!wanted.has(call.name) || call.result?.retry === true) {
    return false;
  }
  const actor = actorRef(call);
  if (card.characterId && typeof actor === "string" && !refMatches(actor, card.characterId, card.name)) {
    return false;
  }
  if (intent.targetId && (intent.targetKind === "enemy" || intent.targetKind === "ally")) {
    const aimed = refsOf(call.args, intent.targetKind === "enemy" ? ENEMY_KEYS : call.name === "heal" ? ["characterId"] : ALLY_KEYS);
    if (aimed.length && !aimed.some((ref) => refMatches(ref, intent.targetId, intent.targetName))) {
      return false;
    }
  }
  // use_reaction's spell is the one it counters, not the card's own.
  const spell = call.args.spell;
  if (intent.spell && call.name !== "use_reaction" && typeof spell === "string" && textKey(spell) !== textKey(intent.spell)) {
    return false;
  }
  return true;
}

// Whether any call this turn carried out the card. Matching the tool's name
// was not enough: a use_spell_slot passed for a Fireball, and so did an
// attack by another character, at another enemy, or one the tool sent back.
export function intentAnswered(card: PlayedCard, calls: Iterable<TurnCall>): boolean {
  const wanted = cardTools(card);
  for (const call of calls) {
    if (callResolves(card, call, wanted)) {
      return true;
    }
  }
  return false;
}

// The corrective message for a card whose attack or cast no call carried out.
export function intentCorrection(
  intent: MessageIntent,
  characterId: string | null,
  name: string,
  resolution?: SpellMech["resolution"] | null,
): string {
  const tools = intentTools(intent);
  const slotOnly = slotFallsShort({ intent, characterId, name, resolution });
  const args = [
    characterId ? `characterId=${characterId}` : "",
    intent.targetKind === "enemy" && intent.targetId ? `targetEnemyId=${intent.targetId}` : "",
    intent.weapon ? `weapon=${intent.weapon}` : "",
    intent.spell ? `spell=${intent.spell}` : "",
    intent.slotLevel ? `level=${intent.slotLevel}` : "",
    ...handExtraArgs(intent),
  ].filter(Boolean);
  return `[System] ${name} played ${what(intent)} from their hand, and nothing resolved it: no ${tools.length > 1 ? "spell tool" : tools[0]} call this turn carried it out (a call for another character, another target or another spell, or one that came back asking for a retry, does not count), so it has not happened.${slotOnly ? " Spending the slot with use_spell_slot does not cast it: the engine rolls it." : ""} Call ${tools.length > 1 ? "the spell's tool" : tools[0]} now${args.length ? ` with ${args.join(", ")}` : ""}. If the rules forbid it the tool refuses, and that refusal is what you narrate. Then narrate from the result only.`;
}
