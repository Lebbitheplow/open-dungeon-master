"use client";

import { useId, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import { LengthNote } from "@/components/ui/LengthNote";
import { cn } from "@/lib/cn";
import { panelField } from "@/app/campaigns/[campaignId]/PanelKit";
import {
  COMBAT_PACE_HINTS,
  COMBAT_PACE_LABELS,
  NARRATION_LENGTH_HINTS,
  NARRATION_LENGTH_LABELS,
  STYLE_NOTES_MAX,
  type CombatPace,
  type NarrationLength,
} from "@/lib/dm/narration-style-logic";
import type { GameSettings } from "@/lib/schemas/game-settings";

// The table's say over how the AI DM writes (issue #383): how long its
// narration runs, and the lead's own notes on voice and pacing. Fits the
// prose to the model and the table without touching the DM's instructions
// (src/lib/dm/narration-style-logic.ts).
export function NarrationStyleRows({
  settings,
  patch,
}: {
  settings: GameSettings;
  patch: (update: Partial<GameSettings>) => void;
}) {
  const notesId = useId();
  const [notes, setNotes] = useState(settings.styleNotes);
  // Another seat's save, or this one's coming back trimmed: the box follows
  // the server's copy whenever that copy changes.
  const [served, setServed] = useState(settings.styleNotes);
  if (served !== settings.styleNotes) {
    setServed(settings.styleNotes);
    setNotes(settings.styleNotes);
  }
  const over = notes.length > STYLE_NOTES_MAX;

  return (
    <>
      <div data-settings-row="narration-length" className="reveal flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Length</span>
        <Tooltip content="How long the DM's narration runs. Short suits a model that runs long and flowery; Rich gives a terse model room. Standard leaves it to the model.">
          <span className="inline-flex min-w-0 max-w-full">
            <Select<NarrationLength>
              size="sm"
              label="Narration length"
              value={settings.narrationLength}
              onChange={(narrationLength) => patch({ narrationLength })}
              options={(Object.keys(NARRATION_LENGTH_LABELS) as NarrationLength[]).map((length) => ({
                value: length,
                label: `${NARRATION_LENGTH_LABELS[length]} narration`,
              }))}
              className="min-w-0 max-w-full"
            />
          </span>
        </Tooltip>
        <span key={settings.narrationLength} className="live-in text-stone-500">
          {NARRATION_LENGTH_HINTS[settings.narrationLength]}
        </span>
      </div>
      <div data-settings-row="combat-pace" className="reveal flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Fights</span>
        <Tooltip content="How often the AI DM's world brings a fight: how soon trouble finds the party on its own, whether that trouble wants a fight, and how the story plans its acts. Balanced leaves it to the story.">
          <span className="inline-flex min-w-0 max-w-full">
            <Select<CombatPace>
              size="sm"
              label="How often fights come"
              value={settings.combatPace ?? "balanced"}
              onChange={(combatPace) => patch({ combatPace })}
              options={(Object.keys(COMBAT_PACE_LABELS) as CombatPace[]).map((pace) => ({
                value: pace,
                label: COMBAT_PACE_LABELS[pace],
              }))}
              className="min-w-0 max-w-full"
            />
          </span>
        </Tooltip>
        <span key={settings.combatPace ?? "balanced"} className="live-in text-stone-500">
          {COMBAT_PACE_HINTS[settings.combatPace ?? "balanced"]}
        </span>
      </div>
      <div data-settings-row="style-notes" className="reveal space-y-1">
        <label htmlFor={notesId} className="pk-rowlabel block">
          Style notes
        </label>
        <textarea
          id={notesId}
          value={notes}
          rows={2}
          onChange={(event) => setNotes(event.target.value)}
          // Saved when you leave the box, not on every key.
          onBlur={() => {
            const next = notes.trim();
            if (!over && next !== settings.styleNotes) {
              patch({ styleNotes: next });
            }
          }}
          placeholder='How the DM should write for this table, e.g. "Keep the pacing slow. Never decide what my character does next. Less purple prose."'
          aria-describedby={`${notesId}-length`}
          className={cn(panelField, "w-full resize-y")}
        />
        <LengthNote
          id={`${notesId}-length`}
          length={notes.length}
          max={STYLE_NOTES_MAX}
          idle="Shapes the voice and pacing; the rules and the dice stay the server's."
        />
      </div>
    </>
  );
}
