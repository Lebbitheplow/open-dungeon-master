"use client";

import { useMemo, useState } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeRace } from "@/lib/help";
import type { Reskinned } from "@/lib/worlds/reskin-logic";
import { LineageCarousel, type LineageSlide } from "../LineageCarousel";
import { asiChips, flattenGroups, lineageArt, lineageTagline } from "../lineage";
import { OptionCardGrid, type OptionCardGroup } from "../OptionCardGrid";
import type { PickerGroup } from "../OptionPicker";
import { RacialChoicesSection } from "../RacialChoicesSection";
import type { BackgroundOption, RaceOption } from "../useBuilderOptions";
import type { BuilderState } from "../useBuilderState";
import { bonusLanguageCount } from "../submit";
import { StepPanel, inputClass } from "./shared";

function languageHelp(race: RaceOption, background: BackgroundOption | undefined): string {
  const parts = [`${race.name} speaks ${race.languages.join(" and ")}`];
  if (race.bonusLanguages > 0) {
    parts.push(`plus ${race.bonusLanguages} of your choice`);
  }
  if (background?.languages) {
    parts.push(
      `${race.bonusLanguages > 0 ? "and" : "plus"} ${background.languages} more from your ${background.name} background`,
    );
  }
  return `${parts.join(" ")}.`;
}

// Step 2: where they are from. The lineage grid (every race the picker
// offered, in the picker's groups and order, the setting's peoples first and
// badged), the detail carousel behind each card's "?", then every choice the
// race leaves to the player: bonus languages, ability bumps, skills, tool,
// cantrip.
export function AncestryStep({
  state,
  race,
  background,
  races,
  raceGroups,
}: {
  state: BuilderState;
  race: RaceOption | undefined;
  background: BackgroundOption | undefined;
  races: Array<Reskinned<RaceOption>>;
  raceGroups: PickerGroup[];
}) {
  // The race's bonus languages plus the background's (an acolyte or a sage
  // learns two more), which used to be loaded and never asked for.
  const languageCount = bonusLanguageCount(race, background);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const { gender } = state;

  // One slide per picker row, in the picker's order, so the carousel walks
  // exactly what the grid shows.
  const slides = useMemo<LineageSlide[]>(
    () =>
      flattenGroups(raceGroups).flatMap(({ option, group, recommended }) => {
        const entry = races.find((candidate) => candidate.id === option.id);
        if (!entry) {
          return [];
        }
        return [
          {
            ...entry,
            art: lineageArt(entry.id, `${option.meta ?? ""} ${entry.name}`, gender),
            canonical: option.meta,
            group,
            recommended,
            info: { text: option.infoText, reference: option.reference },
          },
        ];
      }),
    [raceGroups, races, gender],
  );

  const cardGroups = useMemo<OptionCardGroup[]>(
    () =>
      raceGroups.map((group) => ({
        label: group.label,
        recommended: group.recommended,
        options: group.options.flatMap((option) => {
          const slide = slides.find((candidate) => candidate.id === option.id);
          if (!slide) {
            return [];
          }
          return [
            {
              id: slide.id,
              name: slide.name,
              meta: slide.canonical,
              art: slide.art,
              // Under a reskin the canonical name leads, so a player always
              // knows which SRD race they are actually taking.
              tagline: [slide.canonical, lineageTagline(slide)].filter(Boolean).join(" · "),
              chips: asiChips(slide.asi)
                .slice(0, 2)
                .map((chip) => chip.label),
            },
          ];
        }),
      })),
    [raceGroups, slides],
  );

  return (
    <div className="space-y-4">
      <StepPanel
        title="Where are they from?"
        ornate
        help={
          race
            ? `${race.name} is chosen. Every lineage grants its own ability bumps, senses and tongues: tap a card to choose it, or its ? to read what it hands you first.`
            : "Tap a card to choose a lineage, or its ? to read what it hands you first."
        }
      >
        {race?.note ? (
          <span className="mb-3 flex items-start gap-1 text-xs text-stone-500">
            <span className="line-clamp-2 grow">
              <span className="text-amber-200">{race.name}: </span>
              {race.note}
            </span>
            <InfoButton
              label={race.name}
              text={describeRace(race.id) ?? race.note}
              reference={{ kind: "races", slug: race.id }}
            />
          </span>
        ) : null}
        <OptionCardGrid
          groups={cardGroups}
          value={race?.id ?? ""}
          onChoose={state.changeRace}
          onDetails={(id) => setDetailIndex(slides.findIndex((slide) => slide.id === id))}
          noun="lineage"
        />
        <LineageCarousel
          slides={slides}
          index={detailIndex !== null && detailIndex >= 0 ? detailIndex : null}
          onIndexChange={setDetailIndex}
          chosenId={race?.id ?? ""}
          onChoose={state.changeRace}
        />
      </StepPanel>

      {race && languageCount > 0 ? (
        <StepPanel
          title={
            <span className="flex items-center gap-1">
              Bonus {languageCount === 1 ? "language" : "languages"}
              <InfoButton
                label="Languages"
                text={
                  "A language you know is one you can speak, read and write. It decides who your character can talk to without help, and it comes up more than new players expect: half the trouble in a dungeon is written on a wall.\n\nCommon is the trade tongue everyone shares. The rest are the tongues of particular peoples: Dwarvish, Elvish, Orc, Draconic and so on. Pick whatever fits where your character grew up, or whoever you expect to be negotiating with."
                }
              />
            </span>
          }
          help={languageHelp(race, background)}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: languageCount }, (_, index) => (
              <Select<string>
                key={index}
                value={state.bonusLanguages[index] ?? ""}
                onChange={(picked) =>
                  state.setBonusLanguages((current) => {
                    const next = [...current];
                    next[index] = picked;
                    return next;
                  })
                }
                className="w-full"
                label={`Bonus language ${index + 1}`}
                placeholder="Choose a language..."
                options={[
                  { value: "", label: "Choose a language..." },
                  ...STANDARD_LANGUAGES.filter(
                    (language) =>
                      !race.languages.includes(language) &&
                      (state.bonusLanguages[index] === language || !state.bonusLanguages.includes(language)),
                  ).map((language) => ({ value: language as string, label: language as string })),
                ]}
              />
            ))}
          </div>
        </StepPanel>
      ) : null}

      {race ? (
        <RacialChoicesSection
          race={race}
          grantedSkills={[
            ...state.chosenSkills,
            ...(background?.skills ?? []),
            ...(race.skills ?? []),
          ]}
          asi={state.racialAsi}
          onAsiChange={(index, ability) =>
            state.setRacialAsi((current) => {
              const next = [...current];
              next[index] = ability;
              return next;
            })
          }
          skills={state.racialSkills}
          onSkillsChange={(index, skill) =>
            state.setRacialSkills((current) => {
              const next = [...current];
              next[index] = skill;
              return next;
            })
          }
          cantrip={state.racialCantrip}
          onCantripChange={state.setRacialCantrip}
          tool={state.racialTool}
          onToolChange={state.setRacialTool}
          inputClass={inputClass}
        />
      ) : null}
    </div>
  );
}
