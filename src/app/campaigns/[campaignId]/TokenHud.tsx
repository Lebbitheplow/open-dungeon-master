"use client";

import {
  ArrowRightLeft,
  Crosshair,
  Eye,
  EyeOff,
  Hand,
  HandHelping,
  Heart,
  HeartCrack,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  Wind,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { StageToken } from "@/app/campaigns/[campaignId]/BoardStage";

// The radial HUD on a token (docs/vtt-parity-implementation-plan.md section
// 1.4). Six 40 px buttons in an arc, scaling in over --dur-quick. It is a
// shortcut, not a new path: every button is an existing composer action
// or an existing adjudication, with the target already known.
//
// Positioned in the board's own coordinate space as percentages, so it
// rides with the camera and never needs measuring.

export type HudAction = {
  id: string;
  label: string;
  icon: typeof Hand;
  tone?: "gold" | "ember" | "plain";
  onPick: () => void;
};

export function playerActions(
  token: StageToken,
  compose: (text: string) => void,
  pickTarget: (mode: "attack" | "cast") => void,
): HudAction[] {
  return [
    { id: "attack", label: "Attack", icon: Crosshair, tone: "ember", onPick: () => pickTarget("attack") },
    { id: "cast", label: "Cast", icon: Wand2, tone: "gold", onPick: () => pickTarget("cast") },
    { id: "dodge", label: "Dodge", icon: Shield, onPick: () => compose("I take the Dodge action.") },
    { id: "dash", label: "Dash", icon: Wind, onPick: () => compose("I Dash.") },
    { id: "disengage", label: "Disengage", icon: ArrowRightLeft, onPick: () => compose("I Disengage and step away.") },
    { id: "help", label: "Help", icon: HandHelping, onPick: () => compose("I take the Help action for ") },
  ];
}

export function dmActions(
  token: StageToken,
  handlers: {
    hold: () => void;
    teleport: () => void;
    visibility: (hidden: boolean) => void;
    damage: () => void;
    heal: () => void;
    condition: () => void;
    remove: () => void;
  },
): HudAction[] {
  const adhoc = token.kind === "npc" || token.kind === "prop";
  const combatant = token.kind === "pc" || token.kind === "enemy";
  const actions: HudAction[] = [
    { id: "hold", label: "Pick up", icon: Hand, tone: "gold", onPick: handlers.hold },
    { id: "teleport", label: "Teleport", icon: Sparkles, onPick: handlers.teleport },
  ];
  if (token.kind !== "pc") {
    actions.push({
      id: "visibility",
      label: token.hidden ? "Reveal" : "Hide",
      icon: token.hidden ? Eye : EyeOff,
      onPick: () => handlers.visibility(!token.hidden),
    });
  }
  if (combatant) {
    actions.push(
      { id: "damage", label: "Damage", icon: HeartCrack, tone: "ember", onPick: handlers.damage },
      { id: "condition", label: "Condition", icon: Tag, onPick: handlers.condition },
    );
  }
  if (token.kind === "pc") {
    actions.push({ id: "heal", label: "Heal", icon: Heart, onPick: handlers.heal });
  }
  if (adhoc) {
    actions.push({ id: "remove", label: "Take off", icon: Trash2, tone: "ember", onPick: handlers.remove });
  }
  return actions.slice(0, 7);
}

export function TokenHud({
  token,
  boardWidth,
  boardHeight,
  footprint,
  actions,
  hint,
  onClose,
}: {
  token: StageToken;
  boardWidth: number;
  boardHeight: number;
  footprint: number;
  actions: HudAction[];
  // A line under the arc: "tap an enemy" while a target is being chosen.
  hint?: string;
  onClose: () => void;
}) {
  const cx = ((token.x + footprint / 2) / boardWidth) * 100;
  const cy = ((token.y + footprint / 2) / boardHeight) * 100;
  // The arc opens upward, or downward near the top edge so it stays on the board.
  const flip = token.y < boardHeight / 3;
  const radius = 56;
  const spread = Math.min(Math.PI, actions.length * 0.52);
  const start = (flip ? Math.PI / 2 : -Math.PI / 2) - spread / 2;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      role="menu"
      aria-label={`Actions for ${token.name}`}
    >
      <div
        className="absolute"
        style={{ left: `${cx}%`, top: `${cy}%`, width: 0, height: 0 }}
      >
        {actions.map((action, index) => {
          const angle = start + (actions.length === 1 ? spread / 2 : (index / (actions.length - 1)) * spread);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              title={action.label}
              aria-label={action.label}
              onClick={(event) => {
                event.stopPropagation();
                action.onPick();
              }}
              className={cn(
                "pointer-events-auto fx-pop absolute flex size-10 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border shadow-elev-2 backdrop-blur",
                action.tone === "gold"
                  ? "border-amber-500/70 bg-stone-950/95 text-amber-200 hover:bg-amber-950/70"
                  : action.tone === "ember"
                    ? "border-ember-500/70 bg-stone-950/95 text-ember-300 hover:bg-red-950/60"
                    : "border-stone-600 bg-stone-950/95 text-stone-200 hover:bg-stone-800",
              )}
              style={{
                left: x,
                top: y,
                animationDelay: `${index * 22}ms`,
              }}
            >
              <Icon className="size-4" />
              <span className="sr-only">{action.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label="Close"
          className="pointer-events-auto fx-pop absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-stone-700 bg-stone-950/95 text-stone-400 hover:text-stone-100"
          style={{ left: 0, top: flip ? -radius - 16 : radius + 16 }}
        >
          <X className="size-3.5" />
        </button>
        {hint ? (
          <p
            className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-950/90 px-2 py-0.5 text-[11px] text-amber-200 shadow-elev-1"
            style={{ left: 0, top: flip ? radius + 18 : -radius - 30 }}
          >
            {hint}
          </p>
        ) : null}
        {actions.map((action, index) => {
          const angle = start + (actions.length === 1 ? spread / 2 : (index / (actions.length - 1)) * spread);
          const x = Math.cos(angle) * (radius + 28);
          const y = Math.sin(angle) * (radius + 28);
          return (
            <span
              key={`label-${action.id}`}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-stone-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
              style={{ left: x, top: y }}
            >
              {action.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
