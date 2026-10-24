import { z } from "zod";
import { dmRoll } from "@/lib/dm/roll-card";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import {
  getRelationship,
  listRelationships,
  patchRelationship,
  type Relationship,
} from "@/lib/db/relationships";
import {
  addFlag,
  addMemory,
  applyApproval,
  beatDc,
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
  ROMANCE_LABEL,
  ROMANCE_THRESHOLD,
  TIER_LABEL,
  romanceIndex,
  type RelationshipBeat,
  type SouredLeaving,
} from "@/lib/dm/relationship-logic";
import {
  defaultMilestoneText,
  openLedger,
  publishRelationshipsUpdated,
  recordMilestone,
  recordRelationshipEvent,
  resolveActor,
  resolveSubject,
} from "@/lib/dm/relationship-subject";
import { handleNpcAdvance } from "@/lib/dm/npc-advance";
import { conscienceNotes, landBeat, settleUnrecordedDeeds, type DeedOptions, type Landing } from "@/lib/dm/beat-landing";
import { DEED_KINDS, DEED_SEVERITIES, deedSeverity, isDeedKind, valueLabel } from "@/lib/dm/companion-values-logic";
import { MAX_DEADLINE_HOURS } from "@/lib/dm/conscience-logic";
import { getActiveEncounter } from "@/lib/db/encounters";
import { actNote, outwardApproval } from "@/lib/dm/scheme-logic";
import { revealAct, runningAct, schemesPossible, schemeTool } from "@/lib/dm/scheme-tools";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { resolveRollExpression, unknownSheetRef } from "@/lib/dm/rolls";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import type { RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export { publishRelationshipsUpdated };

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
  // An NPC's act toward a character (issue 501, src/lib/dm/scheme-tools.ts).
  "relationship_scheme",
] as const;

const END_REASONS = ["falling_out", "parting", "breakup", "betrayal", "death"] as const;

export function relationshipsEnabled(campaign: Campaign): boolean {
  return campaign.gameSettings.relationships !== "off";
}

export function romanceEnabled(campaign: Campaign): boolean {
  return relationshipsEnabled(campaign) && campaign.gameSettings.romance !== "off";
}

// `inEncounter`: a fight offers relationship_beat for deeds alone (issue
// 503): most executions happen mid-fight, and the rest waits for it to end.
export function relationshipTools(campaign: Campaign, inEncounter = false): ToolDef[] {
  if (!relationshipsEnabled(campaign)) {
    return [];
  }
  const romance = romanceEnabled(campaign) && !inEncounter;
  const beats = inEncounter
    ? [...DEED_KINDS]
    : romance
      ? RELATIONSHIP_BEAT_NAMES
      : RELATIONSHIP_BEAT_NAMES.filter((beat) => beatSpec(beat)?.track !== "romantic");
  const beatTool: ToolDef = {
    type: "function",
    function: {
      name: "relationship_beat",
      description: inEncounter
        ? "Mid-fight, record a deed a tracked NPC or AI companion saw (a prisoner executed, a foe spared). Call it BEFORE narrating their reaction."
        : "Record one moment that changed how a tracked NPC or AI companion feels about a character, moving the server's approval meter for that pair, when the relationship rules call for it. Charming overtures roll that character's real Persuasion or Performance; deeds simply count. The subject must already exist: set_npc or npc_reaction for an NPC, add_companion for a companion. Call it BEFORE narrating their reaction; narrate exactly what it reports.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The character whose conduct this is: exact characterId from GAME STATE." },
          subject: {
            type: "string",
            description: "Exact name of the tracked NPC or AI companion who witnessed it.",
          },
          beat: {
            type: "string",
            enum: [...beats],
            description: inEncounter
              ? "The deed."
              : "What happened (which beats earn regard and which cost it: the relationship rules)." +
                (romance
                  ? " Romantic: flirt (how a courtship opens), compliment, grand_gesture, intimacy (partners only; always narrate as a fade to black)."
                  : ""),
          },
          note: {
            type: "string",
            description: "One short line on what actually happened, for the relationship's memory.",
          },
          witnesses: { type: "array", items: { type: "string" }, description: "Deeds only: everyone else tracked who saw it, by exact name." },
          severity: { type: "string", enum: [...DEED_SEVERITIES], description: "Deeds only. Default serious." },
          faction: { type: "string", description: "Deeds only: the faction whose people it was done to or for." },
          demand: {
            type: "string",
            description: "Deeds only: what a companion at a warning demands if this brings an ultimatum, in their words.",
          },
          deadlineHours: { type: "integer", minimum: 1, maximum: MAX_DEADLINE_HOURS, description: "Deeds only: hours the demand gives (24)." },
        },
        required: ["characterId", "subject", "beat"],
      },
    },
  };
  // Mid-fight the leanest set that records a deed: who saw it and how
  // grave; a demand set there takes its default.
  if (inEncounter) {
    const properties = beatTool.function.parameters.properties as Record<string, unknown>;
    delete properties.faction;
    delete properties.demand;
    delete properties.deadlineHours;
  }
  if (inEncounter) {
    return [beatTool];
  }
  const tools: ToolDef[] = [
    beatTool,
    {
      type: "function",
      function: {
        name: "relationship_end",
        description:
          "Record a relationship changing for good, for a reason the relationship rules give ('parting' is also the ally who stays behind while the party travels on), or 'breakup' or 'betrayal' when a romance ends badly. Every reason but 'parting' closes the book. Call it BEFORE narrating the goodbye.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string", description: "The character on this side of it: exact characterId from GAME STATE." },
            subject: { type: "string", description: "Exact name of the NPC or companion." },
            reason: { type: "string", enum: [...END_REASONS], description: "How it ends." },
            by: {
              type: "string",
              enum: ["character", "npc"],
              description: "betrayal only: who betrayed whom. character (the default): the character betrayed them, and it costs their regard. npc: they betrayed the character; their regard stays what it truly was, and an act they kept up comes out.",
            },
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
          "Take a romance one step further: interested (a quiet, unspoken pull), courting (declared out loud), together (partners), betrothed (a proposal), married (wed). Call it BEFORE narrating how it goes. After the checks the romance rules describe, the server decides whether they accept, rolling when it is genuinely uncertain. One step per exchange. With initiator npc it is the NPC's own first move toward a character open to advances, allowed only when a director note says they are ready: the character's player answers it.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            characterId: { type: "string", description: "The player character in it: exact characterId from GAME STATE." },
            subject: { type: "string", description: "Exact name of the NPC or companion." },
            to: {
              type: "string",
              enum: ["interested", "courting", "together", "betrothed", "married"],
              description: "The next rung only; the server refuses a skipped step. An NPC's move is always courting.",
            },
            initiator: {
              type: "string",
              enum: ["player", "npc"],
              description: "Who makes the move: player (the default) or npc (their first move, when a director note says they are ready).",
            },
            note: {
              type: "string",
              description:
                "One short line describing the moment, kept in the relationship's memory ('proposed on the bridge at Highmoor'); with initiator npc, their own words to the character.",
            },
          },
          required: ["characterId", "subject", "to"],
        },
      },
    });
    // An NPC's act (issue 501): offered only where a character is open to
    // advances, the only kind of character an act may be aimed at.
    if (schemesPossible(campaign)) {
      tools.splice(2, 0, schemeTool);
    }
  }
  return tools;
}

// ---- relationship_beat ----

const beatSchema = z.object({
  characterId: z.string(),
  subject: z.string().min(1).max(80),
  beat: z.string().min(1).max(40),
  note: z.string().max(200).optional(),
  witnesses: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  severity: z.enum(DEED_SEVERITIES).optional(),
  faction: z.string().trim().max(80).optional(),
  demand: z.string().trim().max(160).optional(),
  deadlineHours: z.number().int().min(1).max(MAX_DEADLINE_HOURS).optional(),
});

export function handleRelationshipBeat(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  if (!relationshipsEnabled(campaign)) {
    return { error: "Relationship tracking is switched off for this campaign.", retry: true };
  }
  let args: z.infer<typeof beatSchema>;
  try {
    args = beatSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: relationship_beat needs characterId, subject, and beat.",
      retry: true,
    };
  }
  const spec = beatSpec(args.beat);
  if (!spec) {
    return {
      error: `Unknown beat "${args.beat}". Use one of: ${RELATIONSHIP_BEAT_NAMES.join(", ")}.`,
      retry: true,
    };
  }
  if (spec.track === "romantic" && !romanceEnabled(campaign)) {
    return { error: "Romance is switched off for this campaign; only social beats apply.", retry: true };
  }
  const deedKind = isDeedKind(args.beat);
  if (!deedKind && getActiveEncounter(campaign.id)) {
    return {
      error: `Mid-fight only deeds are recorded (${DEED_KINDS.join(", ")}); ${args.beat} waits until the fight is over.`,
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
  if (textKey(subject.name) === textKey(sheet.name)) {
    return { error: "A character cannot have a relationship with themselves.", retry: true };
  }

  const relationship = openLedger(campaign, sheet, subject);
  if (relationship.status === "ended") {
    return {
      error: `${sheet.name} and ${subject.name} are finished. Nothing changes that without the story reopening it first.`,
      refused: "rules",
    };
  }
  if (spec.minRomance && romanceIndex(relationship.romance) < romanceIndex(spec.minRomance)) {
    return {
      error: `${args.beat} is not where they are: that belongs to ${ROMANCE_LABEL[spec.minRomance]} and they are at ${ROMANCE_LABEL[relationship.romance]}. Use romance_advance first, if the meter supports it.`,
      retry: true,
    };
  }

  // A charming overture is an attempt, so the dice decide how it lands; a
  // deed has already happened and simply counts.
  let outcome: ReturnType<typeof beatOutcome> | null = null;
  let rollTotal: number | null = null;
  let dc: number | null = null;
  if (spec.skill) {
    // Held carriers and lasting effects ride the check, and the carrier is
    // spent by it.
    const resolved = resolveRollExpression(
      { kind: "skill_check", skill: spec.skill } as unknown as RollArgs,
      sheet,
      rollExtrasFor(campaign, sheet, "skill_check"),
    );
    if ("error" in resolved || "autoFail" in resolved) {
      return "error" in resolved ? resolved : { error: `${sheet.name} cannot make that check.`, refused: "rules" };
    }
    spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
    // An NPC keeping up an act takes a charm as the warmth they show would
    // (src/lib/dm/scheme-logic.ts): every outward rule reads the act.
    dc = beatDc(outwardApproval(relationship));
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

  // A deed counts with everyone it names as a witness, each weighed by who
  // they are (src/lib/dm/beat-landing.ts); any other beat with its subject.
  const deed: DeedOptions | null = deedKind
    ? {
        severity: deedSeverity(args.beat, args.severity),
        faction: args.faction ?? "",
        demand: args.demand ?? "",
        hours: args.deadlineHours,
      }
    : null;
  const beat = args.beat as RelationshipBeat;
  const landing = landBeat(campaign, turn, sheet, subject, relationship, beat, outcome, args.note, deed);
  const others = deedKind ? landWitnesses(campaign, turn, sheet, subject, args.witnesses ?? [], sheets, beat, args.note, deed!) : null;
  if (deedKind) {
    settleUnrecordedDeeds(campaign.id, sheet);
  }
  publishRelationshipsUpdated(campaign.id);

  const { updated, delta, alignment } = landing;
  const tier = friendshipTier(updated.approval);
  const notes = [
    buildBeatNote(sheet.name, subject.name, spec.label, delta, alignment, updated, outcome),
    ...(others?.landed.map((other) => `${other.subject.name} saw it too: ${TIER_LABEL[friendshipTier(other.updated.approval)]} toward ${sheet.name} now.`) ?? []),
    ...conscienceNotes([landing, ...(others?.landed ?? [])]),
    ...(others?.unknown.length ? [`Not tracked, so they keep no memory of it: ${others.unknown.join(", ")}. Register someone who matters with set_npc first.`] : []),
  ];
  return {
    ok: true,
    character: sheet.name,
    subject: subject.name,
    beat: args.beat,
    ...(deed ? { severity: deed.severity } : {}),
    ...(spec.skill ? { skill: spec.skill, roll: rollTotal, dc, outcome } : {}),
    approvalChange: delta,
    approval: updated.approval,
    standing: tier,
    ...(alignment !== 0
      ? { suitsThem: alignment > 0 ? "yes" : "no", alignment }
      : {}),
    ...valuesResult(landing),
    ...(landing.conscience ? { conscience: `${landing.conscience.from} -> ${landing.conscience.to}` } : {}),
    ...(landing.departure?.departed ? { departed: landing.departure.how } : landing.departure?.turned ? { turned: landing.departure.how } : {}),
    ...(updated.romance !== "none" ? { romance: updated.romance } : {}),
    ...(updated.romance !== relationship.romance
      ? { romanceSlipped: `${relationship.romance} -> ${updated.romance}` }
      : {}),
    ...(others?.landed.length
      ? {
          witnesses: others.landed.map((other) => ({
            subject: other.subject.name,
            approvalChange: other.delta,
            standing: friendshipTier(other.updated.approval),
            ...valuesResult(other),
            ...(other.conscience ? { conscience: `${other.conscience.from} -> ${other.conscience.to}` } : {}),
            ...(other.departure?.departed ? { departed: other.departure.how } : other.departure?.turned ? { turned: other.departure.how } : {}),
          })),
        }
      : {}),
    note: notes.join(" "),
    ...actResult(subject.name, sheet.name, updated),
  };
}

// What a companion's values made of it, for the result: which they saw
// honoured and which broken.
function valuesResult(landing: Landing): Record<string, string[]> {
  if (!landing.values || (!landing.values.honoured.length && !landing.values.broken.length)) {
    return {};
  }
  return {
    ...(landing.values.honoured.length ? { honours: landing.values.honoured.map(valueLabel) } : {}),
    ...(landing.values.broken.length ? { breaks: landing.values.broken.map(valueLabel) } : {}),
  };
}

// A deed's other witnesses, each landed on in turn. A name nobody tracks is
// listed back rather than failing the deed, which has already happened.
function landWitnesses(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  subject: { name: string },
  names: readonly string[],
  sheets: CharacterSheet[],
  beat: RelationshipBeat,
  note: string | undefined,
  deed: DeedOptions,
): { landed: Landing[]; unknown: string[] } {
  const seen = new Set([textKey(sheet.name), textKey(subject.name)]);
  const landed: Landing[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    if (seen.has(textKey(name))) {
      continue;
    }
    seen.add(textKey(name));
    const witness = resolveSubject(campaign, name, sheets);
    if ("error" in witness) {
      // Another player's character keeps their own counsel; anyone else is
      // simply not tracked.
      if (!sheets.some((candidate) => !candidate.isCompanion && textKey(candidate.name) === textKey(name))) {
        unknown.push(name);
      }
      continue;
    }
    const ledger = openLedger(campaign, sheet, witness);
    if (ledger.status === "ended") {
      continue;
    }
    landed.push(landBeat(campaign, turn, sheet, witness, ledger, beat, null, note, deed));
  }
  return { landed, unknown };
}

// While an NPC keeps up an act, a tool result says so plainly beside the
// true meter it reports: the AI plays the act, and must know it is one.
function actResult(subjectName: string, characterName: string, relationship: Relationship): { act?: string } {
  const act = runningAct(relationship);
  return act ? { act: actNote(subjectName, characterName, act) } : {};
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
  // An NPC's move names no rung of its own: it is always the step to courting.
  to: z.enum(["interested", "courting", "together", "betrothed", "married"]).optional(),
  initiator: z.enum(["player", "npc"]).default("player"),
  note: z.string().max(200).optional(),
});

export function handleRomanceAdvance(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  if (!romanceEnabled(campaign)) {
    return { error: "Romance is switched off for this campaign.", retry: true };
  }
  let args: z.infer<typeof advanceSchema>;
  try {
    args = advanceSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error:
        "Invalid arguments: romance_advance needs characterId, subject, and to (interested, courting, together, betrothed, or married).",
      retry: true,
    };
  }
  // The NPC's own first move (issue 501): an offer the player answers.
  if (args.initiator === "npc") {
    return handleNpcAdvance(campaign, turn, args, sheets, sheetsById);
  }
  if (!args.to) {
    return {
      error: "Invalid arguments: romance_advance needs to (interested, courting, together, betrothed, or married).",
      retry: true,
    };
  }
  const to = args.to;
  const sheet = resolveActor(args, sheets, sheetsById);
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  const subject = resolveSubject(campaign, args.subject, sheets);
  if ("error" in subject) {
    return subject;
  }
  const relationship = openLedger(campaign, sheet, subject);
  if (relationship.status === "parted") {
    return {
      error: `${subject.name} is not with the party right now; bring them back into the scene before anything goes further.`,
      refused: "rules",
    };
  }
  // One step per exchange, exactly like an NPC's attitude: no ratcheting a
  // stranger to married inside a single reply.
  if (relationship.lastShiftTurn === turn.id) {
    return {
      error: `${sheet.name} and ${subject.name} already took a step this exchange. Let the scene breathe before the next one.`,
      retry: true,
    };
  }
  // An act is played to the letter: the step reads the warmth shown.
  const shown = outwardApproval(relationship);
  const act = runningAct(relationship);
  const verdict = canAdvanceRomance(
    relationship.romance,
    to,
    shown,
    relationship.status,
  );
  if (!verdict.ok) {
    const next = nextRomanceStage(relationship.romance);
    return {
      ...toolError(verdict),
      approval: relationship.approval,
      standing: friendshipTier(relationship.approval),
      romance: relationship.romance,
      ...(next ? { nextStepNeedsApproval: ROMANCE_THRESHOLD[next] } : {}),
      ...actResult(subject.name, sheet.name, relationship),
    };
  }

  const warmth = subject.personality?.warmth ?? 0;
  const consent = consentCheck(
    shown,
    to,
    warmth,
    // The NPC's own mind: the DM sees the die, the table the answer.
    dmRoll(campaign.id, null, "custom", `${subject.name}: whether they agree`, "1d20").total,
  );
  if (!consent.accepted) {
    const approval = applyApproval(relationship.approval, REFUSAL_COST);
    patchRelationship(relationship.id, {
      approval,
      lastShiftTurn: turn.id,
      memories: addMemory(relationship.memories, {
        kind: "refused",
        text: `${subject.name} was not ready when ${sheet.name} asked for ${to}`,
        at: new Date().toISOString(),
      }),
    });
    publishRelationshipsUpdated(campaign.id);
    return {
      ok: true,
      accepted: false,
      character: sheet.name,
      subject: subject.name,
      requested: to,
      romance: relationship.romance,
      approval,
      note: `${subject.name} does not take the step: they care, but not enough for ${to} yet. Narrate the gentle refusal in their own voice and leave things where they were. Do not narrate them agreeing anyway, and do not ask again this scene.`,
    };
  }

  const updated =
    patchRelationship(relationship.id, {
      romance: to,
      lastShiftTurn: turn.id,
      // Reaching a rung settles the meter at its floor when the feeling ran
      // ahead of the number, so the new stage never sits below its bar. An
      // act settles the warmth it shows, never what they truly feel.
      ...(act
        ? { pretense: { ...act, shown: Math.max(act.shown, ROMANCE_THRESHOLD[to]) } }
        : { approval: Math.max(relationship.approval, ROMANCE_THRESHOLD[to]) }),
      flags: addFlag(relationship.flags, to),
      memories: addMemory(relationship.memories, {
        kind: to,
        text: args.note?.trim() || defaultMilestoneText(sheet.name, subject.name, to),
        at: new Date().toISOString(),
      }),
    }) ?? relationship;

  recordMilestone(campaign, sheet, subject, to, args.note);
  publishRelationshipsUpdated(campaign.id);

  return {
    ok: true,
    accepted: true,
    ...(consent.automatic ? {} : { consentRoll: consent.total, consentDc: consent.dc }),
    character: sheet.name,
    subject: subject.name,
    romance: updated.romance,
    approval: updated.approval,
    note: `${subject.name} says yes. ${sheet.name} and ${subject.name} are now ${ROMANCE_LABEL[to]}. Narrate the moment from ${subject.name}'s own voice and feelings.${to === "married" || to === "betrothed" ? " The whole table knows; it is on the campaign record now." : ""}`,
    ...actResult(subject.name, sheet.name, updated),
  };
}

// ---- relationship_end ----

const endSchema = z.object({
  characterId: z.string(),
  subject: z.string().min(1).max(80),
  reason: z.enum(END_REASONS),
  // betrayal only: who betrayed whom (issue 501). Today's betrayal is the
  // character's, which costs the NPC's regard; one by the NPC does not.
  by: z.enum(["character", "npc"]).optional(),
  note: z.string().max(200).optional(),
});

export function handleRelationshipEnd(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  if (!relationshipsEnabled(campaign)) {
    return { error: "Relationship tracking is switched off for this campaign.", retry: true };
  }
  let args: z.infer<typeof endSchema>;
  try {
    args = endSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error:
        "Invalid arguments: relationship_end needs characterId, subject, and reason (falling_out, parting, breakup, betrayal, or death).",
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
  const found = getRelationship(campaign.id, sheet.id, subject.name);
  if (!found) {
    return { error: `No tracked relationship between ${sheet.name} and ${args.subject}.`, retry: true };
  }
  if (args.by === "npc" && args.reason !== "betrayal") {
    return { error: `by npc is for a betrayal only: ${subject.name} betraying ${sheet.name}. Leave by out for ${args.reason}.`, retry: true };
  }
  // The NPC betrayed the character: an act they kept up comes out first, to
  // the whole table, and their regard stays what it truly was.
  const byNpc = args.by === "npc";
  const relationship = byNpc && runningAct(found) ? revealAct(campaign, sheet, found) : found;

  // A parting leaves everything intact: they are still what they were, just
  // out of reach, and the chapter pass will pull them back into the story.
  const parting = args.reason === "parting";
  const cost = byNpc
    ? 0
    : args.reason === "betrayal" ? -30 : args.reason === "falling_out" ? -20 : args.reason === "breakup" ? -12 : 0;
  const approval = parting ? relationship.approval : applyApproval(relationship.approval, cost);
  const updated =
    patchRelationship(relationship.id, {
      status: parting ? "parted" : "ended",
      approval,
      romance: parting ? relationship.romance : demoteRomance(relationship.romance, approval),
      apartChapters: 0,
      memories: addMemory(relationship.memories, {
        kind: args.reason,
        text: args.note?.trim() || endText(sheet.name, subject.name, args.reason, byNpc),
        at: new Date().toISOString(),
      }),
    }) ?? relationship;

  recordRelationshipEvent(
    campaign,
    sheet,
    args.note?.trim() || endText(sheet.name, subject.name, args.reason, byNpc),
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
    ...(byNpc ? { by: "npc" } : {}),
    note: parting
      ? `${sheet.name} and ${subject.name} are parted, not finished: what they are to each other stands, and ${subject.name} will feel the distance as chapters pass. Narrate the farewell.`
      : byNpc
        ? `${subject.name} betrayed ${sheet.name}, and they are over. ${subject.name}'s regard stays what it truly was${relationship.pretense?.revealed ? ", and the whole table now sees it: the warmth was an act" : ""}. Narrate it, and treat it as done.`
        : `${sheet.name} and ${subject.name} are over (${args.reason}). Narrate it, and treat it as done: ${subject.name} does not simply come back around.`,
    ...actResult(subject.name, sheet.name, updated),
  };
}

function endText(character: string, subject: string, reason: (typeof END_REASONS)[number], byNpc = false): string {
  if (byNpc) {
    return `${subject} betrayed ${character}`;
  }
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
// tokens). Bounded so a large cast cannot crowd the block out. The AI reads
// the true meter (an act is named in the storyteller's section,
// src/lib/dm/scheme-tools.ts); a prompt whose answer goes to the table
// (`storyteller: false`) reads the warmth an act shows instead.
// `leaving`: who removes a soured companion at this table (its companion
// conscience, src/lib/dm/conscience.ts souredLeaving).
export function relationshipRosterForPrompt(
  campaignId: string,
  options: { storyteller?: boolean; leaving?: SouredLeaving } = {},
): string[] {
  const storyteller = options.storyteller !== false;
  return listRelationships(campaignId)
    .map((relationship) => (storyteller ? relationship : { ...relationship, approval: outwardApproval(relationship) }))
    .filter(
      (relationship) =>
        relationship.status !== "ended" &&
        (relationship.approval !== 0 || relationship.romance !== "none"),
    )
    .slice(0, 14)
    .map((relationship) => relationshipFragment(relationship, options.leaving));
}
