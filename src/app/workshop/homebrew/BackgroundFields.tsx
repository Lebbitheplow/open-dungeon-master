"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ContentPick } from "@/components/ui/ContentPick";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { NumberField, TextArea, TextField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { ChipList } from "@/app/workshop/plugin/fields";
import { LANGUAGES, TOOL_PROFICIENCIES } from "@/lib/workshop/pickers";
import { SKILL_IDS } from "@/lib/homebrew/item-magic-schema";
import { backgroundMechanics } from "@/lib/content/mechanics";
import { splitPurse } from "@/lib/characters/options";
import { rowIcon } from "@/app/workshop/kit";
import type { BackgroundGrants } from "@/lib/homebrew/background-data";
import type { Data } from "@/app/workshop/homebrew/draft";

// A background: what the builder grants and the creation check holds a
// character to (src/lib/homebrew/background-data.ts), picked rather than
// typed, and the named feature it gives. A background saved before these
// pickers had its grants as prose; it opens with them read from the prose.

type Props = { data: Data; set: (patch: Data) => void };

const SKILL_LABELS = Object.fromEntries(SKILL_IDS.map((id) => [id, id.replace(/_/g, " ")])) as Record<(typeof SKILL_IDS)[number], string>;
const TOOLS = [
  "One type of gaming set",
  "One type of artisan's tools",
  "One type of musical instrument",
  ...TOOL_PROFICIENCIES,
];

export function grantsOfDraft(data: Data): BackgroundGrants {
  const held = data.grants as BackgroundGrants | undefined;
  if (held && Array.isArray(held.skills)) {
    return held;
  }
  const parsed = backgroundMechanics(data);
  const kit = splitPurse(parsed.equipment);
  return {
    skills: parsed.skills,
    ...(parsed.skillChoice ? { skillChoice: parsed.skillChoice } : {}),
    tools: parsed.tools,
    languages: parsed.languages,
    knownLanguages: parsed.knownLanguages,
    equipment: kit.equipment,
    purse: kit.purse,
  };
}

// The kit as lines with a count each: ten torches are ten lines, shown as
// one row of ten.
function KitList({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  const rows = [...counts.entries()];
  const write = (next: Array<[string, number]>) => onChange(next.flatMap(([name, count]) => Array.from({ length: count }, () => name)));
  return (
    <div className="space-y-1.5">
      <ul className="stagger-up space-y-1">
        {rows.map(([name, count], index) => (
          <li key={name} className="live-in flex items-center gap-2 text-xs text-stone-200">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <NumberStepper size="sm" label={`How many ${name}`} value={count} min={1} max={20} onChange={(value) => write(rows.map((row, at) => (at === index ? [row[0], value || 1] : row)))} />
            <button type="button" aria-label={`Remove ${name}`} onClick={() => write(rows.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <ContentPick
        kind="items"
        label="Add an item to the kit"
        placeholder="Add an item..."
        onPick={(entry) => onChange([...items, entry.name])}
      />
    </div>
  );
}

export function BackgroundFields({ data, set }: Props) {
  const grants = grantsOfDraft(data);
  const put = (patch: Partial<BackgroundGrants>) => set({ grants: { ...grants, ...patch } });
  const choice = grants.skillChoice;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5 text-sm">
        <SectionHead title="Skills" glyph="rest-proficiency" className="mb-1" />
        <ToggleChips options={SKILL_IDS} labels={SKILL_LABELS} selected={grants.skills} onChange={(skills) => put({ skills })} />
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
          <span>And the player picks</span>
          <NumberStepper
            size="sm"
            label="Skills the player picks"
            value={choice?.count ?? 0}
            min={0}
            max={4}
            onChange={(count) => put({ skillChoice: count ? { count, from: choice?.from ?? [] } : undefined })}
          />
          <span>{choice?.count ? "from (none ticked: any skill)" : "more"}</span>
        </div>
        {choice?.count ? (
          <div className="live-in">
            <ToggleChips options={SKILL_IDS} labels={SKILL_LABELS} selected={choice.from} onChange={(from) => put({ skillChoice: { count: choice.count, from } })} />
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 text-sm">
          <SectionHead title="Tools" glyph="tab-loot" className="mb-1" />
          <ChipList items={grants.tools} onChange={(tools) => put({ tools })} options={TOOLS} prompt="Add a tool" max={8} />
        </div>
        <div className="space-y-1.5 text-sm">
          <SectionHead title="Languages" glyph="system-lore" className="mb-1" />
          <ChipList items={grants.knownLanguages} onChange={(knownLanguages) => put({ knownLanguages })} options={LANGUAGES} prompt="Add a language" max={6} />
          <span className="flex items-center gap-2 text-[11px] text-stone-400">
            Plus
            <NumberStepper size="sm" label="Languages of the player's choice" value={grants.languages} min={0} max={8} onChange={(languages) => put({ languages })} />
            of the player&apos;s choice
          </span>
        </div>
      </div>
      <div className="space-y-1.5 text-sm">
        <SectionHead title="Starting kit" glyph="tab-loot" className="mb-1" />
        <KitList items={grants.equipment} onChange={(equipment) => put({ equipment })} />
        <NumberField label="Coin (gp)" value={grants.purse} min={0} max={10000} onChange={(purse) => put({ purse: purse === "" ? 0 : purse })} className="w-40" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Feature" value={String(data.feature ?? "")} onChange={(feature) => set({ feature })} placeholder="Salt Lore" maxLength={80} />
        <TextArea label="What the feature does" value={String(data.feature_desc ?? "")} onChange={(feature_desc) => set({ feature_desc })} rows={3} maxLength={4000} />
      </div>
    </div>
  );
}
