import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { createDmTurn, getDmTurn, listOpenPendingRolls, saveDmTurn } from "@/lib/db/dm-turns";
import {
  getActiveEncounter,
  listEnemies,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getTokenByRef } from "@/lib/db/battle-maps";
import { getCampaignMessage, insertCampaignMessage, setMessageVariants } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { effectiveAcFor } from "@/lib/srd";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { trackUtilityCall } from "@/lib/dm/call-tracker";
import { invokeEngine } from "@/lib/dm/invoke";
import { requestDmMessage, requestUtilityMessage } from "@/lib/dm/model";
import { buildDmSystem } from "@/lib/dm/prompt";
import { enqueueDmJob } from "@/lib/dm/queue";
import { setDmStatus } from "@/lib/dm/status";
import { stripToolText } from "@/lib/dm/tool-text";
import { appendVariant, seedVariants, MAX_VARIANTS } from "@/lib/dm/renarrate-logic";
import {
  monsterAdjudication,
  parseMonsterDecision,
  type MonsterDecision,
} from "@/lib/dm/delegation";
import { enqueueNarrationAudio } from "@/lib/tts";
import { extractStoryText, stripReasoningArtifacts } from "@/lib/story-prompt";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Assisted mode's two model-backed delegations: the AI taking the monsters'
// turn, and the AI saying a DM's beat to the table in full.
//
// Both are deliberately thin. The monsters' turn makes ONE small decision
// call per enemy and then routes the answer through invokeEngine with
// actor.kind "ai", so the dice, the reach checks, the conditions, the damage
// and the audit trail are the engine's exactly as they are when a person
// clicks the same action in the console. Nothing in this file resolves
// anything itself. The beat expansion makes ONE narration call with no tools
// at all, on the same guarantee renarrate.ts is built on: prose changes, the
// mechanical state cannot.
//
// The delegation flags are checked by the ROUTES, not here, so the console's
// explicit "run the monsters now" button still works for a DM who has the
// toggle off but wants the help once.

// ---- the monsters' turn ----

export type MonsterTurnOutcome = {
  // One line per enemy, in initiative order, for the table note and the
  // console's confirmation.
  notes: string[];
  error?: string;
};

const MONSTER_SYSTEM =
  'You play one monster\'s turn in a Dungeons & Dragons 5th Edition fight. You are given its stat block, its condition, and every player character it can see with their hit points and armour class. Choose exactly ONE thing for it to do and answer with STRICT JSON only, no code fences, shaped: {"action": "enemy_attack" | "set_enemy_condition" | "enemy_flees" | "hold", "targetCharacterId": string, "attack": string, "why": string}. Prefer enemy_attack and name the target by the id given to you; "attack" is the name of one attack from the stat block, or "" to let the server pick. Use enemy_flees only for a beast or a coward that is badly hurt and has a reason to run. Use hold only when there is genuinely nothing it can do. Play the monster as its stat block and nature suggest: a wolf pack flanks, an archer stays back, a brute hits whoever is closest. Never invent an attack, a spell or a target that is not listed. "why" is one short clause.';

// Feet between two grid squares, the same Chebyshev measure the battle map
// itself uses, so the model is told the distance the engine will check.
function feetBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
}

function describeEnemy(enemy: EncounterEnemy): string {
  const attacks = enemy.stats.attacks?.map((attack) => attack.name).filter(Boolean) ?? [];
  return [
    `${enemy.displayName} (CR ${enemy.cr}), ${enemy.currentHp} of ${enemy.maxHp} hit points, AC ${enemy.ac}, speed ${enemy.stats.speed || "30 ft."}.`,
    attacks.length ? `Attacks: ${attacks.join(", ")}.` : "Attacks: none listed.",
    enemy.stats.traits?.length ? `Traits: ${enemy.stats.traits.join("; ")}.` : "",
    enemy.conditions.length ? `Currently ${enemy.conditions.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function describeParty(
  sheets: CharacterSheet[],
  distances: Map<string, number | null>,
): string {
  return sheets
    .map((sheet) => {
      const feet = distances.get(sheet.id);
      const where = feet === null || feet === undefined ? "" : `, ${feet} ft. away`;
      const state = sheet.conditions.length ? `, ${sheet.conditions.join(", ")}` : "";
      return `- ${sheet.name} (id ${sheet.id}): ${sheet.currentHp} of ${sheet.maxHp} hit points, AC ${effectiveAcFor(sheet)}${where}${state}`;
    })
    .join("\n");
}

// One decision for one monster. Returns null when the model is unreachable or
// answers with nonsense, and the caller falls back to the engine's own
// nearest-target basic attack, so a delegated monster's turn can never
// silently vanish because a model was having a bad day.
async function decideMonsterTurn(
  campaign: Campaign,
  enemy: EncounterEnemy,
  party: string,
): Promise<MonsterDecision | null> {
  const { message, error } = await trackUtilityCall(campaign.id, "monster", () =>
    requestUtilityMessage(
      campaign.settings,
      [
        { role: "system", content: MONSTER_SYSTEM },
        {
          role: "user",
          content: `The monster:\n${describeEnemy(enemy)}\n\nThe party it can see:\n${party}`,
        },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    ),
  );
  if (error) {
    return null;
  }
  return parseMonsterDecision(stripReasoningArtifacts(String(message?.content ?? "")));
}

// The living enemies in the fight, in initiative order, skipping the ones the
// engine would refuse for anyway. Exported so the console can say how many
// monsters a press would move before the DM presses it.
export function monstersReady(campaignId: string): EncounterEnemy[] {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return [];
  }
  return listEnemies(encounter.id)
    .filter((enemy) => enemy.status === "alive" && enemy.currentHp > 0)
    .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
}

// The DM hands the monsters over for one pass: every living enemy acts once,
// highest initiative first.
//
// It does not consult the initiative pointer, and that is deliberate. In
// human-DM mode the pointer is the DM's (src/lib/dm/initiative.ts); the server
// never advances it on their behalf, so "whose turn is it" is a question only
// they can answer. What this does is the thing they asked for: the monsters
// take their turn, now.
export async function playMonsterTurns(campaign: Campaign): Promise<MonsterTurnOutcome> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { notes: [], error: "No fight is running." };
  }
  const enemies = monstersReady(campaign.id);
  if (!enemies.length) {
    return { notes: [], error: "Nothing is left standing to act." };
  }

  // Every delegated action hangs on ONE AI turn, so the engine's own
  // per-turn bookkeeping (which enemies have already acted, which characters
  // were resolved) sees the whole pass as one turn rather than a string of
  // unrelated ones.
  const turn = createDmTurn(campaign.id, [], "ai");
  const notes: string[] = [];

  await enqueueDmJob(campaign.id, async () => {
    setDmStatus(campaign.id, "thinking");
    try {
      for (const enemy of enemies) {
        // Re-read the party inside the loop: the first goblin may have
        // dropped the target the second one was about to pick.
        const sheets = listSheets(campaign.id).filter((sheet) => sheet.currentHp > 0);
        if (!sheets.length) {
          break;
        }
        const map = getBattleMapForEncounter(encounter.id);
        const attacker = map ? getTokenByRef(map.id, enemy.id) : null;
        const distances = new Map<string, number | null>(
          sheets.map((sheet) => {
            const token = map ? getTokenByRef(map.id, sheet.id) : null;
            return [
              sheet.id,
              attacker && token ? feetBetween(attacker, token) : null,
            ];
          }),
        );

        const decision = await decideMonsterTurn(
          campaign,
          enemy,
          describeParty(sheets, distances),
        );
        // No usable decision: the nearest living target and a plain attack,
        // which is exactly what the engine's own skipped-enemy fallback does.
        const call = decision
          ? monsterAdjudication(enemy.id, decision)
          : {
              name: "enemy_attack",
              args: { enemyId: enemy.id, targetCharacterId: nearest(sheets, distances) },
            };
        if (!call) {
          notes.push(`${enemy.displayName} holds.`);
          continue;
        }

        const outcome = await invokeEngine(campaign, { kind: "ai", turnId: turn.id }, call);
        if (!outcome.ok) {
          // The rules refusing is a real answer (out of reach, incapacitated,
          // already down). The monster's turn passes quietly rather than
          // being retried into something the engine would allow.
          notes.push(`${enemy.displayName} cannot: ${outcome.error}`);
          continue;
        }
        notes.push(summarizeMonsterCall(enemy, decision, outcome.result));
      }
    } finally {
      setDmStatus(campaign.id, "idle");
    }
  });

  // Same close as invokeEngine performs for a person: a parked roll keeps the
  // turn open so the answer lands on it, anything else is finished. Re-read
  // rather than closing the object created above, because every adjudication
  // in the pass wrote its own bookkeeping onto the stored row.
  const closing = getDmTurn(turn.id);
  if (closing) {
    const parked = listOpenPendingRolls(campaign.id).some(
      (pending) => pending.turnId === closing.id,
    );
    closing.status = parked ? "awaiting_rolls" : "done";
    saveDmTurn(closing);
  }

  if (notes.length) {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      content: `The monsters act: ${notes.join(" ")}`,
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });
  }
  return { notes };
}

function nearest(
  sheets: CharacterSheet[],
  distances: Map<string, number | null>,
): string {
  let best = sheets[0]?.id ?? "";
  let bestFeet = Number.POSITIVE_INFINITY;
  for (const sheet of sheets) {
    const feet = distances.get(sheet.id);
    if (feet !== null && feet !== undefined && feet < bestFeet) {
      best = sheet.id;
      bestFeet = feet;
    }
  }
  return best;
}

function summarizeMonsterCall(
  enemy: EncounterEnemy,
  decision: MonsterDecision | null,
  result: Record<string, unknown>,
): string {
  const why = decision?.why ? ` (${decision.why})` : "";
  if (typeof result.attack === "string") {
    const swings = Array.isArray(result.swings)
      ? (result.swings as Array<Record<string, unknown>>)
      : [];
    const detail = swings
      .map((swing) =>
        swing.hit
          ? `${swing.rolled} vs AC ${result.vsAc}: HIT for ${swing.damage}${swing.crit ? " (CRIT)" : ""}`
          : `${swing.rolled} vs AC ${result.vsAc}: miss`,
      )
      .join("; ");
    return `${enemy.displayName} attacks ${String(result.target ?? "a hero")} with ${result.attack} (${detail}).${
      result.dropped ? ` ${String(result.target)} falls!` : ""
    }${why}`;
  }
  return `${enemy.displayName} acts${why}.`;
}

// ---- saying a beat out loud ----

// The narration guard, in one sentence, on top of a tools-free call. A beat
// is a record of play that ALREADY happened, so the expansion has nothing to
// decide: every die is already rolled and every hit point already spent.
const EXPAND_DIRECTIVE =
  "[System] The Dungeon Master ran this stretch at the table and wrote down what happened in one line. Say it to the players in full, in your narrating voice, as the moment they are living through. Every mechanical fact stays exactly as the DM wrote it: the same events, the same outcomes, the same people. Add colour, not consequence. Introduce no new event, no die roll, no decision and no NPC the line does not already contain, do not call any tool, and do not carry the scene past where the DM left it. Two or three short paragraphs at most.";

export type ExpandOutcome = { content: string } | { error: string };

// The AI saying a DM's beat to the table. The expansion is stored as a second
// TAKE on the beat's own message rather than as a new message, which is why
// this reuses renarrate's variant machinery: the DM's own line stays as take
// one, the prose is take two and is what the table reads, and flipping back is
// the swipe control the chat already has. Nothing new appears in the
// transcript, so chapters, compaction, retrieval and the export see one beat.
export async function expandBeat(
  campaign: Campaign,
  messageId: string,
  recent: string[],
): Promise<ExpandOutcome> {
  const message = getCampaignMessage(messageId);
  if (!message || message.campaignId !== campaign.id) {
    return { error: "That beat is gone." };
  }
  const beat = message.content.trim();
  if (!beat) {
    return { error: "There is nothing written down to say." };
  }

  const prompt = [
    { role: "system" as const, content: buildDmSystem(campaign) },
    ...(recent.length
      ? [{ role: "user" as const, content: `Recently at this table:\n${recent.join("\n")}` }]
      : []),
    { role: "user" as const, content: `${EXPAND_DIRECTIVE}\nThe DM wrote: ${beat}` },
  ];

  let narration = "";
  let failure = "";
  await enqueueDmJob(campaign.id, async () => {
    setDmStatus(campaign.id, "narrating");
    try {
      const { message: reply, error } = await requestDmMessage(campaign.settings, prompt, {
        // No tools at all, on top of toolChoice "none": an expansion that
        // called a tool would invent mechanics the DM already resolved by
        // hand at the table.
        toolChoice: "none",
      });
      if (error) {
        failure = "The model is unavailable; the beat stands as you wrote it.";
        return;
      }
      narration = stripToolText(extractStoryText(reply?.content)).trim();
    } finally {
      setDmStatus(campaign.id, "idle");
    }
  });

  if (failure) {
    return { error: failure };
  }
  if (!narration) {
    return { error: "The model returned nothing; the beat stands as you wrote it." };
  }

  // Re-read after the call: the DM may have edited the beat while the model
  // was working.
  const current = getCampaignMessage(messageId);
  if (!current || current.campaignId !== campaign.id) {
    return { error: "That beat is gone." };
  }
  const appended = appendVariant(seedVariants(current.variants ?? [], current.content), narration);
  if (appended.capped) {
    return { error: `That is all ${MAX_VARIANTS} takes; pick one.` };
  }
  const updated = setMessageVariants(messageId, appended.variants, appended.index);
  if (!updated) {
    return { error: "Could not store the spoken take." };
  }
  publishPersisted(campaign.id, "message_updated", { message: updated });
  if (campaign.gameSettings.ttsEnabled) {
    void enqueueNarrationAudio(
      campaign.id,
      updated.id,
      updated.content,
      campaign.gameSettings.ttsVoice,
    );
  }
  return { content: updated.content };
}
