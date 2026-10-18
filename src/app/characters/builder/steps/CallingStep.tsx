"use client";

import { useMemo, useState } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton, InfoDialog } from "@/components/ui/InfoDialog";
import { describeFeature, describeSkill } from "@/lib/help";
import { useClassFeatureText } from "@/lib/classes/use-feature-text";
import { firstSentence } from "@/lib/help/rules-text";
import { CLASS_ROLES, classRoles, type ClassRole } from "@/lib/srd/class-roles";
import { subclassBlurb } from "@/lib/srd/features";
import { SRD_SKILLS } from "@/lib/srd";
import { displayName, type Reskinned } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import { classArt } from "../lineage";
import { OptionCardGrid, type CardFacet, type OptionCardGroup } from "../OptionCardGrid";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { classInfoText } from "../usePickerGroups";
import { grantedSkillSources, grantingTrait } from "../reconcile";
import type { ArchetypeOption, BackgroundOption, ClassOption, RaceOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { ClassChoices } from "./ClassChoices";
import { PlaystylePicker } from "../PlaystylePicker";
import { EASY_CLASSES, fillClassSkills, type PlaystyleId } from "../playstyles";
import FeatChoicesFields, { knownTraining } from "../FeatChoicesFields";
import { Field, PickPill, StepPanel, inputClass } from "./shared";

// Step 3: the class (painted cards in the picker's groups and order, the
// setting's callings first and badged, each with its emblem and a ? that
// opens its write-up), its subclass once the level allows one, what the pair
// grants at this level, and the class skill picks. Expertise, fighting
// styles and option lists (invocations and the like) follow in ClassChoices.
export function CallingStep({
  state,
  derived,
  actions,
  klass,
  race,
  background,
  pack,
  classes,
  classGroups,
  subclassGroups,
  offersSubclass,
  subclassLockedAt,
  chosenArchetype,
  playstyle,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  actions: BuilderActions;
  klass: ClassOption | undefined;
  race: RaceOption | undefined;
  background: BackgroundOption | undefined;
  pack: WorldPack | null;
  classes: Array<Reskinned<ClassOption>>;
  classGroups: PickerGroup[];
  subclassGroups: PickerGroup[];
  offersSubclass: boolean;
  // The level the class picks a subclass at, while this level is below it.
  subclassLockedAt: number | null;
  chosenArchetype: ArchetypeOption | null;
  // The answer given on the first step, so the picker opens on it.
  playstyle?: { value: PlaystyleId | null; onChange: (style: PlaystyleId | null) => void };
}) {
  const { subclass } = state;
  const { effectiveLevel, grantedFeatures } = derived;
  const { gender } = state;
  // A genre class's feature text arrives on demand (issue 411).
  useClassFeatureText([klass?.id]);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  // What "Suggest the rest" picked, said until the player changes a pick.
  const [suggested, setSuggested] = useState<string[] | null>(null);
  // The skills already the character's from race or background, and the
  // source each came from: the same map the toggle refuses by, so every
  // greyed pill says why (issue #109).
  const skillSources = useMemo(
    () =>
      grantedSkillSources({
        race,
        background,
        racialSkills: state.racialSkills,
        backgroundSkills: state.backgroundSkills,
      }),
    [race, background, state.racialSkills, state.backgroundSkills],
  );

  // Each class's job in a fight and which of the core four it plays like
  // (src/lib/srd/class-roles.ts).
  const readings = useMemo(
    () =>
      new Map(
        classGroups.flatMap((group) =>
          group.options.map((option) => [
            option.id,
            classRoles(classes.find((candidate) => candidate.id === option.id) ?? { id: option.id }),
          ]),
        ),
      ),
    [classGroups, classes],
  );
  const cardGroups = useMemo<OptionCardGroup[]>(
    () =>
      classGroups.map((group) => ({
        label: group.label,
        recommended: group.recommended,
        options: group.options.map((option) => {
          const entry = classes.find((candidate) => candidate.id === option.id);
          const reading = readings.get(option.id);
          // Under a reskin the canonical class name leads the tagline, the
          // same fact the dropdown kept in its meta column.
          const canonical = entry?.packName ? option.meta?.split(" · ")[1] : undefined;
          return {
            id: option.id,
            name: option.name,
            meta: canonical,
            art: classArt(option.id, gender),
            // The book leads where the group heading does not say it
            // (issue #116: a Marshal looked like a Core Rules class).
            // "Like Fighter + Cleric" leads: it says what the class is in words
            // a new player and a veteran new to the setting both read, short
            // enough to fit the narrow class card's two tagline lines.
            tagline: [
              canonical,
              // One of the core four says so rather than "Wizard: like Wizard".
              reading
                ? reading.playsLike.toLowerCase() === option.id.toLowerCase()
                  ? "Core class"
                  : `Like ${reading.playsLike}${reading.suggested ? " (suggested)" : ""}`
                : "",
              option.source,
              entry?.spellAbility ? `${entry.spellAbility.toUpperCase()} caster` : "",
              // Saves are left to the chosen-class line and the "?" box: the
              // least of what a player chooses a class by, and the card's
              // two lines are better spent on what it plays like.
            ]
              .filter(Boolean)
              .join(" · "),
            // "Easy to learn" leads where it applies: about play, where the
            // setting's seal on the plate is about the world.
            chips: [
              ...(EASY_CLASSES.has(option.id) ? ["Easy to learn"] : []),
              ...(reading?.roles ?? []),
              ...(entry ? [`d${entry.hitDie}`] : []),
            ],
            icon: { kind: "family" as const, key: `class-${option.id}` },
          };
        }),
      })),
    [classGroups, classes, gender, readings],
  );
  // The class grid's filters (OptionCardGrid): its job in a fight, how much
  // magic it has, which of the core four it plays like, and its book or
  // setting. Each offers only the values some class has, so a veteran can
  // ask for the tanks among the setting's classes.
  const classFacets = useMemo<CardFacet[]>(() => {
    const entryOf = (id: string) => classes.find((candidate) => candidate.id === id);
    const magicOf = (id: string) => {
      const type = entryOf(id)?.casterType ?? "none";
      return type === "none" ? "None" : type === "half" || type === "artificer" ? "Half caster" : "Full caster";
    };
    const bookOf = (id: string) => {
      const entry = entryOf(id);
      return entry?.genres?.length ? entry.genres.map(genreWords).join(", ") : entry?.source || "Core rules";
    };
    const ids = [...readings.keys()];
    const present = (values: string[]) => [...new Set(values)].sort().map((value) => ({ value, label: value }));
    return [
      {
        key: "role",
        label: "Role",
        options: CLASS_ROLES.filter((role) => ids.some((id) => readings.get(id)?.roles.includes(role))).map((role) => ({ value: role, label: role })),
        test: (id, role) => Boolean(readings.get(id)?.roles.includes(role as ClassRole)),
      },
      {
        key: "magic",
        label: "Magic",
        options: ["None", "Half caster", "Full caster"].filter((kind) => ids.some((id) => magicOf(id) === kind)).map((kind) => ({ value: kind, label: kind })),
        test: (id, kind) => magicOf(id) === kind,
      },
      {
        key: "plays",
        label: "Plays like",
        options: ["Fighter", "Wizard", "Cleric", "Rogue"].map((core) => ({ value: core, label: core })),
        test: (id, core) => Boolean(readings.get(id)?.playsLike.includes(core)),
      },
      {
        key: "book",
        label: "Book",
        options: present(ids.map(bookOf)),
        test: (id, book) => bookOf(id) === book,
      },
    ];
  }, [classes, readings]);
  const details = detailsFor
    ? classGroups.flatMap((group) => group.options).find((option) => option.id === detailsFor)
    : undefined;

  return (
    <div className="space-y-4">
      <StepPanel title="Choose a class" ornate anchor="class">
        {/* A plain-language way in, above the full catalog it points into.
            "Easy to learn" there and the setting's star in the grid mean
            different things: one is about play, the other about the world. */}
        <PlaystylePicker
          offered={classGroups.flatMap((group) =>
            group.options.map((option) => {
              const reading = readings.get(option.id);
              return { id: option.id, name: option.name, roles: reading?.roles ?? [], playsLike: reading?.playsLike ?? "" };
            }),
          )}
          chosen={klass?.id ?? ""}
          onChoose={state.changeClass}
          style={playstyle?.value}
          onStyle={playstyle?.onChange}
        />
        <Field label="Class" className="mt-4">
          {klass ? (
            <span className="mb-3 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
              <span className="text-amber-200">{klass.name}:</span>{" "}
              <GameTerm id="hit_dice">d{klass.hitDie} hit die</GameTerm> ·{" "}
              <GameTerm id="saving_throw">saves</GameTerm>{" "}
              {klass.saves.map((save) => save.toUpperCase()).join(", ")}
              {klass.spellAbility ? (
                <>
                  {" · "}
                  <GameTerm id={klass.spellAbility}>{klass.spellAbility.toUpperCase()}</GameTerm>{" "}
                  caster
                  {klass.castingLabel ? ` (spells flavored as ${klass.castingLabel})` : ""}
                </>
              ) : null}
              <InfoButton
                label={klass.name}
                text={classInfoText(klass)}
                reference={{ kind: "classes", slug: klass.id }}
              />
            </span>
          ) : null}
          <OptionCardGrid
            groups={cardGroups}
            value={klass?.id ?? ""}
            onChoose={state.changeClass}
            onDetails={setDetailsFor}
            noun="class"
            facets={classFacets}
            compact
          />
          {/* The same write-up the dropdown's info button opened: the pack's
              blurb, the catalog blurb or the content pack's entry. */}
          <InfoDialog
            open={Boolean(details)}
            onOpenChange={(open) => (open ? undefined : setDetailsFor(null))}
            title={details?.name ?? ""}
            // The card's role and "plays like", said again where the class
            // is read about at length.
            meta={(() => {
              const reading = details ? readings.get(details.id) : undefined;
              const saves = details ? classes.find((candidate) => candidate.id === details.id)?.saves : undefined;
              return [
                details?.meta,
                saves?.length ? `Saves ${saves.map((save) => save.toUpperCase()).join(" ")}` : "",
                reading ? `Role: ${reading.roles.join(" / ")}` : "",
                reading
                  ? reading.playsLike.toLowerCase() === details?.id.toLowerCase()
                    ? "One of the core four"
                    : `Plays like ${reading.playsLike}${reading.suggested ? " (suggested)" : ""}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ");
            })()}
            text={details?.infoText}
            reference={details?.reference}
          />
        </Field>
        {offersSubclass ? (
          <Field label="Subclass" className="mt-3" anchor="subclass">
            <OptionPicker
              value={subclass}
              groups={subclassGroups}
              placeholder="None yet"
              className={inputClass}
              onChange={state.changeSubclass}
            />
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              {subclass ? (
                <>
                  <span className="grow">
                    {firstSentence(chosenArchetype?.desc || subclassBlurb(klass?.id ?? "", subclass)) ??
                      "A specialization within your class."}
                  </span>
                  <InfoButton
                    label={subclass}
                    text={chosenArchetype?.desc || subclassBlurb(klass?.id ?? "", subclass) || undefined}
                    reference={
                      chosenArchetype ? { kind: "archetypes", slug: chosenArchetype.id } : undefined
                    }
                  />
                </>
              ) : (
                <span className="grow">
                  <span className="text-amber-300">Still to choose. </span>
                  Your <GameTerm id="subclass">subclass</GameTerm> is the biggest choice about how
                  this character plays. Tap the info icon next to any option to read what it does
                  before choosing.
                </span>
              )}
            </span>
            {/* What the subclass trains the character in (issue 251): its
                armor and weapons said outright, and its picks asked for here,
                as a feat's are. */}
            {derived.subclassTraining.map((grant) => (
              <FeatChoicesFields
                key={grant.name}
                feat={grant.name}
                spec={grant.spec}
                picks={state.featChoices[grant.name.trim().toLowerCase()]}
                known={knownTraining(derived)}
                onChange={(picks) => state.setFeatPicks(grant.name, picks)}
                source="subclass"
              />
            ))}
          </Field>
        ) : subclassLockedAt !== null && klass ? (
          // Below the class's subclass level the menu stays shut and says
          // when the choice comes, instead of listing picks that vanished.
          <Field label="Subclass" className="mt-3">
            <p className="rounded-lg border border-dashed border-stone-700/70 bg-stone-950/40 px-3 py-2 text-xs text-stone-400">
              A {klass.name.toLowerCase()} chooses a <GameTerm id="subclass">subclass</GameTerm> at level{" "}
              {subclassLockedAt}; there is nothing to pick at level {effectiveLevel}. The choice comes with
              that level-up.
            </p>
          </Field>
        ) : null}
      </StepPanel>

      {grantedFeatures.length ? (
        <StepPanel
          title={`What you gain at level ${effectiveLevel}`}
          help="Tap any name to read what it does. Racial traits and background perks are added on top when the character is saved."
        >
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {grantedFeatures.map((feature) => (
              <span
                key={`${feature.name}-${feature.level ?? 0}`}
                className="flex items-center gap-1 text-xs text-stone-300"
              >
                {displayName(pack, "features", feature.name)}
                <InfoButton
                  label={feature.name}
                  meta={feature.level ? `Level ${feature.level}` : undefined}
                  text={klass ? describeFeature(klass.id, subclass, feature.name) : null}
                />
              </span>
            ))}
          </div>
        </StepPanel>
      ) : null}

      {klass ? (
        <StepPanel
          anchor="classSkills"
          title={`Class skills (pick ${klass.skillChoices.count})`}
          help={
            <>
              {klass.skillChoices.count - state.chosenSkills.length > 0 ? (
                <span className="text-amber-300">
                  {klass.skillChoices.count - state.chosenSkills.length} still to choose.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      const filled = fillClassSkills({
                        classId: klass.id,
                        from: klass.skillChoices.from,
                        count: klass.skillChoices.count,
                        chosen: state.chosenSkills,
                        granted: new Set(skillSources.keys()),
                      });
                      setSuggested(filled.filter((id) => !state.chosenSkills.includes(id)));
                      state.setChosenSkills(filled);
                    }}
                    className="underline-offset-2 hover:underline"
                    data-suggest-skills
                  >
                    Suggest the rest
                  </button>{" "}
                </span>
              ) : suggested?.length && suggested.every((id) => state.chosenSkills.includes(id)) ? (
                <span key={suggested.join()} className="reveal block text-amber-200/90">
                  Suggested for a {klass.name.toLowerCase()}:{" "}
                  {suggested.map((id) => SRD_SKILLS.find((entry) => entry.id === id)?.name ?? id).join(", ")}. Tap any to
                  change it.{" "}
                </span>
              ) : null}
              A <GameTerm id="skill">skill</GameTerm> you are proficient in adds your{" "}
              <GameTerm id="proficiency_bonus">proficiency bonus</GameTerm> to rolls that use
              it. Tap any ⓘ to see which ability a skill leans on. A greyed skill is already yours
              from your race or background, so a class pick on it would be wasted.
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {klass.skillChoices.from.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const name = skill?.name ?? skillId;
              const source = skillSources.get(skillId.trim().toLowerCase());
              const grantedBy = source === "race" ? race?.name : source === "background" ? background?.name : "";
              const trait = source === "race" && race ? grantingTrait(race.id, name) : null;
              const info = source
                ? `${name} is already yours: your ${source}${grantedBy ? ` (${grantedBy})` : ""} grants it${trait ? ` through ${trait}` : ""}, so it is not offered as a class pick here.\n\n${describeSkill(skillId) ?? ""}`.trim()
                : describeSkill(skillId);
              return (
                <PickPill
                  key={skillId}
                  label={name}
                  selected={state.chosenSkills.includes(skillId)}
                  disabled={Boolean(source)}
                  onClick={() => actions.toggleSkill(skillId)}
                  info={{ text: info }}
                >
                  {name}
                  {source ? ` (${source})` : ""}
                </PickPill>
              );
            })}
          </div>
        </StepPanel>
      ) : null}

      <ClassChoices state={state} derived={derived} actions={actions} klass={klass} />
    </div>
  );
}

// A genre id as the filter reads it ("dark-fantasy" is "Dark fantasy").
function genreWords(genre: string): string {
  const words = genre.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
