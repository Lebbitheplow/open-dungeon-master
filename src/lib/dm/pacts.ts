import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { companionConscience, companionValues, saveConscience } from "@/lib/db/companion-conscience";
import { companionDeparture, saveDeparture } from "@/lib/db/companion-departures";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { insertItemProposal } from "@/lib/db/item-proposals";
import { insertCampaignMessage } from "@/lib/db/messages";
import type { Npc } from "@/lib/db/npcs";
import { insertPact, listFormingPacts, markPactTried, pactOfCharacter, pactOfNpc, pactTriedAt, savePact } from "@/lib/db/pacts";
import { listRelationships } from "@/lib/db/relationships";
import { listSheets } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { computeSheetDerived } from "@/lib/srd";
import { passiveScore } from "@/lib/dm/check-tools";
import { sheetStatBlock, sheetVitals } from "@/lib/dm/companion-statblock";
import type { CompanionValue } from "@/lib/dm/companion-values-logic";
import { conscienceSetting, consciousCompanions, settleCompanion, worstApproval } from "@/lib/dm/conscience";
import { effectiveRung, standingRung } from "@/lib/dm/conscience-logic";
import { sideFitness, verdictFor } from "@/lib/dm/departure-logic";
import {
  APPROACH_TOOL,
  approachSummary,
  approachWords,
  attemptAllowed,
  choosePlan,
  companionMembers,
  FAIR_RECRUIT_DC,
  firesAt,
  notices,
  openArgumentLine,
  pactLine,
  pactReady,
  partyRegard,
  pickLeader,
  playerMembers,
  playerPactProblem,
  recruitDc,
  recruitRound,
  recruitedRung,
  recruitSkill,
  recruitStyle,
  sharedValues,
  tacticFor,
  tellWhisper,
  triggerFor,
  warnWhisper,
  wavering,
  type Pact,
  type PactHook,
  type PactMember,
  type PactOdds,
} from "@/lib/dm/pact-logic";
import { firePact } from "@/lib/dm/pact-fire";
import { publicItemProposal } from "@/lib/dm/proposal-view";
import { publishRelationshipsUpdated } from "@/lib/dm/relationship-subject";
import { friendshipTier, tierIndex } from "@/lib/dm/relationship-logic";
import { secretRoll } from "@/lib/dm/roll-card";
import { deliverWhisper } from "@/lib/dm/whispers";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { evaluateEncounter } from "@/lib/srd/encounter-math";
import { compareNames, textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Pacts (issue 503 Phases 5 and 7), the rim around src/lib/dm/pact-logic.ts:
// recruiting where companions talk unobserved (the night watch of a long
// rest, src/lib/dm/rest-tools.ts; the road, src/lib/dm/world-tools.ts), the
// tells that let a player in, a spy caught out, and the storyteller's lines.
// The plan going off is src/lib/dm/pact-fire.ts; a player approached and a
// player's secret actions are src/lib/dm/pact-players.ts.
//
// A pact is a storyteller secret (src/lib/dm/viewer.ts): every roll behind
// it is stored "secret" (src/lib/dm/roll-card.ts secretRoll), the AI reads
// it only in the storyteller's section of its prompt, and nothing a tool
// returns names it, since a console call's result is read by whoever made
// it. What the table sees is what the server says aloud: an argument at the
// fire, a rung moving, the plan going off.

export type PactCompanion = {
  sheet: CharacterSheet;
  npc: Npc;
  rung: number;
  values: CompanionValue[];
};

// Pacts form only where companions may leave (Leave or Turn).
export function pactsOn(campaign: Pick<Campaign, "gameSettings">): boolean {
  const setting = conscienceSetting(campaign);
  return setting === "leave" || setting === "turn";
}

const playerCharacters = (sheets: readonly CharacterSheet[]) => sheets.filter((sheet) => !sheet.isCompanion && !sheet.summon);
const standing = (sheet: CharacterSheet) => sheet.currentHp > 0 && !sheet.deathSaves?.dead;

// Whether a pact may approach a player here at all: a table that lets
// companions leave, another player to betray, and a lasting companion to
// do the approaching. The Bonds tab shows "Pacts may approach me" only
// where this holds (AGENTS.md rule 4).
export function playerPactsPossible(campaign: Pick<Campaign, "gameSettings">, sheets: readonly CharacterSheet[]): boolean {
  const players = new Set(playerCharacters(sheets).map((sheet) => sheet.userId)).size;
  return !playerPactProblem(conscienceSetting(campaign), players) && consciousCompanions(sheets).length > 0;
}

export function openToPactNames(campaign: Pick<Campaign, "gameSettings">, sheets: readonly CharacterSheet[]): string[] {
  return playerPactsPossible(campaign, sheets) ? playerCharacters(sheets).filter((sheet) => sheet.openToPacts).map((sheet) => sheet.name) : [];
}

// The lasting companions at the table, standing, with where each stands.
export function pactCompanions(campaign: Campaign, sheets: readonly CharacterSheet[]): PactCompanion[] {
  return consciousCompanions(sheets)
    .filter(standing)
    .flatMap((sheet) => {
      const npc = companionNpcFor(sheet);
      if (!npc || companionDeparture(npc.id).gone) {
        return [];
      }
      const rung = effectiveRung(companionConscience(npc.id), worstApproval(campaign.id, sheet.name, sheets));
      return [{ sheet, npc, rung, values: companionValues(npc.id) }];
    });
}

// A companion's regard for the party: its standing with each player
// character it travels with, on average.
function regardOf(campaignId: string, name: string, sheets: readonly CharacterSheet[]): number | null {
  const party = new Set(playerCharacters(sheets).map((sheet) => sheet.id));
  const key = textKey(name);
  return partyRegard(
    listRelationships(campaignId)
      .filter((row) => row.status === "active" && party.has(row.characterId) && textKey(row.subjectName) === key)
      .map((row) => row.approval),
  );
}

function approvalToward(campaignId: string, companionName: string, characterId: string): number | null {
  const key = textKey(companionName);
  return listRelationships(campaignId).find((row) => row.characterId === characterId && row.status === "active" && textKey(row.subjectName) === key)?.approval ?? null;
}

// The odds the pact reads together: every companion in it and every player
// who joined it, rated as one band of foes for the rest of the party,
// shifted by how whole each side is.
export function pactOdds(pact: Pact, sheets: readonly CharacterSheet[]): PactOdds {
  const ours = new Set([...companionMembers(pact).map((member) => member.sheetId), ...playerMembers(pact).filter((member) => member.stance === "joined").map((member) => member.characterId)]);
  const band = sheets.filter((sheet) => ours.has(sheet.id) && standing(sheet));
  const party = playerCharacters(sheets).filter((sheet) => !ours.has(sheet.id) && !sheet.deathSaves?.dead);
  if (!band.length) {
    return "against";
  }
  const base = evaluateEncounter(party.length ? party.map((sheet) => sheet.level) : [1], band.map((sheet) => sheetStatBlock(sheet, { open: true }).rating.cr));
  const shift = Math.max(0.1, sideFitness(band.map(sheetVitals))) / Math.max(0.1, sideFitness(party.map(sheetVitals)));
  const verdict = verdictFor(Math.round(base.adjustedXp * shift), base.thresholds);
  return verdict === "deadly" || verdict === "beyond_deadly" ? "good" : verdict === "hard" ? "even" : "against";
}

// The pact's leader, plan and moment, worked out again from who is in it.
export function replan(campaign: Campaign, pact: Pact, sheets: readonly CharacterSheet[] = listSheets(campaign.id)): Pact {
  const companions = pactCompanions(campaign, sheets).filter((entry) => companionMembers(pact).some((member) => member.npcId === entry.npc.id));
  const leader = pickLeader(companions.map((entry) => ({ ...entry, name: entry.sheet.name, personality: entry.npc.agency.personality })));
  if (!leader) {
    return pact;
  }
  const { plan, tactic } = choosePlan({
    leader: leader.npc.agency.personality,
    tactics: companions.map((entry) => tacticFor(entry.sheet.class)),
    odds: pactOdds(pact, sheets),
    setting: conscienceSetting(campaign),
  });
  return { ...pact, leaderNpcId: leader.npc.id, plan, tactic, trigger: triggerFor(plan, tactic) };
}

// A companion takes its place in a pact: any plan it held to go alone is
// dropped, since it goes with the pact now.
function joinPact(campaign: Campaign, pact: Pact | null, member: PactMember, founder: PactCompanion | null, sheets: readonly CharacterSheet[]): Pact {
  for (const entry of [member, ...(founder ? [{ kind: "companion" as const, npcId: founder.npc.id }] : [])]) {
    if (entry.kind === "companion") {
      const departure = companionDeparture(entry.npcId);
      if (departure.intent) {
        saveDeparture(entry.npcId, { ...departure, intent: null });
      }
    }
  }
  const now = getClock(campaign.id).instant;
  const base =
    pact ??
    insertPact({
      campaignId: campaign.id,
      leaderNpcId: founder?.npc.id ?? "",
      members: founder ? [{ kind: "companion", npcId: founder.npc.id, name: founder.sheet.name, sheetId: founder.sheet.id }] : [],
      plan: "leave",
      tactic: null,
      trigger: "night_watch",
      createdAt: now,
    });
  const members = base.members.some((entry) => sameMember(entry, member)) ? base.members : [...base.members, member];
  return savePact(replan(campaign, { ...base, members }, sheets));
}

function sameMember(a: PactMember, b: PactMember): boolean {
  return a.kind === "companion" && b.kind === "companion" ? a.npcId === b.npcId : a.kind === "player" && b.kind === "player" && a.characterId === b.characterId;
}

function tableLine(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "system-party", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

const skillMod = (sheet: CharacterSheet, skill: string) => computeSheetDerived(sheet).skills[skill] ?? 0;

// ---- the moments ----

export type PactMomentOptions = {
  // At a long rest: who rests (the 24-hour rule), and when this rest ends,
  // the round it opens (pact-logic.ts recruitRound).
  resting?: readonly string[];
  restEndsAt?: number;
};

// Where companions talk unobserved: a ready pact acts first, then each
// wavering companion may recruit, then the tells and a spy's cover are read.
// Returns what the table was told, for the tool's result (never a secret).
export function pactMoment(campaign: Campaign, turnId: string, hook: Exclude<PactHook, "own_turn">, options: PactMomentOptions = {}): string[] {
  if (!pactsOn(campaign)) {
    return [];
  }
  const lines: string[] = [];
  let sheets = listSheets(campaign.id);
  pruneMembers(campaign, sheets);
  for (const pact of listFormingPacts(campaign.id)) {
    if (readyAt(campaign, pact, sheets, hook)) {
      lines.push(...firePact(campaign, turnId, pact, hook === "travel" ? "road" : "night", "plan"));
    }
  }
  sheets = listSheets(campaign.id);
  const clock = getClock(campaign.id);
  const companions = pactCompanions(campaign, sheets);
  for (const recruiter of companions) {
    if (!wavering(recruiter.rung) || (hook === "long_rest" && options.resting && !options.resting.includes(recruiter.sheet.id))) {
      continue;
    }
    const round = hook === "long_rest" && options.restEndsAt !== undefined ? options.restEndsAt : recruitRound(clock.longRests?.[recruiter.sheet.id]);
    if (!attemptAllowed(pactTriedAt(recruiter.npc.id), round)) {
      continue;
    }
    const said = recruit(campaign, turnId, recruiter, companions, sheets);
    if (said !== null) {
      markPactTried(recruiter.npc.id, round);
      if (said) {
        lines.push(said);
      }
    }
  }
  sheets = listSheets(campaign.id);
  readTells(campaign, turnId, sheets);
  lines.push(...catchSpies(campaign, turnId, sheets));
  return lines;
}

// A pact acts at its moment once it is ready; a strike whose player means to
// attack waits for a fight, where that attack can land (Phase 6).
function readyAt(campaign: Campaign, pact: Pact, sheets: readonly CharacterSheet[], hook: PactHook): boolean {
  if (!firesAt(pact.plan, pact.trigger, hook)) {
    return false;
  }
  if (hook !== "own_turn" && pact.plan === "strike" && pact.secrets.some((secret) => secret.kind === "attack" && !secret.revealed)) {
    return false;
  }
  const ours = new Set(companionMembers(pact).map((member) => member.npcId));
  return pactReady(pactCompanions(campaign, sheets).filter((entry) => ours.has(entry.npc.id)).map((entry) => entry.rung));
}

// A companion who has been talked back to content leaves its pact; a pact
// with no companion left in it is over.
function pruneMembers(campaign: Campaign, sheets: readonly CharacterSheet[]) {
  const here = new Map(pactCompanions(campaign, sheets).map((entry) => [entry.npc.id, entry]));
  for (const pact of listFormingPacts(campaign.id)) {
    const members = pact.members.filter((member) => member.kind === "player" || (here.get(member.npcId)?.rung ?? 0) > 0);
    if (members.length === pact.members.length) {
      continue;
    }
    const left = { ...pact, members };
    savePact(companionMembers(left).length ? replan(campaign, left, sheets) : { ...left, status: "broken" });
  }
}

// One recruiting attempt: the companion it has the best chance with, while
// that chance is a fair one; else a player who said pacts may approach
// them; else the best chance anyway. Returns the table's line ("" when the
// table heard nothing), or null when there was nobody to try.
function recruit(campaign: Campaign, turnId: string, recruiter: PactCompanion, companions: readonly PactCompanion[], sheets: readonly CharacterSheet[]): string | null {
  const pact = pactOfNpc(campaign.id, recruiter.npc.id);
  const targets = companions
    .filter((entry) => entry.npc.id !== recruiter.npc.id && !pactOfNpc(campaign.id, entry.npc.id))
    .map((entry) => ({ entry, dc: recruitDc(regardOf(campaign.id, entry.sheet.name, sheets), sharedValues(recruiter.values, entry.values)) }))
    .sort((a, b) => a.dc - b.dc || compareNames(a.entry.sheet.name, b.entry.sheet.name));
  const best = targets[0] ?? null;
  const player = playerPactsPossible(campaign, sheets)
    ? playerCharacters(sheets).find(
        (sheet) =>
          sheet.openToPacts &&
          standing(sheet) &&
          !pactOfCharacter(campaign.id, sheet.id) &&
          !(pact?.approached ?? []).includes(sheet.id) &&
          tierIndex(friendshipTier(approvalToward(campaign.id, recruiter.sheet.name, sheet.id) ?? 0)) >= tierIndex("wary"),
      )
    : undefined;
  if (best && (best.dc <= FAIR_RECRUIT_DC || !player)) {
    return recruitCompanion(campaign, turnId, recruiter, best.entry, best.dc, pact, sheets);
  }
  if (player) {
    approach(campaign, turnId, recruiter, player, pact, sheets);
    return "";
  }
  return null;
}

function recruitCompanion(
  campaign: Campaign,
  turnId: string,
  recruiter: PactCompanion,
  target: PactCompanion,
  dc: number,
  pact: Pact | null,
  sheets: readonly CharacterSheet[],
): string {
  const style = recruitStyle(recruiter.npc.agency.personality);
  const { skill, mod } = recruitSkill(style, { persuasion: skillMod(recruiter.sheet, "persuasion"), deception: skillMod(recruiter.sheet, "deception") });
  const roll = secretRoll(campaign.id, null, null, "skill_check", `${recruiter.sheet.name}: ${skill === "persuasion" ? "Persuasion" : "Deception"} to turn ${target.sheet.name} (DC ${dc})`, d20Expression(mod), dc);
  if (roll.total >= dc) {
    joinPact(campaign, pact, { kind: "companion", npcId: target.npc.id, name: target.sheet.name, sheetId: target.sheet.id }, pact ? null : recruiter, sheets);
    const conscience = companionConscience(target.npc.id);
    const held = recruitedRung(conscience.held, standingRung(worstApproval(campaign.id, target.sheet.name, sheets)));
    if (held !== conscience.held) {
      saveConscience(target.npc.id, { ...conscience, held, cause: `talk with ${recruiter.sheet.name} by the fire` });
      settleCompanion(campaign, target.sheet, undefined, {}, sheets);
    }
    publishRelationshipsUpdated(campaign.id);
  } else if (style === "secret") {
    warnLoyal(campaign, turnId, recruiter, target, sheets);
  }
  if (style !== "open") {
    return "";
  }
  // An open argument is heard by everyone; whether it worked is not.
  const line = openArgumentLine(recruiter.sheet.name, target.sheet.name);
  tableLine(campaign, line);
  return line;
}

// A companion still close to a character, who is approached and refuses,
// warns that character in a private whisper.
function warnLoyal(campaign: Campaign, turnId: string, recruiter: PactCompanion, target: PactCompanion, sheets: readonly CharacterSheet[]) {
  const key = textKey(target.sheet.name);
  const party = new Map(playerCharacters(sheets).map((sheet) => [sheet.id, sheet]));
  const friend = listRelationships(campaign.id)
    .filter((row) => row.status === "active" && party.has(row.characterId) && textKey(row.subjectName) === key && tierIndex(friendshipTier(row.approval)) >= tierIndex("close"))
    .sort((a, b) => b.approval - a.approval)[0];
  const sheet = friend ? party.get(friend.characterId) : undefined;
  if (sheet) {
    deliverWhisper(campaign.id, turnId, [{ userId: sheet.userId, characterId: sheet.id, characterName: sheet.name }], warnWhisper(target.sheet.name, recruiter.sheet.name, sheet.name));
  }
}

// A pact approaches a player whose player said it may: an offer only they
// see and only they answer (src/lib/dm/pact-players.ts answerApproach).
function approach(campaign: Campaign, turnId: string, recruiter: PactCompanion, sheet: CharacterSheet, pact: Pact | null, sheets: readonly CharacterSheet[]) {
  const base = pact ?? joinPact(campaign, null, { kind: "companion", npcId: recruiter.npc.id, name: recruiter.sheet.name, sheetId: recruiter.sheet.id }, null, sheets);
  const saved = savePact({ ...base, approached: [...base.approached, sheet.id] });
  const leader = companionMembers(saved).find((member) => member.npcId === saved.leaderNpcId)?.name ?? recruiter.sheet.name;
  const proposal = insertItemProposal({
    campaignId: campaign.id,
    turnId: turnId || null,
    characterId: sheet.id,
    userId: sheet.userId,
    toolName: APPROACH_TOOL,
    argsJson: JSON.stringify({
      pactId: saved.id,
      recruiter: recruiter.sheet.name,
      portraitUrl: recruiter.sheet.portrait?.url ?? "",
      look: { gender: String(recruiter.sheet.gender ?? ""), race: recruiter.sheet.race, class: recruiter.sheet.class },
    }),
    summary: approachSummary(sheet.name),
    reason: approachWords(leader, saved),
    seq: allocateSeq(campaign.id),
    ownerOnly: true,
  });
  publishPersisted(campaign.id, "item_proposal_added", { proposal: publicItemProposal(proposal) });
}

// Each player character who spends time with a pact's companions reads them:
// passive Insight against a member's Deception, rolled where no player sees
// it. One who notices is told privately, once a pact.
function readTells(campaign: Campaign, turnId: string, sheets: readonly CharacterSheet[]) {
  const live = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  for (const pact of listFormingPacts(campaign.id)) {
    const inside = new Set(playerMembers(pact).map((member) => member.characterId));
    const watchers = playerCharacters(sheets).filter((sheet) => standing(sheet) && !inside.has(sheet.id) && !pact.toldTo.includes(sheet.id));
    const told: string[] = [];
    for (const member of companionMembers(pact)) {
      const companion = live.get(member.sheetId);
      if (!companion || !watchers.length) {
        continue;
      }
      const roll = secretRoll(campaign.id, null, null, "skill_check", `${companion.name}: Deception, keeping the pact hidden`, d20Expression(skillMod(companion, "deception")));
      for (const watcher of watchers.filter((sheet) => !told.includes(sheet.id))) {
        if (notices(passiveScore(campaign, watcher, "insight"), roll.total)) {
          told.push(watcher.id);
          deliverWhisper(campaign.id, turnId, [{ userId: watcher.userId, characterId: watcher.id, characterName: watcher.name }], tellWhisper(watcher.name, companion.name));
        }
      }
    }
    if (told.length) {
      savePact({ ...pact, toldTo: [...pact.toldTo, ...told] });
    }
  }
}

// A player only playing along is read by the pact's leader from time to
// time: the leader's passive Insight against the player's Deception. A pact
// that catches a spy acts at once.
function catchSpies(campaign: Campaign, turnId: string, sheets: readonly CharacterSheet[]): string[] {
  const live = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const lines: string[] = [];
  for (const pact of listFormingPacts(campaign.id)) {
    const leader = live.get(companionMembers(pact).find((member) => member.npcId === pact.leaderNpcId)?.sheetId ?? "");
    if (!leader) {
      continue;
    }
    for (const spy of playerMembers(pact).filter((member) => member.stance === "spy")) {
      const sheet = live.get(spy.characterId);
      if (!sheet) {
        continue;
      }
      const roll = secretRoll(campaign.id, null, null, "skill_check", `${sheet.name}: Deception, playing along with the pact`, d20Expression(skillMod(sheet, "deception")));
      if (notices(passiveScore(campaign, leader, "insight"), roll.total)) {
        lines.push(...firePact(campaign, turnId, pact, "scene", "caught"));
        break;
      }
    }
  }
  return lines;
}

// ---- the storyteller's section ----

// Every pact still forming, who may be approached, and how to play it: only
// in the section tagged STORYTELLER_SECRET (src/lib/dm/prompt.ts), so the
// lead of an AI table never reads it in the Context tab and an
// out-of-character answer leaves it out.
export function pactLinesForPrompt(campaign: Campaign, sheets: readonly CharacterSheet[]): string[] {
  if (!pactsOn(campaign)) {
    return [];
  }
  const lines: string[] = [];
  const open = openToPactNames(campaign, sheets);
  if (open.length) {
    lines.push(`- Pacts may approach (each player's private choice; never mention it at the table): ${open.join(", ")}. Only the server makes an approach.`);
  }
  const companions = pactCompanions(campaign, sheets);
  for (const pact of listFormingPacts(campaign.id)) {
    const ours = new Set(companionMembers(pact).map((member) => member.npcId));
    const leader = companionMembers(pact).find((member) => member.npcId === pact.leaderNpcId)?.name ?? "one of them";
    lines.push(pactLine(pact, leader, pactReady(companions.filter((entry) => ours.has(entry.npc.id)).map((entry) => entry.rung))));
  }
  return lines;
}

// A fight's own turn: a pact whose plan is to strike together goes on its
// leader's turn, once it is ready (Phase 6 puts its members on the foes'
// side). Returns what the DM is told.
export function pactsAtOwnTurn(campaign: Campaign, leaderSheetId: string): string[] {
  if (!pactsOn(campaign) || conscienceSetting(getCampaignById(campaign.id) ?? campaign) !== "turn") {
    return [];
  }
  const sheets = listSheets(campaign.id);
  const lines: string[] = [];
  for (const pact of listFormingPacts(campaign.id)) {
    const leader = companionMembers(pact).find((member) => member.npcId === pact.leaderNpcId);
    if (leader?.sheetId === leaderSheetId && readyAt(campaign, pact, sheets, "own_turn")) {
      lines.push(...firePact(campaign, "", pact, "fight", "plan"));
    }
  }
  return lines;
}
