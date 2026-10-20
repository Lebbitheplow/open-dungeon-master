"use client";

import { useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { EASY_CLASSES, PLAYSTYLES, playstyleSuggestions, type PlaystyleId } from "./playstyles";

// A new player's way in: pick your job in a fight, see the classes that
// suit it with the easy ones marked, and choose one or keep browsing the
// full grid. Nothing is chosen for the player. The first step asks it
// first; the class step opens on the same answer (`style` is the builder's).
// It is the quick-build quiz's first question too: `onHelpMeBuild` offers
// the other three, and a whole character from the answers.
export function PlaystylePicker({
  offered,
  chosen,
  onChoose,
  style: heldStyle,
  onStyle,
  intro = "Not sure which class? Start from your job in a fight.",
  question = "In a fight, what's your job?",
  onHelpMeBuild,
}: {
  offered: Array<{ id: string; name: string; roles: string[]; playsLike: string }>;
  chosen: string;
  onChoose: (classId: string) => void;
  style?: PlaystyleId | null;
  onStyle?: (style: PlaystyleId | null) => void;
  intro?: string;
  // The DM's quick companion asks it of the party.
  question?: string;
  onHelpMeBuild?: (style: PlaystyleId | null) => void;
}) {
  const [ownStyle, setOwnStyle] = useState<PlaystyleId | null>(null);
  const style = onStyle ? (heldStyle ?? null) : ownStyle;
  const setStyle = onStyle ?? setOwnStyle;
  const suggestions = style ? playstyleSuggestions(style, offered) : [];
  return (
    <div className="space-y-2.5" data-playstyle>
      <p className="text-xs text-stone-400">{intro}</p>
      <div data-pill-group="" className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={question}>
        {PLAYSTYLES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={style === entry.id}
            data-on={style === entry.id ? "" : undefined}
            onClick={() => setStyle(style === entry.id ? null : entry.id)}
            title={entry.blurb}
            className="session-subtab motion-press"
          >
            {entry.label} <strong className="font-semibold">({entry.tag})</strong>
          </button>
        ))}
      </div>
      {onHelpMeBuild ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400" data-quick-door="">
          <span className="min-w-0 flex-1">
            {style
              ? "Or answer three more questions and get a whole character, ready to change before you save."
              : "Or answer four questions and get a whole character, ready to change before you save."}
          </span>
          <button
            type="button"
            onClick={() => onHelpMeBuild(style)}
            className="motion-press rounded-md border border-sky-500/50 px-2 py-1 text-sky-100 transition-colors hover:bg-sky-500/10"
          >
            Help me build
          </button>
        </div>
      ) : null}
      {style ? (
        <div key={style} className="reveal-height space-y-1.5">
          <p className="text-xs text-stone-500">{PLAYSTYLES.find((entry) => entry.id === style)?.blurb}</p>
          {suggestions.length ? (
            <ul className="stagger-up grid gap-2 sm:grid-cols-3">
              {suggestions.map((id) => {
                const entry = offered.find((candidate) => candidate.id === id);
                if (!entry) return null;
                const picked = chosen === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onChoose(id)}
                      aria-pressed={picked}
                      className={cn(
                        "motion-press flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                        picked ? "border-amber-400/60 bg-amber-400/10" : "border-stone-800 bg-stone-950/50 hover:border-amber-500/40",
                      )}
                    >
                      <GameIcon icon={{ kind: "family", key: `class-${id}` }} size="size-8" className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-sm tracking-wide text-amber-50">{entry.name}</span>
                        <span className="block text-[11px] text-stone-500">{entry.roles.join(" / ")}</span>
                      </span>
                      {EASY_CLASSES.has(id) ? (
                        <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
                          Easy to learn
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-stone-500">No class here fits that exactly; every class is in the grid below.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
