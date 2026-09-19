"use client";

import type { CSSProperties } from "react";
import { FLICKER_FACES, pipsFor, tossMs, type AbilityRoll } from "./abilityDice";

// The gradients every die shares, mounted once per dice grid. Zero-sized
// rather than display:none, because a hidden svg's gradients do not resolve
// in every engine.
export function DiceDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <defs>
        <linearGradient id="odm-die-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2a2547" />
          <stop offset="46%" stopColor="#151229" />
          <stop offset="100%" stopColor="#07050f" />
        </linearGradient>
        <linearGradient id="odm-die-bevel" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#f9ecc8" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#f9ecc8" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id="odm-pip-face" cx="0.36" cy="0.32" r="0.8">
          <stop offset="0%" stopColor="#fffaf0" />
          <stop offset="60%" stopColor="#f4e0a6" />
          <stop offset="100%" stopColor="#c9a444" />
        </radialGradient>
        <radialGradient id="odm-pip-dim" cx="0.36" cy="0.32" r="0.8">
          <stop offset="0%" stopColor="#6b6489" />
          <stop offset="100%" stopColor="#3d3757" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function Pips({ value, fill }: { value: number; fill: string }) {
  return (
    <>
      {pipsFor(value).map((pip) => (
        <circle key={`${pip.cx}-${pip.cy}`} cx={pip.cx} cy={pip.cy} r={3.6} fill={fill} />
      ))}
    </>
  );
}

// One pipped d6. Everything between the press and the landing is CSS keyed
// off data-phase, so a row of shaking dice costs two renders: one to start
// the toss and one when the row has landed.
function Die({
  value,
  index,
  roll,
}: {
  value: number | null;
  index: number;
  roll: AbilityRoll | null;
}) {
  const phase = roll?.phase;
  const dropped = Boolean(roll) && roll?.dropIndex === index;
  const settledDrop = dropped && phase === "settled";
  const rest = roll?.rest[index];
  const style = {
    "--dx": rest?.dx ?? "0px",
    "--dy": rest?.dy ?? "0px",
    "--dr": rest?.dr ?? "0deg",
    "--toss": `${tossMs(index)}ms`,
  } as CSSProperties;
  return (
    <span className="die" data-phase={phase} style={style}>
      <span className="die-inner">
        <svg viewBox="0 0 42 42" aria-hidden="true" className="die-body">
          <rect
            x="1.5"
            y="1.5"
            width="39"
            height="39"
            rx="8.5"
            fill="url(#odm-die-body)"
            stroke={settledDrop ? "rgba(220,38,38,.35)" : "rgba(212,171,58,.35)"}
            strokeWidth="1.1"
          />
          <rect x="3.5" y="3.5" width="35" height="35" rx="6.5" fill="none" stroke="url(#odm-die-bevel)" strokeWidth="1.4" />
        </svg>
        {/* In the air the pips themselves change face. */}
        {phase === "rolling" ? (
          <span className="die-flicker">
            {FLICKER_FACES.map((face, faceIndex) => (
              <svg
                key={face}
                viewBox="0 0 42 42"
                aria-hidden="true"
                style={{ animationDelay: `${-faceIndex * 16}ms` }}
              >
                <Pips value={face} fill="url(#odm-pip-face)" />
              </svg>
            ))}
          </span>
        ) : null}
        {/* The face it lands on is mounted for the whole roll and fades up
            exactly as this die's flicker clears. */}
        {value !== null ? (
          <svg viewBox="0 0 42 42" aria-hidden="true" className="die-face">
            <Pips value={value} fill={settledDrop ? "url(#odm-pip-dim)" : "url(#odm-pip-face)"} />
          </svg>
        ) : (
          <span className="die-idle" aria-hidden="true" />
        )}
        {dropped ? (
          <span className="die-dropped" aria-hidden="true">
            ✕
          </span>
        ) : null}
      </span>
    </span>
  );
}

// The four dice of one ability. Keyed by the roll's id at the call site so a
// reroll remounts them and the toss plays again.
export function DiceRow({ roll }: { roll: AbilityRoll | null }) {
  const label = roll
    ? `Rolled ${roll.dice.join(", ")}; the ${roll.dice[roll.dropIndex]} is set aside`
    : "Not rolled yet";
  return (
    <span className="flex min-w-[192px] flex-[1_1_192px] items-center gap-[7px]" role="img" aria-label={label}>
      {[0, 1, 2, 3].map((index) => (
        <Die key={index} index={index} value={roll ? roll.dice[index] : null} roll={roll} />
      ))}
    </span>
  );
}
