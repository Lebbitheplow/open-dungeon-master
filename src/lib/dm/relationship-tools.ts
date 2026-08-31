import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { insertFact } from "@/lib/db/facts";
import { getNpcByName, setNpcAttitude, type Npc } from "@/lib/db/npcs";
import {
  ensureRelationship,
  getRelationship,
  listRelationships,
  patchRelationship,
  type Relationship,
  type RelationshipSubjectKind,
} from "@/lib/db/relationships";
import { derivePersonality } from "@/lib/dm/npc-logic";
import {
  addFlag,
  addMemory,
  applyApproval,
  beatAlignment,
  beatDc,
  beatDelta,
  beatOutcome,
  beatSpec,
  canAdvanceRomance,
  consentCheck,
  demoteRomance,
  friendshipTier,
  nextRomanceStage,
  REFUSAL_COST,
  relationshipFragment,
  RELATIONSHIP_BEAT_NAMES,
  romanceIndex,
  ROMANCE_LABEL,
  ROMANCE_THRESHOLD,
  TIER_LABEL,
  type Personality,
  type RelationshipBeat,
  type RomanceStage,
} from "@/lib/dm/relationship-logic";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollExpression } from "@/lib/dice";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import { resolveRollExpression, resolveSheetRef } from "@/lib/dm/rolls";
import type { RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The relationship engine: how each character actually stands with each NPC
// and AI companion, on one server-owned meter running from open hostility to
// devotion, with romance as an explicit ladder gated behind genuinely being
// liked. Before this, regard was pure narration, so an NPC the party saved
// twice greeted them like strangers and the model could marry off someone it
// had never met.
//
// relationship_beat moves the meter (a charming overture rolls a real
// Charisma skill; a deed applies flat, modulated by whether it suits the
// person judging it), romance_advance is the only way a bond changes what it
// IS and only with consent, and relationship_end records a parting or a
// break. Everything persists per subject NAME, so a companion who leaves
// keeps the whole history for when they come back.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const RELATIONSHIP_TOOL_NAMES = [
  "relationship_beat",
  "romance_advance",
  "relationship_end",
] as const;

const END_REASONS = ["falling_out", "parting", "breakup", "betrayal", "death"] as const;

export function relationshipsEnabled(campaign: Campaign): boolean {
  return campaign.gameSettings.relationships !== "off";
}

export function romanceEnabled(campaign: Campaign): boolean {
  return relationshipsEnabled(campaign) && campaign.gameSettings.romance !== "off";
}

export function relationshipTools(campaign: Campaign): ToolDef[] {
  if (!relationshipsEnabled(campaign)) {
    return [];
  }
  const romance = romanceEnabled(campaign);
  const beats = romance
    ? RELATIONSHIP_BEAT_NAMES
    : RELATIONSHIP_BEAT_NAMES.filter((beat) => beatSpec(beat)?.track !== "romantic");
  const tools: ToolDef[] = [
    {
      type: "function",
      function: {
        name: "relationship_beat",
        description:
          "Record one moment that changed how a tracked NPC or AI companion feels about a character, moving the server's approval meter for that pair. Call it whenever a player's declared words or actions would land with someone watching: keeping a promise, showing mercy or cruelty, defending them, being generous, lying, leaving them to face something alone. The meter runs from hostile through neutral to devoted and persists across sessions. The SAME deed lands differently on different people: the server weighs it against that person's own nature, so mercy wins over a kind healer and irritates a hard-bitten mercenary, and it tells you which happened. Charming overtures (gift, flirt, compliment, grand_gesture) roll that character's real Persuasion or Performance; deeds simply count. Repeating one move is worth steadily less. The subject must already exist: set_npc or npc_reaction for an NPC, add_companion for a companion. Call this BEFORE narrating their reaction, and narrate exactly what it reports.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string", description: "The character whose conduct this is." },
            subject: {
              type: "string",
              description: "Exact name of the tracked NPC or AI companion who witnessed it.",
            },
            beat: {
              type: "string",
              enum: [...beats],
              description:
                "What happened. Earns regard: helped, kept_word, generosity, mercy, courage, honesty, defended, shared_peril, confided, gift. Costs it: broke_word, cruelty, greed, deceit, cowardice, endangered, ignored, insult, betrayal." +
                (romance
                  ? " Romantic: flirt (how a courtship opens), compliment, grand_gesture, intimacy (partners only; always narrate as a fade to black)."
                  : ""),
            },
            note: {
              type: "string",
              description: "One short line on what actually happened, for the relationship's memory.",
            },
          },
          required: ["characterId", "subject", "beat"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "relationship_end",
        description:
          "Record a relationship changing for good: 'falling_out' when a friendship breaks, 'parting' when they stay close but go separate ways (the ally who stays behind while the party travels on), 'breakup' or 'betrayal' when a romance ends badly, 'death' when they die. A parting keeps the whole history and the server brings them back into play later; the others close the book. Call this BEFORE narrating the goodbye.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string", description: "The character on this side of it." },
            subject: { type: "string", description: "Exact name of the NPC or companion." },
            reason: { type: "string", enum: [...END_REASONS], description: "How it ends." },
            note: { type: "string", description: "One short line for the record." },
          },
          required: ["characterId", "subject", "reason"],
        },
      },
    },
  ];
  if (romance) {
    tools.splice(1, 0, {
      type: "function",
      function: {
        name: "romance_advance",
        description:
          "Take a romance one step further: interested (a quiet, unspoken pull), courting (declared out loud), together (partners), betrothed (a proposal), married (wed). Call this ONLY when the player has declared the step their character is taking, and BEFORE narrating how it goes. The server checks that the person actually LIKES them first (nobody is courted into liking someone), then whether the feeling is deep enough for this step, then decides whether they accept, rolling when it is genuinely uncertain. A refusal is a real outcome you must narrate as written; never talk someone into a step the tool declined. One step per exchange.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string", description: "The character taking the step." },
            subject: { type: "string", description: "Exact name of the NPC or companion." },
            to: {
              type: "string",
              enum: ["interested", "courting", "together", "betrothed", "married"],
              description: "The next rung only; the server refuses a skipped step.",
            },
            note: {
              type: "string",
              description:
                "One short line describing the moment, kept in the relationship's memory (e.g. 'proposed on the bridge at Highmoor').",
            },
          },
          required: ["characterId", "subject", "to"],
        },
      },
    });
  }
  return tools;
}

// ---- shared resolution ----

type Subject = {
  kind: RelationshipSubjectKind;
  name: string;
  id: string;
  personality: Personality;
  hostile: boolean;
  npc: Npc | null;
};

function resolveSubject(
  campaign: Campaign,
  rawName: string,
  sheets: CharacterSheet[],
): Subject | { error: string } {
  const needle = rawName.trim().toLowerCase();
  const sheet = sheets.find((candidate) => candidate.name.trim().toLowerCase() === needle);
  if (sheet && !sheet.isCompanion) {
    return {
      error: `${sheet.name} is a player's character. How two player characters feel about each other belongs to those two players and is not metered here; play the scene.`,
    };
  }
  if (sheet?.isCompanion) {
    return {
      kind: "companion",
      name: sheet.name,
      id: sheet.id,
      // Companions have a personality brief rather than axes; nothing to
      // weigh a deed against, so every deed lands at face value.
      personality: null,
      hostile: false,
      npc: null,
    };
  }
  const npc = getNpcByName(campaign.id, rawName);
  if (!npc) {
    return {
      error: `No tracked NPC or companion named "${rawName}". Register them with set_npc (or npc_reaction), or add_companion, before recording how they take things.`,
    };
  }
  return {
    kind: "npc",
    name: npc.name,
    id: npc.id,
    personality: npc.agency.personality ?? derivePersonality(npc.name, npc.attitude, npc.trait),
    hostile: npc.attitude === "hostile",
    npc,
  };
}

function resolveActor(
  args: { characterId: string },
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet | null {
  const stale = resolveSheetRef(args.characterId, sheets, sheetsById);
  return stale ? getSheetById(stale.id) ?? stale : null;
}

function openLedger(
  campaign: Campaign,
  sheet: CharacterSheet,
  subject: Subject,
): Relationship {
  return (
    getRelationship(campaign.id, sheet.id, subject.name) ??
    ensureRelationship({
      campaignId: campaign.id,
      characterId: sheet.id,
      characterName: sheet.name,
      subjectKind: subject.kind,
      subjectName: subject.name,
      subjectId: subject.id,
    })
  );
}

// Milestones land in the character's own story log, which is where the table
// already reads its history, and follow the character into their library
// entry. The panel refetches on the contentless ephemeral.
function recordRelationshipEvent(campaign: Campaign, sheet: CharacterSheet, summary: string) {
  const event = insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "relationship",
    summary: summary.slice(0, 300),
  });
  publishPersisted(campaign.id, "character_event", { event, characterName: sheet.name });
}

export function publishRelationshipsUpdated(campaignId: string) {
  publishEphemeral(campaignId, "relationships_updated", {});
}

// ---- relationship_beat ----

const beatSchema = z.object({
  characterId: z.string(),
  subject: z.string().min(1).max(80),
  beat: z.string().min(1).max(40),
  note: z.string().max(200).optional(),
});

export function handleRelationshipBeat(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  if (!relationshipsEnabled(campaign)) {
    return { error: "Relationship tracking is switched off for this campaign." };
  }
  let args: z.infer<typeof beatSchema>;
  try {
    args = beatSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: relationship_beat needs characterId, subject, and beat.",
    };
  }
  const spec = beatSpec(args.beat);
  if (!spec) {
    return {
      error: `Unknown beat "${args.beat}". Use one of: ${RELATIONSHIP_BEAT_NAMES.join(", ")}.`,
    };
  }
  if (spec.track === "romantic" && !romanceEnabled(campaign)) {
    return { error: "Romance is switched off for this campaign; only social beats apply." };
  }
  const sheet = resolveActor(args, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const subject = resolveSubject(campaign, args.subject, sheets);
  if ("error" in subject) {
    return subject;
  }
  if (subject.name.trim().toLowerCase() === sheet.name.trim().toLowerCase()) {
    return { error: "A character cannot have a relationship with themselves." };
  }

  const relationship = openLedger(campaign, sheet, subject);
  if (relationship.status === "ended") {
    return {
      error: `${sheet.name} and ${subject.name} are finished. Nothing changes that without the story reopening it first.`,
    };
  }
  if (spec.minRomance && romanceIndex(relationship.romance) < romanceIndex(spec.minRomance)) {
    return {
      error: `${args.beat} is not where they are: that belongs to ${ROMANCE_LABEL[spec.minRomance]} and they are at ${ROMANCE_LABEL[relationship.romance]}. Use romance_advance first, if the meter supports it.`,
    };
  }

  // A charming overture is an attempt, so the dice decide how it lands; a
  // deed has already happened and simply counts.
  let outcome: ReturnType<typeof beatOutcome> | null = null;
  let rollTotal: number | null = null;
  let dc: number | null = null;
  if (spec.skill) {
    const resolved = resolveRollExpression(
      { kind: "skill_check", skill: spec.skill } as unknown as RollArgs,
      sheet,
      { encumbrance: campaign.gameSettings.variantRules.encumbrance },
    );
    if ("error" in resolved || "autoFail" in resolved) {
      return {
        error: "error" in resolved ? resolved.error : `${sheet.name} cannot make that check.`,
      };
    }
    dc = beatDc(relationship.approval);
    const rolled = rollExpression(resolved.expression);
    rollTotal = rolled.total;
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "skill_check",
      detail: `${sheet.name}: ${spec.skill} toward ${subject.name}`,
      dc,
      result: rolled,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    turn.rollIds.push(roll.id);
    outcome = beatOutcome(rolled.total, dc);
  }

  const alignment = beatAlignment(spec, subject.personality);
  const delta = beatDelta(args.beat as RelationshipBeat, outcome, {
    approval: relationship.approval,
    repeats: relationship.beats[args.beat] ?? 0,
    personality: subject.personality,
    hostile: subject.hostile,
  });
  const approval = applyApproval(relationship.approval, delta);
  const romance = demoteRomance(relationship.romance, approval);
  // The beats worth remembering are the ones that changed something.
  const memorable =
    args.beat === "intimacy" || args.beat === "betrayal" || Math.abs(delta) >= 7;
  const updated =
    patchRelationship(relationship.id, {
      approval,
      romance,
      beats: { ...relationship.beats, [args.beat]: (relationship.beats[args.beat] ?? 0) + 1 },
      ...(args.beat === "intimacy" ? { flags: addFlag(relationship.flags, "intimacy") } : {}),
      ...(memorable && args.note?.trim()
        ? {
            memories: addMemory(relationship.memories, {
              kind: args.beat,
              text: args.note.trim(),
              at: new Date().toISOString(),
            }),
          }
        : {}),
    }) ?? relationship;
  publishRelationshipsUpdated(campaign.id);

  const tier = friendshipTier(updated.approval);
  return {
    ok: true,
    character: sheet.name,
    subject: subject.name,
    beat: args.beat,
    ...(spec.skill ? { skill: spec.skill, roll: rollTotal, dc, outcome } : {}),
    approvalChange: delta,
    approval: updated.approval,
    standing: tier,
    ...(alignment !== 0
      ? { suitsThem: alignment > 0 ? "yes" : "no", alignment }
      : {}),
    ...(updated.romance !== "none" ? { romance: updated.romance } : {}),
    ...(romance !== relationship.romance
      ? { romanceSlipped: `${relationship.romance} -> ${romance}` }
      : {}),
    note: buildBeatNote(sheet.name, subject.name, spec.label, delta, alignment, updated, outcome),
  };
}

function buildBeatNote(
  character: string,
  subject: string,
  label: string,
  delta: number,
  alignment: number,
  relationship: Relationship,
  outcome: ReturnType<typeof beatOutcome> | null,
): string {
  const opening = `${character} ${label} ${subject}.`;
  // The personality read is the interesting half: say plainly whose nature
  // made this land the way it did, so the narration can show it.
  const grain =
    delta > 0 && alignment >= 2
      ? ` This is exactly the sort of thing ${subject} admires, and it counts double with them.`
      : delta <= 0 && alignment <= -2
        ? ` ${subject} is not the sort of person who values this, and it grates on them rather than winning them over. Show that reaction, not gratitude.`
        : delta < 0 && alignment >= 2
          ? ` ${subject} is inclined to the same failing, so it stings less than it might.`
          : "";
  const landing =
    delta > 5
      ? `It lands hard in their favor.`
      : delta > 0
        ? `It lands, if quietly.`
        : delta === 0
          ? `${subject} has seen this from them before; it barely registers. Try something else.`
          : outcome === "miss"
            ? `It falls flat and ${subject} feels the awkwardness of it.`
            : `It costs them.`;
  const tier = friendshipTier(relationship.approval);
  return `${opening}${grain} ${landing} ${subject} now stands ${TIER_LABEL[tier]} toward ${character}${relationship.romance !== "none" ? ` (${ROMANCE_LABEL[relationship.romance]})` : ""}. Narrate exactly this much and no further step.`;
}

// ---- romance_advance ----

const advanceSchema = z.object({
  characterId: z.string(),
  subject: z.string().min(1).max(80),
  to: z.enum(["interested", "courting", "together", "betrothed", "married"]),
  note: z.string().max(200).optional(),
});

export function handleRomanceAdvance(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  if (!romanceEnabled(campaign)) {
    return { error: "Romance is switched off for this campaign." };
  }
  let args: z.infer<typeof advanceSchema>;
  try {
    args = advanceSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error:
        "Invalid arguments: romance_advance needs characterId, subject, and to (interested, courting, together, betrothed, or married).",
    };
  }
  const sheet = resolveActor(args, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const subject = resolveSubject(campaign, args.subject, sheets);
  if ("error" in subject) {
    return subject;
  }
  const relationship = openLedger(campaign, sheet, subject);
  if (relationship.status === "parted") {
    return {
      error: `${subject.name} is not with the party right now; bring them back into the scene before anything goes further.`,
    };
  }
  // One step per exchange, exactly like an NPC's attitude: no ratcheting a
  // stranger to married inside a single reply.
  if (relationship.lastShiftTurn === turn.id) {
    return {
      error: `${sheet.name} and ${subject.name} already took a step this exchange. Let the scene breathe before the next one.`,
    };
  }
  const verdict = canAdvanceRomance(
    relationship.romance,
    args.to,
    relationship.approval,
    relationship.status,
  );
  if (!verdict.ok) {
    const next = nextRomanceStage(relationship.romance);
    return {
      error: verdict.reason,
      approval: relationship.approval,
      standing: friendshipTier(relationship.approval),
      romance: relationship.romance,
      ...(next ? { nextStepNeedsApproval: ROMANCE_THRESHOLD[next] } : {}),
    };
  }

  const warmth = subject.personality?.warmth ?? 0;
  const consent = consentCheck(
    relationship.approval,
    args.to,
    warmth,
    rollExpression("1d20").total,
  );
  if (!consent.accepted) {
    const approval = applyApproval(relationship.approval, REFUSAL_COST);
    patchRelationship(relationship.id, {
      approval,
      lastShiftTurn: turn.id,
      memories: addMemory(relationship.memories, {
        kind: "refused",
        text: `${subject.name} was not ready when ${sheet.name} asked for ${args.to}`,
        at: new Date().toISOString(),
      }),
    });
    publishRelationshipsUpdated(campaign.id);
    return {
      ok: true,
      accepted: false,
      character: sheet.name,
      subject: subject.name,
      requested: args.to,
      romance: relationship.romance,
      approval,
      note: `${subject.name} does not take the step: they care, but not enough for ${args.to} yet. Narrate the gentle refusal in their own voice and leave things where they were. Do not narrate them agreeing anyway, and do not ask again this scene.`,
    };
  }

  const updated =
    patchRelationship(relationship.id, {
      romance: args.to,
      lastShiftTurn: turn.id,
      // Reaching a rung settles the meter at its floor when the feeling ran
      // ahead of the number, so the new stage never sits below its bar.
      approval: Math.max(relationship.approval, ROMANCE_THRESHOLD[args.to]),
      flags: addFlag(relationship.flags, args.to),
      memories: addMemory(relationship.memories, {
        kind: args.to,
        text: args.note?.trim() || defaultMilestoneText(sheet.name, subject.name, args.to),
        at: new Date().toISOString(),
      }),
    }) ?? relationship;

  recordMilestone(campaign, sheet, subject, args.to, args.note);
  publishRelationshipsUpdated(campaign.id);

  return {
    ok: true,
    accepted: true,
    ...(consent.automatic ? {} : { consentRoll: consent.total, consentDc: consent.dc }),
    character: sheet.name,
    subject: subject.name,
    romance: updated.romance,
    approval: updated.approval,
    note: `${subject.name} says yes. ${sheet.name} and ${subject.name} are now ${ROMANCE_LABEL[args.to]}. Narrate the moment from ${subject.name}'s own voice and feelings.${args.to === "married" || args.to === "betrothed" ? " The whole table knows; it is on the campaign record now." : ""}`,
  };
}

function defaultMilestoneText(character: string, subject: string, stage: RomanceStage): string {
  switch (stage) {
    case "interested":
      return `${character} and ${subject} felt something unspoken pass between them`;
    case "courting":
      return `${character} and ${subject} began openly courting`;
    case "together":
      return `${character} and ${subject} became partners`;
    case "betrothed":
      return `${character} and ${subject} were betrothed`;
    case "married":
      return `${character} and ${subject} were married`;
    default:
      return `${character} and ${subject} grew closer`;
  }
}

// The lasting rungs belong to the campaign's own record, not just the
// relationship row: a marriage is world state every later prompt should see.
function recordMilestone(
  campaign: Campaign,
  sheet: CharacterSheet,
  subject: Subject,
  stage: RomanceStage,
  note?: string,
) {
  const summary = note?.trim()
    ? `${defaultMilestoneText(sheet.name, subject.name, stage)}: ${note.trim()}`
    : defaultMilestoneText(sheet.name, subject.name, stage);
  recordRelationshipEvent(campaign, sheet, summary);
  if (romanceIndex(stage) >= romanceIndex("betrothed")) {
    insertFact({
      campaignId: campaign.id,
      category: "party",
      subject: `${sheet.name} and ${subject.name}`,
      fact: `${summary}.`,
      knownBy: "party",
      // Vows are not the kind of fact a later chapter quietly supersedes.
      pinned: true,
      source: "manual",
    });
  }
  // Someone who has taken a real step with a character is not indifferent to
  // the party any more.
  if (subject.npc && romanceIndex(stage) >= romanceIndex("courting")) {
    if (subject.npc.attitude !== "friendly") {
      setNpcAttitude(subject.npc.id, "friendly", "");
    }
  }
}

// ---- relationship_end ----

const endSchema = z.object({
  characterId: z.string(),
  subject: z.string().min(1).max(80),
  reason: z.enum(END_REASONS),
  note: z.string().max(200).optional(),
});

export function handleRelationshipEnd(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  if (!relationshipsEnabled(campaign)) {
    return { error: "Relationship tracking is switched off for this campaign." };
  }
  let args: z.infer<typeof endSchema>;
  try {
    args = endSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error:
        "Invalid arguments: relationship_end needs characterId, subject, and reason (falling_out, parting, breakup, betrayal, or death).",
    };
  }
  const sheet = resolveActor(args, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const subject = resolveSubject(campaign, args.subject, sheets);
  if ("error" in subject) {
    return subject;
  }
  const relationship = getRelationship(campaign.id, sheet.id, subject.name);
  if (!relationship) {
    return { error: `No tracked relationship between ${sheet.name} and ${args.subject}.` };
  }

  // A parting leaves everything intact: they are still what they were, just
  // out of reach, and the chapter pass will pull them back into the story.
  const parting = args.reason === "parting";
  const cost =
    args.reason === "betrayal" ? -30 : args.reason === "falling_out" ? -20 : args.reason === "breakup" ? -12 : 0;
  const approval = parting ? relationship.approval : applyApproval(relationship.approval, cost);
  const updated =
    patchRelationship(relationship.id, {
      status: parting ? "parted" : "ended",
      approval,
      romance: parting ? relationship.romance : demoteRomance(relationship.romance, approval),
      apartChapters: 0,
      memories: addMemory(relationship.memories, {
        kind: args.reason,
        text: args.note?.trim() || endText(sheet.name, subject.name, args.reason),
        at: new Date().toISOString(),
      }),
    }) ?? relationship;

  recordRelationshipEvent(
    campaign,
    sheet,
    args.note?.trim() || endText(sheet.name, subject.name, args.reason),
  );
  publishRelationshipsUpdated(campaign.id);

  return {
    ok: true,
    character: sheet.name,
    subject: subject.name,
    reason: args.reason,
    status: updated.status,
    approval: updated.approval,
    standing: friendshipTier(updated.approval),
    note: parting
      ? `${sheet.name} and ${subject.name} are parted, not finished: what they are to each other stands, and ${subject.name} will feel the distance as chapters pass. Narrate the farewell.`
      : `${sheet.name} and ${subject.name} are over (${args.reason}). Narrate it, and treat it as done: ${subject.name} does not simply come back around.`,
  };
}

function endText(character: string, subject: string, reason: (typeof END_REASONS)[number]): string {
  switch (reason) {
    case "falling_out":
      return `${character} and ${subject} fell out for good`;
    case "breakup":
      return `${character} and ${subject} ended their romance`;
    case "betrayal":
      return `${character} and ${subject} were broken apart by a betrayal`;
    case "death":
      return `${subject}, who mattered to ${character}, died`;
    default:
      return `${character} and ${subject} parted ways on good terms`;
  }
}

// ---- prompt roster ----

// The GAME STATE block's relationship lines: active and parted bonds that
// have actually moved (an untouched neutral meter says nothing worth the
// tokens). Bounded so a large cast cannot crowd the block out.
export function relationshipRosterForPrompt(campaignId: string): string[] {
  return listRelationships(campaignId)
    .filter(
      (relationship) =>
        relationship.status !== "ended" &&
        (relationship.approval !== 0 || relationship.romance !== "none"),
    )
    .slice(0, 14)
    .map((relationship) => relationshipFragment(relationship));
}
