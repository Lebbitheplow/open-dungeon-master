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

// What the engine needs to know beyond the card to resolve it itself:
// whether a fight is on (a card aimed at an enemy outside one is the model's,
// since a fight has to start first), and how the card's spell resolves when
// the content knows (SpellMech.resolution), which names the spell's tool.
export type DirectContext = {
  inFight: boolean;
  resolution?: SpellMech["resolution"] | null;
  // The spell fills an area (SpellMech.area): a Fireball aimed at one goblin
  // is the model's to place with aoe_damage over everyone in the burst, since
  // cast_at_enemy at the goblin rolls that one creature alone.
  area?: boolean;
  // An instant blast on a battle map, by what its caster picks
  // (src/lib/battlemap/area-shape.ts BlastPick): laid on its squares, it is
  // the engine's, which catches everyone standing in them (issue 570).
  // Absent with no board, and for a lasting area or none.
  blast?: "point" | "direction" | "none";
  // How one casting is shared out among creatures (SpellMech darts, attacks,
  // targets), so a card's shares become one call each (issue 570), and
  // whether its creatures must stand together (Acid Splash), which only
  // aoe_damage checks.
  shareKind?: "darts" | "attacks" | "targets";
  cluster?: boolean;
};

export type DirectCall = { name: string; args: Record<string, unknown> };

const atEnemy = (intent: MessageIntent): boolean => intent.targetKind === "enemy" && Boolean(intent.targetId);
const onAlly = (intent: MessageIntent): boolean => (intent.targetKind === "ally" || intent.targetKind === "self") && Boolean(intent.targetId);
const laysArea = (intent: MessageIntent): boolean => intent.atX !== undefined || intent.towardX !== undefined;

// The squares a card laid its area on, under the tools' own names.
function placement(intent: MessageIntent): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ["atX", "atY", "towardX", "towardY"] as const) {
    if (intent[key] !== undefined) out[key] = intent[key];
  }
  return out;
}

// Whether the card laid its blast where the engine can catch creatures: on
// a point for a burst, a way for a cone or a line, nothing for a burst
// around the caster.
function blastLaid(intent: MessageIntent, blast: DirectContext["blast"]): boolean {
  switch (blast) {
    case "none":
      return true;
    case "point":
      return intent.atX !== undefined && intent.atY !== undefined;
    case "direction":
      return intent.towardX !== undefined && intent.towardY !== undefined;
    default:
      return false;
  }
}

// The target arguments most tools read: an enemy under targetEnemyId, a
// character under targetCharacterId.
function targetArgs(intent: MessageIntent): Record<string, unknown> {
  if (atEnemy(intent)) {
    return { targetEnemyId: intent.targetId };
  }
  if (onAlly(intent)) {
    return { targetCharacterId: intent.targetId };
  }
  return {};
}

// The tool call a card stands for when every choice the engine needs is on
// the card (issue 570): a weapon attack at a named enemy (its class options
// ride under pc_attack's own names); a spell at one enemy, on one ally or on
// oneself whose tool the content names; a class feature; the basic actions;
// a reaction to a hit; a thing drawn, dropped, handed over or drunk. The turn
// runs it before the narrator is asked (src/lib/dm/turn.ts directCards), so
// the dice land at once and the first model call narrates from the result,
// and a human DM's own card resolves on the spot (the actions route).
//
// An instant blast laid on the battle map (Fireball on a square, Burning
// Hands toward one) goes to aoe_damage with its squares and nobody named:
// the engine catches everyone standing in them (aoe-shape.ts
// creaturesInBlast).
//
// Null leaves the card to the model: a rider card (the attack and its rider
// are one call the model composes), a target the card did not fix, a blast
// with no board or no square picked (aimed at one creature: the model names
// who stands in it), a lasting area laid on the board (a Web, which bites
// when its zone row says), a spell the content has no resolution for, a
// summon or a utility spell, Ready with no trigger, and anything aimed at an
// enemy when no fight is on, since the fight has to start first. A card the
// engine then refuses comes back as the tool's own refusal, which the model
// narrates.
export function directCardCall(intent: MessageIntent, characterId: string, context: DirectContext = { inFight: true }): DirectCall | null {
  const { inFight } = context;
  const level = intent.slotLevel ? { level: intent.slotLevel } : {};
  const variant = intent.variant ? { variant: intent.variant } : {};
  switch (intent.card) {
    case "attack":
      if (!inFight || !atEnemy(intent) || intent.riders?.length) {
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
    case "spell": {
      if (!intent.spell) {
        return null;
      }
      const spell = intent.spell;
      if (laysArea(intent) || context.area) {
        const blasts = context.resolution === "save" || context.resolution === "auto";
        return inFight && blasts && blastLaid(intent, context.blast)
          ? { name: "aoe_damage", args: { casterCharacterId: characterId, spell, ...level, ...placement(intent) } }
          : null;
      }
      switch (context.resolution) {
        case "attack":
          return inFight && atEnemy(intent) ? { name: "pc_attack", args: { characterId, targetEnemyId: intent.targetId, spell, ...level } } : null;
        case "save":
        case "auto":
          return inFight && atEnemy(intent)
            ? { name: "cast_at_enemy", args: { characterId, targetEnemyId: intent.targetId, spell, ...level, ...variant, ...(intent.condition ? { condition: intent.condition } : {}) } }
            : null;
        case "heal":
          // heal's characterId is the one healed; the caster is casterId.
          return onAlly(intent) ? { name: "heal", args: { characterId: intent.targetId, casterId: characterId, spell, ...level } } : null;
        case "buff":
          if (atEnemy(intent)) {
            return inFight ? { name: "cast_buff", args: { characterId, spell, targetEnemyId: intent.targetId, ...level, ...variant } } : null;
          }
          return onAlly(intent) ? { name: "cast_buff", args: { characterId, spell, targetCharacterIds: [intent.targetId], ...level, ...variant } } : null;
        default:
          return null;
      }
    }
    case "feature":
      // A feature spent by amount (Lay on Hands) is finished in the composer
      // and posts no card, so a card here carries every choice.
      return intent.resourceId ? { name: "use_resource", args: { characterId, resource: intent.resourceId, ...variant, ...targetArgs(intent) } } : null;
    case "basic": {
      const bonus = intent.bonus ? { bonus: true } : {};
      switch (intent.action) {
        case "dodge":
        case "dash":
        case "disengage":
        case "hide":
          return { name: "take_action", args: { characterId, action: intent.action, ...bonus } };
        case "search":
          return { name: "take_action", args: { characterId, action: "search", ...(intent.skill ? { skill: intent.skill } : {}), ...bonus } };
        case "help":
          return intent.targetId ? { name: "take_action", args: { characterId, action: "help", ...targetArgs(intent), ...bonus } } : null;
        case "grapple":
        case "shove":
          return inFight && atEnemy(intent) ? { name: "take_action", args: { characterId, action: intent.action, targetEnemyId: intent.targetId, ...bonus } } : null;
        case "escape":
          return inFight ? { name: "take_action", args: { characterId, action: "escape" } } : null;
        case "ready":
          if (!intent.trigger || (!intent.readyAction && !intent.readySpell)) {
            return null;
          }
          return {
            name: "take_action",
            args: {
              characterId,
              action: "ready",
              trigger: intent.trigger,
              ...(intent.readyAction ? { readied: intent.readyAction } : {}),
              ...(intent.readySpell ? { spell: intent.readySpell, ...(intent.readyLevel ? { level: intent.readyLevel } : {}) } : {}),
            },
          };
        case "stand-up":
          return { name: "clear_condition", args: { characterId, condition: "prone" } };
        case "stabilize":
          return intent.targetId ? { name: "stabilize", args: { characterId: intent.targetId, healerId: characterId } } : null;
        case "dismount":
          return { name: "dismount", args: { characterId } };
        case "end-turn":
          return inFight ? { name: "end_turn", args: { characterId } } : null;
        default:
          // Use an object is finished in the composer and posts no card.
          return null;
      }
    }
    case "reaction":
      return intent.feature
        ? { name: "use_reaction", args: { characterId, feature: intent.feature, ...(intent.spell ? { spell: intent.spell } : {}), ...level, ...targetArgs(intent) } }
        : null;
    case "gear": {
      if (!intent.item) {
        return null;
      }
      if (intent.action === "use") {
        return { name: "use_item", args: { characterId, item: intent.item, ...(onAlly(intent) && intent.targetKind === "ally" ? { targetCharacterId: intent.targetId } : {}) } };
      }
      if (intent.action === "hand") {
        return intent.targetId ? { name: "handle_item", args: { characterId, action: "hand", item: intent.item, toCharacterId: intent.targetId } } : null;
      }
      return { name: "handle_item", args: { characterId, action: intent.action ?? "equip", item: intent.item } };
    }
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

// A casting shared out, in the card line: "at Goblin 1 (enemyId=g1, 2) and
// Goblin 2 (enemyId=g2, 1)", the count being that creature's darts, rays or
// beams (one each for creatures a Bless or a Hold Person takes).
function sharedTargets(intent: MessageIntent): string {
  const key = intent.targetKind === "enemy" ? "enemyId" : "characterId";
  const named = (intent.shares ?? []).map((share) => `${share.name ?? share.id} (${key}=${share.id}, ${share.count})`);
  return ` ${intent.targetKind === "enemy" ? "at" : "on"} ${named.slice(0, -1).join(", ")} and ${named.at(-1)}, shared out as the counts say`;
}

function what(intent: MessageIntent): string {
  switch (intent.card) {
    case "attack":
      return `${intent.offHand ? "an off-hand attack" : "an attack"} with ${intent.weapon ?? "their weapon"}${target(intent)}${intent.riders?.length ? `, with ${intent.riders.join(" and ")}` : ""}`;
    case "rider":
      return `${intent.rider ?? "a rider"} on their next hit`;
    case "spell":
      return `${intent.spell ?? "a spell"}${intent.slotLevel ? ` from a level ${intent.slotLevel} slot` : ""}${intent.shares && intent.shares.length > 1 ? sharedTargets(intent) : target(intent)}`;
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

// The line the model reads under the player's words. For a card the engine
// resolved before the model was asked (turn.ts directCards), the line says
// so instead of asking for the call: the call and its result stand above in
// the conversation, and a model that called the tool again would cast the
// spell or swing the sword twice.
export function describeIntent(intent: MessageIntent, characterId: string | null, options: { resolved?: boolean } = {}): string {
  const tools = intentTools(intent);
  const who = characterId ? ` for characterId=${characterId}` : "";
  const card = `[Card played${who}: ${what(intent)}${describeHandExtras(intent)}.`;
  if (options.resolved) {
    return `${card} The engine has resolved it: its call and result are in this conversation. Narrate from that result and do not call the tool again.]`;
  }
  return `${card} Resolve it with ${tools.length > 1 ? `the spell's tool (${tools.join(", ")})` : tools[0]}.]`;
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

// The calls a card stands for (issue 570): a casting shared out among
// several creatures is one call per creature, the way the cast tools take
// it (the first call spends the slot, the rest draw on the same casting):
// cast_at_enemy for each creature Magic Missile's darts strike, with how
// many; pc_attack for every ray or beam; cast_at_enemy for each creature an
// upcast Hold Person takes, or one aoe_damage when they must stand together
// (Acid Splash); heal for each creature healed; one cast_buff for every ally
// a Bless takes. Anything else is directCardCall's one call. Null leaves the
// card to the model.
export function directCardCalls(intent: MessageIntent, characterId: string, context: DirectContext = { inFight: true }): DirectCall[] | null {
  const shares = intent.card === "spell" && intent.spell && context.shareKind ? intent.shares ?? [] : [];
  if (!shares.length) {
    const call = directCardCall(intent, characterId, context);
    return call ? [call] : null;
  }
  const first = directCardCall({ ...intent, targetId: shares[0].id, shares: undefined }, characterId, context);
  if (!first) {
    return null;
  }
  const spell = intent.spell as string;
  const level = intent.slotLevel ? { level: intent.slotLevel } : {};
  const enemies = intent.targetKind === "enemy";
  switch (first.name) {
    case "pc_attack":
      return enemies ? shares.flatMap((share) => Array.from({ length: share.count }, () => ({ name: "pc_attack", args: { characterId, targetEnemyId: share.id, spell, ...level } }))) : null;
    case "cast_at_enemy":
      if (!enemies) return null;
      if (context.cluster) {
        return [{ name: "aoe_damage", args: { casterCharacterId: characterId, spell, ...level, enemyIds: shares.map((share) => share.id) } }];
      }
      return shares.map((share) => ({
        name: "cast_at_enemy",
        args: { ...first.args, targetEnemyId: share.id, ...(context.shareKind === "darts" ? { darts: share.count } : {}) },
      }));
    case "heal":
      return shares.map((share) => ({ name: "heal", args: { ...first.args, characterId: share.id } }));
    case "cast_buff":
      return enemies ? null : [{ name: "cast_buff", args: { ...first.args, targetCharacterIds: shares.map((share) => share.id) } }];
    default:
      return [first];
  }
}

// The id prefix of the tool call the turn makes for a card the engine
// resolves itself, before any model call (src/lib/dm/turn.ts cardReply). A
// scorer reading a stored turn tells the engine's call from the model's by it.
export const DIRECT_CALL_ID_PREFIX = "card_";

// The words the corrective message carries, so a reader of a stored turn
// (src/lib/dm/card-score-logic.ts) can tell the calls made after it.
export const INTENT_CORRECTION_MARK = "and nothing resolved it";

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

// How a call fell short of a card: not one of the card's tools; a slot spent
// for a spell the engine rolls; sent back for a retry; made for another
// character, at another target, or with another spell.
export type CallMismatch = "tool" | "slot" | "retry" | "actor" | "target" | "spell";

// Whether this call carried out this card, and if not, why: one of the
// card's tools, for the card's character, at the card's target, casting the
// card's spell, and not sent back to be called again. A rules refusal does
// count: the engine answered, and the refusal is what the narration tells.
// An argument the call left out is not held against it; one that names
// someone or something else is. Null means the call resolved the card.
export function callMismatch(card: PlayedCard, call: TurnCall): CallMismatch | null {
  const { intent } = card;
  if (!intentTools(intent).includes(call.name)) {
    return "tool";
  }
  if (call.name === "use_spell_slot" && slotFallsShort(card)) {
    return "slot";
  }
  if (call.result?.retry === true) {
    return "retry";
  }
  const actor = actorRef(call);
  if (card.characterId && typeof actor === "string" && !refMatches(actor, card.characterId, card.name)) {
    return "actor";
  }
  if (intent.targetId && (intent.targetKind === "enemy" || intent.targetKind === "ally")) {
    const aimed = refsOf(call.args, intent.targetKind === "enemy" ? ENEMY_KEYS : call.name === "heal" ? ["characterId"] : ALLY_KEYS);
    // A casting shared out may land on any of its creatures.
    const named = [{ id: intent.targetId, name: intent.targetName }, ...(intent.shares ?? []).map((share) => ({ id: share.id, name: share.name }))];
    if (aimed.length && !aimed.some((ref) => named.some((entry) => refMatches(ref, entry.id, entry.name)))) {
      return "target";
    }
  }
  // use_reaction's spell is the one it counters, not the card's own.
  const spell = call.args.spell;
  if (intent.spell && call.name !== "use_reaction" && typeof spell === "string" && textKey(spell) !== textKey(intent.spell)) {
    return "spell";
  }
  return null;
}

// Whether any call this turn carried out the card. Matching the tool's name
// was not enough: a use_spell_slot passed for a Fireball, and so did an
// attack by another character, at another enemy, or one the tool sent back.
export function intentAnswered(card: PlayedCard, calls: Iterable<TurnCall>): boolean {
  for (const call of calls) {
    if (callMismatch(card, call) === null) {
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
  return `[System] ${name} played ${what(intent)} from their hand, ${INTENT_CORRECTION_MARK}: no ${tools.length > 1 ? "spell tool" : tools[0]} call this turn carried it out (a call for another character, another target or another spell, or one that came back asking for a retry, does not count), so it has not happened.${slotOnly ? " Spending the slot with use_spell_slot does not cast it: the engine rolls it." : ""} Call ${tools.length > 1 ? "the spell's tool" : tools[0]} now${args.length ? ` with ${args.join(", ")}` : ""}. If the rules forbid it the tool refuses, and that refusal is what you narrate. Then narrate from the result only.`;
}
