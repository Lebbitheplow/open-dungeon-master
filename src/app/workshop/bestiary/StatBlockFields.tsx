"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAX_TRAITS, TRAIT_MAX, type MonsterDraft } from "@/lib/bestiary/monster-draft";
import {
  ABILITY_ORDER,
  ENVIRONMENTS,
  SECTION_LABELS,
  SENSE_NAMES,
  SKILL_NAMES,
  TRAIT_SECTIONS,
  abilityMod,
  sectionOfLine,
  withSection,
} from "@/lib/bestiary/block-sections";
import type { EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";
import { input } from "@/app/workshop/bestiary/types";

// The printed half of a stat block (docs/workshop-parity-audit.md phase
// 12): ability scores, skills, senses, languages and alignment, the spells
// a caster knows, where it lives, and a section on every trait line so the
// block reads in the order a book prints it. None of it changes what the
// engine runs, which is the attack list; it changes what the DM running the
// monster gets told, and whether the block looks finished.

const ALIGNMENTS = [
  "",
  "lawful good",
  "neutral good",
  "chaotic good",
  "lawful neutral",
  "neutral",
  "chaotic neutral",
  "lawful evil",
  "neutral evil",
  "chaotic evil",
  "unaligned",
  "any alignment",
] as const;

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

type Setter = (patch: Partial<EnemyStats>) => void;

function Label({ children }: { children: string }) {
  return <span className="text-[10px] uppercase tracking-wide text-stone-500">{children}</span>;
}

export function AbilityScores({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const stats = draft.stats;
  const set: Setter = (patch) => onChange({ ...draft, stats: { ...stats, ...patch } });
  const scores = stats.abilities ?? {};
  const setScore = (ability: SaveAbility, value: number | "") => {
    const next = { ...scores };
    if (value === "") {
      delete next[ability];
    } else {
      next[ability] = value;
    }
    set({ abilities: Object.keys(next).length ? next : undefined });
  };
  // A DM who typed the six scores usually means the saves and the DEX
  // modifier to follow from them, the way a printed block's do.
  const derive = () =>
    set({
      dexMod: typeof scores.dex === "number" ? abilityMod(scores.dex) : stats.dexMod,
      saveMods: Object.fromEntries(
        ABILITY_ORDER.map((ability) => [
          ability,
          typeof scores[ability] === "number" ? abilityMod(scores[ability] as number) : stats.saveMods?.[ability] ?? 0,
        ]),
      ) as EnemyStats["saveMods"],
    });
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label>Ability scores</Label>
        <button
          type="button"
          onClick={derive}
          disabled={!Object.keys(scores).length}
          className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-amber-100 disabled:opacity-40"
          title="Set the DEX modifier and the saving throws from these scores"
        >
          Saves from scores
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {ABILITY_ORDER.map((ability) => (
          <label key={ability} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-stone-500">
              {ability}
              {typeof scores[ability] === "number" ? (
                <span className="ml-1 text-stone-600">{signed(abilityMod(scores[ability] as number))}</span>
              ) : null}
            </span>
            <input
              type="number"
              min={1}
              max={30}
              value={scores[ability] ?? ""}
              placeholder="10"
              onChange={(event) => setScore(ability, event.target.value === "" ? "" : Number(event.target.value))}
              className={cn(input, "w-full")}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function SkillsAndSenses({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const stats = draft.stats;
  const set: Setter = (patch) => onChange({ ...draft, stats: { ...stats, ...patch } });
  const skills = stats.skills ?? {};
  const senses = stats.senses ?? {};
  const setSense = (name: keyof NonNullable<EnemyStats["senses"]>, value: number | "") => {
    const next = { ...senses };
    if (value === "" || value === 0) {
      delete next[name];
    } else {
      next[name] = value;
    }
    set({ senses: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>Skills (tap to add, type the bonus)</Label>
        <div className="flex flex-wrap gap-1">
          {SKILL_NAMES.map((name) => {
            const bonus = skills[name];
            const on = typeof bonus === "number";
            return (
              <span key={name} className="flex items-center">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = { ...skills };
                    if (on) {
                      delete next[name];
                    } else {
                      next[name] = Math.max(2, stats.dexMod + 2);
                    }
                    set({ skills: Object.keys(next).length ? next : undefined });
                  }}
                  className={cn(
                    "rounded-l-md border px-1.5 py-0.5 text-[11px] capitalize",
                    on
                      ? "border-amber-700 bg-amber-950/50 text-amber-100"
                      : "rounded-r-md border-stone-700 text-stone-400 hover:text-stone-200",
                  )}
                >
                  {name}
                </button>
                {on ? (
                  <input
                    type="number"
                    aria-label={`${name} bonus`}
                    min={-5}
                    max={20}
                    value={bonus}
                    onChange={(event) => set({ skills: { ...skills, [name]: Number(event.target.value) } })}
                    className={cn(input, "w-12 rounded-l-none border-l-0 py-0.5 text-[11px]")}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {SENSE_NAMES.map((name) => (
          <label key={name} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">{name} (ft)</span>
            <input
              type="number"
              min={0}
              max={600}
              step={5}
              value={senses[name] ?? ""}
              placeholder="0"
              onChange={(event) => setSense(name, event.target.value === "" ? "" : Number(event.target.value))}
              className={cn(input, "w-full")}
            />
          </label>
        ))}
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Passive Perception</span>
          <input
            type="number"
            min={1}
            max={40}
            value={senses.passivePerception ?? ""}
            placeholder={String(10 + (skills.perception ?? stats.saveMods?.wis ?? 0))}
            onChange={(event) =>
              setSense("passivePerception", event.target.value === "" ? "" : Number(event.target.value))
            }
            className={cn(input, "w-full")}
          />
        </label>
      </div>
      <p className="text-[10px] text-stone-600">
        A hiding character has to beat the passive Perception; the printed number wins, then the skill, then Wisdom.
      </p>
    </div>
  );
}

export function LanguagesAndHabitat({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const stats = draft.stats;
  const set: Setter = (patch) => onChange({ ...draft, stats: { ...stats, ...patch } });
  const environment = stats.environment ?? [];
  const spells = stats.spells ?? [];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5">
          <Label>Languages</Label>
          <input
            value={stats.languages ?? ""}
            maxLength={200}
            placeholder="Common, Goblin"
            onChange={(event) => set({ languages: event.target.value || undefined })}
            className={cn(input, "w-full")}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Alignment</Label>
          <select
            value={stats.alignment ?? ""}
            onChange={(event) => set({ alignment: event.target.value || undefined })}
            className={cn(input, "w-full capitalize")}
          >
            {ALIGNMENTS.map((alignment) => (
              <option key={alignment} value={alignment} className="capitalize">
                {alignment || "unstated"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <Label>Spells known (by name, comma separated)</Label>
        <input
          defaultValue={spells.join(", ")}
          key={spells.join("|")}
          maxLength={800}
          placeholder="Fire Bolt, Shield, Misty Step"
          onBlur={(event) => {
            const next = event.target.value.split(",").map((name) => name.trim()).filter(Boolean);
            if (next.join("|") !== spells.join("|")) {
              set({ spells: next.length ? next : undefined });
            }
          }}
          className={cn(input, "w-full")}
        />
        <span className="text-[10px] text-stone-600">
          The DM running it sees the list. Put a round of casting into extra damage so the rating counts it.
        </span>
      </label>
      <div className="space-y-1">
        <Label>Found in</Label>
        <div className="flex flex-wrap gap-1">
          {ENVIRONMENTS.map((place) => {
            const on = environment.includes(place);
            return (
              <button
                key={place}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? environment.filter((entry) => entry !== place) : [...environment, place];
                  set({ environment: next.length ? next : undefined });
                }}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[11px] capitalize",
                  on ? "border-amber-700 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-400 hover:text-stone-200",
                )}
              >
                {place}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The trait list with a section on every line. The line stored is the one
// the DM prompt prints, prefix and all (src/lib/bestiary/block-sections.ts).
export function SectionedTraitEditor({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const traits = draft.stats.traits;
  const setTraits = (next: string[]) => onChange({ ...draft, stats: { ...draft.stats, traits: next } });
  return (
    <div className="flex flex-col gap-1">
      <Label>Traits and actions</Label>
      {traits.map((trait, index) => {
        const { section, text } = sectionOfLine(trait);
        return (
          <div key={index} className="flex items-center gap-1.5">
            <select
              value={section}
              aria-label="Section"
              onChange={(event) =>
                setTraits(traits.map((row, at) => (at === index ? withSection(row, event.target.value as typeof section) : row)))
              }
              className={cn(input, "w-32 shrink-0 py-0.5 text-[11px]")}
            >
              {TRAIT_SECTIONS.map((option) => (
                <option key={option} value={option}>
                  {SECTION_LABELS[option]}
                </option>
              ))}
            </select>
            <input
              value={text}
              maxLength={TRAIT_MAX}
              onChange={(event) =>
                setTraits(traits.map((row, at) => (at === index ? withSection(event.target.value, section) : row)))
              }
              placeholder="Fire Breath (Recharge 5-6): DC 15 Dex save, 6d6 fire, half on a success"
              className={cn(input, "flex-1")}
            />
            <button
              type="button"
              onClick={() => setTraits(traits.filter((_, at) => at !== index))}
              className="text-stone-600 hover:text-red-300"
              aria-label="Remove trait"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}
      {traits.length < MAX_TRAITS ? (
        <div className="flex flex-wrap gap-1">
          {TRAIT_SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setTraits([...traits, withSection("", section)])}
              className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-amber-100"
            >
              <Plus className="size-3" /> {SECTION_LABELS[section]}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-stone-600">The block is full at {MAX_TRAITS} lines.</p>
      )}
    </div>
  );
}
