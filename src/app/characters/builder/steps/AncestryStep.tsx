"use client";

import { repeatedGrants } from "@/lib/srd/racial-grants";
import { useMemo, useState, type ReactNode } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeRace } from "@/lib/help";
import type { Reskinned } from "@/lib/worlds/reskin-logic";
import { LineageCarousel, type LineageSlide } from "../LineageCarousel";
import { asiChips, flattenGroups, lineageArt, srdRaceFor } from "../lineage";
import { lineageFits } from "../lineageFits";
import { SRD_CLASSES } from "@/lib/srd";
import type { CardFacet } from "../OptionCardGrid";
import type { Ability } from "@/lib/schemas/sheet";
import { OptionCardGrid, type OptionCardGroup } from "../OptionCardGrid";
import type { PickerGroup } from "../OptionPicker";
import { knownTraining } from "../FeatChoicesFields";
import { RacialChoicesSection } from "../RacialChoicesSection";
import type { BackgroundOption, RaceOption } from "../useBuilderOptions";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { bonusLanguageCount } from "../submit";
import { StepPanel, inputClass } from "./shared";

function languageHelp(race: RaceOption, background: BackgroundOption | undefined): string {
  const parts = [`${race.name} speaks ${race.languages.join(" and ")}`];
  const choice = race.languageChoice;
  const open = race.bonusLanguages - (choice?.count ?? 0);
  if (choice) {
    parts.push(`plus ${choice.count === 1 ? "one" : choice.count} of ${choice.from.join(", ")}`);
  }
  if (open > 0) {
    parts.push(`${choice ? "and" : "plus"} ${open} of your choice`);
  }
  if (background?.knownLanguages?.length) {
    parts.push(`and ${background.knownLanguages.join(" and ")} from your ${background.name} background`);
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
  derived,
  race,
  background,
  races,
  raceGroups,
  listNote = null,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  background: BackgroundOption | undefined;
  races: Array<Reskinned<RaceOption>>;
  raceGroups: PickerGroup[];
  // Why the list may be short (TableScopeNote).
  listNote?: ReactNode;
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
            // Named on the card only where the group heading is not the book.
            sourceOnCard: option.source,
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
              // knows which SRD race they are actually taking; then the
              // book, where the heading does not say it (issue #116).
              // Then the classes its bonuses suit ("Suits Bard, Sorcerer"),
              // where a phrase restating its biggest bonus used to sit.
              tagline: [slide.canonical, slide.sourceOnCard, suitsLine(slide)].filter(Boolean).join(" · "),
              chips: asiChips(slide.asi)
                .slice(0, 2)
                .map((chip) => chip.label),
            },
          ];
        }),
      })),
    [raceGroups, slides],
  );
  const facets = useMemo(() => raceFacets(slides), [slides]);

  return (
    <div className="space-y-4">
      <StepPanel
        title="Where are they from?"
        ornate
        anchor="race"
        help={
          race
            ? `${race.name} is chosen. Every lineage grants its own ability bumps, senses and tongues: tap a card to choose it, or its ? to read what it hands you first.`
            : "Tap a card to choose a lineage, or its ? to read what it hands you first."
        }
      >
        {race?.note ? (
          <span className="mb-3 flex items-start gap-1 text-xs text-stone-500">
            <span className="line-clamp-2 grow">
              <span className="text-amber-200">{race.name}</span>
              {race.source ? <span className="font-mono text-[0.6875rem] text-stone-500"> · {race.source}</span> : null}
              <span className="text-amber-200">: </span>
              {race.note}
            </span>
            <InfoButton
              label={race.name}
              text={describeRace(race.id) ?? race.note}
              reference={{ kind: "races", slug: race.slug ?? race.id }}
            />
          </span>
        ) : null}
        <OptionCardGrid
          groups={cardGroups}
          value={race?.id ?? ""}
          onChoose={state.changeRace}
          onDetails={(id) => setDetailIndex(slides.findIndex((slide) => slide.id === id))}
          noun="lineage"
          facets={facets}
        />
        {listNote}
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
          anchor="languages"
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
                  // A race that offers "your choice of Common or Undercommon"
                  // fills its first slots from that list only.
                  ...(race.languageChoice && index < race.languageChoice.count
                    ? race.languageChoice.from
                    : STANDARD_LANGUAGES
                  ).filter(
                    (language) =>
                      !race.languages.includes(language) &&
                      !(background?.knownLanguages ?? []).includes(language) &&
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
            ...state.backgroundSkills,
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
          ancestry={state.racialAncestry}
          onAncestryChange={state.setRacialAncestry}
          repeated={repeatedGrants(background?.skills, race.skills)}
          repeatSkills={state.repeatSkills}
          onRepeatChange={(index, skill) =>
            state.setRepeatSkills((current) => {
              const next = [...current];
              next[index] = skill;
              return next;
            })
          }
          feats={state.feats}
          onFeatsChange={state.setFeats}
          featAbility={state.racialFeatAbility}
          onFeatAbilityChange={state.setRacialFeatAbility}
          featSpecOf={derived.featSpecOf}
          featDescOf={derived.featDescOf}
          featChoices={state.featChoices}
          onFeatPicks={state.setFeatPicks}
          known={knownTraining(derived)}
          inputClass={inputClass}
        />
      ) : null}
    </div>
  );
}

// The first two classes a lineage's bonuses suit, for its card.
function suitsLine(slide: LineageSlide): string {
  const fits = lineageFits(slide, 2);
  if (!fits) {
    return "";
  }
  return fits.kind === "any" ? "Suits any class" : `Suits ${fits.names.join(", ")}`;
}

const ABILITY_WORDS: Array<[Ability, string]> = [
  ["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"],
  ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"],
];

// The race grid's filters: what a lineage raises, which classes it suits,
// its size and its book. Each offers only the values some lineage has. A
// lineage whose bumps are the player's to place raises anything they like
// and suits any class.
function raceFacets(slides: LineageSlide[]): CardFacet[] {
  const byId = new Map(slides.map((slide) => [slide.id, slide]));
  const sizeOf = (id: string) => srdRaceFor(id)?.size ?? "";
  const bookOf = (slide: LineageSlide) => slide.source || "Core rules";
  const sizes = [...new Set(slides.map((slide) => sizeOf(slide.id)).filter(Boolean))].sort();
  const books = [...new Set(slides.map(bookOf))].sort();
  return [
    {
      key: "raises",
      label: "Raises",
      options: ABILITY_WORDS.map(([value, label]) => ({ value, label })),
      test: (id, ability) => {
        const slide = byId.get(id);
        return Boolean(slide && ((slide.asi[ability as Ability] ?? 0) > 0 || slide.asiChoice));
      },
    },
    {
      key: "suits",
      label: "Good for",
      options: SRD_CLASSES.map((klass) => ({ value: klass.name, label: klass.name })),
      test: (id, className) => {
        const slide = byId.get(id);
        const fits = slide ? lineageFits(slide, 13) : null;
        return Boolean(fits && (fits.kind === "any" || fits.names.includes(className)));
      },
    },
    ...(sizes.length > 1
      ? [{ key: "size", label: "Size", options: sizes.map((size) => ({ value: size, label: size })), test: (id: string, size: string) => sizeOf(id) === size }]
      : []),
    ...(books.length > 1
      ? [{ key: "book", label: "Book", options: books.map((book) => ({ value: book, label: book })), test: (id: string, book: string) => { const slide = byId.get(id); return Boolean(slide && bookOf(slide) === book); } }]
      : []),
  ];
}
