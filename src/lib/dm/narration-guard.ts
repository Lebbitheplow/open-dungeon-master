import { buildLinePrompt, lineViolations } from "@/lib/dm/safety-logic";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { requestDmMessage } from "@/lib/dm/model";
import { extractStoryText } from "@/lib/story-prompt";
import { stripToolText } from "@/lib/dm/tool-text";
import {
  buildCorrectionPrompt,
  checkNarration,
  normalizeSpellName,
  type LiveState,
} from "@/lib/dm/engine-boundary";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import spellManifest from "@/lib/srd/manifest/spells.json";

// The DB/model rim of the engine-boundary guard. All the matching lives in
// dm/engine-boundary.ts (pure); this file only decides what to do about a
// detection, and its answer is deliberately small: ask the model to fix its
// own prose, once.
//
// That one call is held in reserve outside the turn's four-call budget
// (GUARD_RESERVED_CALLS). The turns most likely to contradict their results
// are the busy ones (an attack, the extra attack, end_turn and the enemies),
// and those are exactly the turns that end with the budget spent; a guard
// that could only log there would miss the turns it exists for.
//
// Never touches mechanical state. The dice, the hit points, and the slots
// already resolved through their tools before the narration existed; a
// contradiction is a prose bug, so only prose is ever changed. When the
// rewrite is no better, the original narration stands and the contradiction
// is logged rather than papered over.

export const GUARD_RESERVED_CALLS = 1;

type ManifestSpell = { n: string; l: number; a?: string[] };

let leveled: string[] | null = null;

// Every leveled spell in the bundled spell checklist, with its aliases,
// normalized the way the guard compares names. Cantrips are left out:
// casting one spends nothing, so a missing tool call proves nothing.
export function leveledSpellNames(): string[] {
  if (!leveled) {
    leveled = [
      ...new Set(
        (spellManifest as { spells: ManifestSpell[] }).spells
          .filter((spell) => spell.l >= 1)
          .flatMap((spell) => [spell.n, ...(spell.a ?? [])])
          .map(normalizeSpellName)
          .filter((name) => name.length >= 3),
      ),
    ];
  }
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

export async function enforceEngineBoundary(
  campaign: Campaign,
  turn: DmTurn,
  sheets: readonly CharacterSheet[],
): Promise<void> {
  const narration = turn.narrationParts.join("\n\n").trim();
  if (!narration) {
    return;
  }
  // A line crossed is refused the same way a hit written on a miss is
  // (docs/vtt-parity-implementation-plan.md 9.1), whether or not the
  // outcome check is on: safety is not a setting.
  const lines = campaign.gameSettings.safety?.lines ?? [];
  const crossed = lineViolations(narration, lines, campaign.gameSettings.tableLanguage);
  const partyNames = sheets.map((sheet) => sheet.name);
  const live = liveStateFor(campaign.id);
  const leveledSpells = leveledSpellNames();
  const contradictions = campaign.gameSettings.narrationGuard
    ? checkNarration({
        conversation: turn.conversation,
        narration,
        partyNames,
        live,
        leveledSpells,
      })
    : [];
  if (!contradictions.length && !crossed.length) {
    return;
  }

  const summary = [...contradictions.map((entry) => entry.detail), ...crossed.map((line) => `line crossed: ${line}`)].join("; ");

  // The narration is echoed back explicitly: a turn that ended on a pure
  // narration call never pushed that assistant message into the conversation,
  // so without this the model would be asked to rewrite prose it cannot see and
  // would invent a fresh scene instead.
  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      ...turn.conversation,
      { role: "assistant", content: narration },
      {
        role: "user",
        content: [contradictions.length ? buildCorrectionPrompt(contradictions) : "", crossed.length ? buildLinePrompt(crossed) : ""]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    // No tools: this call exists to rewrite prose, and a tool call here would
    // resolve mechanics a second time. It is the reserved call, so it is
    // made whatever the turn's budget has left.
    { tools: [], toolChoice: "none", thinking: false },
  );
  turn.callIndex += 1;
  if (error) {
    console.warn(`[engine-boundary] turn ${turn.id}: correction call failed (${summary})`);
    return;
  }

  // Tool text the rewrite wrote out (a call it was not offered, as brackets,
  // XML or bare JSON) is stripped like every other narration path does;
  // stripToolText also drops hand-written roll markers.
  const corrected = stripToolText(extractStoryText(message?.content)).trim();
  // A stub reply ("Understood.") technically contradicts nothing; the table
  // would rather have the flawed paragraph it already watched stream in.
  if (corrected.length < Math.min(120, Math.floor(narration.length / 3))) {
    console.warn(
      `[engine-boundary] turn ${turn.id}: correction came back too short to use (${summary})`,
    );
    return;
  }
  // A rewrite is only an improvement if it actually removes contradictions. A
  // model that swapped one wrong claim for another keeps its original text,
  // which at least the table already saw streaming.
  const remaining = campaign.gameSettings.narrationGuard
    ? checkNarration({
        conversation: turn.conversation,
        narration: corrected,
        partyNames,
        live,
        leveledSpells,
      })
    : [];
  const stillCrossed = lineViolations(corrected, lines, campaign.gameSettings.tableLanguage);
  if (remaining.length + stillCrossed.length >= contradictions.length + crossed.length) {
    console.warn(
      `[engine-boundary] turn ${turn.id}: correction did not resolve the contradiction (${summary})`,
    );
    return;
  }
  // finalize() renders the turn's dice cards between the last narration part
  // and the ones before it, so a multi-part turn keeps that shape: the rewrite
  // splits back at its final paragraph break rather than collapsing to one
  // block and pushing every roll card above the whole message.
  const multiPart = turn.narrationParts.length > 1;
  const paragraphs = corrected.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  turn.narrationParts.length = 0;
  if (multiPart && paragraphs.length > 1) {
    turn.narrationParts.push(
      paragraphs.slice(0, -1).join("\n\n"),
      paragraphs[paragraphs.length - 1],
    );
    return;
  }
  turn.narrationParts.push(corrected);
}
