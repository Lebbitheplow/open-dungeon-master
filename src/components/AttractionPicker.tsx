"use client";

import { useId } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { ATTRACTION_CHOICES, ATTRACTION_NOTE_MAX, type Attraction } from "@/lib/attraction";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// "Drawn to" (issue 501): who a character or an NPC could fall for, as
// chips beside their gender and a short note. One tap picks or drops a
// chip; nothing picked means unspecified. A real group with a visible label,
// each chip a pressed-or-not button at the kit's 40px, so it reads and works
// the same by keyboard, by finger and to a screen reader.
export function AttractionPicker({
  value,
  onChange,
  hint,
  className,
}: {
  value: Attraction;
  onChange: (next: Attraction) => void;
  // The ⓘ text: what blank means differs for a character and an NPC.
  hint: string;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={cn("min-w-0", className)} data-attraction-picker>
      <span className="mb-1 flex items-center gap-1 text-xs text-stone-400">
        <span id={labelId}>Drawn to</span>
        <InfoButton label="Drawn to" text={hint} />
      </span>
      <span className="flex flex-wrap gap-1.5">
        {ATTRACTION_CHOICES.map((choice) => {
          const on = value.genders.includes(choice.gender);
          return (
            <button
              key={choice.gender}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange({
                  ...value,
                  genders: on
                    ? value.genders.filter((gender) => gender !== choice.gender)
                    : ATTRACTION_CHOICES.map((entry) => entry.gender).filter(
                        (gender) => gender === choice.gender || value.genders.includes(gender),
                      ),
                })
              }
              className="inline-flex h-10 items-center rounded-full border border-stone-700/70 bg-stone-950/60 px-3 text-xs text-stone-300 transition-colors duration-150 hover:border-amber-500/40 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 aria-pressed:border-rose-400/60 aria-pressed:bg-rose-500/10 aria-pressed:text-rose-100 motion-press"
            >
              {choice.label}
            </button>
          );
        })}
      </span>
      <input
        value={value.note}
        maxLength={ATTRACTION_NOTE_MAX}
        onChange={(event) => onChange({ ...value, note: event.target.value })}
        placeholder="A note, if it needs one (optional)"
        aria-label="Drawn to: a note"
        className={cn(ui.input, "mt-1.5 h-10")}
      />
    </div>
  );
}

export const CHARACTER_ATTRACTION_HINT =
  "Who your character could fall for. Leave it blank and nothing changes; it only matters at a table with romance on, where an NPC who courts your character is one this fits.";

export const NPC_ATTRACTION_HINT =
  "Who they could fall for. Blank means not decided yet: the DM settles it the first time it matters, and it then stays.";
