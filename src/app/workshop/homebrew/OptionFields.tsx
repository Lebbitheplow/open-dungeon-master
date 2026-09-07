"use client";

import { Plus, X } from "lucide-react";
import { SKILL_NAMES } from "@/lib/bestiary/block-sections";
import {
  LANGUAGES,
  PREREQUISITE_SUGGESTIONS,
  VISION_SUGGESTIONS,
  appendTerm,
} from "@/lib/workshop/pickers";
import { AddFromList } from "@/components/ui/AddFromList";
import { Field, NumberField, SelectField, TextArea, TextField } from "@/app/workshop/homebrew/fields";
import { CLASS_IDS, input, type EditorKind } from "@/app/workshop/homebrew/types";
import type { Data } from "@/app/workshop/homebrew/draft";

// The character-option forms: feat, background, species, subclass. Each
// writes the field names the character builder already reads for the
// content pack's own rows, so a homebrew background shows its skills in
// the same picker an SRD one does.

const ABILITY_NAMES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;

type AsiRow = { attributes: string[]; value: number };
type FeatureRow = { n: string; d: string };

// The skills as the builder prints them: "Sleight of Hand", "Animal Handling".
const SKILL_LABELS = SKILL_NAMES.map((skill) =>
  skill.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(" Of ", " of "),
);

// A comma-separated field with a dropdown of what it usually holds beside
// it. Picking appends; the text stays editable for anything off the list.
function ListField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  options,
  prompt,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  options: readonly string[];
  prompt: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={value}
          maxLength={200}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className={`${input} min-w-32 flex-1`}
        />
        <AddFromList prompt={prompt} options={options} onPick={(term) => onChange(appendTerm(value, term))} />
      </div>
    </Field>
  );
}

function FeatFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  return (
    <TextField
      label="Prerequisite"
      value={String(data.prerequisite ?? "")}
      onChange={(prerequisite) => set({ prerequisite })}
      placeholder="Strength 13 or higher"
      maxLength={200}
      hint="Leave empty for none. The builder shows it beside the feat."
      suggestions={PREREQUISITE_SUGGESTIONS}
    />
  );
}

function BackgroundFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ListField
        label="Skill proficiencies"
        value={String(data.skill_proficiencies ?? "")}
        onChange={(skill_proficiencies) => set({ skill_proficiencies })}
        placeholder="Insight, Persuasion"
        hint="The builder grants these by name."
        options={SKILL_LABELS}
        prompt="Add a skill"
      />
      <TextField
        label="Tool proficiencies"
        value={String(data.tool_proficiencies ?? "")}
        onChange={(tool_proficiencies) => set({ tool_proficiencies })}
        placeholder="One type of gaming set"
      />
      <ListField
        label="Languages"
        value={String(data.languages ?? "")}
        onChange={(languages) => set({ languages })}
        placeholder="Two of your choice"
        options={LANGUAGES}
        prompt="Add a language"
      />
      <TextField label="Equipment" value={String(data.equipment ?? "")} onChange={(equipment) => set({ equipment })} placeholder="A set of fine clothes, 15 gp" maxLength={500} />
      <TextField label="Feature" value={String(data.feature ?? "")} onChange={(feature) => set({ feature })} placeholder="Salt Lore" maxLength={80} />
      <TextField label="What the feature does" value={String(data.feature_desc ?? "")} onChange={(feature_desc) => set({ feature_desc })} maxLength={2000} />
    </div>
  );
}

function RaceFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const asi = Array.isArray(data.asi) ? (data.asi as AsiRow[]) : [];
  const speed = (data.speed as { walk?: number } | undefined)?.walk ?? 30;
  const updateAsi = (next: AsiRow[]) => set({ asi: next });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField
          label="Size"
          value={String(data.size ?? "Medium")}
          options={["Tiny", "Small", "Medium", "Large"].map((value) => ({ value, label: value }))}
          onChange={(size) => set({ size })}
        />
        <NumberField label="Speed (ft)" value={speed} min={5} max={120} step={5} onChange={(walk) => set({ speed: { walk: walk === "" ? 30 : walk } })} />
        <TextField
          label="Vision"
          value={String(data.vision ?? "")}
          onChange={(vision) => set({ vision })}
          placeholder="Darkvision 60 ft"
          maxLength={120}
          suggestions={VISION_SUGGESTIONS}
        />
        <ListField
          label="Languages"
          value={String(data.languages ?? "")}
          onChange={(languages) => set({ languages })}
          placeholder="Common and Sylvan"
          options={LANGUAGES}
          prompt="Add a language"
        />
      </div>
      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">Ability score increases</span>
        {asi.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <select
              value={row.attributes[0] ?? "Strength"}
              aria-label="Ability"
              onChange={(event) =>
                updateAsi(asi.map((entry, at) => (at === index ? { ...entry, attributes: [event.target.value] } : entry)))
              }
              className={input}
            >
              {ABILITY_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input
              type="number"
              aria-label="Increase"
              value={row.value}
              min={-2}
              max={3}
              onChange={(event) =>
                updateAsi(asi.map((entry, at) => (at === index ? { ...entry, value: Number(event.target.value) } : entry)))
              }
              className={`${input} w-16`}
            />
            <button
              type="button"
              aria-label="Remove increase"
              onClick={() => updateAsi(asi.filter((_, at) => at !== index))}
              className="rounded-md border border-stone-700 p-1 text-stone-500 hover:text-red-300"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {asi.length < 6 ? (
          <button
            type="button"
            onClick={() => updateAsi([...asi, { attributes: ["Dexterity"], value: 1 }])}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:bg-stone-900"
          >
            <Plus className="size-3" /> Add an increase
          </button>
        ) : null}
      </div>
      <TextArea
        label="Traits"
        value={String(data.traits ?? "")}
        onChange={(traits) => set({ traits })}
        placeholder={"**Marsh Stride.** Difficult terrain in wetlands costs you no extra movement.\n**Reed Sight.** You have advantage on Perception checks in tall grass."}
        rows={5}
        maxLength={4000}
        hint="One trait per line. The builder shows the first sentence of each."
      />
    </div>
  );
}

function ArchetypeFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const levels = (data.levels ?? {}) as Record<string, FeatureRow[]>;
  const rows: Array<{ level: number; index: number; feature: FeatureRow }> = [];
  for (const [level, features] of Object.entries(levels)) {
    features.forEach((feature, index) => rows.push({ level: Number(level), index, feature }));
  }
  rows.sort((a, b) => a.level - b.level);
  const write = (next: Array<{ level: number; feature: FeatureRow }>) => {
    const grouped: Record<string, FeatureRow[]> = {};
    for (const row of next) {
      (grouped[String(row.level)] ??= []).push(row.feature);
    }
    set({ levels: grouped });
  };
  const flat = rows.map((row) => ({ level: row.level, feature: row.feature }));

  return (
    <div className="space-y-2">
      <SelectField
        label="Class"
        value={String(data.classSlug ?? "fighter")}
        options={CLASS_IDS.map((value) => ({ value, label: value }))}
        onChange={(classSlug) => set({ classSlug })}
        className="w-48"
        hint="The builder offers it under this class."
      />
      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">Features by level</span>
        {flat.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <input
              type="number"
              aria-label="Level"
              value={row.level}
              min={1}
              max={20}
              onChange={(event) =>
                write(flat.map((entry, at) => (at === index ? { ...entry, level: Number(event.target.value) || 1 } : entry)))
              }
              className={`${input} w-16`}
            />
            <input
              value={row.feature.n}
              aria-label="Feature name"
              placeholder="Reed Walker"
              maxLength={80}
              onChange={(event) =>
                write(flat.map((entry, at) => (at === index ? { ...entry, feature: { ...entry.feature, n: event.target.value } } : entry)))
              }
              className={`${input} w-40`}
            />
            <input
              value={row.feature.d}
              aria-label="What it does"
              placeholder="Marsh terrain costs no extra movement."
              maxLength={500}
              onChange={(event) =>
                write(flat.map((entry, at) => (at === index ? { ...entry, feature: { ...entry.feature, d: event.target.value } } : entry)))
              }
              className={`${input} min-w-48 flex-1`}
            />
            <button
              type="button"
              aria-label="Remove feature"
              onClick={() => write(flat.filter((_, at) => at !== index))}
              className="rounded-md border border-stone-700 p-1 text-stone-500 hover:text-red-300"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => write([...flat, { level: flat.length ? Math.min(20, flat[flat.length - 1].level + 3) : 3, feature: { n: "", d: "" } }])}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:bg-stone-900"
        >
          <Plus className="size-3" /> Add a feature
        </button>
        <p className="text-[10px] text-stone-600">
          The DM prompt reads each line as rules text. Features are granted by name when a character takes this subclass.
        </p>
      </div>
    </div>
  );
}

export function OptionFields({
  kind,
  data,
  onChange,
}: {
  kind: Exclude<EditorKind, "item" | "spell">;
  data: Data;
  onChange: (next: Data) => void;
}) {
  const set = (patch: Data) => onChange({ ...data, ...patch });
  switch (kind) {
    case "feat":
      return <FeatFields data={data} set={set} />;
    case "background":
      return <BackgroundFields data={data} set={set} />;
    case "race":
      return <RaceFields data={data} set={set} />;
    case "archetype":
      return <ArchetypeFields data={data} set={set} />;
  }
}
