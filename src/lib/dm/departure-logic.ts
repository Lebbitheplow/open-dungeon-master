// A lasting companion leaving the party (issue 503 Phases 2 and 3), the pure
// half: what a companion at its breaking point does, decided by who it is
// and the odds; when a plan it holds finds its opening; and, once it has
// gone, the shape of its return. The rim is src/lib/dm/departure.ts (the
// leaving) and src/lib/dm/companion-revenge.ts (the return); the record is
// kept on the row behind the companion (src/lib/db/companion-departures.ts).
//
// The response is the server's, never the AI's: the AI narrates what the
// server reports. Five responses, from the issue:
//   - confront: bold and rash, it turns on the party now, whatever the odds;
//   - walk out: timid, it leaves at once, openly;
//   - slip away: composed and outmatched, it waits for an opening (its own
//     turn in a fight, or the night watch at a long rest) and goes;
//   - bide and strike: composed with the odds on its side, it waits for the
//     party to be weak at one of those openings, then turns;
//   - report: dutiful with a faction to answer to, it leaves and tells them,
//     and the party's standing there falls.
// The table's setting caps it: Leave never fights (confront walks out
// loudly, bide and strike slips away); Turn allows all five. One that turns
// fights the party where it stands, its own sheet on the foes' side
// (src/lib/dm/turncoat.ts); only when no fight can be staged does it leave as
// a foe and come back with help.
//
// Pure, with relative imports only, so scripts/test-departure.mjs loads it
// directly.

import { encounterCeiling, evaluateEncounter, type EncounterVerdict, type XpThresholds } from "../srd/encounter-math.ts";
import type { CampaignDifficulty } from "../campaign-types.ts";
import type { CompanionValue, CompanionValueId } from "./companion-values-logic.ts";
import type { NpcPersonality } from "./npc-logic.ts";
import { parseWear, type Wear } from "./return-wear-logic.ts";

export const DEPARTURE_RESPONSES = ["confront", "walk_out", "slip_away", "bide_strike", "report"] as const;
export type DepartureResponse = (typeof DEPARTURE_RESPONSES)[number];

// The two that wait for an opening; the rest act at once.
export type IntentResponse = Extract<DepartureResponse, "slip_away" | "bide_strike">;

export function waitsForOpening(response: DepartureResponse): response is IntentResponse {
  return response === "slip_away" || response === "bide_strike";
}

// A response that ends with the companion set against the party: it comes
// back to fight whatever its standing.
export function turnsOnParty(response: DepartureResponse): boolean {
  return response === "confront" || response === "bide_strike";
}

// ---- the odds ----

export type Odds = "against" | "even" | "good";

// How whole one side is, 0.1 to 1: hit points left, and for a caster the
// slots left beside them. A side that has spent itself is a weaker side.
export type Vitals = { hp: number; maxHp: number; slotsLeft: number; slotsMax: number };

export function memberFitness(vitals: Vitals): number {
  const hp = vitals.maxHp > 0 ? Math.max(0, Math.min(1, vitals.hp / vitals.maxHp)) : 0;
  if (vitals.slotsMax <= 0) {
    return hp;
  }
  const slots = Math.max(0, Math.min(1, vitals.slotsLeft / vitals.slotsMax));
  return hp * 0.6 + slots * 0.4;
}

export function sideFitness(members: readonly Vitals[]): number {
  if (!members.length) {
    return 1;
  }
  const mean = members.reduce((sum, member) => sum + memberFitness(member), 0) / members.length;
  return Math.max(0.1, Math.min(1, mean));
}

// The DMG's bands for an adjusted XP against a party's thresholds, the same
// cut evaluateEncounter makes.
export function verdictFor(adjustedXp: number, thresholds: XpThresholds): EncounterVerdict {
  if (adjustedXp < thresholds.easy / 2) {
    return "trivial";
  }
  if (adjustedXp < thresholds.medium) {
    return "easy";
  }
  if (adjustedXp < thresholds.hard) {
    return "medium";
  }
  if (adjustedXp < thresholds.deadly) {
    return "hard";
  }
  return adjustedXp <= thresholds.deadly * 1.5 ? "deadly" : "beyond_deadly";
}

export type OddsReading = { verdict: EncounterVerdict; odds: Odds; adjustedXp: number; shiftedXp: number };

// The companion rated as a foe for the party: how hard a fight against it
// alone would be for them (evaluateEncounter), shifted by how whole each
// side is. A deadly fight for the party is good odds for the companion; a
// hard one is even; anything easier is against it.
export function readOdds(partyLevels: readonly number[], companionCr: number, partyFitness: number, companionFitness: number): OddsReading {
  const base = evaluateEncounter([...partyLevels], [companionCr]);
  const shift = Math.max(0.1, Math.min(1, companionFitness)) / Math.max(0.1, Math.min(1, partyFitness));
  const shiftedXp = Math.round(base.adjustedXp * shift);
  const verdict = verdictFor(shiftedXp, base.thresholds);
  const odds: Odds = verdict === "deadly" || verdict === "beyond_deadly" ? "good" : verdict === "hard" ? "even" : "against";
  return { verdict, odds, adjustedXp: base.adjustedXp, shiftedXp };
}

// ---- the rating's two adjustments (the issue's numbers) ----

const CR_STEPS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, index) => index + 1)];

// A challenge rating moved `rows` steps along the table (1/8, 1/4, 1/2, 1,
// 2...), clamped to it.
export function stepCr(cr: number, rows: number): number {
  let index = CR_STEPS.findIndex((step) => step >= cr);
  if (index < 0) {
    index = CR_STEPS.length - 1;
  }
  return CR_STEPS[Math.max(0, Math.min(CR_STEPS.length - 1, index + Math.round(rows)))];
}

// Healing, buffs and control do not show up as damage: a cleric, druid or
// bard adds a step from level 5 and two from 11; a paladin one from 6, for
// its aura. The best a character's classes give, never summed.
export function supportHandicap(classLevels: Readonly<Record<string, number>>): number {
  let best = 0;
  for (const [classId, level] of Object.entries(classLevels)) {
    const id = classId.toLowerCase();
    if (id === "cleric" || id === "druid" || id === "bard") {
      best = Math.max(best, level >= 11 ? 2 : level >= 5 ? 1 : 0);
    } else if (id === "paladin") {
      best = Math.max(best, level >= 6 ? 1 : 0);
    }
  }
  return best;
}

// ---- the response ----

export type ResponseInput = {
  personality: NpcPersonality | null;
  values: readonly CompanionValue[];
  odds: Odds;
  // Leave or Turn: the tables where companions leave at all.
  setting: "leave" | "turn";
  // A faction it would report to exists (its loyalty's, or the power that
  // keeps the law where the party goes).
  canReport: boolean;
};

const holds = (values: readonly CompanionValue[], value: CompanionValueId) => values.some((held) => held.value === value);

// Who the companion is, read once: a ruthless companion is the readier to
// fight, a mercenary never fights a battle it is not sure of.
export function chooseResponse(input: ResponseInput): DepartureResponse {
  const p = input.personality ?? { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 };
  const boldness = p.boldness + (holds(input.values, "ruthless") ? 1 : 0);
  const mercenary = holds(input.values, "mercenary");
  const rash = boldness >= 2 && p.composure <= 0 && !(mercenary && input.odds !== "good");
  const dutiful = p.diligence >= 2 && input.canReport && (holds(input.values, "faction_loyalty") || holds(input.values, "respects_law"));
  let response: DepartureResponse;
  if (rash) {
    response = "confront";
  } else if (dutiful) {
    response = "report";
  } else if (p.boldness <= -1) {
    response = "walk_out";
  } else if (p.composure >= 1) {
    response = input.odds === "good" ? "bide_strike" : "slip_away";
  } else if (input.odds === "good" && boldness >= 1 && !mercenary) {
    response = "confront";
  } else {
    response = "walk_out";
  }
  return allowedResponse(response, input.setting);
}

// What a table that never lets companions fight makes of a response that
// would: a confrontation walks out loudly, a plan to strike slips away.
export function allowedResponse(response: DepartureResponse, setting: "leave" | "turn"): DepartureResponse {
  if (setting === "turn") {
    return response;
  }
  return response === "confront" ? "walk_out" : response === "bide_strike" ? "slip_away" : response;
}

// ---- openings ----

export type OpeningHook = "own_turn" | "long_rest";

// Whether a held plan acts at this hook: slipping away takes any moment the
// party is not watching (its own turn in a fight, the night watch); biding
// to strike waits for one when the odds have turned its way.
export function opensAt(response: IntentResponse, odds: Odds): boolean {
  return response === "slip_away" || odds === "good";
}

// ---- what the table sees ----

export type DepartureWhere = "fight" | "night" | "scene";

// The public face of a departure: what the party saw, for the table's line
// and the Gone list. Never the plan it held before it went.
export function departureHow(response: DepartureResponse, where: DepartureWhere, faction = ""): string {
  switch (response) {
    case "walk_out":
      return "Walked out on the party";
    case "slip_away":
      return where === "fight" ? "Broke off from the fight and fled the field" : where === "night" ? "Slipped away in the night" : "Slipped away";
    case "report":
      return faction ? `Left to report the party to ${faction}` : "Left to report the party";
    case "confront":
      return "Turned on the party and left to raise a force against them";
    case "bide_strike":
      return where === "night" ? "Turned on the party in the night, and left to return with help" : "Turned on the party at its weakest, and left to return with help";
  }
}

// What the table is told as a companion turns on the party where it stands.
export function turnHow(response: DepartureResponse, where: DepartureWhere): string {
  if (response === "bide_strike") {
    return where === "night" ? "Turned on the party in the night" : "Turned on the party at its weakest";
  }
  return "Turned on the party";
}

// What the DM is told the plan is, in the storyteller's section, so it can
// foreshadow it without ever saying it.
export const INTENT_WORDS: Record<IntentResponse, string> = {
  slip_away: "means to slip away at the first moment the party is not watching (its own turn in a fight, or the night watch)",
  bide_strike: "means to turn on the party the moment it is weak enough to beat (its own turn in a fight, or the night watch)",
};

// ---- the record ----

export type DepartureIntent = { response: IntentResponse; at: number; cause: string };

export type ReturnKind = "fight" | "parley";

export type Gone = {
  response: DepartureResponse;
  how: string;
  // The clock when they went, and the faction they told, if any.
  at: number;
  reportedTo: string;
  hostile: boolean;
  // The level and experience they left at, and what the party earned since
  // (shadow levelling, applied when the sheet is taken up again).
  leftLevel: number;
  xpSince: number;
  // Whether they went to gather help, and how far that has got.
  avenging: boolean;
  rumours: number;
  // The return, once its goal is done: fight or parley, the prepared fight
  // and the DM-only calendar event that cue it, and whether it has run. A
  // `standoff` is a parley forced on one who still hates the party because
  // they alone are past what the table's difficulty lets start_encounter
  // stage (a solo character against an equal): they come to face the party
  // in words.
  cued: ReturnKind | null;
  standoff: boolean;
  // How a return that would be past the ceiling whole comes worn
  // (return-wear-logic.ts), and why, in words for the DM. Null when whole.
  wear: Wear | null;
  wornBy: string;
  templateId: string;
  eventId: string;
  returned: boolean;
};

// A companion that turned on the party where it stood (Phase 6, a Turn
// table): on the foes' side of the fight until it is over, its own sheet
// still at the table (src/lib/dm/turncoat.ts).
export type Turned = { response: DepartureResponse; at: number };

export type Departure = { intent: DepartureIntent | null; gone: Gone | null; turned?: Turned | null };

export const NO_DEPARTURE: Departure = { intent: null, gone: null };

const num = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);
const str = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");

export function parseDeparture(raw: string): Departure {
  if (!raw) {
    return NO_DEPARTURE;
  }
  try {
    const parsed = JSON.parse(raw) as { intent?: Partial<DepartureIntent> | null; gone?: Partial<Gone> | null; turned?: Partial<Turned> | null };
    const intent =
      parsed.intent && (parsed.intent.response === "slip_away" || parsed.intent.response === "bide_strike")
        ? { response: parsed.intent.response, at: Math.max(0, num(parsed.intent.at)), cause: str(parsed.intent.cause, 160) }
        : null;
    const source = parsed.gone;
    const gone =
      source && (DEPARTURE_RESPONSES as readonly string[]).includes(String(source.response))
        ? {
            response: source.response as DepartureResponse,
            how: str(source.how) || departureHow(source.response as DepartureResponse, "scene"),
            at: Math.max(0, num(source.at)),
            reportedTo: str(source.reportedTo, 80),
            hostile: source.hostile === true,
            leftLevel: Math.max(1, Math.min(20, num(source.leftLevel, 1))),
            xpSince: Math.max(0, num(source.xpSince)),
            avenging: source.avenging === true,
            rumours: Math.max(0, num(source.rumours)),
            cued: source.cued === "fight" || source.cued === "parley" ? source.cued : null,
            standoff: source.standoff === true,
            wear: parseWear(source.wear),
            wornBy: str(source.wornBy, 200),
            templateId: str(source.templateId, 80),
            eventId: str(source.eventId, 80),
            returned: source.returned === true,
          }
        : null;
    const turned =
      parsed.turned && (DEPARTURE_RESPONSES as readonly string[]).includes(String(parsed.turned.response))
        ? { response: parsed.turned.response as DepartureResponse, at: Math.max(0, num(parsed.turned.at)) }
        : null;
    return turned ? { intent, gone, turned } : { intent, gone };
  } catch {
    return NO_DEPARTURE;
  }
}

// ---- the return ----

// Who comes back with them, by what they hold to (SRD 5.1 stat blocks): a
// paladin's holy order, a mercenary's hired blades, the soldiers of the
// faction it reported to. Strongest first; the budget takes what fits.
const ALLIES: Record<CompanionValueId | "reported" | "anyone", string[]> = {
  protects_innocent: ["knight", "priest", "guard"],
  keeps_oaths: ["knight", "veteran", "guard"],
  respects_law: ["veteran", "knight", "guard"],
  reveres_dead: ["priest", "acolyte", "guard"],
  hates_tyranny: ["veteran", "scout", "thug"],
  faction_loyalty: ["veteran", "guard"],
  ruthless: ["berserker", "thug", "bandit"],
  mercenary: ["bandit-captain", "thug", "bandit"],
  reported: ["knight", "veteran", "guard"],
  anyone: ["veteran", "thug", "bandit"],
};

export function allyPreferences(values: readonly CompanionValue[], reported: boolean): string[] {
  const keys: Array<keyof typeof ALLIES> = [...(reported ? (["reported"] as const) : []), ...values.map((held) => held.value), "anyone"];
  return [...new Set(keys.flatMap((key) => ALLIES[key]))];
}

export type AllyChoice = { slug: string; name: string; cr: number };

export type ReturnPlan = {
  allies: Array<AllyChoice & { count: number }>;
  target: "hard" | "deadly";
  adjustedXp: number;
  verdict: EncounterVerdict;
  ceiling: number;
  // Past the ceiling whole, it comes alone and worn (return-wear-logic.ts):
  // the wear that brings it inside, with its rating then. Null when whole.
  wear: Wear | null;
  wornCr: number | null;
  // Past the ceiling even at the wear's floor: no fight can be staged.
  standoff: boolean;
};

// The most combatants start_encounter takes.
const MAX_COMBATANTS = 8;

// Allies budgeted so the whole fight (the companion with them) lands at the
// target (hard, or deadly for a companion who hates the party), never past
// the ceiling the table's difficulty sets on start_encounter. Candidates in
// preference order; each round adds the first that still fits, until the
// fight reaches its target or nothing more fits.
//
// A companion already past the ceiling alone (a solo character against an
// equal is beyond deadly by the DMG's math) comes alone and worn instead:
// the gentlest of `wearSteps` whose rating (`rateWorn`, the same derive-cr
// path as its whole rating) brings the fight inside the target's band under
// the ceiling (deadly at most for one who hates them, hard otherwise). None
// does, even at the floor: a standoff.
export function planReturn(input: {
  partyLevels: readonly number[];
  difficulty: CampaignDifficulty;
  companionCr: number;
  hostile: boolean;
  candidates: readonly AllyChoice[];
  wearSteps?: readonly Wear[];
  rateWorn?: (wear: Wear) => number;
}): ReturnPlan {
  const target = input.hostile ? "deadly" : "hard";
  const levels = [...input.partyLevels];
  const evaluate = (crs: number[]) => evaluateEncounter(levels, crs);
  const alone = evaluate([input.companionCr]);
  const ceiling = encounterCeiling(input.difficulty, alone.thresholds.deadly);
  const cap = Math.min(ceiling, target === "deadly" ? Math.round(alone.thresholds.deadly * 1.5) : alone.thresholds.deadly - 1);
  if (alone.adjustedXp > ceiling) {
    const whole = { allies: [], target, ceiling } as const;
    for (const wear of input.wearSteps ?? []) {
      const wornCr = input.rateWorn ? input.rateWorn(wear) : input.companionCr;
      const worn = evaluate([wornCr]);
      if (worn.adjustedXp <= cap) {
        return { ...whole, allies: [], adjustedXp: worn.adjustedXp, verdict: worn.verdict, wear, wornCr, standoff: false };
      }
    }
    return { ...whole, allies: [], adjustedXp: alone.adjustedXp, verdict: alone.verdict, wear: null, wornCr: null, standoff: true };
  }
  const floor = target === "deadly" ? alone.thresholds.deadly : alone.thresholds.hard;
  const picked: AllyChoice[] = [];
  let current = alone;
  while (current.adjustedXp < floor && picked.length + 1 < MAX_COMBATANTS) {
    const next = input.candidates.find((candidate) => evaluate([input.companionCr, ...picked.map((ally) => ally.cr), candidate.cr]).adjustedXp <= cap);
    if (!next) {
      break;
    }
    picked.push(next);
    current = evaluate([input.companionCr, ...picked.map((ally) => ally.cr)]);
  }
  const allies: ReturnPlan["allies"] = [];
  for (const ally of picked) {
    const known = allies.find((entry) => entry.slug === ally.slug);
    if (known) {
      known.count += 1;
    } else {
      allies.push({ ...ally, count: 1 });
    }
  }
  return { allies, target, adjustedXp: current.adjustedXp, verdict: current.verdict, ceiling, wear: null, wornCr: null, standoff: false };
}

// A companion whose standing has climbed back above disliked comes to talk,
// not to fight: the deeds since they left count.
export const PARLEY_FROM = -24;

export function returnKind(worstApproval: number | null, hostileResponse: boolean): ReturnKind {
  if (worstApproval === null) {
    return hostileResponse ? "fight" : "parley";
  }
  return worstApproval >= PARLEY_FROM ? "parley" : "fight";
}

// The goal the row is given when they go to gather help, and how many
// rounds of the agency dice it takes: a driven companion gets there sooner.
export function avengeGoal(name: string): string {
  return `gather enough help to bring down the party ${name} left`;
}

export function avengeTarget(personality: NpcPersonality | null): number {
  return personality && personality.drive >= 2 ? 2 : 3;
}

// What reaches the party's ears at each round of that goal: a DM-only fact
// the DM may surface as a rumour.
export function rumourFor(name: string, progress: number, target: number, done: boolean): string {
  if (done) {
    return `Rumour: ${name} has gathered allies and is coming for the party.`;
  }
  if (progress <= 0) {
    return `Rumour: someone matching ${name}'s description has been asking questions about the party.`;
  }
  return progress + 1 >= target
    ? `Rumour: ${name} has been seen with armed companions, closing on the party's trail.`
    : `Rumour: ${name} has been seen seeking out old allies, and asking where the party is bound.`;
}
