"use client";

import { SKILL_NAMES } from "@/lib/bestiary/block-sections";
import {
  LANGUAGES,
  PREREQUISITE_SUGGESTIONS,
  TOOL_PROFICIENCIES,
  appendTerm,
} from "@/lib/workshop/pickers";
import { AddFromList } from "@/components/ui/AddFromList";
import { ContentPick } from "@/components/ui/ContentPick";
import {
  Field,
  TextField,
  type FieldGlossary,
} from "@/app/workshop/homebrew/fields";
import { describeSkill } from "@/lib/help";
import type { GlossaryEntry } from "@/lib/help/terms";
import type { EditorKind } from "@/app/workshop/homebrew/types";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { Data } from "@/app/workshop/homebrew/draft";
import { ArchetypeFields } from "@/app/workshop/homebrew/ArchetypeFields";
import { SpeciesFields } from "@/app/workshop/homebrew/SpeciesFields";

// The character-option forms: feat, background, species, subclass. Each
// writes the field names the character builder already reads for the
// content pack's own rows, so a homebrew background shows its skills in
// the same picker an SRD one does.

// The skills as the builder prints them: "Sleight of Hand", "Animal Handling".
const SKILL_LABELS = SKILL_NAMES.map((skill) =>
  skill.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(" Of ", " of "),
);

// What each skill covers, for the ⓘ beside the list.
const SKILL_GLOSSARY: GlossaryEntry[] = SKILL_NAMES.flatMap((name, index) => {
  const blurb = describeSkill(name.toLowerCase().replace(/\s+/g, "_"));
  return blurb ? [{ name: SKILL_LABELS[index] ?? name, blurb }] : [];
});

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
  glossary,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  options: readonly string[];
  prompt: string;
  glossary?: FieldGlossary;
}) {
  return (
    <Field label={label} hint={hint} glossary={glossary}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={value}
          maxLength={200}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className={cn(ui.input, "min-w-32 flex-1")}
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
        glossary={{ title: "Skills", entries: SKILL_GLOSSARY }}
      />
      <ListField
        label="Tool proficiencies"
        value={String(data.tool_proficiencies ?? "")}
        onChange={(tool_proficiencies) => set({ tool_proficiencies })}
        placeholder="One type of gaming set"
        hint="A tool you are proficient with adds your proficiency bonus to checks made with it."
        options={TOOL_PROFICIENCIES}
        prompt="Add a tool"
      />
      <ListField
        label="Languages"
        value={String(data.languages ?? "")}
        onChange={(languages) => set({ languages })}
        placeholder="Two of your choice"
        options={LANGUAGES}
        prompt="Add a language"
      />
      <Field label="Equipment" hint="What the character starts with. Pick from the catalogue or type anything.">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={String(data.equipment ?? "")}
            maxLength={500}
            placeholder="A set of fine clothes, 15 gp"
            aria-label="Equipment"
            onChange={(event) => set({ equipment: event.target.value })}
            className={cn(ui.input, "min-w-32 flex-1")}
          />
          <ContentPick
            kind="items"
            label="Add an item"
            placeholder="Add an item..."
            onPick={(entry) => set({ equipment: appendTerm(String(data.equipment ?? ""), entry.name) })}
          />
        </div>
      </Field>
      <TextField label="Feature" value={String(data.feature ?? "")} onChange={(feature) => set({ feature })} placeholder="Salt Lore" maxLength={80} />
      <TextField label="What the feature does" value={String(data.feature_desc ?? "")} onChange={(feature_desc) => set({ feature_desc })} maxLength={2000} />
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
      return <SpeciesFields data={data} set={set} />;
    case "archetype":
      return <ArchetypeFields data={data} set={set} />;
  }
}
