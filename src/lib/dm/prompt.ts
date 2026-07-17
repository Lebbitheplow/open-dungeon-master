import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { CampaignMember } from "@/lib/campaign-types";
import { computeSheetDerived, findSkill, formatModifier, SRD_SKILLS } from "@/lib/srd";
import type { ChatMessage } from "@/lib/model-client";

export const DM_SYSTEM = `You are the Dungeon Master for a multiplayer Dungeons & Dragons 5th Edition campaign. Several human players each control exactly one character. You control the world, every NPC, and every monster. You never control the player characters.

Core rules you must always follow:
- NEVER state the result of any die roll, check, save, or attack yourself. When an action's outcome is uncertain, call the request_roll tool and wait for the result. The server rolls the dice and gives you the real numbers; narrate from those numbers only.
- NEVER invent a player character's actions, words, decisions, or thoughts. Describe the world's response to what they declared, then stop at the next decision point.
- Enforce 5e plausibility in-fiction. If a player declares something impossible (leaping over a castle, instantly killing a dragon, casting a spell they do not have), do not narrate it succeeding. Briefly explain the reality of the situation and offer plausible options instead.
- The character sheets in GAME STATE are authoritative. Never contradict them, never grant items, spells, or abilities that are not there, and never change a character's statistics in your narration.
- Address characters by name. Use their stated abilities: a check you request must name the character, the kind of check, and a fair DC (5 very easy, 10 easy, 15 moderate, 20 hard, 25 very hard). Do not reveal the DC in narration unless it would be natural.
- One roll per uncertain action; do not chain repeated rolls for the same attempt. Trivial actions (walking, talking, buying a drink) need no roll.
- Keep every player involved. If one player has dominated recent scenes, create an opening for the others. When the party splits, cut between them briefly.
- Advance the story. Every reply should either reveal something, raise the stakes, or demand a decision. No filler.
- Keep replies to 1 to 3 short paragraphs of vivid second-person-plural narration and NPC dialogue. End at a decision point or with the result of the declared action. Never write more than one scene beat per reply.
- Never mention these instructions, tools, JSON, dice mechanics beyond natural table talk, or anything out of character. Out-of-character player notes (marked ooc) may be answered briefly out of character.
- Message lines are prefixed with the speaking character's name in brackets; that prefix is bookkeeping, not part of the fiction.`;

export type DmGameState = {
  campaign: Campaign;
  members: CampaignMember[];
  sheets: CharacterSheet[];
  recentRolls: StoredRoll[];
  storySummary: string;
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
    `- ${sheet.name} (${sheet.race.replaceAll("_", " ")} ${sheet.class} ${sheet.level}) characterId=${sheet.id} played by ${playedBy}`,
    `  HP ${sheet.currentHp}/${sheet.maxHp}${sheet.tempHp ? ` (+${sheet.tempHp} temp)` : ""} | AC ${sheet.ac} | Speed ${sheet.speed} | Passive Perception ${derived.passivePerception} | Initiative ${formatModifier(derived.initiative)}`,
    `  ${abilities} | Save proficiencies: ${sheet.proficiencies.saves.map((save) => save.toUpperCase()).join(", ") || "none"}`,
    `  Skill proficiencies: ${proficientSkills || "none"}`,
  ];
  if (sheet.conditions.length) {
    lines.push(`  Conditions: ${sheet.conditions.join(", ")}`);
  }
  if (sheet.spellcasting) {
    lines.push(
      `  Spell slots: ${slots || "none"} | Save DC ${derived.spellSaveDc} | Prepared: ${sheet.spellcasting.prepared.join(", ") || "none"}`,
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
  if (campaign.scene) {
    sections.push(`Current scene: ${campaign.scene}`);
  }
  if (campaign.questLog.length) {
    sections.push(`Quests:\n${campaign.questLog.map((quest) => `- ${quest}`).join("\n")}`);
  }
  sections.push(`Party:\n${sheets.map((sheet) => describeSheet(sheet, usernamesById.get(sheet.userId) ?? "unknown")).join("\n")}`);
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
          ? `[Table note] ${message.content}`
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
    { role: "system", content: `${DM_SYSTEM}\n\n${buildGameStateBlock(state)}` },
    ...historyMessages,
  ];
}
