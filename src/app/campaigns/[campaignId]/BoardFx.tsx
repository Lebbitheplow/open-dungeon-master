"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { damageTone } from "@/lib/battlemap/damage-palette";
import { fxTone, type FxEvent, type FxOutcome } from "@/lib/battlemap/fx-plan";
import { haptic, prefersReducedMotion, useLowEffects } from "@/lib/effects-mode";
import type { ParticleHandle } from "@/components/ParticleCanvas";
import type { XY } from "@/lib/battlemap/types";

// The effect player (docs/vtt-parity-implementation-plan.md section 1.3).
// Effects arrive planned from the server; this component queues them, plays
// at most one per target token at a time, draws the SVG half (arcs, bolts,
// beams, rings, captions, floating numbers) and asks the particle canvas
// for the rest. Every timing is a token from globals.css; on reduced
// motion only the caption and the number play, and only for their hold.

// How long each kind stays on screen, in milliseconds. Matches the CSS
// durations of the classes each piece uses.
const HOLD: Record<string, number> = {
  attack: 620,
  spell: 760,
  heal: 700,
  condition: 480,
  death: 1000,
  door: 520,
  hazard: 700,
  template: 1100,
  teleport: 760,
  ping: 400,
};

type Active = { fx: FxEvent; startedAt: number };

function targetsOf(fx: FxEvent): XY[] {
  if (!fx.to) {
    return [];
  }
  return Array.isArray(fx.to) ? fx.to : [fx.to];
}

function targetIds(fx: FxEvent): string[] {
  if (!fx.toTokenId) {
    return [];
  }
  return Array.isArray(fx.toTokenId) ? fx.toTokenId.filter(Boolean) : [fx.toTokenId];
}

function centre(tile: XY): XY {
  return { x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2 };
}

// Queue management: a pure function over the pending list and the active
// list. One effect per target token at a time; the rest wait their turn.
export function nextPlayable(pending: FxEvent[], active: Active[]): FxEvent | null {
  const busy = new Set(active.flatMap((entry) => targetIds(entry.fx)));
  for (const fx of pending) {
    const ids = targetIds(fx);
    if (ids.some((id) => busy.has(id))) {
      continue;
    }
    return fx;
  }
  return null;
}

export function useFxPlayer(
  incoming: FxEvent[],
  onPlayed: (ids: string[]) => void,
  particles: React.RefObject<ParticleHandle | null>,
  toCanvas: (svgX: number, svgY: number) => { x: number; y: number },
) {
  const [active, setActive] = useState<Active[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<FxEvent[]>([]);
  const low = useLowEffects();
  const onPlayedRef = useRef(onPlayed);
  useEffect(() => {
    onPlayedRef.current = onPlayed;
  });

  // Move whatever may start from the queue into the active list. The
  // particle half and the haptic fire once here, at start.
  const startNext = useCallback(() => {
    setActive((current) => {
      let next = current;
      let started = false;
      for (;;) {
        const fx = nextPlayable(pendingRef.current, next);
        if (!fx) {
          break;
        }
        pendingRef.current = pendingRef.current.filter((entry) => entry.id !== fx.id);
        next = [...next, { fx, startedAt: performance.now() }];
        started = true;
        if (!prefersReducedMotion() && particles.current) {
          emitParticles(fx, particles.current, toCanvas, low);
        }
        if (fx.kind === "attack" || fx.kind === "spell") {
          if (fx.outcome === "crit") {
            haptic("crit");
          } else if (fx.outcome === "hit" || fx.outcome === "fail") {
            haptic("hit");
          }
        }
      }
      return started ? next : current;
    });
  }, [low, particles, toCanvas]);

  // New arrivals join the queue once. A hidden tab drops them: an effect
  // is a moment, and a moment that was missed is not replayed late.
  useEffect(() => {
    const fresh = incoming.filter((fx) => !seenRef.current.has(fx.id));
    if (!fresh.length) {
      return;
    }
    for (const fx of fresh) {
      seenRef.current.add(fx.id);
    }
    if (seenRef.current.size > 200) {
      seenRef.current = new Set([...seenRef.current].slice(-100));
    }
    if (document.hidden) {
      onPlayedRef.current(fresh.map((fx) => fx.id));
      return;
    }
    pendingRef.current = [...pendingRef.current, ...fresh];
    const frame = requestAnimationFrame(startNext);
    return () => cancelAnimationFrame(frame);
  }, [incoming, startNext]);

  // Retire whatever has held long enough, then let the next one start.
  useEffect(() => {
    if (!active.length && !pendingRef.current.length) {
      return;
    }
    const timer = window.setInterval(() => {
      const now = performance.now();
      const reduced = prefersReducedMotion();
      setActive((current) => {
        const done = current.filter(
          (entry) => now - entry.startedAt >= (reduced ? 320 : (HOLD[entry.fx.kind] ?? 600)),
        );
        if (!done.length) {
          return current;
        }
        onPlayedRef.current(done.map((entry) => entry.fx.id));
        return current.filter((entry) => !done.includes(entry));
      });
      if (pendingRef.current.length) {
        startNext();
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, [active.length, startNext]);

  return active;
}

function emitParticles(
  fx: FxEvent,
  handle: ParticleHandle,
  toCanvas: (x: number, y: number) => { x: number; y: number },
  low: boolean,
) {
  const tone = damageTone(fx.damageType);
  const color = fxTone(fx);
  const targets = targetsOf(fx);
  const count = low ? 4 : 12;
  if (fx.kind === "attack") {
    if (fx.outcome === "crit") {
      for (const tile of targets) {
        const p = toCanvas(centre(tile).x, centre(tile).y);
        handle.burst(p.x, p.y, "#d4ab3a", "shard", low ? 4 : 8);
      }
    } else if (fx.outcome === "hit") {
      for (const tile of targets) {
        const p = toCanvas(centre(tile).x, centre(tile).y);
        handle.burst(p.x, p.y, tone.color, "spark", low ? 3 : 6);
      }
    }
    return;
  }
  if (fx.kind === "spell" || fx.kind === "hazard") {
    if (fx.outcome === "miss" || fx.outcome === "save") {
      return;
    }
    for (const tile of targets) {
      const p = toCanvas(centre(tile).x, centre(tile).y);
      handle.burst(p.x, p.y, tone.color, tone.burst, count);
    }
    return;
  }
  if (fx.kind === "template") {
    const outcomes = fx.outcomes ?? [];
    targets.forEach((tile, index) => {
      if (outcomes[index] === "save") {
        return;
      }
      const p = toCanvas(centre(tile).x, centre(tile).y);
      handle.burst(p.x, p.y, tone.color, tone.burst, Math.ceil(count / 2));
    });
    return;
  }
  if (fx.kind === "heal") {
    for (const tile of targets) {
      const c = centre(tile);
      const p = toCanvas(c.x, c.y + TILE / 2 - 4);
      handle.burst(p.x, p.y, "#7ed6a4", "bloom", count);
    }
    return;
  }
  if (fx.kind === "teleport") {
    const from = fx.from ? toCanvas(centre(fx.from).x, centre(fx.from).y) : null;
    if (from) {
      handle.burst(from.x, from.y, color, "mist", count);
    }
    for (const tile of targets) {
      const p = toCanvas(centre(tile).x, centre(tile).y);
      handle.burst(p.x, p.y, color, "mist", count);
    }
    return;
  }
  if (fx.kind === "death") {
    for (const tile of targets) {
      const p = toCanvas(centre(tile).x, centre(tile).y);
      handle.burst(p.x, p.y, "#5b3a8a", "mist", count);
    }
  }
  // A torch guttering out: a last flare of ember, then a curl of smoke
  // (docs/vtt-parity-implementation-plan.md 7.3).
  if (fx.kind === "gutter") {
    for (const tile of targets) {
      const p = toCanvas(centre(tile).x, centre(tile).y);
      handle.burst(p.x, p.y, "#e0a040", "spark", Math.max(4, Math.floor(count / 2)));
      handle.burst(p.x, p.y, "#6b6b6b", "mist", count);
    }
  }
}

const CAPTION: Partial<Record<FxOutcome, string>> = {
  miss: "miss",
  fumble: "fumble",
  save: "saved",
  half: "half",
  fail: "",
  crit: "critical",
};

function Caption({ at, text, color }: { at: XY; text: string; color: string }) {
  return (
    <text
      x={at.x}
      y={at.y - TILE / 2 - 2}
      textAnchor="middle"
      fontSize={9}
      fontWeight={700}
      fill={color}
      stroke="#0c0a09"
      strokeWidth={2.5}
      paintOrder="stroke"
      className="fx-rise"
      style={{ fontFamily: "sans-serif", letterSpacing: "0.04em", textTransform: "uppercase" }}
    >
      {text}
    </text>
  );
}

function FloatingNumber({
  at,
  amount,
  color,
  big,
}: {
  at: XY;
  amount: number;
  color: string;
  big: boolean;
}) {
  return (
    <text
      x={at.x}
      y={at.y - 4}
      textAnchor="middle"
      fontSize={big ? 18 : 13}
      fontWeight={700}
      fill={color}
      stroke="#0c0a09"
      strokeWidth={3}
      paintOrder="stroke"
      className="fx-rise"
      style={{ fontFamily: "var(--font-display), serif" }}
    >
      {amount}
    </text>
  );
}

// The SVG half of one effect.
function EffectShape({ fx }: { fx: FxEvent }) {
  const reduced = prefersReducedMotion();
  const color = fxTone(fx);
  const targets = targetsOf(fx);
  const from = fx.from ? centre(fx.from) : null;
  const first = targets[0] ? centre(targets[0]) : null;
  const numberColor =
    fx.kind === "heal" ? "#7ed6a4" : fx.outcome === "crit" ? "#d4ab3a" : "#ff9d5c";

  const nodes: React.ReactNode[] = [];

  if (fx.kind === "attack" && first) {
    const landed = fx.outcome === "hit" || fx.outcome === "crit";
    if (!reduced && from) {
      if (fx.ranged) {
        nodes.push(
          <line
            key="bolt"
            x1={from.x}
            y1={from.y}
            x2={first.x}
            y2={first.y}
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            className="fx-flash"
            style={{ animationDuration: "var(--dur-quick)" }}
          />,
        );
      } else {
        // An arc swing at the target's near edge, in the attacker's tone.
        const angle = Math.atan2(first.y - from.y, first.x - from.x);
        const r = TILE * 0.55;
        const a0 = angle - 0.9;
        const a1 = angle + 0.9;
        const sx = first.x - Math.cos(a0) * r;
        const sy = first.y - Math.sin(a0) * r;
        const ex = first.x - Math.cos(a1) * r;
        const ey = first.y - Math.sin(a1) * r;
        nodes.push(
          <path
            key="arc"
            d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`}
            fill="none"
            stroke={landed ? color : "#d6cfc2"}
            strokeOpacity={landed ? 0.9 : 0.5}
            strokeWidth={landed ? 3 : 2}
            strokeLinecap="round"
            className="fx-sweep"
            style={{ transformOrigin: `${first.x}px ${first.y}px` }}
          />,
        );
      }
    }
    if (landed && !reduced) {
      nodes.push(
        <circle
          key="rim"
          cx={first.x}
          cy={first.y}
          r={TILE / 2 - 2}
          fill="none"
          stroke={fx.outcome === "crit" ? "#d4ab3a" : "#e0703a"}
          strokeWidth={2.5}
          className="fx-flash"
        />,
      );
    }
    if (fx.outcome === "crit" && !reduced) {
      nodes.push(
        <g key="shards" className="fx-bloom" style={{ transformOrigin: `${first.x}px ${first.y}px` }}>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const r0 = TILE / 2;
            const r1 = TILE * 0.95;
            return (
              <polygon
                key={i}
                points={`${first.x + Math.cos(a) * r0},${first.y + Math.sin(a) * r0} ${first.x + Math.cos(a + 0.12) * r1},${first.y + Math.sin(a + 0.12) * r1} ${first.x + Math.cos(a - 0.12) * r1},${first.y + Math.sin(a - 0.12) * r1}`}
                fill="#d4ab3a"
                fillOpacity={0.8}
              />
            );
          })}
        </g>,
      );
    }
    const caption = fx.outcome ? CAPTION[fx.outcome] : "";
    if (caption) {
      nodes.push(
        <Caption
          key="cap"
          at={fx.outcome === "fumble" && from ? from : first}
          text={caption}
          color={fx.outcome === "crit" ? "#d4ab3a" : "#d6cfc2"}
        />,
      );
    }
    if (typeof fx.amount === "number") {
      nodes.push(
        <FloatingNumber key="num" at={first} amount={fx.amount} color={numberColor} big={fx.outcome === "crit"} />,
      );
    }
  } else if ((fx.kind === "spell" || fx.kind === "hazard") && first) {
    const landed = fx.outcome !== "miss" && fx.outcome !== "save";
    if (!reduced && from && fx.kind === "spell") {
      nodes.push(
        <line
          key="beam"
          x1={from.x}
          y1={from.y}
          x2={first.x}
          y2={first.y}
          stroke={color}
          strokeWidth={3}
          strokeOpacity={0.85}
          strokeLinecap="round"
          className="fx-flash"
          filter="url(#fx-soft)"
        />,
      );
    }
    if (landed && !reduced) {
      nodes.push(
        <circle
          key="burst"
          cx={first.x}
          cy={first.y}
          r={TILE * 0.7}
          fill={color}
          fillOpacity={0.35}
          stroke={damageTone(fx.damageType).edge}
          strokeOpacity={0.8}
          className="fx-bloom"
          style={{ transformOrigin: `${first.x}px ${first.y}px` }}
        />,
      );
    }
    const caption = fx.outcome ? CAPTION[fx.outcome] : "";
    if (caption) {
      nodes.push(<Caption key="cap" at={first} text={caption} color="#d6cfc2" />);
    }
    if (typeof fx.amount === "number") {
      nodes.push(<FloatingNumber key="num" at={first} amount={fx.amount} color={numberColor} big={false} />);
    }
  } else if (fx.kind === "template" && fx.shape) {
    const outcomes = fx.outcomes ?? [];
    const origin = fx.from ?? fx.shape.tiles[0] ?? { x: 0, y: 0 };
    if (!reduced) {
      fx.shape.tiles.forEach((tile, index) => {
        const distance = Math.max(Math.abs(tile.x - origin.x), Math.abs(tile.y - origin.y));
        nodes.push(
          <rect
            key={`t-${index}`}
            x={tile.x * TILE}
            y={tile.y * TILE}
            width={TILE}
            height={TILE}
            fill={color}
            fillOpacity={0.35}
            className="fx-flash"
            style={{ animationDelay: `${distance * 18}ms`, animationDuration: "var(--dur-scene)" }}
          />,
        );
      });
    }
    targets.forEach((tile, index) => {
      const outcome = outcomes[index];
      const caption = outcome ? CAPTION[outcome] : "";
      if (caption) {
        nodes.push(<Caption key={`c-${index}`} at={centre(tile)} text={caption} color="#d6cfc2" />);
      }
    });
  } else if (fx.kind === "heal" && first) {
    if (!reduced) {
      nodes.push(
        <circle
          key="bloom"
          cx={first.x}
          cy={first.y + TILE / 4}
          r={TILE * 0.6}
          fill="#7ed6a4"
          fillOpacity={0.3}
          stroke="#d4ab3a"
          strokeOpacity={0.6}
          className="fx-bloom"
          style={{ transformOrigin: `${first.x}px ${first.y + TILE / 4}px` }}
        />,
      );
    }
    if (typeof fx.amount === "number") {
      nodes.push(<FloatingNumber key="num" at={first} amount={fx.amount} color="#7ed6a4" big={false} />);
    }
  } else if (fx.kind === "condition" && first) {
    nodes.push(
      <Caption
        key="cap"
        at={first}
        text={fx.outcome === "save" ? `${fx.label ?? ""} ends` : fx.label ?? ""}
        color={fx.outcome === "save" ? "#d6cfc2" : "#ff9d5c"}
      />,
    );
    if (!reduced) {
      nodes.push(
        <circle
          key="flash"
          cx={first.x}
          cy={first.y}
          r={TILE / 2 - 2}
          fill="none"
          stroke="#e0703a"
          strokeWidth={2}
          className="fx-flash"
          style={{ animationDuration: "var(--dur-quick)" }}
        />,
      );
    }
  } else if (fx.kind === "death" && first) {
    if (!reduced) {
      nodes.push(
        <circle
          key="collapse"
          cx={first.x}
          cy={first.y}
          r={TILE / 2}
          fill="none"
          stroke="#a985d9"
          strokeWidth={2}
          className="fx-collapse"
          style={{ transformOrigin: `${first.x}px ${first.y}px` }}
        />,
      );
    }
    nodes.push(<Caption key="cap" at={first} text="slain" color="#a985d9" />);
  } else if (fx.kind === "door" && first) {
    const tile = targets[0];
    if (!reduced && (fx.state === "open" || fx.state === "closed")) {
      const hinge = { x: tile.x * TILE + 4, y: tile.y * TILE + TILE / 2 };
      nodes.push(
        <path
          key="wedge"
          d={`M ${hinge.x} ${hinge.y} L ${hinge.x + TILE - 8} ${hinge.y} A ${TILE - 8} ${TILE - 8} 0 0 ${fx.state === "open" ? 0 : 1} ${hinge.x} ${hinge.y - (fx.state === "open" ? TILE - 8 : -(TILE - 8))} Z`}
          fill="#d4ab3a"
          fillOpacity={0.35}
          className="fx-flash"
        />,
      );
    }
    if (!reduced && fx.state === "locked") {
      nodes.push(
        <rect
          key="shake"
          x={tile.x * TILE + 2}
          y={tile.y * TILE + 2}
          width={TILE - 4}
          height={TILE - 4}
          fill="none"
          stroke="#e0703a"
          strokeWidth={2}
          className="fx-shake"
        />,
      );
    }
    if (!reduced && (fx.state === "secret" || fx.state === "found")) {
      nodes.push(
        <rect
          key="dissolve"
          x={tile.x * TILE}
          y={tile.y * TILE}
          width={TILE}
          height={TILE}
          fill="#d4ab3a"
          fillOpacity={0.4}
          className="fx-flash"
          style={{ animationDuration: "var(--dur-scene)" }}
        />,
      );
    }
    nodes.push(
      <Caption
        key="cap"
        at={first}
        text={fx.state === "found" ? "a door" : fx.state ?? ""}
        color="#d4ab3a"
      />,
    );
  } else if (fx.kind === "teleport" && first) {
    if (!reduced) {
      if (from) {
        nodes.push(
          <circle
            key="out"
            cx={from.x}
            cy={from.y}
            r={TILE / 2}
            fill="none"
            stroke="#8b6fd6"
            strokeWidth={2}
            className="fx-collapse"
            style={{ transformOrigin: `${from.x}px ${from.y}px`, animationDuration: "var(--dur-beat)" }}
          />,
        );
      }
      nodes.push(
        <circle
          key="in"
          cx={first.x}
          cy={first.y}
          r={TILE / 2}
          fill="#8b6fd6"
          fillOpacity={0.3}
          stroke="#d9ccff"
          className="fx-bloom"
          style={{ transformOrigin: `${first.x}px ${first.y}px` }}
        />,
      );
    }
  }

  return <g pointerEvents="none">{nodes}</g>;
}

// Rendered inside the board's <svg>, above every other layer.
export function FxLayer({ active }: { active: Active[] }) {
  const nodes = useMemo(
    () => active.map((entry) => <EffectShape key={entry.fx.id} fx={entry.fx} />),
    [active],
  );
  return nodes.length ? <g data-layer="fx">{nodes}</g> : null;
}
