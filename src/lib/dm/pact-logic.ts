// Pacts (issue 503 Phases 5 and 7), the pure half: companions who waver
// looking for others who feel the same, what a pact plans and when it acts,
// how the party can find out, and what a player who is approached may do.
// No DB access and no "@/" imports, so scripts/test-pacts.mjs loads it
// directly. The rim is src/lib/dm/pacts.ts (recruiting, tells, the
// storyteller's lines), src/lib/dm/pact-fire.ts (the plan going off) and
// src/lib/dm/pact-players.ts (a player approached, secret actions).
//
// The shape of it, from the issue:
//   - recruiting runs where companions could talk unobserved, the night watch
//     of a long rest and the road, once per long rest per wavering companion
//     (uneasy or worse): the recruiter's Persuasion or Deception, rolled where
//     no player sees it, against a DC set by the target's regard for the party
//     and eased by the values they share. A success adds the target to the
//     recruiter's pact and moves it one rung down its ladder;
//   - a pact holds its members, a plan (leave together, a harmless sabotage
//     first, or at a Turn table strike together), the moment it goes, and a
//     leader: the member with the most drive;
//   - it goes when one of its companions reaches the breaking point, or two
//     stand at a warning or worse together;
//   - it is a storyteller secret (src/lib/dm/viewer.ts) until it goes or is
//     caught: a character's passive Insight that beats a member's Deception
//     is whispered to that character's player alone.

import { friendshipTier, type FriendshipTier } from "./relationship-logic.ts";
import type { CompanionValue } from "./companion-values-logic.ts";
import type { NpcPersonality } from "./npc-logic.ts";
import type { ConscienceSetting } from "../schemas/game-settings-options.ts";
import { compareNames, textKey } from "../language/text-logic.ts";

// ---- recruiting ----

// The DC to turn a companion, by its regard for the party: one still
// devoted is nearly impossible to turn, one already wary is easy.
export const RECRUIT_DC: Record<FriendshipTier, number> = {
  hostile: 5,
  disliked: 8,
  wary: 10,
  neutral: 13,
  cordial: 15,
  friendly: 18,
  close: 22,
  devoted: 28,
};

// Each value the two hold in common: offended by the same deeds.
export const SHARED_VALUE_EASE = 2;
export const MIN_RECRUIT_DC = 5;

// A recruiter works on its best chance while that is a fair one; past it, a
// player who said pacts may approach them is the likelier ally.
export const FAIR_RECRUIT_DC = 15;

// One recruiting moves the recruited one rung down, never past a warning (an
// ultimatum is the party's to answer, not a recruiter's to set).
export const RECRUIT_STEP_CAP = 2;

const BREAKING_RUNG = 4;
const WARNING_RUNG = 2;

// The values two companions hold in common; a faction's loyalty counts only
// for the same faction.
export function sharedValues(a: readonly CompanionValue[], b: readonly CompanionValue[]): number {
  return a.filter((held) =>
    b.some((other) => other.value === held.value && (held.value !== "faction_loyalty" || textKey(other.faction) === textKey(held.faction))),
  ).length;
}

// A companion's regard for the party: the mean of its standing with each
// player character. Null when it has dealt with none yet (read as neutral).
export function partyRegard(approvals: readonly number[]): number | null {
  if (!approvals.length) {
    return null;
  }
  return Math.round(approvals.reduce((sum, value) => sum + value, 0) / approvals.length);
}

export function recruitDc(regard: number | null, shared: number): number {
  const base = RECRUIT_DC[friendshipTier(regard ?? 0)];
  return Math.max(MIN_RECRUIT_DC, base - SHARED_VALUE_EASE * Math.max(0, Math.round(shared)));
}

// Whether a companion on this rung recruits at all: uneasy or worse.
export function wavering(rung: number): boolean {
  return rung >= 1;
}

// Once per long rest. The waking time between two long rests is one round,
// named by the instant the earlier rest ended (-1 before a companion's first
// rest); the night watch of a long rest opens the round that rest begins.
// An attempt is allowed when the recruiter has made none in this round.
export function recruitRound(lastLongRestEnd: number | null | undefined): number {
  return typeof lastLongRestEnd === "number" && Number.isFinite(lastLongRestEnd) ? lastLongRestEnd : -1;
}

export function attemptAllowed(triedInRound: number | null, round: number): boolean {
  return triedInRound !== round;
}

// How it recruits follows who it is: a bold companion with little composure
// argues openly at the campfire, where the party hears it; any other works
// in private.
export type RecruitStyle = "open" | "secret";

export function recruitStyle(personality: NpcPersonality | null): RecruitStyle {
  return personality && personality.boldness >= 1 && personality.composure <= 0 ? "open" : "secret";
}

// An open argument is honest (Persuasion); a private one uses the better.
export function recruitSkill(style: RecruitStyle, mods: { persuasion: number; deception: number }): { skill: "persuasion" | "deception"; mod: number } {
  if (style === "open" || mods.persuasion >= mods.deception) {
    return { skill: "persuasion", mod: mods.persuasion };
  }
  return { skill: "deception", mod: mods.deception };
}

// The rung a recruited companion is moved to: one down from where it
// stands, held at a warning.
export function recruitedRung(held: number, standing: number): number {
  const now = Math.max(held, standing);
  return Math.max(held, Math.min(RECRUIT_STEP_CAP, now + 1));
}

// ---- the pact ----

export const PACT_PLANS = ["leave", "sabotage", "strike"] as const;
export type PactPlan = (typeof PACT_PLANS)[number];

// The harmless tactics a class is good at (the issue's section 8). The ones
// that harm (poison, a spell on the watch) wait for a Turn table and are a
// player's secret action, not a companion's plan.
export const PACT_TACTICS = ["theft", "false_trail", "denounce"] as const;
export type PactTactic = (typeof PACT_TACTICS)[number];

export function tacticFor(classId: string): PactTactic | null {
  switch (textKey(classId)) {
    case "rogue":
      return "theft";
    case "ranger":
      return "false_trail";
    case "cleric":
    case "paladin":
    case "bard":
      return "denounce";
    default:
      return null;
  }
}

// When the plan goes: the night watch of a long rest, the road (a false
// trail), or the leader's own turn in a fight (a strike).
export type PactTrigger = "night_watch" | "road" | "fight";

export type PactHook = "long_rest" | "travel" | "own_turn";

export type PactOdds = "against" | "even" | "good";

// The leader's nature picks the plan: at a Turn table a pact that would win
// a fight against the party, and is not timid, strikes together; a driven or
// composed leader with a tactic to hand sabotages first; any other leaves
// together.
export function choosePlan(input: {
  leader: NpcPersonality | null;
  tactics: readonly (PactTactic | null)[];
  odds: PactOdds;
  setting: ConscienceSetting;
}): { plan: PactPlan; tactic: PactTactic | null } {
  const p = input.leader ?? { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 };
  if (input.setting === "turn" && input.odds === "good" && p.boldness >= 0) {
    return { plan: "strike", tactic: null };
  }
  const tactic = PACT_TACTICS.find((option) => input.tactics.includes(option)) ?? null;
  if (tactic && (p.drive >= 1 || p.composure >= 1)) {
    return { plan: "sabotage", tactic };
  }
  return { plan: "leave", tactic: null };
}

export function triggerFor(plan: PactPlan, tactic: PactTactic | null): PactTrigger {
  if (plan === "strike") {
    return "fight";
  }
  return plan === "sabotage" && tactic === "false_trail" ? "road" : "night_watch";
}

// Whether the plan goes at this moment: its own trigger, and for a strike
// the night watch too (turning on the party as it sleeps, the way a lone
// companion bides and strikes).
export function firesAt(plan: PactPlan, trigger: PactTrigger, hook: PactHook): boolean {
  if (hook === "own_turn") {
    return trigger === "fight";
  }
  if (hook === "travel") {
    return trigger === "road";
  }
  return trigger === "night_watch" || plan === "strike";
}

// A pact is ready when one of its companions has reached the breaking point,
// or two stand at a warning or worse together.
export function pactReady(rungs: readonly number[]): boolean {
  return rungs.some((rung) => rung >= BREAKING_RUNG) || rungs.filter((rung) => rung >= WARNING_RUNG).length >= 2;
}

// The member with the most drive leads; then the boldest; then by name, so
// the same pact always has the same leader.
export function pickLeader<T extends { name: string; personality: NpcPersonality | null }>(members: readonly T[]): T | null {
  const drive = (member: T) => member.personality?.drive ?? 0;
  const boldness = (member: T) => member.personality?.boldness ?? 0;
  return [...members].sort((a, b) => drive(b) - drive(a) || boldness(b) - boldness(a) || compareNames(a.name, b.name))[0] ?? null;
}

// ---- finding out ----

// A passive score against a check (the hider's total meets or beats it to
// stay hidden): true when the watcher notices.
export function notices(passive: number, total: number): boolean {
  return passive > total;
}

// ---- players in a pact (Phase 7) ----

export const APPROACH_TOOL = "pact_approach";

export const APPROACH_CHOICES = ["join", "play_along", "report", "refuse"] as const;
export type ApproachChoice = (typeof APPROACH_CHOICES)[number];

export const APPROACH_CHOICE_TEXT: Record<ApproachChoice, { label: string; hint: string }> = {
  join: { label: "Join them", hint: "Your character goes with the pact when its plan goes." },
  play_along: { label: "Play along", hint: "Pretend to join and watch them. They may see through you." },
  report: { label: "Tell the party", hint: "Everyone learns of the pact, and it has to act now." },
  refuse: { label: "Refuse", hint: "Say no and keep it to yourself." },
};

// What a pact's approach stores (item_proposals.args_json).
export type ApproachArgs = {
  pactId: string;
  recruiter: string;
  portraitUrl: string;
  look: { gender: string; race: string; class: string };
};

export function approachArgs(argsJson: string): ApproachArgs | null {
  try {
    const parsed = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    if (typeof parsed.pactId !== "string") {
      return null;
    }
    const look = parsed.look && typeof parsed.look === "object" ? (parsed.look as Record<string, unknown>) : {};
    return {
      pactId: parsed.pactId,
      recruiter: str(parsed.recruiter, 80),
      portraitUrl: str(parsed.portraitUrl, 400),
      look: { gender: str(look.gender, 40), race: str(look.race, 40), class: str(look.class, 40) },
    };
  } catch {
    return null;
  }
}

export function isApproachChoice(value: unknown): value is ApproachChoice {
  return typeof value === "string" && (APPROACH_CHOICES as readonly string[]).includes(value);
}

// Player pacts need a table that lets companions leave (Leave or Turn), and
// another player to betray: a solo campaign never offers one.
export function playerPactProblem(setting: ConscienceSetting, players: number): string | null {
  if (setting !== "leave" && setting !== "turn") {
    return "Pacts form only where companions may leave the party (Companion conscience: Leave or Turn).";
  }
  if (players < 2) {
    return "A solo campaign has no other player to betray, so pacts never approach a player.";
  }
  return null;
}

// Secret actions a player in a pact may take. Theft and a quiet scheme cause
// no harm and need Leave; harming the party, or attacking another player's
// character when the plan goes, needs Turn.
export const SECRET_KINDS = ["steal", "scheme", "harm", "attack"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export const SECRET_SKILLS = ["stealth", "sleight_of_hand", "deception"] as const;
export type SecretSkill = (typeof SECRET_SKILLS)[number];

export function secretKindProblem(setting: ConscienceSetting, kind: SecretKind): string | null {
  if (setting !== "leave" && setting !== "turn") {
    return "This table keeps its companions, so no pact acts.";
  }
  if ((kind === "harm" || kind === "attack") && setting !== "turn") {
    return kind === "attack"
      ? "Attacking another player's character needs a table set to Turn; this one is set to Leave."
      : "Sabotage that harms needs a table set to Turn; this one allows only harmless sabotage.";
  }
  return null;
}

// What each kind rolls, hidden, and what the watch notices it with.
export function secretSkillFor(kind: SecretKind, chosen: SecretSkill | undefined): SecretSkill {
  if (kind === "steal") {
    return "sleight_of_hand";
  }
  return chosen ?? (kind === "attack" ? "stealth" : "deception");
}

export function watchSenseFor(skill: SecretSkill): "perception" | "insight" {
  return skill === "deception" ? "insight" : "perception";
}

// ---- the record ----

export type CompanionMember = { kind: "companion"; npcId: string; name: string; sheetId: string };
export type PlayerMember = { kind: "player"; characterId: string; name: string; userId: string; stance: "joined" | "spy" };
export type PactMember = CompanionMember | PlayerMember;

export type SecretAction = {
  id: string;
  characterId: string;
  name: string;
  kind: SecretKind;
  // In the player's own words.
  text: string;
  skill: SecretSkill;
  rollId: string;
  total: number;
  // The best the watch had against it when it was rolled.
  watch: number;
  caught: boolean;
  revealed: boolean;
  targetId: string;
  targetName: string;
  item: string;
  // A stolen line as it left its owner's pack (JSON), held until it comes
  // out and reaches the thief.
  itemJson: string;
  at: number;
};

export type PactStatus = "forming" | "fired" | "broken";

export type Pact = {
  id: string;
  campaignId: string;
  leaderNpcId: string;
  members: PactMember[];
  plan: PactPlan;
  tactic: PactTactic | null;
  trigger: PactTrigger;
  status: PactStatus;
  // Characters a member has approached (one approach each), who refused,
  // and who a tell was whispered to (once each).
  approached: string[];
  refusedBy: string[];
  toldTo: string[];
  // Out in the open: reported, caught, or gone.
  exposed: boolean;
  secrets: SecretAction[];
  createdAt: number;
  firedAt: number | null;
  // What the table saw when it went, in the server's words.
  how: string;
};

const str = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);

export function parseMembers(raw: string): PactMember[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown[];
    return (Array.isArray(parsed) ? parsed : []).flatMap((entry): PactMember[] => {
      const row = (entry ?? {}) as Record<string, unknown>;
      if (row.kind === "companion" && typeof row.npcId === "string") {
        return [{ kind: "companion", npcId: row.npcId, name: str(row.name, 80), sheetId: str(row.sheetId, 80) }];
      }
      if (row.kind === "player" && typeof row.characterId === "string") {
        return [{ kind: "player", characterId: row.characterId, name: str(row.name, 80), userId: str(row.userId, 80), stance: row.stance === "spy" ? "spy" : "joined" }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function parseSecrets(raw: string): SecretAction[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown[];
    return (Array.isArray(parsed) ? parsed : []).flatMap((entry): SecretAction[] => {
      const row = (entry ?? {}) as Record<string, unknown>;
      if (typeof row.id !== "string" || !(SECRET_KINDS as readonly string[]).includes(String(row.kind))) {
        return [];
      }
      const skill = (SECRET_SKILLS as readonly string[]).includes(String(row.skill)) ? (row.skill as SecretSkill) : "deception";
      return [
        {
          id: row.id,
          characterId: str(row.characterId, 80),
          name: str(row.name, 80),
          kind: row.kind as SecretKind,
          text: str(row.text, 300),
          skill,
          rollId: str(row.rollId, 80),
          total: num(row.total),
          watch: num(row.watch),
          caught: row.caught === true,
          revealed: row.revealed === true,
          targetId: str(row.targetId, 80),
          targetName: str(row.targetName, 80),
          item: str(row.item, 120),
          itemJson: str(row.itemJson, 4000),
          at: num(row.at),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function companionMembers(pact: Pick<Pact, "members">): CompanionMember[] {
  return pact.members.filter((member): member is CompanionMember => member.kind === "companion");
}

export function playerMembers(pact: Pick<Pact, "members">): PlayerMember[] {
  return pact.members.filter((member): member is PlayerMember => member.kind === "player");
}

// ---- what the DM, the player and the table are told ----

export const PLAN_WORDS: Record<PactPlan, string> = {
  leave: "leave the party together",
  sabotage: "weaken the party, then leave together",
  strike: "turn on the party together",
};

export const TACTIC_WORDS: Record<PactTactic, string> = {
  theft: "steal the party's best thing in the night",
  false_trail: "lead the party off the road and slip away",
  denounce: "denounce the party to the power it answers to",
};

export const TRIGGER_WORDS: Record<PactTrigger, string> = {
  night_watch: "at the night watch of a long rest",
  road: "on the road",
  fight: "in a fight, on the leader's own turn (or as the party sleeps)",
};

export function planLine(pact: Pick<Pact, "plan" | "tactic" | "trigger">): string {
  const plan = pact.plan === "sabotage" && pact.tactic ? `${TACTIC_WORDS[pact.tactic]}, then leave together` : PLAN_WORDS[pact.plan];
  return `${plan}, ${TRIGGER_WORDS[pact.trigger]}`;
}

// The storyteller's line for a pact still forming (src/lib/dm/viewer.ts).
export function pactLine(pact: Pact, leaderName: string, ready: boolean): string {
  const companions = companionMembers(pact).map((member) => member.name);
  const players = playerMembers(pact).map((member) => (member.stance === "spy" ? `${member.name} (only playing along: a spy)` : member.name));
  const held = pact.secrets.filter((secret) => !secret.revealed);
  return [
    `- A pact: ${[...companions, ...players].join(", ")}, led by ${leaderName}, mean to ${planLine(pact)}.`,
    ready ? "It is ready: the server sets it off at that moment and tells you." : "It is not ready yet.",
    pact.refusedBy.length ? `Approached and refused: ${pact.refusedBy.join(", ")}.` : "",
    held.length ? `Secret actions held: ${held.map((secret) => `${secret.name}: ${secret.text}`).join("; ")}.` : "",
    "Foreshadow it (two who go quiet when someone walks up, who always take watch together); never say it, and nobody learns it but by the server's word.",
  ]
    .filter(Boolean)
    .join(" ");
}

// The card's line (owner-only), safe for a lock screen: no names but theirs.
export function approachSummary(characterName: string): string {
  return `A private offer for ${characterName}`;
}

export function approachWords(leaderName: string, pact: Pick<Pact, "plan" | "tactic" | "trigger">): string {
  return `${leaderName} takes you aside where nobody else can hear: the party has lost its way, and some of its companions mean to ${planLine(pact)}. Will you stand with them?`;
}

export function tellWhisper(observer: string, member: string): string {
  return `${observer} notices something about ${member}: a look held too long with another companion, talk that stops when ${observer} comes near. Something is being kept from the party. Only you noticed.`;
}

export function warnWhisper(target: string, recruiter: string, character: string): string {
  return `${target} finds ${character} alone: ${recruiter} tried to turn ${target} against the party tonight. ${target} said no, and wanted ${character} to know.`;
}

export function openArgumentLine(recruiter: string, target: string): string {
  return `${recruiter} argues at the fire, loud enough for everyone, that the party has lost its way, and presses ${target} to say so too.`;
}

// Marks the table's line when a pact or a secret action comes out: the
// transcript draws it as a reveal card (MessageParts.tsx), and the DM reads
// it as the server's word.
export const PACT_REVEAL_PREFIX = "[Revealed] ";

// The DM's line when a plan goes, in the moment part of GAME STATE.
export function firedNote(how: string): string {
  return `${how} The server did it; narrate it as it happened. Never call dismiss_companion for it.`;
}
