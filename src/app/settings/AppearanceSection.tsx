"use client";

import { Moon, Sun, SunMoon } from "lucide-react";
import { PageSection } from "@/components/PageShell";
import { cn } from "@/lib/cn";
import { UI_SCALE_MAX, UI_SCALE_MIN, useThemePrefs, writeThemeChoice, writeUiScale, type ThemeChoice } from "@/lib/theme-mode";

// Appearance (docs/vtt-parity-implementation-plan.md section 14): the night
// or the day theme, the OS's choice by default, and how large the interface
// reads. Both are kept on this device, not on the account.
const CHOICES: Array<{ id: ThemeChoice; label: string; icon: typeof Sun }> = [
  { id: "auto", label: "Follow the system", icon: SunMoon },
  { id: "dark", label: "Arcane night", icon: Moon },
  { id: "light", label: "Parchment day", icon: Sun },
];

export function AppearanceSection() {
  const { choice, scale } = useThemePrefs();
  return (
    <PageSection heading="Appearance" intro="Kept on this device. The board and its canvases draw at their own size whatever the scale.">
      <div className="flex flex-wrap gap-2">
        {CHOICES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={choice === entry.id}
            onClick={() => writeThemeChoice(entry.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors duration-[var(--dur-quick,150ms)]",
              choice === entry.id ? "border-amber-700 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            <entry.icon className="size-3.5" /> {entry.label}
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-stone-400">
        Interface scale
        <input
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={0.05}
          value={scale}
          onChange={(event) => writeUiScale(Number(event.target.value))}
          className="w-40 accent-amber-400"
        />
        <span className="w-10 text-right tabular-nums text-stone-300">{Math.round(scale * 100)}%</span>
        {scale !== 1 ? (
          <button type="button" onClick={() => writeUiScale(1)} className="text-[11px] text-stone-500 underline-offset-2 hover:text-amber-200 hover:underline">
            Reset
          </button>
        ) : null}
      </label>
    </PageSection>
  );
}
