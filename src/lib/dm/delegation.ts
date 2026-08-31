// Assisted mode: which parts of running the table the human DM has handed to
// the AI, and how long they have handed the whole thing over for.
//
// The three settings ODM offers are not three products. "ai" and "human" are
// the ends of one dial and this module is the middle of it: the DM keeps the
// story and gives away as much of the bookkeeping as they want to. Nothing
// here is a second rules engine. Every delegated action still goes through
// invokeEngine (src/lib/dm/invoke.ts) with actor.kind "ai", so the per-turn
// caps and the narration guard apply to the AI's share of the session and to
// nothing the person does.
//
// Pure by design: no "@/" imports and no I/O, so scripts/test-delegation.mjs
// can import it directly and the client can read the same rules the server
// enforces.

import type { DmMode } from "@/lib/dm/viewer";

// The capabilities that can be handed over one at a time. Ask is deliberately
// absent: answering a rules question in channel writes nothing to the
// campaign, so it is available in every mode and there is nothing to delegate.
export const DELEGATIONS = ["monsters", "narration", "cover"] as const;
export type Delegation = (typeof DELEGATIONS)[number];

export type DmAssist = Record<Delegation, boolean>;

export const DELEGATION_LABELS: Record<Delegation, string> = {
  monsters: "AI runs the monsters",
  narration: "AI reads your beats aloud",
  cover: "AI can cover for you",
};

export const DELEGATION_HINTS: Record<Delegation, string> = {
  monsters:
    "When the initiative pointer passes an enemy, the AI picks its action and the engine resolves it. You can still swing for them yourself.",
  narration:
    "A beat you write down gets said to the table in full prose. Your own line stays one click away as the first take.",
  cover:
    "You can hand the next few answers to the AI when you step away. It follows your outline and gives the table back to you when the count runs out.",
};

// Delegation only exists in the middle setting. In "human" nothing is handed
// over, which is what the mode means; in "ai" everything already is, so a
// toggle would only be a way to break the AI's own game.
export function delegated(mode: DmMode, assist: DmAssist, which: Delegation): boolean {
  return mode === "assisted" && assist[which] === true;
}

// All three at once, for the console, which renders every affordance from it.
// A button appearing for something the server would refuse is the failure
// worth designing out, so the client asks the same function the routes do.
export function allDelegations(
  mode: DmMode | undefined,
  assist: DmAssist | undefined,
): Record<Delegation, boolean> {
  if (!mode || !assist) {
    return { monsters: false, narration: false, cover: false };
  }
  return {
    monsters: delegated(mode, assist, "monsters"),
    narration: delegated(mode, assist, "narration"),
    cover: delegated(mode, assist, "cover"),
  };
}

// ---- covering for the DM ----

// Long enough to answer a scene, short enough that a DM who forgets to come
// back does not lose the campaign to it.
export const MAX_COVER_TURNS = 20;

// What the count means, said once here so the console and the prompt agree:
// one "answer" is one DM turn, and a DM turn reads every player action that
// arrived before it started. A cover of 5 is therefore five times the AI
// speaks, not five things the players type.
export type DmCover = {
  // Answers left. Zero means the stretch is over and the DM has the table
  // back; the record is kept so the console can say so rather than going
  // blank.
  turnsLeft: number;
  // One line the DM leaves on the way out: where the scene is going, what not
  // to do. Rides alongside the standing dmOutline rather than replacing it.
  brief: string;
  // Who handed it over, and when, so the table can see it was deliberate.
  byUserId: string;
  startedAt: string;
};

export function coverActive(cover: DmCover | null): boolean {
  return Boolean(cover && cover.turnsLeft > 0);
}

// Whether the AI is answering for the table right now: the DM delegated cover
// and a stretch is still running. The action route and the turn-wake guard in
// src/lib/dm/loop.ts both ask this one function, so "may the AI speak" cannot
// drift between the place that queues an intent and the place that enqueues a
// turn.
export function coverInEffect(mode: DmMode, assist: DmAssist, cover: DmCover | null): boolean {
  return delegated(mode, assist, "cover") && coverActive(cover);
}

// Spending one answer. Returns the record to store, never null: a cover that
// has run down to zero stays on the campaign so the console can say "the AI
// answered your last five" instead of quietly reverting.
export function consumeCover(cover: DmCover | null): DmCover | null {
  if (!coverActive(cover) || !cover) {
    return cover;
  }
  return { ...cover, turnsLeft: cover.turnsLeft - 1 };
}

export function clampCoverTurns(raw: unknown): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_COVER_TURNS, value));
}

// Anything unreadable reads as "nobody handed anything over", which is the
// safe direction: the worst case is the DM presses the button again.
export function normalizeCover(raw: unknown): DmCover | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const byUserId = typeof record.byUserId === "string" ? record.byUserId : "";
  if (!byUserId) {
    return null;
  }
  return {
    turnsLeft: clampCoverTurns(record.turnsLeft),
    brief: clampCoverBrief(record.brief),
    byUserId,
    startedAt:
      typeof record.startedAt === "string" && record.startedAt
        ? record.startedAt
        : new Date(0).toISOString(),
  };
}

export const COVER_BRIEF_MAX = 400;

export function clampCoverBrief(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, COVER_BRIEF_MAX);
}

// The line the table reads. Deliberately plain and always shown: a player who
// cannot tell the DM stepped out has been lied to by omission, and the whole
// point of the mode is that the human is still the author.
export function describeCover(cover: DmCover | null): string {
  if (!cover) {
    return "";
  }
  if (cover.turnsLeft <= 0) {
    return "The DM has the table back.";
  }
  return cover.turnsLeft === 1
    ? "The DM stepped away; the AI is answering one more time."
    : `The DM stepped away; the AI is answering the next ${cover.turnsLeft} times.`;
}

// The block appended to the DM system prompt while a cover is running. It is
// emphatic about not spending the story because the model is otherwise being
// handed a campaign it has never run and every incentive to make something
// happen in it.
export function coverPromptBlock(cover: DmCover | null): string {
  if (!coverActive(cover) || !cover) {
    return "";
  }
  const lines = [
    "Covering for the Dungeon Master: a person runs this table and has stepped away, leaving you the next few answers. Keep the game moving and keep it theirs.",
    "Follow the DM's outline. Play the scene that is already in front of the party, run the NPCs and monsters in it, and resolve what the players attempt through the rules engine exactly as always.",
    "Do not spend the story while they are out. Do not end the chapter, resolve the campaign's central question, kill or permanently remove a named NPC, destroy a location, or introduce a twist the outline does not already contain. If the party heads somewhere the outline does not cover, play the journey and stop short of the arrival.",
    `You have ${cover.turnsLeft} ${cover.turnsLeft === 1 ? "answer" : "answers"} left before the DM takes the table back.`,
  ];
  if (cover.brief) {
    lines.push(`What the DM asked for on their way out: ${cover.brief}`);
  }
  return lines.join("\n");
}

// ---- delegated monster turns ----

// What the model is allowed to choose for a monster. Every one of these is an
// existing adjudication, so a delegated monster reaches the engine through the
// same handler a person clicking the console reaches, and the shortlist exists
// only to keep the model from wandering into the party's half of the catalog.
export const MONSTER_ACTIONS = [
  "enemy_attack",
  "set_enemy_condition",
  "enemy_flees",
  "hold",
] as const;
export type MonsterAction = (typeof MONSTER_ACTIONS)[number];

export type MonsterDecision = {
  action: MonsterAction;
  targetCharacterId: string;
  attack: string;
  condition: string;
  why: string;
};

// The model answers with one JSON object per monster. Returns null on anything
// unusable, and the caller falls back to the engine's own nearest-target basic
// attack, so a monster's turn can never silently vanish because a model was
// having a bad day.
export function parseMonsterDecision(raw: string): MonsterDecision | null {
  const text = String(raw ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const action = String(parsed.action ?? "").trim() as MonsterAction;
  if (!MONSTER_ACTIONS.includes(action)) {
    return null;
  }
  return {
    action,
    targetCharacterId: String(parsed.targetCharacterId ?? "").trim(),
    attack: String(parsed.attack ?? "").trim().slice(0, 60),
    condition: String(parsed.condition ?? "").trim().slice(0, 40),
    why: String(parsed.why ?? "").trim().slice(0, 160),
  };
}

// The decision as an adjudication the façade will take. Null means "this
// monster does nothing this turn", which is a real answer: a frightened goblin
// with nobody in reach should not be made to swing at a wall.
export function monsterAdjudication(
  enemyId: string,
  decision: MonsterDecision,
): { name: string; args: Record<string, unknown> } | null {
  if (decision.action === "hold") {
    return null;
  }
  if (decision.action === "enemy_flees") {
    return { name: "enemy_flees", args: { enemyId, reason: decision.why || "Breaks and runs." } };
  }
  if (!decision.targetCharacterId) {
    return null;
  }
  if (decision.action === "set_enemy_condition") {
    // A monster imposing a condition on a player is not what this
    // adjudication does; it puts one on an ENEMY. The only honest reading of
    // the model picking it is a self-buff or a debuff it landed on a fellow
    // monster, and without a condition named there is nothing to apply.
    return decision.condition
      ? {
          name: "set_enemy_condition",
          args: {
            enemyId,
            condition: decision.condition,
            reason: decision.why || "Delegated monster turn.",
          },
        }
      : null;
  }
  return {
    name: "enemy_attack",
    args: {
      enemyId,
      targetCharacterId: decision.targetCharacterId,
      ...(decision.attack ? { attack: decision.attack } : {}),
    },
  };
}
