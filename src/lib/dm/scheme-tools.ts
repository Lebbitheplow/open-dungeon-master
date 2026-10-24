import { z } from "zod";
import { campaignSeats, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getNpcByName } from "@/lib/db/npcs";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import {
  getRelationship,
  listRelationships,
  listRelationshipsForSubject,
  patchRelationship,
  type Relationship,
} from "@/lib/db/relationships";
import { resolveMonster } from "@/lib/bestiary";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { computeSheetDerived } from "@/lib/srd";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { Opponent } from "@/lib/dm/roll-gates";
import { deliverWhisper } from "@/lib/dm/whispers";
import { openToAdvanceNames, romanceSafetyBlock } from "@/lib/dm/advance-logic";
import { addMemory, demoteRomance, friendshipTier, TIER_LABEL } from "@/lib/dm/relationship-logic";
import {
  actLine,
  actRunning,
  deceptionFromNature,
  exposeTo,
  MOTIVE_MAX,
  revealPretense,
  SCHEME_RULES,
  schemeRevealProblem,
  schemeStartProblem,
  seenThroughWhisper,
  startPretense,
  type Pretense,
} from "@/lib/dm/scheme-logic";
import {
  openLedger,
  publishRelationshipsUpdated,
  recordRelationshipEvent,
  resolveActor,
  resolveSubject,
} from "@/lib/dm/relationship-subject";
import { unknownSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";

// Scheming NPCs (issue 501), the rim of src/lib/dm/scheme-logic.ts: the one
// tool a new intent earns (relationship_scheme, start and reveal; one tool
// per intent, src/lib/dm/tool-merge-logic.ts), the Insight that sees through
// an act (check_notice with sense insight and againstMonster set to the NPC's
// name, src/lib/dm/check-tools.ts), and the
// storyteller's section of the DM's game state. A betrayal that ends it is
// relationship_end with by "npc" (src/lib/dm/relationship-tools.ts), which
// reveals a running act through revealAct below.
//
// Every visible beat is a server outcome: the Bonds row a player reads moves
// to the truth only when an Insight that beat the act is whispered to them,
// or when the act is revealed to everyone (the relationships route,
// scheme-logic.ts bondTruthFor).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const SCHEME_TOOL = "relationship_scheme";

export const schemeTool: ToolDef = {
  type: "function",
  function: {
    name: SCHEME_TOOL,
    description:
      "An NPC who only pretends to care for a character, for a motive of their own (a honey trap), or the moment that act comes out. start: the act begins where they truly stand, and nobody at the table sees anything change; build the warmth with relationship_beat, each warm beat landing at its face value on the warmth the table sees, while you keep their true standing and the motive. Only toward a character open to advances from NPCs, by an NPC drawn to them. reveal: the truth comes out to everyone. A betrayal that ends the bond is relationship_end with reason betrayal and by npc instead.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["start", "reveal"], description: "start the act, or reveal it to everyone." },
        characterId: { type: "string", description: "The character the act is aimed at: exact characterId from GAME STATE." },
        subject: { type: "string", description: "Exact name of the tracked NPC keeping up the act." },
        motive: { type: "string", description: "start only: what they really want from the character, in a few words ('the vault key')." },
        note: { type: "string", description: "reveal only: one short line on how it came out, for the relationship's memory." },
      },
      required: ["action", "characterId", "subject"],
    },
  },
};

// Why a table has no acts: relationships or romance off, or the safety
// tools ruling romance out, exactly as an honest first move reads them.
function schemeSafety(campaign: Campaign): string | null {
  const settings = campaign.gameSettings;
  if (settings.relationships === "off") {
    return "Relationship tracking is switched off for this campaign.";
  }
  if (settings.romance === "off") {
    return "Romance is switched off for this campaign, so no NPC plays at it either.";
  }
  return romanceSafetyBlock(settings.safety);
}

// Whether relationship_scheme is offered: a table where it could be used,
// with at least one character whose player opened them to advances.
export function schemesPossible(campaign: Campaign, sheets?: readonly CharacterSheet[]): boolean {
  return !schemeSafety(campaign) && openToAdvanceNames(campaign, sheets ?? listSheets(campaign.id)).length > 0;
}

const schemeSchema = z.object({
  action: z.enum(["start", "reveal"]),
  characterId: z.string(),
  subject: z.string().min(1).max(80),
  motive: z.string().max(400).optional(),
  note: z.string().max(200).optional(),
});

export function handleRelationshipScheme(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof schemeSchema>;
  try {
    args = schemeSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: relationship_scheme needs action (start or reveal), characterId and subject, and a motive to start.",
      retry: true,
    };
  }
  const sheet = resolveActor(args, sheets, sheetsById);
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const subject = resolveSubject(campaign, args.subject, sheets);
  if ("error" in subject) {
    return subject;
  }
  if (args.action === "reveal") {
    const relationship = getRelationship(campaign.id, sheet.id, subject.name);
    const problem = schemeRevealProblem(subject.name, sheet.name, relationship?.pretense ?? null);
    if (problem || !relationship) {
      return { error: problem ?? `${subject.name} keeps up no act toward ${sheet.name}; nothing to reveal.`, retry: true };
    }
    const revealed = revealAct(campaign, sheet, relationship, args.note);
    return {
      ok: true,
      character: sheet.name,
      subject: subject.name,
      revealed: true,
      approval: revealed.approval,
      standing: friendshipTier(revealed.approval),
      note: `The truth is out: the whole table now sees that ${subject.name}'s warmth toward ${sheet.name} was an act, and where ${subject.name} really stands (${TIER_LABEL[friendshipTier(revealed.approval)]}). Narrate the unmasking. If it ends things between them, relationship_end with reason betrayal and by npc.`,
    };
  }

  const motive = args.motive?.trim() ?? "";
  if (!motive) {
    return { error: "relationship_scheme start needs a motive: what they really want from the character, in a few words.", retry: true };
  }
  // The ledger opens only for an act that may begin: a refusal leaves no row.
  const existing = getRelationship(campaign.id, sheet.id, subject.name);
  const npc = subject.npc ?? getNpcByName(campaign.id, subject.name);
  const problem = schemeStartProblem(
    {
      name: subject.name,
      kind: subject.kind,
      status: existing?.status ?? "active",
      gender: npc?.gender ?? "",
      attraction: npc?.attraction ?? null,
      actToward: actElsewhere(campaign.id, subject.name),
    },
    {
      name: sheet.name,
      gender: sheet.gender,
      attraction: sheet.attraction ?? null,
      open: Boolean(sheet.openToAdvances),
      isCompanion: sheet.isCompanion,
    },
    schemeSafety(campaign),
  );
  if (problem) {
    return { error: problem, refused: "rules" };
  }
  const relationship = existing ?? openLedger(campaign, sheet, subject);
  const pretense = startPretense(motive.slice(0, MOTIVE_MAX), relationship.approval, new Date().toISOString());
  patchRelationship(relationship.id, { pretense });
  // Nothing anyone at the table sees has changed; only a person running it
  // has a Bonds tab that reads the act, so only they are told to look.
  if (campaignSeats(campaign).dmMode !== "ai") {
    publishRelationshipsUpdated(campaign.id);
  }
  return {
    ok: true,
    character: sheet.name,
    subject: subject.name,
    approval: relationship.approval,
    standing: friendshipTier(relationship.approval),
    shown: pretense.shown,
    note: `The act is on, and it starts where ${subject.name} truly stands (${TIER_LABEL[friendshipTier(relationship.approval)]}): nobody at the table sees anything change. Build the warmth as a real bond is built, giving ${sheet.name} chances to earn it and recording each with relationship_beat; every warm beat lands at its face value on the warmth the table sees, whatever ${subject.name} truly feels. The motive and the truth are yours alone: never call it an act aloud, in narration, a note or out of character. Someone may see through it with check_notice sense insight, againstMonster ${subject.name}.`,
  };
}

// The act this NPC keeps up toward anyone, by that character's name. An
// act on a bond that ended is over, whether or not it ever came out.
function actElsewhere(campaignId: string, subjectName: string): string | null {
  const running = listRelationshipsForSubject(campaignId, subjectName).find((entry) => entry.status !== "ended" && actRunning(entry.pretense));
  return running ? running.characterName : null;
}

// The truth comes out to the whole table: the act ends, the romance drops to
// what the true meter holds, and the story log and the bond's memory keep it.
export function revealAct(campaign: Campaign, sheet: CharacterSheet, relationship: Relationship, note?: string): Relationship {
  if (!relationship.pretense) {
    return relationship;
  }
  const text = note?.trim() || `${relationship.subjectName}'s warmth toward ${sheet.name} was an act all along`;
  const updated =
    patchRelationship(relationship.id, {
      pretense: revealPretense(relationship.pretense),
      romance: demoteRomance(relationship.romance, relationship.approval),
      memories: addMemory(relationship.memories, { kind: "unmasked", text, at: new Date().toISOString() }),
    }) ?? relationship;
  recordRelationshipEvent(campaign, sheet, text);
  publishRelationshipsUpdated(campaign.id);
  return updated;
}

// ---- seeing through it ----

// The tracked NPC an Insight's check_notice names (againstMonster set to
// their name), as the opponent whose Deception sets the DC: their stat
// block's when they have one, a lasting companion's own sheet's, else one
// from their nature (scheme-logic.ts deceptionFromNature), so the same
// person always lies equally well. Null when the name is no tracked NPC or
// companion: the bestiary's stat block by that name answers instead.
export function npcDeceiver(campaign: Campaign, rawName: string, sheets: CharacterSheet[]): Opponent | null {
  const subject = resolveSubject(campaign, rawName, sheets);
  if ("error" in subject) {
    return null;
  }
  const companion = subject.kind === "companion" ? getSheetById(subject.id) : null;
  if (companion?.isCompanion) {
    return { name: subject.name, stats: liesWith(computeSheetDerived(companion).skills.deception ?? 0), conditions: [] };
  }
  const statBlock = subject.npc?.statBlock ?? "";
  const monster = statBlock ? resolveMonster(statBlock, campaign.gameSettings, { userIds: spellAuthorsFor(campaign) }) : null;
  if (monster) {
    return { name: subject.name, stats: monster.stats, conditions: [] };
  }
  return { name: subject.name, stats: liesWith(deceptionFromNature(subject.personality)), conditions: [] };
}

// A block that lists one skill: all the contest reads of it
// (src/lib/dm/roll-gates.ts creatureCheckMod).
function liesWith(deception: number): EnemyStats {
  return { skills: { deception } } as unknown as EnemyStats;
}

// Who beat the act: every running act this NPC keeps up is seen through by
// each character who noticed, and each one's player is told privately (the
// whisper path, src/lib/dm/whispers.ts). Nobody else is. Returns a line per
// character newly let in, for the DM.
export function seeThroughActs(
  campaign: Campaign,
  turn: Pick<DmTurn, "id">,
  npcName: string,
  noticers: readonly CharacterSheet[],
): string[] {
  const players = noticers.filter((sheet) => !sheet.isCompanion && !sheet.summon);
  const lines: string[] = [];
  for (const relationship of listRelationshipsForSubject(campaign.id, npcName)) {
    const pretense = relationship.pretense;
    if (!actRunning(pretense)) {
      continue;
    }
    const fresh = players.filter((sheet) => !pretense.exposedTo.includes(sheet.id));
    if (!fresh.length) {
      continue;
    }
    patchRelationship(relationship.id, { pretense: exposeTo(pretense, fresh.map((sheet) => sheet.id)) });
    for (const sheet of fresh) {
      deliverWhisper(campaign.id, turn.id, [{ userId: sheet.userId, characterId: sheet.id, characterName: sheet.name }], seenThroughWhisper(sheet.name, relationship.subjectName, relationship.characterName));
      lines.push(`${sheet.name} saw through ${relationship.subjectName}'s act toward ${relationship.characterName}; only ${sheet.name}'s player was told.`);
    }
  }
  if (lines.length) {
    publishRelationshipsUpdated(campaign.id);
  }
  return lines;
}

// ---- the storyteller's section of the game state ----

// Every storyteller secret the DM's game state carries, one formatted line
// each: who is open to advances (each player's private choice), an NPC ready
// to make a move (src/lib/dm/advance-tick.ts advanceDirectorNotes), and each
// running act with the rules for playing one. src/lib/dm/prompt.ts renders
// them as one section, tagged so the Context tab and an out-of-character
// answer leave it out (src/lib/dm/viewer.ts, storyteller secrets).
export function storytellerLinesForPrompt(campaign: Campaign, sheets: readonly CharacterSheet[], advanceCues: readonly string[]): string[] {
  const lines: string[] = [];
  const open = openToAdvanceNames(campaign, sheets);
  if (open.length) {
    lines.push(`- Open to advances from NPCs (each player's private choice; never mention it at the table): ${open.join(", ")}.`);
  }
  for (const cue of advanceCues) {
    lines.push(`- ${cue}`);
  }
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  const acts = campaign.gameSettings.relationships === "off" ? [] : listRelationships(campaign.id).filter((entry) => entry.status !== "ended" && actRunning(entry.pretense));
  for (const act of acts) {
    const seen = (act.pretense?.exposedTo ?? []).map((id) => names.get(id)).filter((name): name is string => Boolean(name));
    lines.push(`- ${actLine(act.subjectName, act.characterName, act.pretense as Pretense, seen)}`);
  }
  if (acts.length) {
    lines.push(SCHEME_RULES);
  }
  return lines;
}

// The act a relationship tool's result names, when one is running for this
// pair, so the AI never plays the shown warmth as the truth or the truth as
// what the table sees.
export function runningAct(relationship: { pretense: Pretense | null } | null | undefined): Pretense | null {
  return relationship && actRunning(relationship.pretense) ? relationship.pretense : null;
}
