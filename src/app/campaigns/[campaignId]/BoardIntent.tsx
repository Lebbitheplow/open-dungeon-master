"use client";

import { Crosshair, Footprints, Sparkles, Swords, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { TokenFace } from "@/app/campaigns/[campaignId]/BoardChrome";
import type { StageToken } from "@/app/campaigns/[campaignId]/BoardStage";
import { intentArc, intentSentence, visibleIntents, type TokenIntent } from "@/lib/battlemap/intent";

// Enemy intent on the board (docs/visual-overhaul-plan.md 5.6): a breathing
// badge over each enemy that means to do something, the diamond-scale arc to
// its mark, and the sentence spelled out, on hover, focus or a press.
//
// Display only. The board draws exactly the intents its projection was sent
// and nothing else: it never derives one, and it drops any that names a
// token the viewer cannot see (src/lib/battlemap/intent.ts). The engine does
// not send intents yet, so on today's server this renders nothing.

const GLYPH = {
  melee: Swords,
  ranged: Crosshair,
  spell: Sparkles,
  move: Footprints,
  other: Zap,
} as const;

export function IntentLayer({
  intents,
  tokens,
  footprints,
  boardWidth,
  boardHeight,
  round,
  faceOf,
}: {
  intents: TokenIntent[] | null | undefined;
  tokens: StageToken[];
  footprints: Record<string, number>;
  boardWidth: number;
  boardHeight: number;
  round?: number;
  faceOf: (token: StageToken) => Array<string | null | undefined>;
}) {
  const [litId, setLitId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(tokens.map((token) => [token.id, token])), [tokens]);
  const shown = useMemo(
    () => visibleIntents(intents, tokens.map((token) => token.id), round),
    [intents, tokens, round],
  );
  if (!shown.length) {
    return null;
  }
  const centre = (token: StageToken) => {
    const footprint = footprints[token.id] ?? 1;
    return { x: (token.x + footprint / 2) * TILE, y: (token.y + footprint / 2) * TILE };
  };
  const lit = shown.find((intent) => intent.actorTokenId === litId) ?? null;
  const litActor = lit ? byId.get(lit.actorTokenId) : undefined;
  const litTarget = lit?.targetTokenId ? byId.get(lit.targetTokenId) : undefined;
  const arc = litActor && litTarget ? intentArc(centre(litActor), centre(litTarget)) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-layer="intent">
      {arc ? (
        <svg
          viewBox={`0 0 ${boardWidth * TILE} ${boardHeight * TILE}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 size-full"
        >
          {arc.scales.map((scale, index) => (
            <polygon
              key={index}
              points={`${scale.x.toFixed(1)},${(scale.y - scale.size).toFixed(1)} ${(scale.x + scale.size).toFixed(1)},${scale.y.toFixed(1)} ${scale.x.toFixed(1)},${(scale.y + scale.size).toFixed(1)} ${(scale.x - scale.size).toFixed(1)},${scale.y.toFixed(1)}`}
              fill={scale.tone}
              className="intent-scale"
              style={{ animationDelay: `${scale.delay}ms` }}
            />
          ))}
          <polygon points={arc.head} fill="#dc2626" className="intent-scale" style={{ animationDelay: `${arc.headDelay}ms` }} />
        </svg>
      ) : null}
      {shown.map((intent) => {
        const actor = byId.get(intent.actorTokenId);
        if (!actor) {
          return null;
        }
        const target = intent.targetTokenId ? byId.get(intent.targetTokenId) : undefined;
        const footprint = footprints[actor.id] ?? 1;
        const isLit = litId === actor.id;
        const Icon = GLYPH[intent.verbKind ?? "melee"] ?? Swords;
        const likely = intent.source === "likely";
        return (
          <button
            key={actor.id}
            type="button"
            aria-label={intentSentence(intent, actor.name, target?.name)}
            aria-pressed={isLit}
            data-lit={isLit}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setLitId(actor.id);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setLitId(null);
            }}
            onFocus={() => setLitId(actor.id)}
            onBlur={() => setLitId(null)}
            // A press is the phone's hover: it holds the arc until pressed again.
            onClick={(event) => {
              event.stopPropagation();
              setLitId((current) => (current === actor.id ? null : actor.id));
            }}
            className={cn(
              "intent-badge pointer-events-auto absolute flex cursor-help items-center gap-1 rounded-full border bg-[rgba(8,6,18,0.9)] py-0.5 pl-0.5 pr-1.5",
              isLit ? "border-[#f87171]" : "border-[rgba(220,38,38,0.5)]",
              likely && !isLit && "border-dashed",
            )}
            style={{
              left: `${((actor.x + footprint / 2) / boardWidth) * 100}%`,
              // Above the figure, except along the top rows, where the initiative
              // rail would cover it: there it hangs below instead.
              top: `${((actor.y < 2 ? actor.y + footprint + 0.34 : actor.y - 0.34) / boardHeight) * 100}%`,
            }}
          >
            <span
              className="flex size-[15px] flex-none items-center justify-center rounded-full"
              style={{ background: isLit ? "#dc2626" : "rgba(220,38,38,.35)" }}
            >
              <Icon className="size-2.5" strokeWidth={2.4} style={{ color: isLit ? "#fff" : "#fca5a5" }} />
            </span>
            <span className="font-mono text-[9px] leading-none" style={{ color: isLit ? "#fecaca" : "#f87171" }}>
              {typeof intent.expected === "number" ? intent.expected : likely ? "?" : "!"}
            </span>
          </button>
        );
      })}
      {lit && litActor ? (
        <div
          role="status"
          className="intent-toast absolute left-1/2 top-3 z-10 flex max-w-[92%] items-center gap-2 rounded-full border border-[rgba(220,38,38,0.5)] bg-[rgba(8,6,18,0.94)] py-[5px] pl-[5px] pr-[11px] shadow-[0_8px_24px_rgba(4,2,12,0.6)]"
        >
          <TokenFace
            candidates={faceOf(litActor)}
            name={litActor.name}
            enemy
            className="size-6 rounded-full border border-[rgba(220,38,38,0.7)]"
          />
          <span className="min-w-0 truncate font-serif text-[12.5px] text-[#e9e6f4]">
            {intentSentence(lit, litActor.name, litTarget?.name)}
          </span>
          {litTarget ? (
            <TokenFace
              candidates={faceOf(litTarget)}
              name={litTarget.name}
              className="size-6 rounded-full border border-[rgba(227,193,92,0.6)]"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
