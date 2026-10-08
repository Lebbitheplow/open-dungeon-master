import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { SRD_SKILLS } from "@/lib/srd";
import spellManifest from "@/lib/srd/manifest/spells.json";
import {
  normalizeSpellName,
  type LiveState,
  type ResolvedOutcomes,
} from "@/lib/dm/engine-boundary";
import {
  checkClaims,
  parseReaderReply,
  readerSystem,
  renderReaderInput,
  type ClaimKind,
  type NarrationClaim,
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

export async function readClaims(
  campaign: Campaign,
  input: {
    // Who is reading, for the log line: a turn id, never text.
    label: string;
    text: string;
    kinds: readonly ClaimKind[];
    outcomes: ResolvedOutcomes;
    sheets: readonly CharacterSheet[];
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
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: readerSystem(SKILL_IDS) },
      {
        role: "user",
        content: renderReaderInput(
          input.kinds,
          {
            creatures: [...creatures].map(([ref, display]) => ({ ref, display })),
            party: [...party].map(([ref, name]) => ({ ref, name })),
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
    kinds: input.kinds,
    text: input.text,
    attackRefs: new Set(input.outcomes.attacks.keys()),
    creatureRefs: new Set(input.outcomes.creatures.keys()),
    party,
    leveledSpells: leveledSpellNames(),
    normalizeSpell: normalizeSpellName,
    skills: new Set(SKILL_IDS),
  });
  if (process.env.DM_DEBUG) {
    console.log(`[dm-debug] claims ${input.label}: asked ${input.kinds.join(",")}; ${JSON.stringify(claims)}`);
  }
  return claims;
}
