"use client";

import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { InfoButton } from "@/components/ui/InfoDialog";
import { replayAnimation } from "@/lib/motion/replay";
import {
  BONDS_INFO,
  LIVING_WORLD_INFO,
  NARRATION_GUARD_INFO,
  ROMANCE_INFO,
} from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { NarratorFields } from "@/app/create-campaign/NarratorFields";
import { SafetyFields } from "@/app/create-campaign/SafetyFields";
import type { StepProps } from "@/app/create-campaign/draft";
import {
  countableRows,
  featuresOn,
  flipRow,
  tableSheet,
  type SheetInfo,
  type SheetRow,
} from "@/app/create-campaign/table-sheet";

// The count lives with the rows it counts; the review step still finds it here.
export { featuresOn };

const INFO: Record<SheetInfo, { label: string; text: string }> = {
  livingWorld: { label: "What does Living World do?", text: LIVING_WORLD_INFO },
  bonds: { label: "What are Bonds?", text: BONDS_INFO },
  romance: { label: "How does Romance work?", text: ROMANCE_INFO },
  narrationGuard: { label: "What is the outcome check?", text: NARRATION_GUARD_INFO },
};

// Step 4, the table sheet: the switches in four groups with a running total,
// then the AI allies, the narrator voice, and safety and tone. Voice
// narration and maps stay visible but disabled when the server lacks the
// backend, because they are one server switch away rather than a feature
// this install can never have; the AI-only rows hide when a human narrates.
// Which rows exist, and what a press does, is table-sheet.ts.
export function FeelStep(props: StepProps & { active: boolean }) {
  const { draft, patch, gates, active } = props;
  const counter = useRef<HTMLSpanElement>(null);
  const groups = tableSheet(draft, gates);

  const flip = (row: SheetRow) => {
    patch(flipRow(draft, row.key));
    // The total answers every press, including one that does not move it.
    replayAnimation(counter.current, "cc-count-pop var(--dur-beat) var(--ease-spring)");
  };

  return (
    <div className={cn("space-y-4 text-sm", active && "cc-live")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="cc-note min-w-0 flex-1 basis-32 leading-relaxed">
          The gold dot marks a switch the total counts.
        </p>
        <div className="cc-counter" aria-live="polite">
          <span ref={counter} className="cc-count">
            {featuresOn(draft, gates)}
          </span>
          <span className="flex flex-col">
            <span className="cc-eyebrow text-amber-300">features on</span>
            <span className="cc-note">of {countableRows(gates)} counted</span>
          </span>
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.id}>
          <div className="cc-group-head">
            <span className="cc-eyebrow">{group.label}</span>
            <span className="cc-group-rule" aria-hidden="true" />
            {group.note ? <span className="cc-note">{group.note}</span> : null}
          </div>
          <div className="cc-sheet-grid">
            {group.rows.map((row) => (
              <div
                key={row.key}
                className="cc-row-slot"
                data-dependent={row.dependent ? "true" : "false"}
                data-info={row.info ? "true" : "false"}
              >
                <button
                  type="button"
                  disabled={row.disabled}
                  aria-pressed={row.on}
                  onClick={() => flip(row)}
                  className="cc-row motion-press"
                >
                  <span
                    className="cc-switch"
                    style={{ "--knob": row.knob } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="cc-row-label">{row.label}</span>
                    <span className="cc-row-hint">{row.hint}</span>
                  </span>
                </button>
                {row.counted && row.on ? <span className="cc-dot" aria-hidden="true" /> : null}
                {row.info ? (
                  <InfoButton
                    label={INFO[row.info].label}
                    text={INFO[row.info].text}
                    className="absolute right-1.5 top-1.5"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      <p className="cc-note leading-relaxed">
        Theatre inserts, drawing on the board, enemy intent and characters per player are choices
        too, but they are left out of the total.
      </p>

      <NarratorFields {...props} className={cn(!gates.aiNarrates && !draft.ttsEnabled && "hidden")} />
      <SafetyFields {...props} />
    </div>
  );
}
