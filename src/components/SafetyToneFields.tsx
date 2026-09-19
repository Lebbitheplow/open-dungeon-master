"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import {
  BOUNDARIES,
  STRICTNESS,
  TONES,
  TONE_MAX,
  type Boundaries,
  type GmSettings,
  type SafetySettings,
  type Strictness,
  type Tone,
} from "@/lib/dm/safety-logic";
import type { Personality } from "@/lib/dm/personalities";

// Safety, strictness and tone (docs/vtt-parity-implementation-plan.md
// section 9), shared by the creation wizard's Feel step and the lobby's
// settings. Lines and veils are typed as lists; the boundary, strictness
// and tone are chips; a personality preset fills strictness, tone and the
// narrator's voice at once.

const chip = "rounded-md border px-2 py-0.5 text-[11px]";
const on = "border-amber-700 bg-amber-950/40 text-amber-100";
const off = "border-stone-700 text-stone-400 hover:text-stone-200";

export const BOUNDARY_LABELS: Record<Boundaries, string> = { family: "All ages", standard: "Standard", mature: "Mature" };
export const STRICTNESS_LABELS: Record<Strictness, string> = { lenient: "Lenient", standard: "By the book", harsh: "Harsh" };

function ListField({ label, hint, value, onChange }: { label: string; hint: string; value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-stone-400">{label}</span>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onChange(text.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 12))}
        placeholder={hint}
        className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 outline-none focus:border-amber-600"
      />
    </label>
  );
}

export function SafetyToneFields({
  safety,
  gm,
  ttsVoice,
  onSafety,
  onGm,
  onVoice,
  showPresets = true,
}: {
  safety: SafetySettings;
  gm: GmSettings;
  ttsVoice?: string;
  onSafety: (next: SafetySettings) => void;
  onGm: (next: GmSettings) => void;
  onVoice?: (voice: string) => void;
  showPresets?: boolean;
}) {
  const [presets, setPresets] = useState<Personality[]>([]);
  useEffect(() => {
    if (!showPresets) {
      return;
    }
    let cancelled = false;
    fetch("/api/personalities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { personalities?: Personality[] } | null) => {
        if (!cancelled) {
          setPresets(data?.personalities ?? []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showPresets]);
  const toggleTone = (tone: Tone) => {
    const has = gm.tone.includes(tone);
    if (!has && gm.tone.length >= TONE_MAX) {
      return;
    }
    onGm({ ...gm, tone: has ? gm.tone.filter((entry) => entry !== tone) : [...gm.tone, tone] });
  };
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">Safety</p>
        <div data-pill-group="" className="flex flex-wrap items-center gap-1.5">
          <button type="button" aria-pressed={safety.xCard} onClick={() => onSafety({ ...safety, xCard: !safety.xCard })} className={cn(chip, safety.xCard ? on : off)}>
            X-card {safety.xCard ? "on" : "off"}
          </button>
          {BOUNDARIES.map((boundary) => (
            <button data-on={safety.boundaries === boundary ? "" : undefined} key={boundary} type="button" aria-pressed={safety.boundaries === boundary} onClick={() => onSafety({ ...safety, boundaries: boundary })} className={cn(chip, safety.boundaries === boundary ? on : off)}>
              {BOUNDARY_LABELS[boundary]}
            </button>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ListField label="Lines (never in the story)" hint="spiders, harm to children" value={safety.lines} onChange={(lines) => onSafety({ ...safety, lines })} />
          <ListField label="Veils (only off the page)" hint="torture, romance" value={safety.veils} onChange={(veils) => onSafety({ ...safety, veils })} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">Strictness and tone</p>
        <div data-pill-group="" className="flex flex-wrap items-center gap-1.5">
          {STRICTNESS.map((level) => (
            <button data-on={gm.strictness === level ? "" : undefined} key={level} type="button" aria-pressed={gm.strictness === level} onClick={() => onGm({ ...gm, strictness: level })} className={cn(chip, gm.strictness === level ? on : off)}>
              {STRICTNESS_LABELS[level]}
            </button>
          ))}
        </div>
        <div className="stagger-pop mt-1.5 flex flex-wrap items-center gap-1.5">
          {TONES.map((tone) => (
            <button key={tone} type="button" aria-pressed={gm.tone.includes(tone)} onClick={() => toggleTone(tone)} className={cn(chip, gm.tone.includes(tone) ? on : off)}>
              {tone}
            </button>
          ))}
          <span className="text-[10px] text-stone-600">Up to three.</span>
        </div>
      </div>
      {showPresets && presets.length ? (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">Or pick a DM personality</p>
          <div className="stagger-pop flex flex-wrap items-center gap-1.5">
            {presets.map((preset) => {
              const active = preset.gm.strictness === gm.strictness && preset.gm.tone.join() === gm.tone.join() && (!ttsVoice || preset.ttsVoice === ttsVoice);
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.blurb}
                  aria-pressed={active}
                  onClick={() => {
                    onGm({ strictness: preset.gm.strictness, tone: [...preset.gm.tone] });
                    onVoice?.(preset.ttsVoice);
                  }}
                  className={cn(chip, active ? on : off)}
                >
                  {preset.name}
                </button>
              );
            })}
            {ttsVoice ? <VoicePreviewButton voice={ttsVoice} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
