import { createHash } from "node:crypto";
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
import { textKey } from "@/lib/language/text-logic";
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
): Pick<ReaderGate, "guard" | "attacks" | "fight" | "creatures" | "numbers" | "party"> {
  return {
    guard: campaign.gameSettings.narrationGuard,
    attacks: outcomes.attacks.size > 0,
    fight: Boolean(outcomes.liveFight),
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
  const taken = new Set(npcs.map((npc) => textKey(npc.name)));
  for (const sheet of sheets) {
    if (!sheet.summon && !taken.has(textKey(sheet.name))) {
      roster.set(sheet.id, { kind: "pc", id: sheet.id, name: sheet.name, gender: sheet.gender });
    }
  }
  for (const [ref, display] of creatures) {
    roster.set(ref, { kind: "monster", id: "", name: display });
  }
  for (const name of registering) {
    if (!taken.has(textKey(name))) {
      roster.set(`new:${name}`, { kind: "npc", id: "", name });
    }
  }
  return roster;
}

// Readings kept for a few minutes, a bounded handful (see readClaims).
const READING_TTL_MS = 10 * 60_000;
const READINGS_KEPT = 64;

declare global {
  var __odmReaderReplies: Map<string, { at: number; reply: string }> | undefined;
}

function readings() {
  return (globalThis.__odmReaderReplies ??= new Map());
}

function rememberedReading(key: string): string | null {
  const known = readings().get(key);
  return known && Date.now() - known.at < READING_TTL_MS ? known.reply : null;
}

function rememberReading(key: string, reply: string) {
  const map = readings();
  map.set(key, { at: Date.now(), reply });
  if (map.size > READINGS_KEPT) {
    map.delete(map.keys().next().value as string);
  }
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
  // Only the party's: a cast claim names a party character.
  const spent = input.outcomes.spends
    .flatMap((spend) => {
      const by = party.get(spend.characterId);
      return by === undefined ? [] : [{ ...spend, by }];
    })
    .map((spend, index) => ({ ...spend, ref: `s${index + 1}` }));
  const speakers = input.kinds.includes("speaker")
    ? speakerRoster(campaign.id, input.sheets, creatures, input.registering)
    : new Map<string, Speaker>();
  // Who speaks is asked only when the passage names someone it could be.
  const named = namedSpeakers(input.text, speakers);
  const kinds = named.size ? input.kinds : input.kinds.filter((kind) => kind !== "speaker");
  if (!kinds.length) {
    return [];
  }
  const reading = [
    { role: "system" as const, content: readerSystem(SKILL_IDS, kinds.includes("speaker"), kinds.length > 1) },
    {
      role: "user" as const,
      content: renderReaderInput(
        kinds,
        {
          creatures: [...creatures].map(([ref, display]) => ({ ref, display })),
          party: [...party].map(([ref, name]) => ({ ref, name })),
          speakers: [...named].map(([ref, speaker]) => ({ ref, name: speaker.name, aliases: speaker.aliases })),
          spent,
        },
        input.text,
      ),
    },
  ];
  // The same passage read for the same things against the same grounding is
  // answered from the last reading (a retried or resumed turn reads its kept
  // narration again); the key is the whole request, so any change reads anew
  // (the context audit's F10).
  // The model that read it is part of the request: another backend reads anew.
  const route = campaign.settings;
  const key = createHash("sha1")
    .update(
      JSON.stringify([
        campaign.id,
        route.textProvider,
        route.customBaseUrl,
        route.customModel,
        route.localTextModel,
        route.utilityProvider,
        route.utilityBaseUrl,
        route.utilityModel,
        reading,
      ]),
    )
    .digest("hex");
  let reply = rememberedReading(key);
  if (reply === null) {
    const { message, error } = await requestUtilityMessage(campaign.settings, reading, {
      meta: { task: "claims" },
      timeoutMs: arcTextTimeoutMs(),
      thinking: false,
      temperature: 0,
    });
    if (error) {
      console.error(`[claims] ${input.label}: the reader call failed; the passage counts as claiming nothing`);
      return [];
    }
    reply = String(message?.content ?? "");
  }
  const raw = parseReaderReply(stripReasoningArtifacts(reply));
  // Only a reading that parsed is kept: an unreadable one is worth asking again.
  if (raw) {
    rememberReading(key, reply);
  }
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
    spent: new Map(spent.map((spend) => [spend.ref, spend.characterId])),
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
// could act on, who speaks its quoted lines, and which of its sentences are
// the narrator's asides, which never reach the table.
export async function readReply(
  campaign: Campaign,
  sheets: readonly CharacterSheet[],
  turn: Pick<DmTurn, "id" | "conversation">,
  text: string,
  state: { inEncounter: boolean; encounterNudged: boolean; damageNudged: boolean; registering: readonly string[] },
): Promise<PartRead & { outcomes: ResolvedOutcomes }> {
  const outcomes = guardOutcomes(turn.conversation, liveStateFor(campaign.id), campaign.gameSettings.tableLanguage);
  const kinds = claimKindsFor({
    ...guardGate(campaign, outcomes, sheets),
    rollAsk: true,
    fightStart: !state.inEncounter && !state.encounterNudged,
    unrolled: !state.damageNudged && !outcomes.damageNumbers.length,
    speech: hasQuotedLine(text),
    aside: true,
  });
  return {
    kinds,
    claims: await readClaims(campaign, { label: `turn ${turn.id}`, text, kinds, outcomes, sheets, registering: state.registering }),
    outcomes,
  };
}

// The narrator's asides in prose no reply read covers and that goes to the
// table as it is: the forced final call's and the rescue's after it
// (src/lib/dm/turn.ts), a reroll's take (renarrate.ts) and a continuation
// (continue-scene.ts). Asides alone are asked, since nothing else found
// there could still run.
export async function readAsides(
  campaign: Campaign,
  sheets: readonly CharacterSheet[],
  turn: Pick<DmTurn, "id" | "conversation">,
  text: string,
): Promise<NarrationClaim[]> {
  return readClaims(campaign, {
    label: `turn ${turn.id}`,
    text,
    kinds: ["aside"],
    outcomes: guardOutcomes(turn.conversation, liveStateFor(campaign.id), campaign.gameSettings.tableLanguage),
    sheets,
  });
}
