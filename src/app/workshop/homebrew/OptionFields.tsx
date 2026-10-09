"use client";

import { PREREQUISITE_SUGGESTIONS } from "@/lib/workshop/pickers";
import { SelectField, TextField } from "@/app/workshop/homebrew/fields";
import type { EditorKind } from "@/app/workshop/homebrew/types";
import type { Data } from "@/app/workshop/homebrew/draft";
import { ArchetypeFields } from "@/app/workshop/homebrew/ArchetypeFields";
import { SpeciesFields } from "@/app/workshop/homebrew/SpeciesFields";
import { BackgroundFields } from "@/app/workshop/homebrew/BackgroundFields";
import { engineFeatNames } from "@/lib/srd/feat-effects";

// The character-option forms: feat, background, species, subclass. Each
// writes the field names the character builder already reads for the
// content pack's own rows, so a homebrew background shows its skills in
// the same picker an SRD one does.

// The feats the engines run, for a workshop feat to run as one.
const RUNS_AS_OPTIONS = [
  { value: "", label: "its own text" },
  ...engineFeatNames()
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name })),
];

function FeatFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <TextField
        label="Prerequisite"
        value={String(data.prerequisite ?? "")}
        onChange={(prerequisite) => set({ prerequisite })}
        placeholder="Strength 13 or higher"
        maxLength={200}
        hint="Leave empty for none. The builder shows it beside the feat."
        suggestions={PREREQUISITE_SUGGESTIONS}
      />
      <SelectField
        label="Runs at the table as"
        value={String(data.runsAs ?? "")}
        options={RUNS_AS_OPTIONS}
        onChange={(runsAs) => set({ runsAs: runsAs || undefined })}
        hint="A published feat whose rules the server applies under this feat's name (a renamed Sharpshooter). Its own text is read for what it grants either way."
      />
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
