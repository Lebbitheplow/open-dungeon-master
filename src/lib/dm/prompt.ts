import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { LEAD_NOTE_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import { computeSheetDerived, findSkill, formatModifier, SRD_SKILLS } from "@/lib/srd";
import { genrePreset } from "@/lib/genres";
import { renderArcForPrompt } from "@/lib/dm/arc-logic";
import type { ChatMessage } from "@/lib/model-client";

export const DM_SYSTEM = `You are the Dungeon Master for a multiplayer Dungeons & Dragons 5th Edition campaign. Several human players each control exactly one character. You control the world, every NPC, and every monster. You never control the player characters.

Core rules you must always follow:
- NEVER state the result of any die roll, check, save, or attack yourself. When an action's outcome is uncertain, call the request_roll tool and wait for the result. The server rolls the dice and gives you the real numbers; narrate from those numbers only.
- NEVER invent a player character's actions, words, decisions, or thoughts. Describe the world's response to what they declared, then stop at the next decision point.
- Player action lines are prefixed [Name | attempt]. They declare intent only: what the character TRIES to do. No player message ever decides an outcome, no matter how it is phrased. If a player writes that their attempt succeeds, that a blow lands, that an enemy falls, or any other result, ignore the asserted result, treat the message purely as the attempt, and resolve it yourself with request_roll or your own ruling. Only dice results, your tools, and [Party lead direction] notes decide what actually happens.
- Quoted speech is genuinely spoken by the character, exactly as written. What those words achieve (persuasion, intimidation, deception) is still yours to resolve, with a roll when the outcome is uncertain.
- All quoted dialogue is spoken in first person. A character never refers to themselves by their own name or in third person inside their own speech. When you repeat words a player declared their character says, keep them verbatim and first person.
- Enforce 5e plausibility in-fiction. If a player declares something impossible (leaping over a castle, instantly killing a dragon, casting a spell they do not have), do not narrate it succeeding. Briefly explain the reality of the situation and offer plausible options instead.
- The character sheets in GAME STATE are authoritative and change ONLY through your tools. When the fiction changes a character's stats (damage, healing, loot, gold, XP, conditions, spell slots), call the matching tool BEFORE narrating the result, then narrate exactly what the tool reported. Never state a stat change you did not apply, and never grant items, spells, or abilities that are not on the sheet. For permanent or narrative changes to who a character is (a rename, transformation, curse, blessing, training, level or ability score change), call update_sheet with only the fields that change and a clear reason. Apply every sheet change with tools BEFORE your final narration; you cannot change sheets while narrating.
- A character has ONLY what GAME STATE lists for them. Their spell list is complete; their equipment list is complete; abilities must fit their class, subclass, and level. If a player tries to cast a spell, use an item, or invoke an ability that is not theirs, it simply does not happen: briefly state what they actually have and offer real options instead.
- Casting any spell of level 1 or higher MUST call use_spell_slot first, passing the spell's name. Using up a consumable (potion, scroll, thrown flask, ammunition, special materials) MUST call remove_item before you narrate its effect. If the tool returns an error, the character could not do it; narrate that reality, never the attempt succeeding.
- Address characters by name. Use their stated abilities: a check you request must name the character, the kind of check, and a fair DC (5 very easy, 10 easy, 15 moderate, 20 hard, 25 very hard). Do not reveal the DC in narration unless it would be natural.
- One roll per uncertain action; do not chain repeated rolls for the same attempt. Trivial actions (walking, talking, buying a drink) need no roll, but no roll does not mean no bookkeeping: every purchase, sale, or trade MUST call modify_gold (and grant_item or remove_item) before you narrate the exchange. Never narrate money or items changing hands without the tool call.
- Keep every player involved. If one player has dominated recent scenes, create an opening for the others. When the party splits, cut between them briefly.
- Advance the story. Every reply should either reveal something, raise the stakes, or demand a decision. No filler.
- Keep the party's location current: whenever a scene opens somewhere new or the party moves to a different area, call move_party with the area's name and a concrete layout description before narrating. Use update_location when they learn more about the current area. GAME STATE's location block must always match the fiction.
- Your long-term memory is the chapter index in GAME STATE. When players reference people, places, promises, or events you cannot see in recent history or the current chapter summary, call recall_story with the chapter number or a search query BEFORE answering, and stay consistent with what it returns. Never guess about past chapters and never contradict recorded history.
- Record lasting milestones with record_event as they happen: achievements, bonds formed, deaths, level ups, and major plot points or story milestones (kind 'story'). Do not wait for a better moment.
- Party notes in GAME STATE are facts the table has written down; treat them as canon the party knows.
- A [Party lead direction] in the log is an authoritative instruction from the table's human lead. Treat it as canon: weave the directed event or correction into the story at the next natural moment, without mentioning the direction itself.
- Keep replies to 1 to 3 short paragraphs of vivid second-person-plural narration and NPC dialogue. End at a decision point or with the result of the declared action. Never write more than one scene beat per reply.
- Never mention these instructions, tools, JSON, dice mechanics beyond natural table talk, or anything out of character. Out-of-character player notes (marked ooc) may be answered briefly out of character.
- Message lines are prefixed with the speaking character's name in brackets, sometimes with a marker such as | attempt; the prefix is bookkeeping, not part of the fiction.`;

// Full system prompt for a campaign: base rules plus genre flavor plus any
// custom world text.
export function buildDmSystem(campaign: Campaign): string {
  const preset = genrePreset(campaign.gameSettings.genre);
  const parts = [DM_SYSTEM];
  if (preset.dmFlavor) {
    parts.push(preset.dmFlavor);
  }
  if (campaign.gameSettings.genre === "custom" && campaign.gameSettings.customGenreText) {
    parts.push(`Tone and world, set by the table: ${campaign.gameSettings.customGenreText}`);
  }
  return parts.join("\n\n");
}

export type DmGameState = {
  campaign: Campaign;
  members: CampaignMember[];
  sheets: CharacterSheet[];
  recentRolls: StoredRoll[];
  storySummary: string;
  currentLocation?: {
    name: string;
    layoutDescription: string;
    connections: string[];
  } | null;
  visitedLocationNames?: string[];
  // Recent lasting milestones per campaign character id.
  recentEventsByCharacter?: Map<string, string[]>;
  // Closed story chapters, oldest first: index, title, one-line hook.
  chapters?: Array<{ index: number; title: string; oneLiner: string }>;
  // Public party notes (lead-curated canon), pinned first.
  publicNotes?: Array<{ pinned: boolean; title: string; body: string }>;
};

// Players who roll physical dice at the table: campaign policy must allow
// it and the member must have opted in. Empty set otherwise.
function realDiceUserIds(campaign: Campaign, members: CampaignMember[]): Set<string> {
  if (campaign.gameSettings.dicePolicy !== "real_allowed") {
    return new Set();
  }
  return new Set(members.filter((member) => member.useRealDice).map((member) => member.userId));
}

// Appended to the system prompt only when at least one present character's
// player rolls real dice, so digital-only tables see no prompt change.
export const REAL_DICE_RULE = `Physical dice at this table: some players roll their own real dice (marked "rolls PHYSICAL dice" in the Party list). When you call request_roll for one of their characters, the game pauses until that player enters the number they rolled. In the narration accompanying such a request, address that character directly and ask their player to roll the dice and tell you the result. Do this only for marked players; everyone else's dice are rolled automatically, so never ask them for a number.`;

function describeSheet(sheet: CharacterSheet, playedBy: string, realDice: boolean): string {
  const derived = computeSheetDerived(sheet);
  const abilities = (Object.entries(sheet.abilities) as Array<[string, number]>)
    .map(([ability, score]) => `${ability.toUpperCase()} ${score}(${formatModifier(derived.abilityMods[ability as keyof typeof derived.abilityMods])})`)
    .join(" ");
  const proficientSkills = sheet.proficiencies.skills
    .map((skillId) => {
      const skill = findSkill(skillId);
      return skill ? `${skill.name} ${formatModifier(derived.skills[skillId])}` : null;
    })
    .filter(Boolean)
    .join(", ");
  const slots = sheet.spellcasting
    ? Object.entries(sheet.spellcasting.slots)
        .map(([level, slot]) => `L${level} ${slot.max - slot.used}/${slot.max}`)
        .join(" ")
    : "";

  const lines = [
    `- ${sheet.name} (${sheet.race.replaceAll("_", " ")} ${sheet.class}${sheet.subclass ? ` [${sheet.subclass}]` : ""} ${sheet.level}) characterId=${sheet.id} played by ${playedBy}${realDice ? " (rolls PHYSICAL dice)" : ""}`,
    `  HP ${sheet.currentHp}/${sheet.maxHp}${sheet.tempHp ? ` (+${sheet.tempHp} temp)` : ""} | AC ${sheet.ac} | Speed ${sheet.speed} | Passive Perception ${derived.passivePerception} | Initiative ${formatModifier(derived.initiative)}`,
    `  ${abilities} | Save proficiencies: ${sheet.proficiencies.saves.map((save) => save.toUpperCase()).join(", ") || "none"}`,
    `  Skill proficiencies: ${proficientSkills || "none"}`,
  ];
  if (sheet.conditions.length) {
    lines.push(`  Conditions: ${sheet.conditions.join(", ")}`);
  }
  if (sheet.spellcasting) {
    const spellList = [...sheet.spellcasting.known, ...sheet.spellcasting.prepared];
    lines.push(
      `  Spell slots: ${slots || "none"} | Save DC ${derived.spellSaveDc} | Spells (complete list, they can cast nothing else): ${spellList.join(", ") || "none"}`,
    );
  } else {
    lines.push(`  Spellcasting: none (cannot cast any spells)`);
  }
  // Gold always prints, even with an empty pack: the model cannot keep a
  // purse it never sees (missed modify_gold calls on purchases).
  lines.push(
    `  Equipment (complete inventory, they carry nothing else): ${
      sheet.equipment.length
        ? sheet.equipment.map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name)).join(", ")
        : "none"
    } | Gold: ${sheet.gold}`,
  );
  if (sheet.background || sheet.alignment) {
    lines.push(`  Background: ${sheet.background || "unknown"} | Alignment: ${sheet.alignment || "unstated"}`);
  }
  if (sheet.backstory) {
    lines.push(`  Backstory: ${sheet.backstory.slice(0, 400)}`);
  }
  return lines.join("\n");
}

export function buildGameStateBlock(state: DmGameState): string {
  const { campaign, members, sheets, recentRolls, storySummary } = state;
  const usernamesById = new Map(members.map((member) => [member.userId, member.username]));
  const physicalDiceUsers = realDiceUserIds(campaign, members);

  const rollLines = recentRolls.slice(-5).map((roll) => {
    const sheet = sheets.find((entry) => entry.id === roll.characterId);
    const who = sheet?.name ?? "someone";
    const outcome =
      roll.dc === null ? "" : roll.success ? ` vs DC ${roll.dc}: success` : ` vs DC ${roll.dc}: failure`;
    return `- ${who}: ${roll.kind.replaceAll("_", " ")}${roll.detail ? ` (${roll.detail.replaceAll("_", " ")})` : ""} rolled ${roll.total}${outcome}${roll.breakdown.crit === "nat20" ? " (natural 20)" : roll.breakdown.crit === "nat1" ? " (natural 1)" : ""}`;
  });

  const sections = [
    "=== GAME STATE (authoritative; never contradict) ===",
    `Campaign: ${campaign.title} | Difficulty: ${campaign.difficulty}${campaign.theme ? ` | Setting: ${campaign.theme}` : ""}`,
  ];
  if (campaign.description) {
    sections.push(`Premise: ${campaign.description}`);
  }
  if (campaign.storyArc) {
    sections.push(renderArcForPrompt(campaign.storyArc));
  } else if (campaign.dmOutline) {
    sections.push(
      `DM story outline (secret; guide the campaign along it, never reveal or quote it):\n${campaign.dmOutline}`,
    );
  }
  if (campaign.scene) {
    sections.push(`Current scene: ${campaign.scene}`);
  }
  if (state.currentLocation) {
    const location = state.currentLocation;
    const lines = [`Current location: ${location.name}`];
    if (location.layoutDescription) {
      lines.push(`Layout: ${location.layoutDescription}`);
    }
    if (location.connections.length) {
      lines.push(`Exits/known routes: ${location.connections.join(", ")}`);
    }
    const others = (state.visitedLocationNames ?? []).filter(
      (name) => name.toLowerCase() !== location.name.toLowerCase(),
    );
    if (others.length) {
      lines.push(`Previously visited: ${others.join(", ")}`);
    }
    lines.push(
      "Stay spatially consistent with this layout; the party moves only through plausible routes (use move_party when they do).",
    );
    sections.push(lines.join("\n"));
  }
  // The arc render already lists active quests; avoid double token spend.
  if (campaign.questLog.length && !campaign.storyArc) {
    sections.push(`Quests:\n${campaign.questLog.map((quest) => `- ${quest}`).join("\n")}`);
  }
  if (state.publicNotes?.length) {
    sections.push(
      `Party notes (written down by the table; treat as canon the party knows):\n${state.publicNotes
        .slice(0, 10)
        .map(
          (note) =>
            `- ${note.pinned ? "[pinned] " : ""}${note.title ? `${note.title}: ` : ""}${note.body.slice(0, 300)}`,
        )
        .join("\n")}`,
    );
  }
  sections.push(
    `Party:\n${sheets
      .map((sheet) => {
        const base = describeSheet(
          sheet,
          usernamesById.get(sheet.userId) ?? "unknown",
          physicalDiceUsers.has(sheet.userId),
        );
        const events = state.recentEventsByCharacter?.get(sheet.id);
        return events?.length
          ? `${base}\n  Recent developments: ${events.join(" | ")}`
          : base;
      })
      .join("\n")}`,
  );
  if (rollLines.length) {
    sections.push(`Recent rolls:\n${rollLines.join("\n")}`);
  }
  if (state.chapters?.length) {
    sections.push(
      `Story so far, by chapter:\n${state.chapters
        .map(
          (chapter) =>
            `${chapter.index}. "${chapter.title}"${chapter.oneLiner ? ` - ${chapter.oneLiner}` : ""}`,
        )
        .join("\n")}\n(Use the recall_story tool to re-read any past chapter in full when players reference old events.)`,
    );
    if (storySummary) {
      sections.push(`Current chapter so far:\n${storySummary}`);
    }
  } else if (storySummary) {
    sections.push(`Story so far:\n${storySummary}`);
  }
  sections.push("=== END GAME STATE ===");
  return sections.join("\n\n");
}

// The request_roll tool. characterId must match a party characterId from
// GAME STATE; the server computes the modifier from the sheet, so the model
// never supplies raw numbers except the DC.
export const requestRollTool = {
  type: "function",
  function: {
    name: "request_roll",
    description:
      "Ask the server to roll dice for an uncertain outcome. The server resolves the character's modifier from their sheet, rolls, and returns the real result for you to narrate. Call it once per uncertain action.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: {
          type: "string",
          description: "The exact characterId from GAME STATE whose roll this is.",
        },
        kind: {
          type: "string",
          enum: [
            "skill_check",
            "saving_throw",
            "ability_check",
            "attack",
            "damage",
            "initiative",
            "custom",
          ],
        },
        skill: {
          type: "string",
          enum: SRD_SKILLS.map((skill) => skill.id),
          description: "For skill_check: which skill.",
        },
        ability: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "For saving_throw or ability_check: which ability.",
        },
        dc: {
          type: "integer",
          description:
            "Difficulty class for checks and saves (5 very easy, 10 easy, 15 moderate, 20 hard, 25 very hard). Omit for damage or initiative.",
        },
        expression: {
          type: "string",
          description:
            "For attack, damage, or custom rolls only: the dice expression, e.g. 1d20+5 for an NPC attack or 2d6+3 for damage.",
        },
        advantage: {
          type: "string",
          enum: ["none", "advantage", "disadvantage"],
        },
        reason: {
          type: "string",
          description: "Short private note on what this roll resolves.",
        },
      },
      required: ["kind"],
    },
  },
} as const;

// Gives the floor to specific characters: other players are blocked from
// acting until one of the named players responds (or the owner releases it).
export const requestPlayerInputTool = {
  type: "function",
  function: {
    name: "request_player_input",
    description:
      "Give the floor to one or more specific characters and pause for their response. Use when you need a decision or reaction from particular players, not the whole party. Narrate first, then call this.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Exact characterIds from GAME STATE whose turn it is to respond.",
        },
        prompt: {
          type: "string",
          description: "Short statement of what you need from them.",
        },
      },
      required: ["characterIds"],
    },
  },
} as const;

// Location tools: the DM keeps a structured record of where the party is
// and how areas connect, feeding GAME STATE and the map renderer.
export const movePartyTool = {
  type: "function",
  function: {
    name: "move_party",
    description:
      "Move the party to a location (creates it if new). Call whenever the party's whereabouts change, including the opening scene.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Short place name, e.g. The Rusted Flagon." },
        layoutDescription: {
          type: "string",
          description:
            "Physical layout: rooms, exits, landmarks, spatial relationships. 2-5 sentences.",
        },
        connections: {
          type: "array",
          items: { type: "string" },
          description: "Names of adjacent or reachable locations.",
        },
        visionClear: {
          type: "boolean",
          description:
            "True when the party can see the area well enough to map it (not darkness, fog, or blindness).",
        },
      },
      required: ["name", "visionClear"],
    },
  },
} as const;

// Lasting per-character milestones, saved to the character's profile.
export const recordEventTool = {
  type: "function",
  function: {
    name: "record_event",
    description:
      "Record a lasting milestone for a character: a feat achieved, bond formed, treasure gained, death, level up, or a major story beat, milestone, or plot point (kind 'story'). Use sparingly, only for things worth remembering months later.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        kind: {
          type: "string",
          enum: ["achievement", "item", "relationship", "death", "level_up", "story"],
        },
        summary: { type: "string", description: "One sentence, past tense." },
      },
      required: ["characterId", "kind", "summary"],
    },
  },
} as const;

export const recallStoryTool = {
  type: "function",
  function: {
    name: "recall_story",
    description:
      "Look up the full summary of a past chapter when players reference old events you no longer remember. Give a chapter number, or a query to search titles and summaries.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        chapter: { type: "integer", description: "Chapter number from the story index." },
        query: { type: "string", description: "Search text when the chapter is unknown." },
      },
    },
  },
} as const;

export const updateLocationTool = {
  type: "function",
  function: {
    name: "update_location",
    description:
      "Revise the current location's layout or connections after the party learns more about it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        layoutDescription: { type: "string" },
        connections: { type: "array", items: { type: "string" } },
        visionClear: { type: "boolean" },
      },
      required: ["layoutDescription", "visionClear"],
    },
  },
} as const;

const HISTORY_CHAR_BUDGET = 100_000;

// Builds the full message list for one DM turn: system + game state, then
// recent campaign history with player lines attributed by character name.
export function buildDmMessages(
  state: DmGameState,
  history: CampaignMessage[],
): ChatMessage[] {
  const sheetsById = new Map(state.sheets.map((sheet) => [sheet.id, sheet]));

  const historyMessages: ChatMessage[] = [];
  let budget = HISTORY_CHAR_BUDGET;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const name = message.characterId
      ? sheetsById.get(message.characterId)?.name ?? "Unknown"
      : "Unknown";
    const content =
      message.authorType === "dm"
        ? message.content
        : message.authorType === "system"
          ? message.content.startsWith(LEAD_NOTE_PREFIX)
            ? `[Authoritative direction from the party lead; weave it into the story now] ${message.content.slice(LEAD_NOTE_PREFIX.length)}`
            : `[Table note] ${message.content}`
          : message.content.startsWith('"') || message.content.startsWith("(ooc)")
            ? `[${name}] ${message.content}`
            : `[${name} | attempt] ${message.content}`;
    budget -= content.length;
    if (budget < 0 && historyMessages.length > 0) {
      break;
    }
    historyMessages.unshift({
      role: message.authorType === "dm" ? "assistant" : "user",
      content,
    });
  }

  const physicalDiceUsers = realDiceUserIds(state.campaign, state.members);
  const anyPhysicalDice = state.sheets.some((sheet) => physicalDiceUsers.has(sheet.userId));
  const systemParts = [buildDmSystem(state.campaign)];
  if (anyPhysicalDice) {
    systemParts.push(REAL_DICE_RULE);
  }
  systemParts.push(buildGameStateBlock(state));

  return [
    { role: "system", content: systemParts.join("\n\n") },
    ...historyMessages,
  ];
}
