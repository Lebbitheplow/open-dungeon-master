"use client";

import { Select } from "@/components/ui/Select";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import type { FeatGrantSpec, FeatPicks } from "@/lib/srd/feat-grants";
import { featSpellsAnything, type CastingAbility } from "@/lib/srd/feat-spells";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import ContentPicker from "./ContentPicker";
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
  const set = (kind: keyof KnownTraining, index: number, value: string) => {
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
  const hasPicks = spec.languages + spec.skills + spec.expertise + spec.weapons + spec.tools + spec.damageTypes.length > 0;
  const taught = spec.taught;
  const teaches = featSpellsAnything(taught) && taught.cantrips + taught.spells > 0;
  if (!hasPicks && !teaches) {
    return null;
  }
  // The spells the feat teaches (src/lib/srd/feat-spells.ts): the class
  // list and casting ability where the feat leaves them open, then one
  // search per cantrip and per spell, held to the feat's level, school and
  // list by the content API's filters.
  const spellPicks = { cantrips: picks?.cantrips ?? [], spells: picks?.spells ?? [] };
  const listPicked = (picks?.list ?? "").trim().toLowerCase();
  const listParam = taught.listChoice ? listPicked : taught.lists.length === 1 ? taught.lists[0] : "";
  const needsList = taught.listChoice && !listPicked;
  const setSpell = (kind: "cantrips" | "spells", index: number, value: string) => {
    const next = [...spellPicks[kind]];
    while (next.length < index) {
      next.push("");
    }
    next[index] = value;
    onChange({ ...picks, [kind]: next.filter((entry, at) => entry || at < index) });
  };
  const spellSlots = (kind: "cantrips" | "spells", count: number, level: number) =>
    Array.from({ length: count }, (_, index) => {
      const chosen = spellPicks[kind][index] ?? "";
      const label = `${feat} ${kind === "cantrips" ? (taught.attackCantrip ? "attack cantrip" : "cantrip") : `${level === 1 ? "1st" : `${level}th`}-level ${taught.schools.length ? `${taught.schools.join(" or ")} ` : ""}${taught.ritualBook ? "ritual " : ""}spell`} ${index + 1}`;
      return (
        <div key={`${kind}-${index}`} data-feat-spell={`${feat}:${kind}:${index + 1}`}>
          <span className="mb-1 block text-[11px] text-stone-400">{label}</span>
          {chosen ? (
            <div className="flex items-center gap-2">
              <PickPill label={chosen} selected onClick={() => setSpell(kind, index, "")}>
                {capital(chosen)}
              </PickPill>
              <span className="text-[11px] text-stone-500">Tap to change</span>
            </div>
          ) : needsList ? (
            <span className="text-xs text-stone-500">Pick the spell list first.</span>
          ) : (
            <ContentPicker
              kind="spells"
              extraParams={{
                level: String(level),
                exact: "1",
                ...(listParam ? { class: listParam } : {}),
                ...(taught.schools.length ? { school: taught.schools.join(",") } : {}),
                ...(kind === "cantrips" && taught.attackCantrip ? { attack: "1" } : {}),
              }}
              placeholder={`Search ${kind === "cantrips" ? "cantrips" : "spells"}...`}
              onPick={(entry) => setSpell(kind, index, entry.name)}
            />
          )}
        </div>
      );
    });
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
      {spec.damageTypes.length ? (
        <Select<string>
          value={picks?.damageType ?? ""}
          onChange={(picked) => onChange({ ...picks, damageType: picked })}
          className="w-full sm:w-64"
          label={`${feat} damage type`}
          placeholder="Choose a damage type..."
          options={[
            { value: "", label: "Choose a damage type..." },
            ...spec.damageTypes.map((type) => ({ value: type, label: capital(type) })),
          ]}
        />
      ) : null}
      {teaches && taught.listChoice ? (
        <Select<string>
          value={listPicked}
          onChange={(picked) => onChange({ ...picks, list: picked, cantrips: [], spells: [] })}
          className="w-full sm:w-64"
          label={`${feat} spell list`}
          placeholder="Choose a spell list..."
          options={[
            { value: "", label: "Choose a spell list..." },
            ...taught.lists.map((list) => ({ value: list, label: capital(list) })),
          ]}
        />
      ) : null}
      {teaches && taught.ability === "choice" ? (
        <Select<CastingAbility | "">
          value={picks?.ability ?? ""}
          onChange={(picked) => onChange({ ...picks, ...(picked ? { ability: picked } : {}) })}
          className="w-full sm:w-64"
          label={`${feat} spellcasting ability`}
          placeholder="Choose the ability..."
          options={[
            { value: "", label: "Choose the ability..." },
            { value: "int", label: "Intelligence" },
            { value: "wis", label: "Wisdom" },
            { value: "cha", label: "Charisma" },
          ]}
        />
      ) : null}
      {teaches && taught.fixedSpells.length ? (
        <p className="text-[11px] text-stone-400">
          Known from the feat: {taught.fixedSpells.map(capital).join(", ")}
          {taught.freeCast ? ", castable once per long rest without a slot" : ""}.
        </p>
      ) : null}
      {teaches && taught.cantrips > 0 ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{spellSlots("cantrips", taught.cantrips, 0)}</div> : null}
      {teaches && taught.spells > 0 ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{spellSlots("spells", taught.spells, taught.spellLevel)}</div> : null}
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
