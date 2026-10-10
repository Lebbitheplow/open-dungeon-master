"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { SectionHead } from "@/components/ui/SectionHead";
import { ContentPick } from "@/components/ui/ContentPick";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { BLOCK_LIMITS, SAVE_ABILITY_IDS } from "@/lib/bestiary/block-check";
import type { MonsterDraft } from "@/lib/bestiary/monster-draft";
import type { MonsterSpell, MonsterSpellcasting } from "@/lib/dm/monster-abilities";
import { Field, OptionalStepper, rowIcon } from "@/app/workshop/kit";

// A monster's Spellcasting or Innate Spellcasting trait as the numbers the
// engine casts with (src/lib/dm/enemy-casting.ts): the save DC and attack
// bonus, the slots by level a slot spell spends, and the list, each spell at
// its level or a number of times a day. A spell not on this list is refused
// when the DM tries to cast it for the monster, so the list is the rule, not
// a reminder.

type Props = { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void };

const ABILITY_OPTIONS = [
  { value: "", label: "Unstated" },
  ...SAVE_ABILITY_IDS.map((ability) => ({ value: ability as string, label: ability.toUpperCase() })),
];

const USE_OPTIONS = [
  { value: "slot", label: "From a slot" },
  { value: "atwill", label: "At will" },
  ...[1, 2, 3].map((count) => ({ value: `day${count}`, label: `${count}/day` })),
];

function castWay(spell: MonsterSpell): string {
  if (spell.perDay) return `day${spell.perDay}`;
  return spell.level === 0 || spell.level === null ? "atwill" : "slot";
}

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function SpellcastingEditor({ draft, onChange }: Props) {
  const casting = draft.stats.spellcasting;
  const set = (next: MonsterSpellcasting | undefined) =>
    onChange({
      ...draft,
      stats: {
        ...draft.stats,
        spellcasting: next,
        // The printed list the DM prompt shows follows the block's own.
        spells: next?.spells.length ? next.spells.map((spell) => spell.name) : draft.stats.spells,
      },
    });
  const on = Boolean(casting);
  return (
    <div className="flex flex-col gap-2">
      <SectionHead
        title="Spellcasting"
        glyph="cue-arcane"
        className="mb-0"
        aside={
          <Switch
            label="Casts spells"
            on={on}
            onChange={(next) =>
              set(
                next
                  ? {
                      dc: 13,
                      attack: 5,
                      ability: "int",
                      slots: {},
                      spells: (draft.stats.spells ?? []).map((name) => ({ name, level: null })),
                    }
                  : undefined,
              )
            }
          />
        }
      />
      {casting ? (
        <div className="reveal flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Ability">
              <span className="block w-28">
                <Select label="Spellcasting ability" size="sm" value={casting.ability ?? ""} onChange={(ability) => set({ ...casting, ability: (ability || undefined) as MonsterSpellcasting["ability"] })} options={ABILITY_OPTIONS} />
              </span>
            </Field>
            <Field label="Save DC">
              <OptionalStepper label="Spell save DC" min={1} max={30} fallback={13} value={casting.dc} onChange={(dc) => set({ ...casting, dc: dc === "" ? undefined : dc })} />
            </Field>
            <Field label="Spell attack">
              <OptionalStepper label="Spell attack bonus" min={-5} max={20} fallback={5} value={casting.attack} onChange={(attack) => set({ ...casting, attack: attack === "" ? undefined : attack })} />
            </Field>
            <Field label="Caster level">
              <OptionalStepper label="Caster level" min={1} max={20} fallback={5} value={casting.casterLevel} onChange={(casterLevel) => set({ ...casting, casterLevel: casterLevel === "" ? undefined : casterLevel })} />
            </Field>
          </div>
          <Field label="Slots by level">
            <div className="stagger-up grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1.5">
              {LEVELS.map((level) => (
                <span key={level} className="flex flex-col gap-0.5 text-[10px] uppercase text-stone-500">
                  Level {level}
                  <NumberStepper
                    size="sm"
                    label={`Level ${level} slots`}
                    min={0}
                    max={9}
                    value={casting.slots[String(level)] ?? 0}
                    onChange={(count) => {
                      const slots = { ...casting.slots };
                      if (count > 0) slots[String(level)] = count;
                      else delete slots[String(level)];
                      set({ ...casting, slots });
                    }}
                  />
                </span>
              ))}
            </div>
          </Field>
          <div className="flex flex-col gap-1">
            {casting.spells.map((spell, index) => (
              <div key={spell.name} className="live-in flex flex-wrap items-center gap-1.5 text-xs">
                <span className="min-w-36 flex-1 text-stone-200">{spell.name}</span>
                <span className="block w-28">
                  <Select
                    label={`How ${spell.name} is cast`}
                    size="sm"
                    value={castWay(spell)}
                    onChange={(use) => {
                      const next: MonsterSpell =
                        use === "slot"
                          ? { name: spell.name, level: spell.level && spell.level > 0 ? spell.level : 1 }
                          : use === "atwill"
                            ? { name: spell.name, level: spell.level === 0 ? 0 : null }
                            : { name: spell.name, level: null, perDay: Number(use.slice(3)) };
                      set({ ...casting, spells: casting.spells.map((row, at) => (at === index ? next : row)) });
                    }}
                    options={USE_OPTIONS}
                  />
                </span>
                {castWay(spell) === "slot" ? (
                  <NumberStepper size="sm" label={`${spell.name} level`} min={1} max={9} value={spell.level ?? 1} onChange={(level) => set({ ...casting, spells: casting.spells.map((row, at) => (at === index ? { ...row, level } : row)) })} />
                ) : null}
                <button type="button" aria-label={`Remove ${spell.name}`} onClick={() => set({ ...casting, spells: casting.spells.filter((_, at) => at !== index) })} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {casting.spells.length < BLOCK_LIMITS.spells ? (
              <ContentPick
                kind="spells"
                label="Find a spell in the catalogue to add"
                placeholder="Add a spell from the books..."
                onPick={(entry) => {
                  if (casting.spells.some((known) => known.name.toLowerCase() === entry.name.toLowerCase())) return;
                  const level = typeof entry.level === "number" ? entry.level : null;
                  set({ ...casting, spells: [...casting.spells, { name: entry.name, level }] });
                }}
              />
            ) : null}
          </div>
          <span className="text-[11px] text-stone-500">
            The DM casts these for the monster; the server spends the slot or the use, and uses this DC for the save.
          </span>
        </div>
      ) : null}
    </div>
  );
}
