// Which of the DM's actions a call is offered, and how much of each one's
// description rides (docs/agent-context-efficiency-audit-2026-10-17.md F02).
//
// The full set is ~22K tokens out of a fight and ~27K in one: more than a
// 16K window holds before a word of rules, and most of a 32K one. The
// compact profile offers a core that covers ordinary play (rolls, movement,
// social checks, the sheet's everyday changes; in a fight the combat tools),
// opens the groups the table's state or the players' words call for (a shop
// at hand, a horse, a structured scene), and keeps every other action one
// call away: more_tools names the groups, and opening one offers its tools
// from the next reply on. Each offered tool keeps its name, its parameters
// and their kinds, with descriptions cut to their first sentence; more_tools
// returns any tool's full description on request. Nothing is taken off the
// table: a tool from a group never opened still runs when called by name,
// and the server checks every call as it always has.
//
// The full profile is unchanged and stays the profile for any window that
// holds it (src/lib/dm/model-tuning-logic.ts decides).
//
// Pure, so scripts/test-tool-profiles.mjs can drive it.

export type ToolProfile = "full" | "lean" | "compact";

export type ToolDefLike = {
  type?: string;
  function: { name: string; description?: string; parameters?: unknown };
};

// Offered in every compact call.
const CORE_ALWAYS = [
  "request_roll",
  "request_player_input",
  "record_event",
  "send_whisper",
  "recall_story",
  "search_lore",
  "read_card",
  "write_campaign_note",
  "complete_beat",
  "run_prepared_encounter",
  "heal",
  "use_resource",
  "use_item",
  "set_condition",
  "clear_condition",
  "set_npc",
  "check_notice",
  "group_check",
];

// Out of a fight: moving, meeting people, the purse and the pack.
const CORE_EXPLORE = [
  "move_party",
  "update_location",
  "start_encounter",
  "npc_reaction",
  "social_check",
  "grant_item",
  "remove_item",
  "modify_gold",
  "purchase",
  "award_xp",
  "take_rest",
];

// In a fight: every action a round needs.
const CORE_COMBAT = [
  "pc_attack",
  "enemy_attack",
  "cast_at_enemy",
  "cast_at_player",
  "aoe_damage",
  "take_action",
  "use_reaction",
  "end_turn",
  "move_token",
  "end_encounter",
  "add_enemies",
  "enemy_flees",
  "set_enemy_condition",
  "clear_enemy_condition",
  "damage_enemy",
  "apply_damage",
  "stabilize",
];

export type ToolGroupId =
  | "spells"
  | "outside"
  | "companions"
  | "sheet"
  | "tactics"
  | "legendary"
  | "hazards"
  | "world"
  | "explore"
  | "binder"
  | "factions"
  | "shop"
  | "settlement"
  | "party"
  | "effects"
  | "scenes"
  | "sound"
  | "mounts"
  | "pets"
  | "relationships"
  | "picture";

export const TOOL_GROUPS: Record<ToolGroupId, { summary: string; tools: readonly string[] }> = {
  // Opened by itself when anyone at the table casts (ProfileSignals.caster).
  spells: { summary: "a character's spells: buffs and summons, a saving-throw spell at one enemy, a slot spent on a utility spell", tools: ["cast_buff", "cast_at_enemy", "use_spell_slot"] },
  // The exploring core, closed in a fight and one call away there.
  outside: { summary: "moving the party, items and gold, XP, social checks, a rest (the out-of-fight actions)", tools: CORE_EXPLORE },
  companions: { summary: "adding or dismissing an AI companion", tools: ["add_companion", "dismiss_companion"] },
  sheet: {
    summary: "lasting sheet changes: damage outside a fight, stabilizing, XP for the party, revealing an item, learning a spell, a story change to who a character is",
    tools: ["apply_damage", "stabilize", "party_award", "reveal_item", "learn_spell", "update_sheet"],
  },
  tactics: {
    summary: "fight extras: damage split among targets, teleports, flying or climbing, telegraphing an enemy's intent",
    tools: ["split_damage", "teleport_token", "set_movement", "declare_intent"],
  },
  legendary: { summary: "legendary actions, legendary resistance and lair actions", tools: ["legendary_action", "legendary_resist", "lair_action"] },
  hazards: { summary: "falls, traps, drowning, suffocation, extreme heat and cold", tools: ["apply_hazard"] },
  world: {
    summary: "treasure hoards, overland travel, passing time, weather, breaking objects, a title card",
    tools: ["roll_treasure", "damage_object", "travel", "pass_time", "set_weather", "show_title"],
  },
  explore: { summary: "downtime, lifestyles, lifting and dragging, diseases, madness and poisons", tools: ["lift", "set_lifestyle", "downtime", "afflict"] },
  binder: { summary: "handouts and the quest log", tools: ["show_handout", "dismiss_handout", "set_quest", "tick_objective"] },
  factions: { summary: "faction standing and notes", tools: ["adjust_reputation", "faction_note"] },
  shop: { summary: "opening a shop, buying, selling, haggling", tools: ["open_shop", "buy_item", "sell_item", "haggle"] },
  settlement: { summary: "inventing a settlement", tools: ["generate_settlement"] },
  party: { summary: "the party's shared pack and purse", tools: ["party_stash"] },
  effects: { summary: "lasting effects that are not conditions (a blessing, a curse, a boon)", tools: ["set_effect", "clear_effect"] },
  scenes: { summary: "structured scenes: chases, heists, skill challenges", tools: ["start_scene", "scene_check", "end_scene"] },
  sound: { summary: "the table's music and sound stings", tools: ["set_ambience", "play_sting"] },
  mounts: { summary: "mounting and dismounting", tools: ["mount_up", "dismount"] },
  pets: { summary: "familiars, pets and animal companions", tools: ["summon_pet", "pet_attack", "damage_pet", "dismiss_pet"] },
  relationships: { summary: "bonds, romance and their endings", tools: ["relationship_beat", "romance_advance", "relationship_end"] },
  picture: { summary: "a picture of the scene", tools: ["generate_image"] },
};

export const MORE_TOOLS = "more_tools";

// The least a compact call offers beside a group it has just opened, when the
// window holds no more: the model asked for that group to use it now.
export const ESSENTIAL_TOOLS = ["request_roll", "request_player_input", "record_event", "send_whisper"];
// And in a fight, the actions no round runs without.
export const ESSENTIAL_COMBAT_TOOLS = ["pc_attack", "enemy_attack", "end_turn"];
// What a fight's call can spare when its window is tight, before it falls to
// the essentials: lookups and notes, noticing and group checks, a new NPC, a
// prepared fight. Each still runs when called by name.
export const COMBAT_SPARE_TOOLS = [
  "recall_story",
  "search_lore",
  "read_card",
  "write_campaign_note",
  "run_prepared_encounter",
  "set_npc",
  "check_notice",
  "group_check",
];

const GROUP_IDS = Object.keys(TOOL_GROUPS) as ToolGroupId[];
const GROUPED = new Map<string, ToolGroupId>(GROUP_IDS.flatMap((id) => TOOL_GROUPS[id].tools.map((name) => [name, id] as const)));

export function groupOfTool(name: string): ToolGroupId | null {
  return GROUPED.get(name) ?? null;
}

export function isToolGroup(value: string): value is ToolGroupId {
  return (GROUP_IDS as string[]).includes(value);
}

// What the table holds and the players just said, for the groups a compact
// call opens without being asked.
export type ProfileSignals = {
  inEncounter: boolean;
  // A shop is open where the party stands.
  shopOpen?: boolean;
  mounts?: boolean;
  pets?: boolean;
  scene?: boolean;
  quests?: boolean;
  // An enemy in the fight has legendary or lair actions.
  legendary?: boolean;
  // Someone at the table casts spells.
  caster?: boolean;
  // The newest player lines, and the tool a card played from the Hand names.
  playerText?: string;
  cardTool?: string | null;
};

// Words in the players' newest lines that call for a group. Deliberately
// plain: a miss costs one more_tools call, a false hit a few hundred tokens.
// English words only, an extra: at a table in another language every group
// these would open is that one more_tools call away.
const INTENT: Array<[ToolGroupId, RegExp]> = [
  ["shop", /\b(buy|buying|sell|selling|shop|shops|merchant|wares|haggle|barter|price|prices)\b/i],
  ["world", /\b(travel|journey|road|ride (?:to|north|south|east|west)|march|days? (?:later|pass)|wait (?:until|for)|treasure|hoard|loot|break (?:down|open|the)|smash|weather)\b/i],
  ["explore", /\b(craft|crafting|downtime|research|train(?:ing)?|lifestyle|carouse|lift|drag|push|haul|disease|poison(?:ed)?|madness)\b/i],
  ["hazards", /\b(trap|traps|fall|falls|jump|leap|climb|drown|swim|lava|fire|burning|freezing|suffocat\w*)\b/i],
  ["mounts", /\b(horse|horses|mount|mounts|saddle|steed|pony)\b/i],
  ["relationships", /\b(romance|kiss|flirt|court|befriend|friendship)\b/i],
  ["pets", /\b(familiar|pet|animal companion)\b/i],
  ["binder", /\b(quest|quests|handout|map of|letter|journal)\b/i],
  ["factions", /\b(faction|guild|reputation)\b/i],
  ["effects", /\b(curse|cursed|blessing|boon)\b/i],
  ["scenes", /\b(chase|heist|infiltrat\w*)\b/i],
  ["sheet", /\b(learn (?:the )?spell|copy (?:the )?spell|level up|rename)\b/i],
];

export function autoGroups(signals: ProfileSignals): Set<ToolGroupId> {
  const groups = new Set<ToolGroupId>();
  if (signals.shopOpen) groups.add("shop");
  if (signals.mounts) groups.add("mounts");
  if (signals.pets) groups.add("pets");
  if (signals.scene) groups.add("scenes");
  if (signals.quests) groups.add("binder");
  if (signals.inEncounter && signals.legendary) groups.add("legendary");
  if (signals.caster) groups.add("spells");
  const text = signals.playerText ?? "";
  for (const [group, pattern] of INTENT) {
    if (pattern.test(text)) groups.add(group);
  }
  const carded = signals.cardTool ? groupOfTool(signals.cardTool) : null;
  if (carded) groups.add(carded);
  return groups;
}

// The names a compact call offers, out of the full set it would offer.
export function compactToolNames(
  fullNames: readonly string[],
  signals: ProfileSignals,
  opened: Iterable<ToolGroupId>,
): Set<string> {
  const groups = new Set<ToolGroupId>([...autoGroups(signals), ...opened]);
  const core = new Set([...CORE_ALWAYS, ...(signals.inEncounter ? CORE_COMBAT : CORE_EXPLORE)]);
  // Out of a fight the exploring core is the core, not a group to open.
  if (!signals.inEncounter) groups.add("outside");
  const offered = new Set<string>();
  for (const name of fullNames) {
    const group = groupOfTool(name);
    // A tool no group names is core: a new tool is never hidden by omission.
    if (core.has(name) || (group ? groups.has(group) : true)) {
      offered.add(name);
    }
  }
  return offered;
}

// The groups the call does not already offer, for more_tools to name.
export function closedGroups(fullNames: readonly string[], offered: ReadonlySet<string>): ToolGroupId[] {
  return GROUP_IDS.filter((id) => TOOL_GROUPS[id].tools.some((name) => fullNames.includes(name) && !offered.has(name)));
}

export function moreToolsTool(closed: readonly ToolGroupId[]): ToolDefLike {
  return {
    type: "function",
    function: {
      name: MORE_TOOLS,
      description: `More actions than the ones listed here. Name a group and its actions are offered from your next reply on; call it before narrating anything that needs them. Groups: ${closed.map((id) => `${id} (${TOOL_GROUPS[id].summary})`).join("; ")}. Name a tool instead to read its full instructions.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          group: { type: "string", enum: [...closed], description: "The group whose actions you need." },
          tool: { type: "string", description: "An action's name, to read its full instructions." },
        },
      },
    },
  };
}

function firstSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(?=\s|$)/.exec(clean);
  const sentence = match ? match[1] : clean;
  return sentence.length > max ? `${sentence.slice(0, max).replace(/\s+\S*$/, "")}...` : sentence;
}

function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactSchema);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, field]) => [
      key,
      key === "description" && typeof field === "string" ? firstSentence(field, 100) : compactSchema(field),
    ]),
  );
}

// A tool with its descriptions cut to their first sentence; names, kinds,
// enums and what is required are untouched.
export function compactTool<T extends ToolDefLike>(tool: T): T {
  return {
    ...tool,
    function: {
      ...tool.function,
      ...(tool.function.description ? { description: firstSentence(tool.function.description, 200) } : {}),
      ...(tool.function.parameters ? { parameters: compactSchema(tool.function.parameters) } : {}),
    },
  };
}

// The whole of one tool's instructions, as more_tools returns them.
export function toolHelp(tool: ToolDefLike): Record<string, unknown> {
  const parameters = tool.function.parameters as { properties?: Record<string, { description?: string }> } | undefined;
  return {
    tool: tool.function.name,
    instructions: tool.function.description ?? "",
    parameters: Object.fromEntries(
      Object.entries(parameters?.properties ?? {}).map(([name, schema]) => [name, schema?.description ?? ""]),
    ),
  };
}

// What a more_tools call asked for.
export function readMoreToolsCall(rawArguments: string): { group: ToolGroupId | null; tool: string | null } {
  let args: { group?: unknown; tool?: unknown } = {};
  try {
    args = JSON.parse(rawArguments || "{}") as typeof args;
  } catch {
    // An unreadable call asks for nothing; the result says what it can ask.
  }
  const group = typeof args.group === "string" && isToolGroup(args.group.trim().toLowerCase()) ? (args.group.trim().toLowerCase() as ToolGroupId) : null;
  const tool = typeof args.tool === "string" && args.tool.trim() ? args.tool.trim() : null;
  return { group, tool };
}
