"use client";

import CatalogBrowser from "@/app/characters/builder/CatalogBrowser";
import ContentPicker from "@/app/characters/builder/ContentPicker";
import type { RaceOption } from "@/app/characters/builder/useBuilderOptions";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { contentSlug, describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import { ABILITIES, type Ability } from "@/lib/schemas/sheet";
import { DRACONIC_ANCESTRIES, takesDraconicAncestry } from "@/lib/srd/racial-grants";

const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

function skillName(skillId: string) {
  return SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;
}

// The picks a race offers instead of fixing: half-elf's two +1 ability
// bumps and two skills, high elf's wizard cantrip, hill dwarf's tool. Until
// these existed the grants were silently dropped, leaving those characters
// weaker than the rules allow.
export function RacialChoicesSection({
  race,
  grantedSkills,
  asi,
  onAsiChange,
  skills,
  onSkillsChange,
  cantrip,
  onCantripChange,
  tool,
  onToolChange,
  ancestry = "",
  onAncestryChange,
  repeated = [],
  repeatSkills = [],
  onRepeatChange,
}: {
  race: RaceOption;
  // Skills already granted by class and background, so they are not offered
  // twice (a duplicate pick would waste the racial choice).
  grantedSkills: string[];
  asi: Array<Ability | "">;
  onAsiChange: (index: number, ability: Ability | "") => void;
  skills: string[];
  onSkillsChange: (index: number, skill: string) => void;
  cantrip: string;
  onCantripChange: (spell: string) => void;
  tool: string;
  onToolChange: (tool: string) => void;
  // A dragonborn's draconic ancestry, by id.
  ancestry?: string;
  onAncestryChange?: (ancestry: string) => void;
  // Skills the race and the background both give, and the ones chosen in
  // their place.
  repeated?: string[];
  repeatSkills?: string[];
  onRepeatChange?: (index: number, skill: string) => void;
  inputClass: string;
}) {
  const draconic = takesDraconicAncestry(race.id);
  const hasChoices = Boolean(
    race.asiChoice || race.skillChoice || race.cantripChoice || race.toolChoice || draconic || repeated.length,
  );
  if (!hasChoices) {
    return null;
  }

  // A half-elf's +1s go to abilities other than the one the race already
  // raises, per the SRD.
  const fixedAbilities = new Set(Object.keys(race.asi) as Ability[]);
  // An either-or increase ("Strength or Dexterity") offers only its two.
  const asiFrom = race.asiChoice?.from;

  return (
    <div className="space-y-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
      <p className="text-xs text-amber-200/90">{race.name} choices</p>

      {race.asiChoice ? (
        <div data-builder-target="racialAsi">
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
            <GameTerm id="ability_score">Ability</GameTerm> increases (+{race.asiChoice.amount} to{" "}
            {asiFrom
              ? asiFrom.map((ability) => ABILITY_NAMES[ability]).join(" or ")
              : `${race.asiChoice.count} abilities of your choice`}
            )
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.asiChoice.count }, (_, index) => (
              <span key={index} className="flex items-center gap-1">
                <Select<Ability | "">
                  value={asi[index] ?? ""}
                  onChange={(next) => onAsiChange(index, next)}
                  className="min-w-0 grow"
                  label={`Ability increase ${index + 1}`}
                  placeholder="Choose an ability..."
                  options={[
                    // Still a row of its own, so a pick can be taken back.
                    { value: "" as const, label: "Choose an ability..." },
                    ...ABILITIES.filter(
                      (ability) =>
                        !fixedAbilities.has(ability) &&
                        (!asiFrom || asiFrom.includes(ability)) &&
                        (asi[index] === ability || !asi.includes(ability)),
                    ).map((ability) => ({ value: ability, label: ABILITY_NAMES[ability] })),
                  ]}
                />
                {asi[index] ? (
                  <GameTerm id={asi[index] as Ability} className="shrink-0 text-xs text-stone-500">
                    what is this?
                  </GameTerm>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {race.skillChoice ? (
        <div data-builder-target="racialSkills">
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
            <GameTerm id="skill">Skill</GameTerm> proficiencies ({race.skillChoice.count} of your
            choice)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.skillChoice.count }, (_, index) => (
              <span key={index} className="flex items-center gap-1">
                <Select<string>
                  value={skills[index] ?? ""}
                  onChange={(next) => onSkillsChange(index, next)}
                  className="min-w-0 grow"
                  label={`Skill proficiency ${index + 1}`}
                  placeholder="Choose a skill..."
                  options={[
                    { value: "", label: "Choose a skill..." },
                    ...ALL_SKILLS.filter(
                      (skill) => skills[index] === skill || (!skills.includes(skill) && !grantedSkills.includes(skill)),
                    ).map((skill) => ({ value: skill as string, label: skillName(skill) })),
                  ]}
                />
                {skills[index] ? (
                  <InfoButton
                    label={skillName(skills[index])}
                    text={describeSkill(skills[index])}
                  />
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {draconic && onAncestryChange ? (
        <label className="block" data-builder-target="ancestry">
          <span className="mb-1 block text-stone-400">
            Draconic ancestry: your breath weapon&apos;s damage and save, and the damage you resist
          </span>
          <Select<string>
            value={ancestry}
            onChange={onAncestryChange}
            className="w-full"
            label="Draconic ancestry"
            placeholder="Choose a dragon..."
            options={[
              { value: "", label: "Choose a dragon..." },
              ...DRACONIC_ANCESTRIES.map((entry) => ({
                value: entry.id,
                label: `${entry.dragon} (${entry.damageType}, ${entry.area}, ${entry.save.toUpperCase()} save)`,
              })),
            ]}
          />
        </label>
      ) : null}

      {repeated.length && onRepeatChange ? (
        <div data-builder-target="repeatSkills">
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
            Your race and background both give {repeated.map(skillName).join(" and ")}; choose
            {repeated.length === 1 ? " another skill" : ` ${repeated.length} other skills`} in its place
          </span>
          <div className="grid grid-cols-2 gap-2">
            {repeated.map((_, index) => (
              <span key={index} className="flex items-center gap-1">
                <Select<string>
                  value={repeatSkills[index] ?? ""}
                  onChange={(next) => onRepeatChange(index, next)}
                  className="min-w-0 grow"
                  label={`Skill in place of a repeated one ${index + 1}`}
                  placeholder="Choose a skill..."
                  options={[
                    { value: "", label: "Choose a skill..." },
                    ...ALL_SKILLS.filter(
                      (skill) =>
                        repeatSkills[index] === skill ||
                        (!repeatSkills.includes(skill) && !grantedSkills.includes(skill) && !skills.includes(skill)),
                    ).map((skill) => ({ value: skill as string, label: skillName(skill) })),
                  ]}
                />
                {repeatSkills[index] ? (
                  <InfoButton label={skillName(repeatSkills[index])} text={describeSkill(repeatSkills[index])} />
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {race.toolChoice ? (
        <label className="block" data-builder-target="racialTool">
          <span className="mb-1 block text-stone-400">Tool proficiency</span>
          <Select<string>
            value={tool}
            onChange={onToolChange}
            className="w-full"
            label="Tool proficiency"
            placeholder="Choose a tool..."
            options={[{ value: "", label: "Choose a tool..." }, ...race.toolChoice.from.map((entry) => ({ value: entry, label: entry }))]}
          />
        </label>
      ) : null}

      {race.cantripChoice ? (
        <div data-builder-target="racialCantrip">
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
            Bonus <GameTerm id="cantrip">cantrip</GameTerm> (one {race.cantripChoice.list}{" "}
            cantrip)
          </span>
          <p className="mb-1.5 text-xs text-stone-500">
            A cantrip is a small spell you can cast as often as you like, forever. Pick one from
            the list below (tap ⓘ to read what each does), or search by name if you already have
            one in mind.
          </p>
          {cantrip ? (
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-full border border-amber-800 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200">
                {cantrip}
                <InfoButton
                  label={cantrip}
                  reference={{ kind: "spells", slug: contentSlug(cantrip), name: cantrip }}
                />
              </span>
              <button
                type="button"
                onClick={() => onCantripChange("")}
                className="text-xs text-stone-500 hover:text-stone-300"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              {/* Nobody can search for a cantrip they have never heard of.
                  Every one this race may take is listed from the start, each
                  with the ⓘ that says what it does; the search is second. */}
              <CatalogBrowser
                kind="spells"
                buttonLabel={`Every ${race.cantripChoice.list} cantrip`}
                defaultOpen
                openSections={[`cantrips:${race.cantripChoice.list}`]}
                selectedNames={cantrip ? [cantrip] : []}
                onPick={(entry) => onCantripChange(entry.name)}
                sections={[
                  {
                    key: `cantrips:${race.cantripChoice.list}`,
                    label: `Every ${race.cantripChoice.list} cantrip`,
                    params: { class: race.cantripChoice.list, level: "0" },
                  },
                ]}
                metaOf={(entry) => entry.school ?? ""}
              />
              <p className="mt-2 mb-1 text-xs text-stone-500">Or search by name:</p>
              <ContentPicker
                kind="spells"
                extraParams={{ class: race.cantripChoice.list, level: "0" }}
                placeholder="Search cantrips (e.g. fire bolt)"
                onPick={(entry) => onCantripChange(entry.name)}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
