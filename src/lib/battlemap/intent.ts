// Enemy intent as the board receives it (docs/visual-overhaul-plan.md 5.6).
//
// This file is the projection's SHAPE and the client's last check on it, not
// the engine feature. Nothing in the engine records an intent yet: the plan's
// two sources (a `declare_intent` DM tool, and `tactics.ts` deriving the
// likely one) and the redaction in `view.ts` are server work still to do.
// Until a projection carries `intents`, the board draws none.
//
// Pure: no DOM, no React. scripts/test-board-intent.mjs drives it.

export type IntentSource = "declared" | "likely";

// What kind of thing is planned, which picks the badge's glyph.
export type IntentVerbKind = "melee" | "ranged" | "spell" | "move" | "other";

export type TokenIntent = {
  actorTokenId: string;
  // The thing planned, as the table would say it: "Longsword", "Pounce".
  verb: string;
  verbKind?: IntentVerbKind;
  // Absent for an intent with no single mark (a breath weapon, a retreat).
  targetTokenId?: string | null;
  // The expected damage, when the viewer may see numbers. The projection
  // omits it for a seat that may not; the client never computes one.
  expected?: number | null;
  source: IntentSource;
  // The round it was declared for. An intent from an earlier round is stale.
  round?: number;
};

// The last line of defence, never the first: the server redacts an intent
// whose actor the viewer cannot perceive. This drops anything that still
// refers to a token the viewer's own projection does not contain, so a
// projection bug cannot draw an arc to an empty tile and give an ambusher
// away, and it drops intents left over from an earlier round.
export function visibleIntents(
  intents: TokenIntent[] | null | undefined,
  tokenIds: Iterable<string>,
  round?: number,
): TokenIntent[] {
  if (!intents?.length) {
    return [];
  }
  const known = new Set(tokenIds);
  const seen = new Set<string>();
  const out: TokenIntent[] = [];
  for (const intent of intents) {
    if (!known.has(intent.actorTokenId) || seen.has(intent.actorTokenId)) {
      continue;
    }
    if (intent.targetTokenId && !known.has(intent.targetTokenId)) {
      continue;
    }
    if (round !== undefined && intent.round !== undefined && intent.round !== round) {
      continue;
    }
    if (!intent.verb.trim()) {
      continue;
    }
    seen.add(intent.actorTokenId);
    out.push(intent);
  }
  return out;
}

// "Hobgoblin Warlord plans to Longsword Ysolde", hedged when it is a guess.
export function intentSentence(intent: TokenIntent, actorName: string, targetName?: string | null): string {
  const hedge = intent.source === "likely" ? "will likely" : "plans to";
  const tail = targetName ? ` ${targetName}` : "";
  return `${actorName} ${hedge} ${intent.verb}${tail}`;
}

export type ArcScale = { x: number; y: number; size: number; tone: string; delay: number };

export const ARC_STEPS = 30;
export const ARC_STAGGER_MS = 12;

// The diamond-scale arc from the actor to its mark: thirty scales along a
// raised curve, tapering in at the tail and out at the head, each lighting
// 12 ms after the last so the threat reads as travelling.
export function intentArc(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { scales: ArcScale[]; head: string; headDelay: number } {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 - span * 0.3;
  const scales: ArcScale[] = [];
  for (let i = 0; i < ARC_STEPS; i += 1) {
    const t = i / (ARC_STEPS - 1);
    const inv = 1 - t;
    scales.push({
      x: inv * inv * from.x + 2 * inv * t * mx + t * t * to.x,
      y: inv * inv * from.y + 2 * inv * t * my + t * t * to.y,
      size: 2.6 + Math.sin(t * Math.PI) * 3.1,
      tone: t < 0.34 ? "#ef4444" : t < 0.7 ? "#b91c1c" : "#7f1d1d",
      delay: i * ARC_STAGGER_MS,
    });
  }
  const angle = Math.atan2(to.y - my, to.x - mx);
  const head = [
    `${to.x.toFixed(1)},${to.y.toFixed(1)}`,
    `${(to.x - Math.cos(angle - 0.5) * 15).toFixed(1)},${(to.y - Math.sin(angle - 0.5) * 15).toFixed(1)}`,
    `${(to.x - Math.cos(angle + 0.5) * 15).toFixed(1)},${(to.y - Math.sin(angle + 0.5) * 15).toFixed(1)}`,
  ].join(" ");
  return { scales, head, headDelay: ARC_STEPS * ARC_STAGGER_MS };
}
