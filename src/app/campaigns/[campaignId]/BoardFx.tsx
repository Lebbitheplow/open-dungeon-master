"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { damageTone } from "@/lib/battlemap/damage-palette";
import { fxTone, type FxEvent, type FxOutcome } from "@/lib/battlemap/fx-plan";
import { haptic, prefersReducedMotion, useLowEffects } from "@/lib/effects-mode";
import type { ParticleHandle } from "@/components/ParticleCanvas";
import type { XY } from "@/lib/battlemap/types";
import { Flipbook } from "@/app/campaigns/[campaignId]/BoardFlipbook";
import { deliveryImpact, deliveryTravel, MissChip } from "@/app/campaigns/[campaignId]/BoardDelivery";
import { beatSheet, effectHold, numberRise, type BeatSheet } from "@/lib/battlemap/beats";
import { presentationFor, seedOf, type Presentation, type Shake } from "@/lib/battlemap/delivery";

// The effect player (docs/vtt-parity-implementation-plan.md section 1.3).
// Effects arrive planned from the server; this component queues them, plays
// at most one per target token at a time, draws the SVG half (arcs, bolts,
// beams, rings, captions, floating numbers) and asks the particle canvas
// for the rest. How a damage type arrives is one row of the delivery table
// (src/lib/battlemap/delivery.ts) and how long anything holds the stage is
// the beat sheet (src/lib/battlemap/beats.ts): the full set at the table's
// pace, the quick set under low effects or when effects are queueing, and on
// reduced motion only the caption and the number, for their 320 ms hold.

type Active = { fx: FxEvent; startedAt: number; hold: number; quick: boolean };

function planOf(fx: FxEvent, low: boolean): Presentation {
  return presentationFor(
    { kind: fx.kind, damageType: fx.damageType, outcome: fx.outcome, ranged: fx.ranged, amount: fx.amount },
    { low },
  );
}

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
  // Shakes the stage: translate only, after `delay`, never under reduced
  // motion or low effects (the caller owns the element). The effect comes
  // along so the caller can kick the struck figures on the same beat.
  onShake?: (shake: Shake, delay: number, fx: FxEvent) => void,
) {
  const [active, setActive] = useState<Active[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<FxEvent[]>([]);
  const low = useLowEffects();
  const onPlayedRef = useRef(onPlayed);
  const onShakeRef = useRef(onShake);
  useEffect(() => {
    onPlayedRef.current = onPlayed;
    onShakeRef.current = onShake;
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
        const reduced = prefersReducedMotion();
        // A queue behind this one means the table is waiting: play it quick.
        const quick = low || pendingRef.current.length > 0;
        const plan = planOf(fx, low);
        const sheet = beatSheet({ quick, reduced });
        next = [...next, { fx, startedAt: performance.now(), hold: effectHold(fx.kind, sheet, plan.row.delay), quick }];
        started = true;
        if (!reduced && particles.current) {
          const handle = particles.current;
          // A delayed burst must not land on a canvas that has since gone.
          emitParticles(fx, plan, handle, toCanvas, low, () => particles.current === handle);
        }
        if (!reduced && !low && plan.shake) {
          onShakeRef.current?.(plan.shake, plan.row.delay, fx);
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
      setActive((current) => {
        const done = current.filter((entry) => now - entry.startedAt >= entry.hold);
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

// The particle half, read off the delivery table: the family and the count
// come from the row (halved on the low tier), and the burst waits for the
// impact beat so an ember bursts when it lands, not when it is thrown.
function emitParticles(
  fx: FxEvent,
  plan: Presentation,
  handle: ParticleHandle,
  toCanvas: (x: number, y: number) => { x: number; y: number },
  low: boolean,
  alive: () => boolean,
) {
  const tone = damageTone(fx.damageType);
  const color = fxTone(fx);
  const targets = targetsOf(fx);
  const burst = plan.particles;
  const count = burst?.count ?? (low ? 4 : 12);
  const at = (fn: () => void, delay: number) => {
    if (delay <= 0) {
      fn();
    } else {
      window.setTimeout(() => {
        if (alive()) {
          fn();
        }
      }, delay);
    }
  };
  if (fx.kind === "attack") {
    if (!burst) {
      return;
    }
    at(() => {
      for (const tile of targets) {
        const p = toCanvas(centre(tile).x, centre(tile).y);
        // A blade throws fewer, finer pieces than a spell of the same family.
        handle.burst(p.x, p.y, burst.color, fx.outcome === "crit" ? "shard" : burst.family, Math.ceil(burst.count * 0.6));
      }
    }, burst.at);
    return;
  }
  if (fx.kind === "spell" || fx.kind === "hazard") {
    if (!burst) {
      return;
    }
    at(() => {
      for (const tile of targets) {
        const p = toCanvas(centre(tile).x, centre(tile).y);
        handle.burst(p.x, p.y, burst.color, burst.family, burst.count);
      }
    }, burst.at);
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
    at(() => {
      for (const tile of targets) {
        const c = centre(tile);
        const p = toCanvas(c.x, c.y + TILE / 2 - 4);
        handle.burst(p.x, p.y, "#7ed6a4", "bloom", count);
      }
    }, plan.row.delay);
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
      handle.burst(p.x, p.y, "#5b3a8a", "mist", low ? 4 : 9);
    }
  }
  // A torch guttering out: a last flare of ember, then a curl of smoke
  // (docs/vtt-parity-implementation-plan.md 7.3).
  if (fx.kind === "gutter") {
    const embers = low ? 4 : 12;
    for (const tile of targets) {
      const p = toCanvas(centre(tile).x, centre(tile).y);
      handle.burst(p.x, p.y, "#e0a040", "spark", Math.max(4, Math.floor(embers / 2)));
      handle.burst(p.x, p.y, "#6b6b6b", "mist", embers);
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

function Caption({
  at,
  text,
  color,
  hold,
  delay = 0,
}: {
  at: XY;
  text: string;
  color: string;
  // How long the word stays up; the status beat for a condition.
  hold: number;
  delay?: number;
}) {
  const reduced = prefersReducedMotion();
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
      // Reduced motion shows the word still: the collapsed keyframe would
      // end on its faded-out frame and show nothing at all.
      className={reduced ? undefined : "fx-rise"}
      style={{
        fontFamily: "sans-serif",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        ...(reduced ? {} : { animationDuration: `${hold}ms`, animationDelay: `${delay}ms` }),
      }}
    >
      {text}
    </text>
  );
}

function FloatingNumber({
  at,
  amount,
  plan,
  rise,
}: {
  at: XY;
  amount: number;
  plan: Presentation;
  rise: number;
}) {
  const reduced = prefersReducedMotion();
  const style = plan.number ?? { color: "#ff9d5c", size: 13, variant: "damage" as const };
  return (
    <text
      x={at.x}
      y={at.y - 4}
      textAnchor="middle"
      fontSize={style.size}
      fontWeight={700}
      fill={style.color}
      stroke="#0c0a09"
      strokeWidth={3}
      paintOrder="stroke"
      className={reduced ? undefined : "fx-dmg-rise"}
      style={
        {
          fontFamily: "var(--font-display), serif",
          ...(reduced ? {} : { "--fx-rise": `${rise}ms`, animationDelay: `${plan.row.delay}ms` }),
        } as React.CSSProperties
      }
    >
      {style.variant === "heal" ? `+${amount}` : amount}
    </text>
  );
}

// The SVG half of one effect.
function EffectShape({ fx, sheet }: { fx: FxEvent; sheet: BeatSheet }) {
  const reduced = prefersReducedMotion();
  const low = lowEffectsNow();
  const color = fxTone(fx);
  const targets = targetsOf(fx);
  const from = fx.from ? centre(fx.from) : null;
  const first = targets[0] ? centre(targets[0]) : null;
  const plan = planOf(fx, low);
  const rise = numberRise(sheet);
  const seed = seedOf(fx.id);

  const nodes: React.ReactNode[] = [];

  if (fx.kind === "attack" && first) {
    if (!reduced) {
      nodes.push(...deliveryTravel({ plan, from, to: first, seed }), ...deliveryImpact({ plan, to: first }));
    }
    if (fx.outcome === "crit" && !reduced) {
      nodes.push(
        <g
          key="shards"
          className="fx-bloom"
          style={{ transformOrigin: `${first.x}px ${first.y}px`, animationDelay: `${plan.row.delay}ms` }}
        >
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
      const at = fx.outcome === "fumble" && from ? from : first;
      if ((fx.outcome === "miss" || fx.outcome === "fumble") && !reduced) {
        nodes.push(<MissChip key="cap" at={at} text={caption} delay={plan.row.delay} />);
      } else {
        nodes.push(
          <Caption
            key="cap"
            at={at}
            text={caption}
            color={fx.outcome === "crit" ? "#d4ab3a" : "#d6cfc2"}
            hold={rise}
            delay={plan.row.delay}
          />,
        );
      }
    }
    if (typeof fx.amount === "number") {
      nodes.push(<FloatingNumber key="num" at={first} amount={fx.amount} plan={plan} rise={rise} />);
    }
  } else if ((fx.kind === "spell" || fx.kind === "hazard") && first) {
    if (!reduced) {
      // A hazard has no caster: it opens where it is.
      nodes.push(
        ...deliveryTravel({ plan, from: fx.kind === "spell" ? from : null, to: first, seed }),
        ...deliveryImpact({ plan, to: first }),
      );
    }
    if (plan.landing !== "none" && !reduced) {
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
          style={{ transformOrigin: `${first.x}px ${first.y}px`, animationDelay: `${plan.row.delay}ms` }}
        />,
      );
    }
    const caption = fx.outcome ? CAPTION[fx.outcome] : "";
    if (caption) {
      if (fx.outcome === "miss" && !reduced) {
        nodes.push(<MissChip key="cap" at={first} text={caption} delay={plan.row.delay} />);
      } else {
        nodes.push(<Caption key="cap" at={first} text={caption} color="#d6cfc2" hold={rise} delay={plan.row.delay} />);
      }
    }
    if (typeof fx.amount === "number") {
      nodes.push(<FloatingNumber key="num" at={first} amount={fx.amount} plan={plan} rise={rise} />);
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
        nodes.push(<Caption key={`c-${index}`} at={centre(tile)} text={caption} color="#d6cfc2" hold={rise} />);
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
      nodes.push(<FloatingNumber key="num" at={first} amount={fx.amount} plan={plan} rise={rise} />);
    }
  } else if (fx.kind === "condition" && first) {
    nodes.push(
      <Caption
        key="cap"
        at={first}
        text={fx.outcome === "save" ? `${fx.label ?? ""} ends` : fx.label ?? ""}
        color={fx.outcome === "save" ? "#d6cfc2" : "#ff9d5c"}
        hold={sheet.status}
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
    nodes.push(<Caption key="cap" at={first} text="slain" color="#a985d9" hold={sheet.status} />);
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
        hold={sheet.impact + sheet.clear}
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

  // The painted flipbook over each target, on top of the drawn effect, which
  // stays as the fallback when this host has no sheets. Skipped under reduced
  // motion and low effects, like every other loop and flourish.
  // The table names the sheet, and the sheet waits for the impact beat like
  // everything else that happens at the target.
  const sheetId = reduced || low ? null : plan.flipbook;
  if (sheetId) {
    for (const [index, target] of targets.entries()) {
      nodes.push(<Flipbook key={`book-${index}`} sheetId={sheetId} at={centre(target)} delay={plan.row.delay} />);
    }
  }

  return <g pointerEvents="none">{nodes}</g>;
}

function lowEffectsNow(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.effects === "low";
}

// Rendered inside the board's <svg>, above every other layer.
export function FxLayer({ active }: { active: Active[] }) {
  const nodes = useMemo(
    () =>
      active.map((entry) => (
        <EffectShape
          key={entry.fx.id}
          fx={entry.fx}
          sheet={beatSheet({ quick: entry.quick, reduced: prefersReducedMotion() })}
        />
      )),
    [active],
  );
  return nodes.length ? <g data-layer="fx">{nodes}</g> : null;
}
