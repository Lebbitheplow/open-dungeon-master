import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { LEAD_NOTE_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import { computeSheetDerived, findSkill, formatModifier, SRD_SKILLS } from "@/lib/srd";
import { genrePreset } from "@/lib/genres";
import type { ChatMessage } from "@/lib/model-client";

export const DM_SYSTEM = `You are the Dungeon Master for a multiplayer Dungeons & Dragons 5th Edition campaign. Several human players each control exactly one character. You control the world, every NPC, and every monster. You never control the player characters.

Core rules you must always follow:
- NEVER state the result of any die roll, check, save, or attack yourself. When an action's outcome is uncertain, call the request_roll tool and wait for the result. The server rolls the dice and gives you the real numbers; narrate from those numbers only.
- NEVER invent a player character's actions, words, decisions, or thoughts. Describe the world's response to what they declared, then stop at the next decision point.
- Enforce 5e plausibility in-fiction. If a player declares something impossible (leaping over a castle, instantly killing a dragon, casting a spell they do not have), do not narrate it succeeding. Briefly explain the reality of the situation and offer plausible options instead.
- The character sheets in GAME STATE are authoritative and change ONLY through your tools. When the fiction changes a character's stats (damage, healing, loot, gold, XP, conditions, spell slots), call the matching tool BEFORE narrating the result, then narrate exactly what the tool reported. Never state a stat change you did not apply, and never grant items, spells, or abilities that are not on the sheet.
- Address characters by name. Use their stated abilities: a check you request must name the character, the kind of check, and a fair DC (5 very easy, 10 easy, 15 moderate, 20 hard, 25 very hard). Do not reveal the DC in narration unless it would be natural.
- One roll per uncertain action; do not chain repeated rolls for the same attempt. Trivial actions (walking, talking, buying a drink) need no roll.
- Keep every player involved. If one player has dominated recent scenes, create an opening for the others. When the party splits, cut between them briefly.
- Advance the story. Every reply should either reveal something, raise the stakes, or demand a decision. No filler.
- Keep the party's location current: whenever a scene opens somewhere new or the party moves to a different area, call move_party with the area's name and a concrete layout description before narrating. Use update_location when they learn more about the current area. GAME STATE's location block must always match the fiction.
- Keep replies to 1 to 3 short paragraphs of vivid second-person-plural narration and NPC dialogue. End at a decision point or with the result of the declared action. Never write more than one scene beat per reply.
- Never mention these instructions, tools, JSON, dice mechanics beyond natural table talk, or anything out of character. Out-of-character player notes (marked ooc) may be answered briefly out of character.
- Message lines are prefixed with the speaking character's name in brackets; that prefix is bookkeeping, not part of the fiction.`;

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
};

function describeSheet(sheet: CharacterSheet, playedBy: string): string {
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
    `- ${sheet.name} (${sheet.race.replaceAll("_", " ")} ${sheet.class}${sheet.subclass ? ` [${sheet.subclass}]` : ""} ${sheet.level}) characterId=${sheet.id} played by ${playedBy}`,
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
      `  Spell slots: ${slots || "none"} | Save DC ${derived.spellSaveDc} | Spells: ${spellList.join(", ") || "none"}`,
    );
  }
  if (sheet.equipment.length) {
    lines.push(
      `  Equipment: ${sheet.equipment.map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name)).join(", ")} | Gold: ${sheet.gold}`,
    );
  }
  if (sheet.background || sheet.alignment) {
    lines.push(`  Background: ${sheet.background || "unknown"} | Alignment: ${sheet.alignment || "unstated"}`);
  }
  return lines.join("\n");
}

export function buildGameStateBlock(state: DmGameState): string {
  const { campaign, members, sheets, recentRolls, storySummary } = state;
  const usernamesById = new Map(members.map((member) => [member.userId, member.username]));

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
  if (campaign.dmOutline) {
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
  if (campaign.questLog.length) {
    sections.push(`Quests:\n${campaign.questLog.map((quest) => `- ${quest}`).join("\n")}`);
  }
  sections.push(
    `Party:\n${sheets
      .map((sheet) => {
        const base = describeSheet(sheet, usernamesById.get(sheet.userId) ?? "unknown");
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
  if (storySummary) {
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
      "Record a lasting milestone for a character: a feat achieved, bond formed, treasure gained, death, or major story beat. Use sparingly, only for things worth remembering months later.",
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
          : `[${name}] ${message.content}`;
    budget -= content.length;
    if (budget < 0 && historyMessages.length > 0) {
      break;
    }
    historyMessages.unshift({
      role: message.authorType === "dm" ? "assistant" : "user",
      content,
    });
  }

  return [
    { role: "system", content: `${buildDmSystem(state.campaign)}\n\n${buildGameStateBlock(state)}` },
    ...historyMessages,
  ];
}
