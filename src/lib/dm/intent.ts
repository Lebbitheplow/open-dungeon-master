// Enemy intent, the engine's half (docs/visual-overhaul-plan.md 5.6): what an
// enemy looks likely to do next, and which intents one viewer may be told.
//
// Pure: no database, no events. src/lib/battlemap/view.ts feeds it the rows
// it has already read, and scripts/test-intent.mjs drives it directly. It
// must not import map-tools (which imports view.ts), so the attack's kind is
// read here rather than borrowed from there.
import type { EnemyAttack, EnemyStats } from "@/lib/bestiary/statblock";
import type { EncounterIntents } from "@/lib/db/encounter-intents";
import type { IntentVerbKind, TokenIntent } from "@/lib/battlemap/intent";
import { speedToTiles } from "@/lib/battlemap/movement";
import { chebyshev } from "@/lib/battlemap/types";
import { averageDetail } from "@/lib/srd/odds";

// A stat snapshot keeps an attack's name, bonus, dice and damage type, and
// nothing about reach or range, so the name decides, as it does for the
// engine's own reach check (map-tools RANGED_ATTACK_RE). Weapons are asked
// first because "Light Crossbow" is a weapon even though a crossbow has bolts.
const RANGED_WEAPON_RE = /bow|sling|dart|javelin|thrown|rifle|pistol|gun|rock|spit|spine|web|longarm/i;
const SPELL_RE =
  /spell|\bray\b|bolt|blast|beam|breath|gaze|curse|hex|eldritch|arcane|magic|fireball|lightning|\bword\b|spear of/i;

export function attackVerbKind(attack: Pick<EnemyAttack, "name"> | null | undefined): IntentVerbKind {
  const name = attack?.name?.trim() ?? "";
  if (!name) {
    return "other";
  }
  if (RANGED_WEAPON_RE.test(name)) {
    return "ranged";
  }
  if (SPELL_RE.test(name)) {
    return "spell";
  }
  return "melee";
}

const MOVE_RE = /flee|retreat|withdraw|fall back|advance|reposition|\bmove|\bdash|\bhide|take cover|close in/i;

// The kind of a DECLARED verb, which is free text. A name the stat block
// lists is that attack's kind; otherwise the words decide, and a verb that
// says nothing recognisable is "other" rather than assumed to be a blade.
export function declaredVerbKind(
  verb: string,
  attacks: Array<Pick<EnemyAttack, "name">> = [],
): IntentVerbKind {
  const wanted = verb.trim().toLowerCase();
  const listed = attacks.find((entry) => entry.name.toLowerCase() === wanted);
  if (listed) {
    return attackVerbKind(listed);
  }
  if (MOVE_RE.test(verb)) {
    return "move";
  }
  const kind = attackVerbKind({ name: verb });
  return kind === "melee" ? "other" : kind;
}

// The average of a damage expression, rounded for a badge; null when the
// expression does not parse, so a number is never invented.
export function expectedDamage(expression: string | null | undefined): number | null {
  const text = (expression ?? "").trim();
  if (!text) {
    return null;
  }
  const detail = averageDetail(text);
  if (!detail.exact && detail.average === 0) {
    return null;
  }
  return Number.isFinite(detail.average) && detail.average > 0 ? Math.round(detail.average) : null;
}

export type IntentActor = { stats: Pick<EnemyStats, "attacks" | "speed"> };
export type IntentPosition = { id: string; x: number; y: number };
// A player character's token as the guess sees it. `down` is a PC at 0 HP:
// on the board, but not something a monster spends its turn on.
export type IntentMark = IntentPosition & { hidden?: boolean; down?: boolean };

function nearestMark(from: IntentPosition, marks: IntentMark[]): { mark: IntentMark; tiles: number } | null {
  let best: { mark: IntentMark; tiles: number; crow: number } | null = null;
  for (const mark of marks) {
    if (mark.hidden || mark.down) {
      continue;
    }
    const tiles = chebyshev(from.x, from.y, mark.x, mark.y);
    const crow = (from.x - mark.x) ** 2 + (from.y - mark.y) ** 2;
    // Grid distance first, the straight line to break a tie, then the id so
    // every client is told the same mark.
    if (
      !best ||
      tiles < best.tiles ||
      (tiles === best.tiles && (crow < best.crow || (crow === best.crow && mark.id < best.mark.id)))
    ) {
      best = { mark, tiles, crow };
    }
  }
  return best ? { mark: best.mark, tiles: best.tiles } : null;
}

// The likely intent: the monster's primary attack against the nearest living
// player character it could be after. The primary attack is the first the
// block lists, unless the mark is further than a move could close and the
// block has something that reaches. Null when there is nothing to say: no
// attacks, or nobody standing.
export function likelyIntent(
  enemy: IntentActor,
  enemyToken: IntentPosition,
  pcTokens: IntentMark[],
): TokenIntent | null {
  const attacks = enemy.stats.attacks ?? [];
  if (!attacks.length) {
    return null;
  }
  const nearest = nearestMark(enemyToken, pcTokens);
  if (!nearest) {
    return null;
  }
  let attack = attacks[0];
  const canClose = nearest.tiles <= speedToTiles(enemy.stats.speed) + 1;
  if (!canClose && attackVerbKind(attack) === "melee") {
    attack = attacks.find((entry) => attackVerbKind(entry) !== "melee") ?? attack;
  }
  const expected = expectedDamage(attack.damage);
  return {
    actorTokenId: enemyToken.id,
    verb: attack.name,
    verbKind: attackVerbKind(attack),
    targetTokenId: nearest.mark.id,
    ...(expected !== null ? { expected } : {}),
    source: "likely",
  };
}

export type IntentProjectionInput = {
  round: number;
  declared: EncounterIntents;
  // Living enemies with a token on the board, hidden ones included: the
  // viewer's own token list decides which of them are spoken for.
  enemies: Array<{ id: string; stats: IntentActor["stats"]; token: IntentPosition }>;
  // Every player character token on the board.
  pcTokens: Array<IntentMark & { refId: string }>;
  // The token ids this viewer's projection contains.
  shownTokenIds: Set<string>;
  // Whether this viewer may see enemy numbers (capsFor().enemyNumbers).
  enemyNumbers: boolean;
};

// What one viewer is told. The redaction lives here and nowhere else:
// an actor the viewer's projection does not contain says nothing; a mark it
// does not contain is not named; a number goes only to a seat that may see
// enemy numbers. The DM's projection contains every token and may see
// numbers, so the same three rules hand the DM everything.
export function projectIntents(input: IntentProjectionInput): TokenIntent[] {
  const declared = input.declared.round === input.round ? input.declared.byActor : {};
  const pcTokenByRef = new Map(input.pcTokens.map((token) => [token.refId, token]));
  const out: TokenIntent[] = [];
  for (const enemy of input.enemies) {
    if (!input.shownTokenIds.has(enemy.token.id)) {
      continue;
    }
    const said = declared[enemy.id];
    let intent: TokenIntent | null;
    if (said) {
      const targetToken = said.targetRef ? pcTokenByRef.get(said.targetRef) : undefined;
      intent = {
        actorTokenId: enemy.token.id,
        verb: said.verb,
        verbKind: said.verbKind ?? "other",
        targetTokenId: targetToken?.id ?? null,
        ...(said.expected !== null ? { expected: said.expected } : {}),
        source: "declared",
      };
    } else {
      intent = likelyIntent(enemy, enemy.token, input.pcTokens);
    }
    if (!intent) {
      continue;
    }
    if (intent.targetTokenId && !input.shownTokenIds.has(intent.targetTokenId)) {
      intent.targetTokenId = null;
    }
    if (!input.enemyNumbers) {
      delete intent.expected;
    }
    out.push({ ...intent, round: input.round });
  }
  return out;
}
