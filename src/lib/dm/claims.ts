import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { listNpcs } from "@/lib/db/npcs";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { SRD_SKILLS } from "@/lib/srd";
import spellManifest from "@/lib/srd/manifest/spells.json";
import {
  guardOutcomes,
  normalizeSpellName,
  type LiveState,
  type ResolvedOutcomes,
} from "@/lib/dm/engine-boundary";
import { hasQuotedLine, type Speaker } from "@/lib/dm/speech";
import { foldName } from "@/lib/language/text-logic";
import {
  checkClaims,
  claimKindsFor,
  namedSpeakers,
  parseReaderReply,
  readerSystem,
  renderReaderInput,
  type ClaimKind,
  type NarrationClaim,
  type PartRead,
  type ReaderGate,
} from "@/lib/dm/claims-logic";

// The claims reader's rim: one utility-model call that reads a passage of
// narration, in any language, into the claims src/lib/dm/claims-logic.ts
// checks and src/lib/dm/engine-boundary.ts rules on. Made outside any
// transaction, and only when the gate found something to ask.
//
// A reader that fails or answers something unreadable fails open: the
// passage counts as claiming nothing, so the turn is persisted as it would
// have been, the way a retrieval with no embedder never breaks a turn. It is
// never silent: the failure is logged, naming the turn and never the text
// (PRIVACY: narration is story text; only DM_DEBUG logs it).

type ManifestSpell = { n: string; l: number; a?: string[] };

let leveled: Set<string> | null = null;

// Every leveled spell in the bundled spell checklist, with its aliases,
// normalized the way the guard compares names. Cantrips are left out:
// casting one spends nothing, so a missing tool call proves nothing.
export function leveledSpellNames(): ReadonlySet<string> {
  leveled ??= new Set(
    (spellManifest as { spells: ManifestSpell[] }).spells
      .filter((spell) => spell.l >= 1)
      .flatMap((spell) => [spell.n, ...(spell.a ?? [])])
      .map(normalizeSpellName)
      .filter((name) => name.length >= 3),
  );
  return leveled;
}

// The running fight's enemies as they stand now, after every call this
// turn made: what a tool-less kill or a refused attack is checked against.
export function liveStateFor(campaignId: string): LiveState | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  return {
    enemies: listEnemies(encounter.id).map((enemy) => ({
      id: enemy.id,
      name: enemy.displayName,
      hp: enemy.currentHp,
      maxHp: enemy.maxHp,
      status: enemy.status,
    })),
  };
}

// What the guard can rule on, from engine state alone: the part of the
// reader's gate shared by the turn loop's reads and the end-of-turn guard.
export function guardGate(
  campaign: Campaign,
  outcomes: ResolvedOutcomes,
  sheets: readonly CharacterSheet[],
): Pick<ReaderGate, "guard" | "attacks" | "creatures" | "numbers" | "party"> {
  return {
    guard: campaign.gameSettings.narrationGuard,
    attacks: outcomes.attacks.size > 0,
    creatures: outcomes.creatures.size > 0,
    numbers: outcomes.numbers.size > 0 || Boolean(outcomes.liveFight),
    party: sheets.length > 0,
  };
}

const SKILL_IDS = SRD_SKILLS.map((skill) => skill.id);

// Everyone who may speak a line at this table, by the ref the reader copies:
// the cast every seat sees (src/lib/dm/cast.ts publicCast), the party, the
// fight's creatures, and the NPCs the reply being read registers, whose row
// does not exist yet (an id-less speaker, resolved by name when the message
// is written: src/lib/dm/speech-lines.ts). Aliases and the gender field ride
// along for the reading of person-written text.
export function speakerRoster(
  campaignId: string,
  sheets: readonly CharacterSheet[],
  creatures: ReadonlyMap<string, string> = new Map(),
  registering: readonly string[] = [],
): Map<string, Speaker> {
  const roster = new Map<string, Speaker>();
  const npcs = listNpcs(campaignId).filter((npc) => !npc.archived);
  for (const npc of npcs) {
    roster.set(npc.id, { kind: "npc", id: npc.id, name: npc.name, aliases: npc.aliases, gender: npc.gender });
  }
  const taken = new Set(npcs.map((npc) => foldName(npc.name)));
  for (const sheet of sheets) {
    if (!sheet.summon && !taken.has(foldName(sheet.name))) {
      roster.set(sheet.id, { kind: "pc", id: sheet.id, name: sheet.name, gender: sheet.gender });
    }
  }
  for (const [ref, display] of creatures) {
    roster.set(ref, { kind: "monster", id: "", name: display });
  }
  for (const name of registering) {
    if (!taken.has(foldName(name))) {
      roster.set(`new:${name}`, { kind: "npc", id: "", name });
    }
  }
  return roster;
}

export async function readClaims(
  campaign: Campaign,
  input: {
    // Who is reading, for the log line: a turn id, never text.
    label: string;
    text: string;
    kinds: readonly ClaimKind[];
    outcomes: ResolvedOutcomes;
    sheets: readonly CharacterSheet[];
    // NPC names the reply being read registers (set_npc), for a speaker
    // claim on their first line.
    registering?: readonly string[];
  },
): Promise<NarrationClaim[]> {
  if (!input.kinds.length || !input.text.trim()) {
    return [];
  }
  const creatures = new Map<string, string>();
  for (const [ref, fact] of [...input.outcomes.creatures, ...input.outcomes.attacks]) {
    creatures.set(ref, fact.display);
  }
  const party = new Map(input.sheets.map((sheet) => [sheet.id, sheet.name]));
  const speakers = input.kinds.includes("speaker")
    ? speakerRoster(campaign.id, input.sheets, creatures, input.registering)
    : new Map<string, Speaker>();
  // Who speaks is asked only when the passage names someone it could be.
  const named = namedSpeakers(input.text, speakers);
  const kinds = named.size ? input.kinds : input.kinds.filter((kind) => kind !== "speaker");
  if (!kinds.length) {
    return [];
  }
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: readerSystem(SKILL_IDS, kinds.includes("speaker"), kinds.length > 1) },
      {
        role: "user",
        content: renderReaderInput(
          kinds,
          {
            creatures: [...creatures].map(([ref, display]) => ({ ref, display })),
            party: [...party].map(([ref, name]) => ({ ref, name })),
            speakers: [...named].map(([ref, speaker]) => ({ ref, name: speaker.name, aliases: speaker.aliases })),
          },
          input.text,
        ),
      },
    ],
    { timeoutMs: arcTextTimeoutMs(), thinking: false, temperature: 0 },
  );
  if (error) {
    console.error(`[claims] ${input.label}: the reader call failed; the passage counts as claiming nothing`);
    return [];
  }
  const raw = parseReaderReply(stripReasoningArtifacts(String(message?.content ?? "")));
  if (!raw) {
    console.error(`[claims] ${input.label}: the reader's reply was unreadable; the passage counts as claiming nothing`);
    return [];
  }
  const claims = checkClaims(raw, {
    kinds,
    text: input.text,
    attackRefs: new Set(input.outcomes.attacks.keys()),
    creatureRefs: new Set(input.outcomes.creatures.keys()),
    party,
    leveledSpells: leveledSpellNames(),
    normalizeSpell: normalizeSpellName,
    skills: new Set(SKILL_IDS),
    speakers: named,
  });
  if (process.env.DM_DEBUG) {
    console.log(`[dm-debug] claims ${input.label}: asked ${kinds.join(",")}; ${JSON.stringify(claims)}`);
  }
  return claims;
}

const namedSchema = z.object({ name: z.string().trim().min(1).max(80) });

// The names a reply's set_npc and add_companion calls register. The reply is
// read before its tools run, so without them a newcomer's first line would
// find nobody to belong to.
export function registeringNames(calls: ReadonlyArray<{ name: string; rawArguments: string }>): string[] {
  return calls.flatMap((call) => {
    if (call.name !== "set_npc" && call.name !== "add_companion") {
      return [];
    }
    let args: unknown;
    try {
      args = JSON.parse(call.rawArguments || "{}");
    } catch {
      // A model's malformed arguments: its tool call fails on its own.
      return [];
    }
    const parsed = namedSchema.safeParse(args);
    return parsed.success ? [parsed.data.name] : [];
  });
}

// One read of a reply's prose, asking only what this moment of the turn
// could act on, and who speaks its quoted lines.
export async function readReply(
  campaign: Campaign,
  sheets: readonly CharacterSheet[],
  turn: Pick<DmTurn, "id" | "conversation">,
  text: string,
  state: { inEncounter: boolean; encounterNudged: boolean; damageNudged: boolean; registering: readonly string[] },
): Promise<PartRead> {
  const outcomes = guardOutcomes(turn.conversation, liveStateFor(campaign.id));
  const kinds = claimKindsFor({
    ...guardGate(campaign, outcomes, sheets),
    rollAsk: true,
    fightStart: !state.inEncounter && !state.encounterNudged,
    unrolled: !state.damageNudged && !outcomes.damageNumbers.length,
    speech: hasQuotedLine(text),
  });
  return {
    kinds,
    claims: await readClaims(campaign, { label: `turn ${turn.id}`, text, kinds, outcomes, sheets, registering: state.registering }),
  };
}
