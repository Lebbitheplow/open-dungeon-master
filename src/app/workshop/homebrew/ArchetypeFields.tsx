"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ContentPick } from "@/components/ui/ContentPick";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { SelectField } from "@/app/workshop/homebrew/fields";
import { CLASS_IDS } from "@/app/workshop/homebrew/types";
import { engineRunsFeature, subclassFeatureCatalog, type CatalogFeature } from "@/lib/workshop/feature-catalog";
import { addChip, rowIcon } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";

// A subclass: its class, its features by level and the always-prepared
// spells it hands out (a domain's, an oath's). A character who takes it is
// granted these by name at the table (src/lib/srd/subclass-tables.ts), so a
// feature borrowed from a published subclass keeps the name the engines run
// it by, and the row says so.

type FeatureRow = { n: string; d: string };
type Flat = { level: number; feature: FeatureRow };

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function BorrowFeature({ onPick, taken }: { onPick: (feature: CatalogFeature) => void; taken: Set<string> }) {
  const [query, setQuery] = useState("");
  const all = subclassFeatureCatalog();
  const results = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (wanted.length < 2) return [];
    return all
      .filter((entry) => entry.name.toLowerCase().includes(wanted) || entry.subclass.toLowerCase().includes(wanted))
      .slice(0, 24);
  }, [all, query]);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Borrow a feature from any subclass: improved critical, vow of enmity..."
          aria-label="Find a published subclass feature to borrow"
          className={cn(ui.input, "w-full pl-7 text-sm")}
        />
      </div>
      {results.length ? (
        <ul className="reveal stagger-up max-h-64 space-y-1 overflow-y-auto rounded-lg border border-stone-800 bg-stone-950/60 p-1.5">
          {results.map((entry) => {
            const key = `${entry.classId}/${entry.subclass}/${entry.name}`;
            const done = taken.has(entry.name.toLowerCase());
            return (
              <li key={key} className="flex items-start gap-2">
                <button
                  type="button"
                  disabled={done}
                  onClick={() => onPick(entry)}
                  className={cn(ui.btnSmall, addChip, "shrink-0", done && "border-emerald-500/40 text-emerald-200")}
                >
                  {done ? <Check className="size-3" /> : <Plus className="size-3" />} Level {entry.level}
                </button>
                <span className="min-w-0 text-[11px] leading-snug text-stone-400">
                  <span className="text-stone-200">{entry.name}</span> ({capital(entry.classId)}, {entry.subclass})
                  {entry.text ? ` ${entry.text.slice(0, 140)}${entry.text.length > 140 ? "..." : ""}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function SpellLists({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const spells = (data.spells ?? {}) as Record<string, string[]>;
  const rows = Object.entries(spells).sort(([a], [b]) => Number(a) - Number(b));
  const put = (next: Record<string, string[]>) => set({ spells: Object.keys(next).length ? next : undefined });
  const [level, setLevel] = useState(3);
  return (
    <div className="space-y-1.5">
      <SectionHead title="Always-prepared spells" glyph="rest-spell-slot" className="mb-1" />
      {rows.map(([at, names]) => (
        <div key={at} className="live-in flex flex-wrap items-center gap-1.5 text-xs">
          <span className="w-16 text-stone-400">Level {at}</span>
          {names.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-1.5 py-0.5 text-stone-200">
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => {
                  const left = names.filter((entry) => entry !== name);
                  const next = { ...spells };
                  if (left.length) next[at] = left;
                  else delete next[at];
                  put(next);
                }}
                className="text-stone-500 hover:text-red-300"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[11px] text-stone-400">
          At class level
          <NumberStepper size="sm" label="Class level the spells arrive at" min={1} max={20} value={level} onChange={setLevel} />
        </span>
        <ContentPick
          kind="spells"
          label="Find a spell the subclass always has prepared"
          placeholder="Add a spell..."
          className="min-w-48 flex-1"
          onPick={(entry) => {
            const list = spells[String(level)] ?? [];
            if (list.some((name) => name.toLowerCase() === entry.name.toLowerCase())) return;
            put({ ...spells, [String(level)]: [...list, entry.name] });
          }}
        />
      </div>
      <p className="text-[11px] text-stone-500">Prepared for free from that level on, and never counted against the class&apos;s own prepared spells.</p>
    </div>
  );
}

export function ArchetypeFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const classId = String(data.classSlug ?? "fighter");
  const levels = (data.levels ?? {}) as Record<string, FeatureRow[]>;
  const flat: Flat[] = Object.entries(levels)
    .flatMap(([level, features]) => features.map((feature) => ({ level: Number(level), feature })))
    .sort((a, b) => a.level - b.level);
  const write = (next: Flat[]) => {
    const grouped: Record<string, FeatureRow[]> = {};
    for (const row of next) {
      (grouped[String(row.level)] ??= []).push(row.feature);
    }
    set({ levels: grouped });
  };
  const taken = new Set(flat.map((row) => row.feature.n.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      <SelectField
        label="Class"
        value={classId}
        options={CLASS_IDS.map((value) => ({ value, label: capital(value) }))}
        onChange={(classSlug) => set({ classSlug })}
        className="w-56"
        hint="The builder offers it under this class."
      />
      <div className="space-y-1.5 text-sm">
        <SectionHead title="Features by level" glyph="rest-level-up" className="mb-1" />
        {flat.map((row, index) => {
          const tag = row.feature.n.trim() ? engineRunsFeature(classId, row.feature.n.trim()) : null;
          return (
            <div key={index} className="live-in grid gap-1.5 rounded-lg border border-stone-800 p-2 sm:grid-cols-[auto_1fr_auto]">
              <NumberStepper
                label="Level"
                value={row.level}
                min={1}
                max={20}
                onChange={(level) => write(flat.map((entry, at) => (at === index ? { ...entry, level: level || 1 } : entry)))}
              />
              <div className="min-w-0 space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    value={row.feature.n}
                    aria-label="Feature name"
                    placeholder="Reed Walker"
                    maxLength={80}
                    onChange={(event) => write(flat.map((entry, at) => (at === index ? { ...entry, feature: { ...entry.feature, n: event.target.value } } : entry)))}
                    className={cn(ui.input, "w-full text-sm sm:w-56")}
                  />
                  {tag ? (
                    <span className="reveal-pop rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-200" title="A feature of this name is run by the server, not just read by the DM.">
                      The engine runs it {tag}
                    </span>
                  ) : null}
                </span>
                <textarea
                  value={row.feature.d}
                  aria-label="What it does"
                  placeholder="Marsh terrain costs no extra movement."
                  maxLength={1500}
                  rows={2}
                  onChange={(event) => write(flat.map((entry, at) => (at === index ? { ...entry, feature: { ...entry.feature, d: event.target.value } } : entry)))}
                  className={cn(ui.input, "w-full resize-y text-sm")}
                />
              </div>
              <button type="button" aria-label="Remove feature" onClick={() => write(flat.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => write([...flat, { level: flat.length ? Math.min(20, flat[flat.length - 1].level + 3) : 3, feature: { n: "", d: "" } }])}
          className={cn(ui.btnSmall, addChip)}
        >
          <Plus className="size-3" /> Add a feature
        </button>
        <BorrowFeature taken={taken} onPick={(entry) => write([...flat, { level: entry.level, feature: { n: entry.name, d: entry.text } }])} />
        <p className="text-[11px] text-stone-500">
          Granted by name when a character takes this subclass. A borrowed feature keeps its name so the engine runs it; renaming it makes it words for the DM.
        </p>
      </div>
      <SpellLists data={data} set={set} />
    </div>
  );
}
