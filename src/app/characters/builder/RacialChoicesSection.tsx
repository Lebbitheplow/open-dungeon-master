"use client";

import ContentPicker from "@/app/characters/builder/ContentPicker";
import type { RaceOption } from "@/app/characters/builder/useBuilderOptions";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { SRD_SKILLS } from "@/lib/srd";
import { ABILITIES, type Ability } from "@/lib/schemas/sheet";

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
  inputClass,
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
  inputClass: string;
}) {
  const hasChoices = Boolean(
    race.asiChoice || race.skillChoice || race.cantripChoice || race.toolChoice,
  );
  if (!hasChoices) {
    return null;
  }

  // A half-elf's +1s go to abilities other than the one the race already
  // raises, per the SRD.
  const fixedAbilities = new Set(Object.keys(race.asi) as Ability[]);

  return (
    <div className="space-y-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
      <p className="text-xs text-amber-200/90">{race.name} choices</p>

      {race.asiChoice ? (
        <div>
          <span className="mb-1 block text-stone-400">
            Ability increases (+{race.asiChoice.amount} to {race.asiChoice.count} abilities of
            your choice)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.asiChoice.count }, (_, index) => (
              <select
                key={index}
                value={asi[index] ?? ""}
                onChange={(event) => onAsiChange(index, event.target.value as Ability | "")}
                className={inputClass}
              >
                <option value="">Choose an ability...</option>
                {ABILITIES.filter(
                  (ability) =>
                    !fixedAbilities.has(ability) &&
                    (asi[index] === ability || !asi.includes(ability)),
                ).map((ability) => (
                  <option key={ability} value={ability}>
                    {ABILITY_NAMES[ability]}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>
      ) : null}

      {race.skillChoice ? (
        <div>
          <span className="mb-1 block text-stone-400">
            Skill proficiencies ({race.skillChoice.count} of your choice)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.skillChoice.count }, (_, index) => (
              <select
                key={index}
                value={skills[index] ?? ""}
                onChange={(event) => onSkillsChange(index, event.target.value)}
                className={inputClass}
              >
                <option value="">Choose a skill...</option>
                {ALL_SKILLS.filter(
                  (skill) =>
                    skills[index] === skill ||
                    (!skills.includes(skill) && !grantedSkills.includes(skill)),
                ).map((skill) => (
                  <option key={skill} value={skill}>
                    {skillName(skill)}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>
      ) : null}

      {race.toolChoice ? (
        <label className="block">
          <span className="mb-1 block text-stone-400">Tool proficiency</span>
          <select
            value={tool}
            onChange={(event) => onToolChange(event.target.value)}
            className={inputClass}
          >
            <option value="">Choose a tool...</option>
            {race.toolChoice.from.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {race.cantripChoice ? (
        <div>
          <span className="mb-1 block text-stone-400">
            Bonus cantrip (one {race.cantripChoice.list} cantrip)
          </span>
          {cantrip ? (
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded-full border border-amber-800 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200">
                {cantrip}
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
            <ContentPicker
              kind="spells"
              extraParams={{ class: race.cantripChoice.list, level: "0" }}
              placeholder="Search cantrips (e.g. fire bolt)"
              onPick={(entry) => onCantripChange(entry.name)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
