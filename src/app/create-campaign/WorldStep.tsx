"use client";

import { ImageIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS } from "@/lib/genres";
import type { Genre } from "@/lib/schemas/game-settings";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { FieldLabel } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import {
  arrivalTypeIn,
  dmFlavorText,
  portalCards,
  typeInPlan,
  worldFacts,
  type TypeInPlan,
} from "@/app/create-campaign/portals";

// A card has no room for a ⓘ of its own, and a `title` tooltip never opens
// under a finger, so every setting is also spelled out in one dialog on the
// label.
const SETTING_INFO = `The setting decides how the world sounds, what the maps and portraits look like, and which classes and backgrounds the character builder floats to the top. It changes no rule: every setting plays 5e.\n\n${GENRE_PRESETS.map(
  (preset) => `**${preset.name}**: ${preset.blurb}`,
).join("\n\n")}`;

// Step 2: the setting as eight painted portals, its custom description, the
// theme the preset writes (and the person may overwrite), the premise, and a
// read-back of what the choice tells the Dungeon Master.
// Cover art is only pointed at from here: the upload and the AI painter live
// in the campaign's details dialog, because a cover needs a campaign row to
// hang off, and duplicating the picker here would mean two upload paths.
export function WorldStep({
  draft,
  patch,
  gates,
  active,
  selectedPack,
  onPickGenre,
}: StepProps & {
  // True while this is the step on screen; entrances wait for it.
  active: boolean;
  selectedPack: WorldPackSummary | null;
  // Picking a bare genre by hand leaves the pack and lets the preset write
  // the theme, so the dialog owns the handler that does all three.
  onPickGenre: (genre: Genre) => void;
}) {
  const showsAiFill = gates.aiNarrates && draft.aiStorySetup;
  // The type-in is a clip played over the input while its own text hides;
  // `run` re-keys it so a second pick replays it.
  const [typing, setTyping] = useState<(TypeInPlan & { run: number }) | null>(null);
  const [arrived, setArrived] = useState(false);
  if (active && !arrived) {
    setArrived(true);
    const plan = arrivalTypeIn(draft);
    if (plan) {
      setTyping({ ...plan, run: 0 });
    }
  }

  const pick = (genre: Genre) => {
    const plan = typeInPlan(draft, genre);
    onPickGenre(genre);
    setTyping((current) => (plan ? { ...plan, run: (current?.run ?? 0) + 1 } : null));
  };

  // Only while the line on screen is the line being typed: a pack applied
  // from step one, or anything else that rewrote the theme, ends it.
  const typingNow = typing !== null && typing.text === draft.theme;
  const themeNote = draft.themeTouched
    ? "yours; nothing will overwrite it"
    : draft.worldPack
      ? "written by the world pack"
      : draft.theme
        ? "written by the preset"
        : "yours to write";

  return (
    <div className={cn("space-y-4 text-sm", active && "cc-live")}>
      <div>
        <FieldLabel className="mb-0">
          <span className="flex items-center gap-1">
            Setting
            <InfoButton label="Settings" text={SETTING_INFO} />
          </span>
        </FieldLabel>
        <div className="cc-portal-grid">
          {portalCards(draft.genre).map((card) => (
            <div
              key={card.id}
              className="cc-portal-slot"
              style={{ "--cc-delay": `${card.delayMs}ms` } as CSSProperties}
            >
              <button
                type="button"
                onClick={() => pick(card.id)}
                aria-pressed={card.chosen}
                className="cc-portal motion-card"
              >
                <span
                  role="img"
                  aria-label={`${card.name} cover plate`}
                  className="cc-plate"
                  style={{ backgroundImage: `url("${card.plate}")` }}
                >
                  <span className="cc-plate-name">{card.name}</span>
                  {card.humansOnly ? <span className="cc-humans">humans only</span> : null}
                </span>
                <span className="cc-portal-body">
                  <span className="cc-portal-blurb">{card.blurb}</span>
                  <span className="cc-portal-foot">
                    <span className="cc-chip">{card.climate}</span>
                    <span className="cc-cta">{card.chosen ? "Chosen" : "Tap to choose"}</span>
                  </span>
                </span>
              </button>
              {card.chosen ? (
                <span className="cc-chosen" aria-hidden="true">
                  ✓ Chosen
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {draft.genre === "custom" ? (
          <div className="cc-custom mt-2">
            <span className="cc-eyebrow mb-1 block">Describe it yourself</span>
            <p className="cc-prose mb-2 text-[13px] leading-relaxed text-stone-300">
              Custom writes nothing for you. The theme and premise boxes stay yours, and what you
              describe here goes to the DM in place of a preset tone.
            </p>
            <span className="cc-serif block">
              <textarea
                value={draft.customGenreText}
                onChange={(event) => patch({ customGenreText: event.target.value })}
                rows={2}
                maxLength={500}
                placeholder="Describe the world and tone in your own words..."
                className="cc-bare"
              />
            </span>
          </div>
        ) : null}
      </div>

      <label
        className={cn("cc-field block", typingNow && "cc-typing")}
        data-written={draft.theme ? "true" : "false"}
        style={
          typingNow
            ? ({
                "--cc-type-ms": `${typing.typeMs}ms`,
                "--cc-type-steps": typing.chars,
                "--cc-sweep-ms": `${typing.sweepMs}ms`,
              } as CSSProperties)
            : undefined
        }
      >
        <span key={typingNow ? typing.run : "rest"} className="cc-sweep" aria-hidden="true" />
        <span className="cc-field-head">
          <span className="cc-eyebrow">World or theme notes</span>
          <span className="cc-note">{themeNote}</span>
        </span>
        <span className="cc-type-row cc-serif block">
          <input
            value={draft.theme}
            onChange={(event) => {
              setTyping(null);
              patch({ theme: event.target.value, themeTouched: true });
            }}
            maxLength={120}
            placeholder="Low-magic gritty, homebrew fey court, neon-drenched megacity..."
            className="cc-bare"
          />
          {typingNow ? (
            <span key={typing.run} className="cc-typed" aria-hidden="true">
              <span
                onAnimationEnd={(event) => {
                  if (event.animationName === "cc-typeline") {
                    setTyping(null);
                  }
                }}
              >
                {typing.text}
              </span>
            </span>
          ) : null}
        </span>
      </label>

      <div className="cc-field">
        <div className="cc-field-head">
          <span className="cc-eyebrow">How the DM will talk</span>
          <span className="cc-note">
            {selectedPack ? `${selectedPack.name} adds its own voice on top` : "read-only"}
          </span>
        </div>
        <p key={draft.genre} className="cc-flavor cc-prose text-[13px] leading-relaxed text-stone-300">
          {dmFlavorText(draft.genre)}
        </p>
        <div key={`facts-${draft.genre}`} className="cc-facts">
          {worldFacts(draft.genre).map((fact, index) => (
            <span key={fact.key} className="cc-fact" style={{ animationDelay: `${index * 70}ms` }}>
              <span className="cc-fact-key">{fact.key}</span>
              <span className="cc-fact-value">{fact.value}</span>
            </span>
          ))}
        </div>
      </div>

      <label className="cc-field block">
        <span className="cc-field-head">
          <span className="cc-eyebrow">Premise</span>
          <span className="cc-note">
            optional{showsAiFill ? "; the AI fills this in if left blank" : ""}
          </span>
        </span>
        <span className="cc-serif block">
          <textarea
            value={draft.description}
            onChange={(event) =>
              patch({ description: event.target.value, descriptionTouched: true })
            }
            rows={2}
            maxLength={500}
            className="cc-bare"
          />
        </span>
      </label>

      <div className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <ImageIcon className="mt-0.5 size-4 shrink-0 text-amber-300/70" aria-hidden="true" />
        <div>
          <span className="block text-stone-300">Cover art</span>
          <p className="mt-0.5 text-xs text-stone-500">
            You can add cover art from the campaign&apos;s details once it exists.
          </p>
        </div>
      </div>
    </div>
  );
}
