"use client";

import { PageSection } from "@/components/PageShell";
import { GameIcon } from "@/components/ui/GameIcon";
import { Slider } from "@/components/ui/Slider";
import { ui } from "@/lib/ui";
import { UI_SCALE_MAX, UI_SCALE_MIN, useThemePrefs, writeThemeChoice, writeUiScale, type ThemeChoice } from "@/lib/theme-mode";

// Appearance (docs/vtt-parity-implementation-plan.md section 14): the night
// or the day theme, the OS's choice by default, and how large the interface
// reads. Both are kept on this device, not on the account.
const CHOICES: Array<{ id: ThemeChoice; label: string; glyph: string }> = [
  { id: "auto", label: "Follow the system", glyph: "daypart-dusk" },
  { id: "dark", label: "Arcane night", glyph: "daypart-night" },
  { id: "light", label: "Parchment day", glyph: "daypart-day" },
];

export function AppearanceSection() {
  const { choice, scale } = useThemePrefs();
  return (
    <PageSection
      heading="Appearance"
      glyph="sense-darkvision"
      intro="Kept on this device. The board and its canvases draw at their own size whatever the scale."
    >
      <div data-pill-group="" role="group" aria-label="Theme" className="flex flex-wrap gap-2">
        {CHOICES.map((entry) => (
          <button
            data-on={choice === entry.id ? "" : undefined}
            key={entry.id}
            type="button"
            aria-pressed={choice === entry.id}
            onClick={() => writeThemeChoice(entry.id)}
            className="theme-card motion-press"
          >
            <GameIcon icon={{ kind: "glyph", key: entry.glyph }} size="size-8" /> {entry.label}
          </button>
        ))}
      </div>
      <div className="mt-4 text-xs text-stone-400">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span>Interface scale</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-stone-300">{Math.round(scale * 100)}%</span>
            {scale !== 1 ? (
              <button type="button" onClick={() => writeUiScale(1)} className={`${ui.btnSmall} reveal-pop px-2 py-1 text-[11px]`}>
                Reset
              </button>
            ) : null}
          </span>
        </div>
        <Slider
          label="Interface scale"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={0.05}
          value={scale}
          onChange={writeUiScale}
          bubble={(value) => `${Math.round(value * 100)}%`}
        />
      </div>
    </PageSection>
  );
}
