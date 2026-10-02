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
// cast with no tool call gets one corrective call (src/lib/dm/turn.ts).
//
// Pure: the schema, the prompt line and the correction are testable without
// a database.
import { z } from "zod";
import { HAND_INTENT_ACTIONS, describeHandExtras, handExtraArgs, handIntentExtras } from "@/lib/battlemap/hand-intent";

const text = (max: number) => z.string().trim().min(1).max(max);

export const messageIntentSchema = z.object({
  ...handIntentExtras,
  card: z.enum(["attack", "rider", "spell", "feature", "basic", "reaction"]),
  weapon: text(80).optional(),
  offHand: z.boolean().optional(),
  rider: text(80).optional(),
  spell: text(80).optional(),
  slotLevel: z.number().int().min(0).max(9).nullable().optional(),
  resourceId: text(80).optional(),
  action: z
    .enum(["dodge", "dash", "disengage", "help", "hide", "ready", "grapple", "shove", "use-object", "end-turn", ...HAND_INTENT_ACTIONS])
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
      return intent.action === "end-turn" ? ["end_turn"] : intent.action === "stand-up" ? ["clear_condition"] : ["take_action"];
    case "reaction":
      return ["use_reaction"];
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
      return `the ${intent.action ?? "basic"} action${target(intent)}`;
    case "reaction":
      return `the reaction ${intent.feature ?? intent.spell ?? ""}${target(intent)}`;
  }
}

// The line the model reads under the player's words.
export function describeIntent(intent: MessageIntent, characterId: string | null): string {
  const tools = intentTools(intent);
  const who = characterId ? ` for characterId=${characterId}` : "";
  return `[Card played${who}: ${what(intent)}${describeHandExtras(intent)}. Resolve it with ${tools.length > 1 ? `the spell's tool (${tools.join(", ")})` : tools[0]}.]`;
}

// Whether any call this turn resolved the card.
export function intentAnswered(intent: MessageIntent, calledTools: Iterable<string>): boolean {
  const wanted = new Set(intentTools(intent));
  for (const name of calledTools) {
    if (wanted.has(name)) {
      return true;
    }
  }
  return false;
}

// The corrective message for a card whose attack or cast got no tool call.
export function intentCorrection(intent: MessageIntent, characterId: string | null, name: string): string {
  const tools = intentTools(intent);
  const args = [
    characterId ? `characterId=${characterId}` : "",
    intent.targetKind === "enemy" && intent.targetId ? `targetEnemyId=${intent.targetId}` : "",
    intent.weapon ? `weapon=${intent.weapon}` : "",
    intent.spell ? `spell=${intent.spell}` : "",
    intent.slotLevel ? `level=${intent.slotLevel}` : "",
    ...handExtraArgs(intent),
  ].filter(Boolean);
  return `[System] ${name} played ${what(intent)} from their hand, and nothing resolved it: no ${tools.length > 1 ? "spell tool" : tools[0]} call was made this turn, so it has not happened. Call ${tools.length > 1 ? "the spell's tool" : tools[0]} now${args.length ? ` with ${args.join(", ")}` : ""}. If the rules forbid it the tool refuses, and that refusal is what you narrate. Then narrate from the result only.`;
}
