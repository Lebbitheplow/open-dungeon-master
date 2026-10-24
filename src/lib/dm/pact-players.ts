import { allocateSeq, campaignSeats, type Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { ItemProposal } from "@/lib/db/item-proposals";
import { listOpenItemProposals, resolveItemProposal } from "@/lib/db/item-proposals";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getPact, listFormingPacts, listPacts, pactOfCharacter, savePact } from "@/lib/db/pacts";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { computeSheetDerived } from "@/lib/srd";
import { lineNamed } from "@/lib/srd/item-row";
import { passiveScore } from "@/lib/dm/check-tools";
import { conscienceSetting } from "@/lib/dm/conscience";
import {
  APPROACH_TOOL,
  approachArgs,
  companionMembers,
  notices,
  PACT_REVEAL_PREFIX,
  planLine,
  playerMembers,
  secretKindProblem,
  secretSkillFor,
  watchSenseFor,
  type ApproachChoice,
  type Pact,
  type SecretAction,
  type SecretKind,
  type SecretSkill,
} from "@/lib/dm/pact-logic";
import { firePact } from "@/lib/dm/pact-fire";
import { takeItem } from "@/lib/dm/pact-fire";
import { replan } from "@/lib/dm/pacts";
import { publicItemProposal } from "@/lib/dm/proposal-view";
import { publishRelationshipsUpdated } from "@/lib/dm/relationship-subject";
import { revealRolls, secretRoll } from "@/lib/dm/roll-card";
import { isDmSeat } from "@/lib/dm/viewer";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Players in a pact (issue 503 Phase 7): the answer to a pact's approach,
// which is its player's alone; the secret actions a member takes, held by
// the server and rolled where nobody else sees, until the plan goes or
// someone catches them; and each player's own view of the pact they are in.
// The approach itself is made by src/lib/dm/pacts.ts, the plan going off by
// src/lib/dm/pact-fire.ts.

const SKILL_WORD: Record<SecretSkill, string> = { stealth: "Stealth", sleight_of_hand: "Sleight of Hand", deception: "Deception" };

function tableLine(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "system-party", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// ---- the answer ----

// Who settles a pact's approach: its own player answers; whoever runs the
// story may only withdraw it; nobody else may do either, the lead of an AI
// table included (it never reaches them).
export function canResolveApproach(action: "approve" | "decline" | "cancel", actorIsOwner: boolean, actorRunsTable: boolean): boolean {
  return action === "cancel" ? actorRunsTable : actorIsOwner;
}

export function runsTable(campaign: Campaign, userId: string): boolean {
  return isDmSeat(campaignSeats(campaign), userId);
}

// The player's answer, applied. Returns the outcome stored on the offer
// (seen only by the same seats) and nothing the table hears, unless the
// answer was to tell the party.
export function answerApproach(campaign: Campaign, proposal: ItemProposal, choice: ApproachChoice): string {
  const args = approachArgs(proposal.argsJson);
  const pact = args ? getPact(args.pactId) : null;
  const sheet = getSheetById(proposal.characterId);
  if (!pact || pact.status !== "forming" || !sheet) {
    return "the pact had already moved";
  }
  if (choice === "refuse") {
    savePact({ ...pact, refusedBy: [...new Set([...pact.refusedBy, sheet.name])] });
    return "refused";
  }
  if (choice === "report") {
    // Out in the open, the pact has to act now with whatever odds it has.
    firePact(campaign, "", pact, "scene", "reported", sheet.name);
    return "told the party";
  }
  const member = { kind: "player" as const, characterId: sheet.id, name: sheet.name, userId: sheet.userId, stance: choice === "play_along" ? ("spy" as const) : ("joined" as const) };
  const members = [...pact.members.filter((entry) => !(entry.kind === "player" && entry.characterId === sheet.id)), member];
  savePact(replan(campaign, { ...pact, members }));
  // A contentless ping: each seat reads back only what it may (the joiner,
  // their own pact on the Bonds tab).
  publishRelationshipsUpdated(campaign.id);
  return choice === "play_along" ? "playing along" : "joined";
}

// Switching "Pacts may approach me" off withdraws any approach still
// waiting on that character's answer, as quietly as it came.
export function closeApproachesToward(campaign: Campaign, characterId: string): number {
  let withdrawn = 0;
  for (const proposal of listOpenItemProposals(campaign.id)) {
    if (proposal.toolName === APPROACH_TOOL && proposal.characterId === characterId) {
      const resolved = resolveItemProposal(proposal.id, "cancelled", "consent withdrawn");
      if (resolved) {
        withdrawn += 1;
        publishPersisted(campaign.id, "item_proposal_resolved", { proposal: publicItemProposal(resolved) });
      }
    }
  }
  return withdrawn;
}

// ---- secret actions ----

export type SecretInput = {
  kind: SecretKind;
  text: string;
  skill?: SecretSkill;
  targetId?: string;
  item?: string;
};

export type SecretOutcome =
  | { ok: true; caught: false; confirmation: string; secret: OwnSecret }
  | { ok: true; caught: true; revealed: string; secret: OwnSecret }
  | { error: string; status: number };

const skillMod = (sheet: CharacterSheet, skill: string) => computeSheetDerived(sheet).skills[skill] ?? 0;

// A member of a pact acts in secret. The server holds it and rolls it where
// only its player and the storyteller see; the watch (the best passive score
// among the rest of the party, or the one robbed) may catch it, and then it
// is revealed on the spot. Otherwise it comes out when the plan goes.
export function declareSecretAction(campaign: Campaign, sheet: CharacterSheet, input: SecretInput): SecretOutcome {
  const setting = conscienceSetting(campaign);
  const ceiling = secretKindProblem(setting, input.kind);
  if (ceiling) {
    return { error: ceiling, status: 409 };
  }
  const pact = pactOfCharacter(campaign.id, sheet.id);
  if (!pact) {
    return { error: `${sheet.name} is in no pact, so has nothing to do in secret.`, status: 409 };
  }
  if (input.kind !== "attack" && getActiveEncounter(campaign.id)) {
    return { error: "A secret action waits until the fight is over.", status: 409 };
  }
  const text = input.text.trim().slice(0, 300);
  const sheets = listSheets(campaign.id);
  const inside = new Set([...companionMembers(pact).map((member) => member.sheetId), ...playerMembers(pact).map((member) => member.characterId)]);
  const party = sheets.filter((other) => !other.isCompanion && !other.summon && !inside.has(other.id) && other.currentHp > 0 && !other.deathSaves?.dead);
  const target = input.targetId ? sheets.find((other) => other.id === input.targetId && !other.summon) : undefined;
  if ((input.kind === "steal" || input.kind === "attack") && (!target || target.id === sheet.id)) {
    return { error: "Say whose character, another at this table.", status: 400 };
  }
  if (input.kind === "steal" && (!input.item?.trim() || lineNamed(target!.equipment, input.item) < 0)) {
    return { error: `${target!.name} carries nothing called "${input.item ?? ""}".`, status: 400 };
  }
  const skill = secretSkillFor(input.kind, input.skill);
  // The roll card names its character already; the detail says what it was.
  const roll = secretRoll(campaign.id, null, sheet.id, "skill_check", `${SKILL_WORD[skill]}, in secret`, d20Expression(skillMod(sheet, skill)));
  // The one robbed watches their own pack; anything else, the best of the
  // party's eyes (or, for a lie, its best sense of one).
  const sense = watchSenseFor(skill);
  const watchers = input.kind === "steal" ? [target!] : party;
  const watch = watchers.reduce<{ sheet: CharacterSheet; score: number } | null>((best, other) => {
    const score = passiveScore(campaign, other, sense);
    return !best || score > best.score ? { sheet: other, score } : best;
  }, null);
  const caught = input.kind !== "attack" && watch !== null && notices(watch.score, roll.total);
  const secret: SecretAction = {
    id: crypto.randomUUID(),
    characterId: sheet.id,
    name: sheet.name,
    kind: input.kind,
    text: text || defaultText(input.kind, target?.name ?? "", input.item ?? ""),
    skill,
    rollId: roll.rollId,
    total: roll.total,
    watch: watch?.score ?? 0,
    caught,
    revealed: caught,
    targetId: target?.id ?? "",
    targetName: target?.name ?? "",
    item: input.kind === "steal" ? (input.item ?? "").trim() : "",
    itemJson: "",
    at: getClock(campaign.id).instant,
  };
  if (caught) {
    revealRolls(campaign.id, [roll.rollId]);
    const line = `${PACT_REVEAL_PREFIX}${watch!.sheet.name} caught ${sheet.name} ${input.kind === "steal" ? `reaching for ${target!.name}'s ${secret.item}` : `in the act: ${secret.text}`}.`;
    tableLine(campaign, line);
    savePact({ ...pact, secrets: [...pact.secrets, secret] });
    publishRelationshipsUpdated(campaign.id);
    return { ok: true, caught: true, revealed: line.slice(PACT_REVEAL_PREFIX.length), secret: ownSecret(secret) };
  }
  if (input.kind === "steal") {
    // Theft moves inventory now: the thing leaves its owner's pack (they
    // will find it gone, not who took it) and is held until it comes out.
    const row = takeItem(campaign, target!, secret.item, `${secret.item} went missing`);
    secret.itemJson = row ? JSON.stringify(row) : "";
  }
  savePact({ ...pact, secrets: [...pact.secrets, secret] });
  return { ok: true, caught: false, confirmation: confirmationFor(secret), secret: ownSecret(secret) };
}

function defaultText(kind: SecretKind, target: string, item: string): string {
  switch (kind) {
    case "steal":
      return `take ${target}'s ${item}`;
    case "attack":
      return `strike at ${target} when the pact moves`;
    case "harm":
      return "do the party harm";
    case "scheme":
      return "work against the party";
  }
}

function confirmationFor(secret: SecretAction): string {
  const held = secret.kind === "attack" ? "It waits for the pact's move, in a fight." : "Nobody saw. It stays secret until the pact moves or someone catches on.";
  return `Done in secret: ${secret.text}. ${SKILL_WORD[secret.skill]} ${secret.total}. ${held}`;
}

// ---- each player's own view ----

export type OwnSecret = { id: string; kind: SecretKind; text: string; total: number; revealed: boolean; caught: boolean };

function ownSecret(secret: SecretAction): OwnSecret {
  return { id: secret.id, kind: secret.kind, text: secret.text, total: secret.total, revealed: secret.revealed, caught: secret.caught };
}

export type PactView = {
  id: string;
  characterId: string;
  characterName: string;
  stance: "joined" | "spy";
  members: string[];
  leader: string;
  plan: string;
  status: Pact["status"];
  secrets: OwnSecret[];
  // What this character may do in secret at this table.
  kinds: SecretKind[];
};

// The pacts a viewer's own characters are in: members, plan and moment,
// and that character's own secret actions, never another player's.
export function pactsForPlayer(campaign: Campaign, userId: string): PactView[] {
  const setting = conscienceSetting(campaign);
  const kinds = (["steal", "scheme", "harm", "attack"] as const).filter((kind) => !secretKindProblem(setting, kind));
  return listFormingPacts(campaign.id).flatMap((pact) =>
    playerMembers(pact)
      .filter((member) => member.userId === userId)
      .map((member) => viewOf(pact, member.characterId, member.name, member.stance, kinds)),
  );
}

// Every pact at the table, for a person running it.
export function pactsForStoryteller(campaign: Campaign): PactView[] {
  return listPacts(campaign.id).map((pact) => viewOf(pact, "", "", "joined", []));
}

function viewOf(pact: Pact, characterId: string, characterName: string, stance: "joined" | "spy", kinds: SecretKind[]): PactView {
  const leader = companionMembers(pact).find((member) => member.npcId === pact.leaderNpcId)?.name ?? "";
  return {
    id: pact.id,
    characterId,
    characterName,
    stance,
    members: pact.members.map((member) => member.name),
    leader,
    plan: planLine(pact),
    status: pact.status,
    secrets: pact.secrets.filter((secret) => !characterId || secret.characterId === characterId).map(ownSecret),
    kinds,
  };
}
