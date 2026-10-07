"use client";

import { Select } from "@/components/ui/Select";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import type { FeatGrantSpec, FeatPicks } from "@/lib/srd/feat-grants";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import { PickPill } from "./steps/shared";

// What the character already has, so a feat's pick is never one of them.
export type KnownTraining = {
  languages: string[];
  skills: string[];
  expertise: string[];
  weapons: string[];
  tools: string[];
};

const lower = (value: string) => value.trim().toLowerCase();

// The builder's training as it stands, for the pickers, known on every
// step (useBuilderDerived's `training` needs no ability score).
export function knownTraining(derived: {
  training: { languages: string[]; skills: string[]; expertise?: string[]; weapons: string[]; tools: string[] };
}): KnownTraining {
  const { training } = derived;
  return {
    languages: training.languages,
    skills: training.skills,
    expertise: training.expertise ?? [],
    weapons: training.weapons,
    tools: training.tools,
  };
}
const capital = (value: string) => value.replace(/(^|\s|')([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`);
const skillName = (skillId: string) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;

// The picks a feat leaves to the player, beside the feat (issue #125):
// Linguist's three languages, Skill Expert's skill and the expertise on it,
// Weapon Master's four weapons, a pack feat's tool. Each list offers only
// what the character does not already have, less this feat's own picks,
// which stay offered so they can be changed.
export default function FeatChoicesFields({
  feat,
  spec,
  picks,
  known,
  onChange,
}: {
  feat: string;
  spec: FeatGrantSpec;
  picks: FeatPicks | undefined;
  known: KnownTraining;
  onChange: (picks: FeatPicks) => void;
}) {
  const mine = {
    languages: picks?.languages ?? [],
    skills: picks?.skills ?? [],
    expertise: picks?.expertise ?? [],
    weapons: picks?.weapons ?? [],
    tools: picks?.tools ?? [],
  };
  // Held by someone other than this feat.
  const heldBy = (kind: keyof KnownTraining) => {
    const own = new Set(mine[kind].map(lower));
    return new Set(known[kind].map(lower).filter((entry) => !own.has(entry)));
  };
  const set = (kind: keyof FeatPicks, index: number, value: string) => {
    const next = [...(mine[kind] ?? [])];
    while (next.length < index) {
      next.push("");
    }
    next[index] = value;
    onChange({ ...picks, [kind]: next });
  };
  const toggle = (kind: "skills" | "expertise", value: string, limit: number) => {
    const current = mine[kind];
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : current.length < limit
        ? [...current, value]
        : current;
    onChange({ ...picks, [kind]: next });
  };
  const heldLanguages = heldBy("languages");
  const heldSkills = heldBy("skills");
  const heldExpertise = heldBy("expertise");
  const heldWeapons = heldBy("weapons");
  const heldTools = heldBy("tools");
  // The feat's expertise goes on a skill the character has, the feat's own
  // skill included.
  const expertiseFrom = [...new Set([...known.skills, ...mine.skills])].filter((skill) => !heldExpertise.has(lower(skill)));
  const hasPicks = spec.languages + spec.skills + spec.expertise + spec.weapons + spec.tools > 0;
  if (!hasPicks) {
    return null;
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-amber-900/40 bg-amber-950/10 p-2.5" data-feat-choices={feat}>
      <p className="text-xs text-amber-200/90">{feat} choices</p>
      {spec.languages > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: spec.languages }, (_, index) => (
            <Select<string>
              key={index}
              value={mine.languages[index] ?? ""}
              onChange={(picked) => set("languages", index, picked)}
              className="w-full"
              label={`${feat} language ${index + 1}`}
              placeholder="Choose a language..."
              options={[
                { value: "", label: "Choose a language..." },
                ...STANDARD_LANGUAGES.filter(
                  (language) =>
                    !heldLanguages.has(lower(language)) &&
                    (mine.languages[index] === language || !mine.languages.includes(language)),
                ).map((language) => ({ value: language as string, label: language as string })),
              ]}
            />
          ))}
        </div>
      ) : null}
      {spec.skills > 0 ? (
        <div>
          <span className="mb-1 block text-[11px] text-stone-400">
            Skill proficiency ({spec.skills} of your choice){mine.skills.length < spec.skills ? <span className="text-amber-300"> · {spec.skills - mine.skills.length} still to choose</span> : null}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {SRD_SKILLS.filter((skill) => !heldSkills.has(skill.id)).map((skill) => (
              <PickPill
                key={skill.id}
                label={skill.name}
                selected={mine.skills.includes(skill.id)}
                onClick={() => toggle("skills", skill.id, spec.skills)}
                info={{ text: describeSkill(skill.id) }}
              >
                {skill.name}
              </PickPill>
            ))}
          </div>
        </div>
      ) : null}
      {spec.expertise > 0 ? (
        <div>
          <span className="mb-1 block text-[11px] text-stone-400">
            Expertise ({spec.expertise} of your skills){mine.expertise.length < spec.expertise ? <span className="text-amber-300"> · {spec.expertise - mine.expertise.length} still to choose</span> : null}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {expertiseFrom.length ? null : <span className="text-xs text-stone-500">Pick a skill first.</span>}
            {expertiseFrom.map((skillId) => (
              <PickPill
                key={skillId}
                label={skillName(skillId)}
                selected={mine.expertise.includes(skillId)}
                onClick={() => toggle("expertise", skillId, spec.expertise)}
                info={{ text: describeSkill(skillId) }}
              >
                {skillName(skillId)}
              </PickPill>
            ))}
          </div>
        </div>
      ) : null}
      {spec.weapons > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: spec.weapons }, (_, index) => (
            <Select<string>
              key={index}
              value={mine.weapons[index] ?? ""}
              onChange={(picked) => set("weapons", index, picked)}
              className="w-full"
              label={`${feat} weapon ${index + 1}`}
              placeholder="Choose a weapon..."
              options={[
                { value: "", label: "Choose a weapon..." },
                ...SRD_WEAPONS.filter(
                  (weapon) =>
                    !heldWeapons.has(lower(weapon.name)) &&
                    (mine.weapons[index] === weapon.name || !mine.weapons.includes(weapon.name)),
                ).map((weapon) => ({ value: weapon.name, label: weapon.name, hint: weapon.damage })),
              ]}
            />
          ))}
        </div>
      ) : null}
      {spec.tools > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: spec.tools }, (_, index) => (
            <Select<string>
              key={index}
              value={mine.tools[index] ?? ""}
              onChange={(picked) => set("tools", index, picked)}
              className="w-full"
              label={`${feat} tool ${index + 1}`}
              placeholder="Choose a tool..."
              options={[
                { value: "", label: "Choose a tool..." },
                ...spec.toolsFrom.filter(
                  (tool) => !heldTools.has(lower(tool)) && (mine.tools[index] === tool || !mine.tools.includes(tool)),
                ).map((tool) => ({ value: tool, label: capital(tool) })),
              ]}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
