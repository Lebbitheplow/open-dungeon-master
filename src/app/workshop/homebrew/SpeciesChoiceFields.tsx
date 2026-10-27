"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { SelectField, TextArea, TextField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { ChipList } from "@/app/workshop/plugin/fields";
import { MechGroup, list, sub } from "@/app/workshop/homebrew/MechGroup";
import { addChip, rowIcon } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";
import { LANGUAGES, TOOL_PROFICIENCIES } from "@/lib/workshop/pickers";
import { SKILL_IDS } from "@/lib/homebrew/item-magic-schema";
import { DAMAGE_TYPES } from "@/lib/dm/damage-logic";
import { raceMechanics } from "@/lib/content/mechanics";
import { ABILITIES, type Ability } from "@/lib/schemas/abilities";
import {
  BREATH_AREAS,
  VARIANT_LIMITS,
  uniqueVariantId,
  variantSummary,
  type BreathShape,
  type SpeciesVariantOption,
} from "@/lib/content/species-variants";

// A species whose player picks one of several packages: a Half-Dragon's
// ancestry, a lineage, a bloodline (issue #538). Hidden behind one button
// until the author asks for it, since most species offer none. Each option
// holds only what the table runs (scores, resistances, a breath, skills,
// tools, languages) and the words its player reads; the save checks it
// whole (src/lib/content/species-variants.ts).

type Props = { data: Data; set: (patch: Data) => void };

const L = VARIANT_LIMITS;
const ABILITY_WORDS: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
const SKILL_LABELS = Object.fromEntries(SKILL_IDS.map((id) => [id, id.replace(/_/g, " ")])) as Record<(typeof SKILL_IDS)[number], string>;
const TOOLS = TOOL_PROFICIENCIES.map((tool) => tool.toLowerCase());

// An option as the draft holds it, read for its summary line.
function readOption(raw: Data): SpeciesVariantOption {
  const breath = sub(raw.breath);
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    asi: sub(raw.asi) as Partial<Record<Ability, number>>,
    resistances: list(raw.resistances),
    skills: list(raw.skills),
    tools: list(raw.tools),
    languages: list(raw.languages),
    ...(breath.damageType
      ? { breath: { damageType: String(breath.damageType), save: (breath.save ?? "dex") as Ability, shape: (breath.shape ?? "cone") as BreathShape } }
      : {}),
  };
}

// A field emptied is left out, so the entry holds only what it gives.
function withField(option: Data, key: string, value: unknown): Data {
  const next: Data = { ...option, [key]: value };
  if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
    delete next[key];
  }
  return next;
}

function Increases({ option, put }: { option: Data; put: (asi: Data | undefined) => void }) {
  const asi = sub(option.asi);
  const rows = Object.entries(asi).map(([ability, value]): [Ability, number] => [ability as Ability, Number(value) || 1]);
  const write = (next: Array<[Ability, number]>) => put(next.length ? Object.fromEntries(next) : undefined);
  const free = ABILITIES.filter((ability) => !(ability in asi));
  return (
    <div className="col-span-2 space-y-1.5 sm:col-span-4">
      <span className="text-[11px] text-stone-400">Ability score increases (+3 in all at most)</span>
      {rows.map(([ability, value], index) => (
        <div key={ability} className="live-in flex flex-wrap items-center gap-1.5">
          <span className="w-44">
            <Select<Ability>
              value={ability}
              label="Ability"
              options={[ability, ...free].map((entry) => ({ value: entry, label: ABILITY_WORDS[entry] }))}
              onChange={(next) => write(rows.map(([held, amount], at): [Ability, number] => [at === index ? next : held, amount]))}
            />
          </span>
          <NumberStepper
            label={`Increase to ${ABILITY_WORDS[ability]}`}
            value={value}
            min={1}
            max={2}
            onChange={(amount) => write(rows.map(([held, old], at): [Ability, number] => [held, at === index ? amount : old]))}
          />
          <button
            type="button"
            aria-label={`Remove the increase to ${ABILITY_WORDS[ability]}`}
            onClick={() => write(rows.filter((_, at) => at !== index))}
            className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {rows.length < L.asiTotal && free.length ? (
        <button
          type="button"
          onClick={() => write([...rows, [free[0], 1]])}
          className={cn(ui.btnSmall, addChip)}
        >
          <Plus className="size-3" /> Add an increase
        </button>
      ) : null}
    </div>
  );
}

function OptionFields({ option, put }: { option: Data; put: (next: Data) => void }) {
  const field = (key: string, value: unknown) => put(withField(option, key, value));
  const breath = sub(option.breath);
  const breathType = String(breath.damageType ?? "");
  const putBreath = (patch: Data) => {
    const next = { damageType: breathType, save: breath.save ?? "dex", shape: breath.shape ?? "cone", ...patch };
    field("breath", next.damageType ? next : undefined);
  };
  return (
    <>
      <TextField
        label="Option name"
        value={String(option.name ?? "")}
        onChange={(name) => put({ ...option, name })}
        maxLength={L.name}
        className="col-span-2"
      />
      <div className="col-span-2 sm:col-span-4">
        <TextArea
          label="What it says"
          value={String(option.description ?? "")}
          onChange={(description) => field("description", description)}
          maxLength={L.description}
          rows={3}
          hint="The player reads this; the table runs only the grants below."
        />
      </div>
      <Increases option={option} put={(asi) => field("asi", asi)} />
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Damage it resists</span>
        <ToggleChips options={DAMAGE_TYPES} selected={list(option.resistances)} max={L.resistances} onChange={(next) => field("resistances", next)} />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Skills it is proficient in</span>
        <ToggleChips options={SKILL_IDS} labels={SKILL_LABELS} selected={list(option.skills)} max={L.skills} onChange={(next) => field("skills", next)} />
      </div>
      <div className="col-span-2 space-y-1">
        <span className="text-[11px] text-stone-400">Tools it is proficient with</span>
        <ChipList items={list(option.tools)} onChange={(next) => field("tools", next)} options={TOOLS} prompt="Add a tool" max={L.tools} />
      </div>
      <div className="col-span-2 space-y-1">
        <span className="text-[11px] text-stone-400">Languages it speaks</span>
        <ChipList items={list(option.languages)} onChange={(next) => field("languages", next)} options={LANGUAGES} prompt="Add a language" max={L.languages} />
      </div>
      <SelectField
        label="Breath weapon"
        value={breathType}
        options={[{ value: "", label: "none" }, ...DAMAGE_TYPES.map((type) => ({ value: type, label: type }))]}
        onChange={(damageType) => putBreath({ damageType })}
        className="col-span-2"
        hint={breathType ? "Scales like the Dragonborn's: 2d6 to 5d6, DC 8 + Constitution + proficiency, once per short rest." : undefined}
      />
      {breathType ? (
        <>
          <SelectField
            label="Save"
            value={String(breath.save ?? "dex") as Ability}
            options={ABILITIES.map((ability) => ({ value: ability, label: ABILITY_WORDS[ability] }))}
            onChange={(save) => putBreath({ save })}
          />
          <SelectField
            label="Shape"
            value={String(breath.shape ?? "cone") as BreathShape}
            options={(Object.keys(BREATH_AREAS) as BreathShape[]).map((shape) => ({ value: shape, label: BREATH_AREAS[shape] }))}
            onChange={(shape) => putBreath({ shape })}
          />
        </>
      ) : null}
    </>
  );
}

export function SpeciesChoiceFields({ data, set }: Props) {
  const [newName, setNewName] = useState("");
  // The option just added opens, ready for its grants.
  const [fresh, setFresh] = useState<string | null>(null);
  const raw = data.variants;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return (
      <div className="space-y-1.5 text-sm" data-species-choice>
        <SectionHead title="The player's choice" glyph="tab-characters" className="mb-1" />
        <p className="text-[11px] text-stone-400">
          For a species whose players each pick one of several packages, each with its own scores, training,
          resistances or breath.
        </p>
        <button type="button" onClick={() => set({ variants: { label: "", options: [] } })} className={cn(ui.btnSmall, addChip)}>
          <Plus className="size-3" /> Let the player choose (ancestry, lineage, bloodline)
        </button>
      </div>
    );
  }
  const group = raw as Data;
  const options = Array.isArray(group.options) ? (group.options as Data[]) : [];
  const putGroup = (patch: Data) => set({ variants: { ...group, ...patch } });
  const putOptions = (next: Data[]) => putGroup({ options: next });
  const move = (index: number, by: number) => {
    const next = [...options];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    putOptions(next);
  };
  const name = newName.trim();
  const full = options.length >= L.options;
  const add = () => {
    if (!name || full) return;
    // The id is made once, here, and a rename keeps it.
    const id = uniqueVariantId(name, options.map((option) => String(option.id ?? "")).filter(Boolean));
    putOptions([...options, { id, name }]);
    setFresh(id);
    setNewName("");
  };
  const baseAsi = raceMechanics({ asi: data.asi }).asi;
  return (
    <div className="space-y-2 text-sm" data-species-choice>
      <SectionHead title="The player's choice" glyph="tab-characters" className="mb-1" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField
          label="What the player chooses"
          value={String(group.label ?? "")}
          onChange={(label) => putGroup({ label })}
          placeholder="Draconic ancestry, Bloodline"
          maxLength={L.label}
          hint="The builder asks for it under this name, and the sheet records the pick as it."
        />
      </div>
      <ul className="space-y-1.5" aria-label="Options">
        {options.map((option, index) => {
          const optionName = String(option.name ?? "").trim() || `Option ${index + 1}`;
          const key = String(option.id ?? "") || `at-${index}`;
          return (
            <li key={key} className="live-in flex items-start gap-1" data-species-option={String(option.id ?? "")}>
              <div className="min-w-0 grow">
                <MechGroup title={optionName} summary={variantSummary(readOption(option))} open={fresh === option.id}>
                  <OptionFields option={option} put={(next) => putOptions(options.map((entry, at) => (at === index ? next : entry)))} />
                </MechGroup>
              </div>
              <button
                type="button"
                aria-label={`Move ${optionName} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className={cn(ui.iconAction, rowIcon, "disabled:opacity-40")}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${optionName} down`}
                disabled={index === options.length - 1}
                onClick={() => move(index, 1)}
                className={cn(ui.iconAction, rowIcon, "disabled:opacity-40")}
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${optionName}`}
                onClick={() => putOptions(options.filter((_, at) => at !== index))}
                className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}
              >
                <X className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="New option's name" value={newName} onChange={setNewName} placeholder="Ashen" maxLength={L.name} className="min-w-48 grow sm:grow-0" />
        <button type="button" onClick={add} disabled={!name || full} className={cn(ui.btnSmall, addChip)}>
          <Plus className="size-3" /> Add option
        </button>
        <span className="pb-2 text-[11px] text-stone-400" data-species-option-count>
          {options.length} of {L.options}
          {options.length < L.minOptions ? `: a choice needs ${L.minOptions}` : ""}
        </span>
      </div>
      {options.length ? (
        <div className="space-y-0.5" data-species-choice-preview>
          <span className="text-[11px] text-stone-400">What each pick gives, with the species&apos; own scores</span>
          <ul className="space-y-0.5 text-[11px] text-stone-300">
            {options.map((option, index) => (
              <li key={String(option.id ?? "") || `at-${index}`}>
                <span className="text-amber-200/90">{String(option.name ?? "").trim() || `Option ${index + 1}`}</span>:{" "}
                {variantSummary(readOption(option), baseAsi)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <button type="button" onClick={() => set({ variants: undefined })} className={cn(ui.btnSmall, addChip, "hover:text-red-300")}>
        <X className="size-3" /> Remove the choice
      </button>
    </div>
  );
}
