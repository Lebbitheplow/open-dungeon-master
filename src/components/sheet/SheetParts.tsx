"use client";

import type { ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoChipList } from "@/components/ui/InfoDialog";
import { CountPop } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";
import { contentSlug, describeFeature } from "@/lib/help";
import { ABILITIES } from "@/lib/schemas/sheet";
import { formatModifier, SRD_SKILLS } from "@/lib/srd";

// The pieces of the character sheet (docs/visual-overhaul-plan.md 8b.5), one
// implementation drawn by both the session's sheet dialog and the character
// page: a medallion portrait, painted ability tiles with tiered numbers,
// vitals medallions, save and skill rows with their icons, and the spell,
// equipment, feature and feat lists as icon chips that open their write-up.
// Styles are in src/app/styles/sheet.css.

type Ability = (typeof ABILITIES)[number];

const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// How a score reads at a glance: a weakness is dim, an ordinary score plain,
// a strength gold, and an exceptional one lit.
function scoreTier(score: number): "low" | "plain" | "high" | "peak" {
  if (score <= 9) return "low";
  if (score <= 13) return "plain";
  if (score <= 17) return "high";
  return "peak";
}

// The portrait in a gold ring with the class emblem riding its rim. The
// portrait itself is whatever the caller draws (a lightbox, a plate).
export function PortraitMedallion({
  classId,
  level,
  children,
  className,
}: {
  classId: string;
  level?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("sheet-medallion", className)}>
      <div className="sheet-medallion-face">{children}</div>
      <span className="sheet-medallion-emblem" title={classId}>
        <GameIcon icon={{ kind: "family", key: `class-${classId.toLowerCase()}` }} size="size-7" />
      </span>
      {level ? <span className="sheet-medallion-level">{level}</span> : null}
    </div>
  );
}

export function SheetBlock({
  title,
  aside,
  hint,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  // A hover explanation for the heading itself (how a DC was summed).
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("sheet-block", className)}>
      <header className="sheet-block-head" title={hint}>
        <h3 className="sheet-block-title">{title}</h3>
        <span className="sheet-block-rule motion-rule" aria-hidden="true" />
        {aside ? <span className="sheet-block-aside">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function AbilityTiles({
  abilities,
  mods,
  saves,
  saveProficiencies = [],
  explainSave,
}: {
  abilities: Record<Ability, number>;
  mods: Record<Ability, number>;
  // With saves the tile carries the saving throw under the score.
  saves?: Record<Ability, number>;
  saveProficiencies?: string[];
  explainSave?: (ability: Ability) => string;
}) {
  return (
    <div className="stagger-up grid grid-cols-3 gap-2 sm:grid-cols-6">
      {ABILITIES.map((ability, index) => {
        const proficient = saveProficiencies.includes(ability);
        return (
          <div
            key={ability}
            className="sheet-ability motion-card"
            data-tier={scoreTier(abilities[ability])}
            style={{ animationDelay: `${index * 45}ms` }}
            title={ABILITY_NAMES[ability]}
          >
            <GameIcon icon={{ kind: "glyph", key: `ability-${ability}` }} size="size-9" className="mx-auto" />
            <p className="eyebrow mt-1 text-[10px] text-stone-400">{ability}</p>
            <p className="sheet-ability-mod">{formatModifier(mods[ability])}</p>
            <p className="sheet-ability-score">{abilities[ability]}</p>
            {saves ? (
              <p
                className={cn("sheet-ability-save", proficient && "sheet-ability-save-on")}
                title={explainSave ? explainSave(ability) : undefined}
              >
                <span className={cn("sheet-pip", proficient && "sheet-pip-on")} aria-hidden="true" />
                Save {formatModifier(saves[ability])}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export type Vital = {
  glyph: string;
  label: ReactNode;
  value: ReactNode;
  title?: string;
  tone?: "plain" | "warn";
};

export function VitalTiles({ vitals }: { vitals: Vital[] }) {
  return (
    <div className="stagger-up grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {vitals.map((vital, index) => (
        <div key={index} className="sheet-vital" data-tone={vital.tone ?? "plain"} title={vital.title}>
          <GameIcon icon={{ kind: "glyph", key: vital.glyph }} size="size-7" />
          <span className="min-w-0">
            <span className="sheet-vital-label">{vital.label}</span>
            <span className="sheet-vital-value">
              {/* Gold spent, experience won, armour changed: the number pops. */}
              <CountPop value={typeof vital.value === "string" || typeof vital.value === "number" ? vital.value : null}>
                {vital.value}
              </CountPop>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Hit points as a bar: what is left in red, temporary points riding on top
// in blue. The numbers stay beside it; the bar is the glance.
export function HpBar({ current, max, temp = 0 }: { current: number; max: number; temp?: number }) {
  const span = Math.max(1, max + temp);
  const width = (value: number) => `${Math.max(0, Math.min(100, (value / span) * 100))}%`;
  return (
    <div className="sheet-hp" title={`${current}${temp ? ` +${temp} temporary` : ""} of ${max} hit points`}>
      <GameIcon icon={{ kind: "glyph", key: "rest-hp" }} size="size-7" />
      <div className="min-w-0 grow">
        <div className="flex items-baseline justify-between gap-2">
          <span className="sheet-vital-label">
            <GameTerm id="hit_points">Hit points</GameTerm>
          </span>
          <span className="font-display text-sm text-amber-50">
            {current}
            {temp ? <span className="text-sky-300"> +{temp}</span> : null}
            <span className="text-stone-500"> / {max}</span>
          </span>
        </div>
        <div className="sheet-hp-track">
          <span
            key={`hp-${current}`}
            data-changed=""
            className="motion-bar sheet-hp-fill"
            data-low={current <= max / 4 ? "" : undefined}
            style={{ width: width(current) }}
          />
          {temp ? <span className="sheet-hp-temp" style={{ left: width(current), width: width(temp) }} /> : null}
        </div>
      </div>
    </div>
  );
}

export function SkillRows({
  skills,
  proficient,
  explain,
}: {
  skills: Record<string, number>;
  proficient: string[];
  explain?: (skillId: string) => string;
}) {
  return (
    <div className="stagger-up grid grid-cols-1 gap-x-3 gap-y-0.5 min-[420px]:grid-cols-2">
      {SRD_SKILLS.map((skill) => {
        const on = proficient.includes(skill.id);
        return (
          <span key={skill.id} className={cn("sheet-skill", on && "sheet-skill-on")} title={explain?.(skill.id)}>
            <GameIcon icon={{ kind: "glyph", key: `skill-${skill.name}` }} size="size-5" />
            <span className="grow truncate">{skill.name}</span>
            <span className={cn("sheet-pip", on && "sheet-pip-on")} aria-hidden="true" />
            <span className="w-7 text-right font-mono">{formatModifier(skills[skill.id] ?? 0)}</span>
          </span>
        );
      })}
    </div>
  );
}

export function SpellChips({ spells, emptyText }: { spells: string[]; emptyText?: string }) {
  return (
    <InfoChipList
      items={[...new Set(spells)].map((spell) => ({
        name: spell,
        icon: { kind: "spell" as const, key: spell },
        reference: { kind: "spells", slug: contentSlug(spell), name: spell },
      }))}
      emptyText={emptyText}
    />
  );
}

// Every carried thing as an icon chip that opens its entry in the library,
// so a rope and a Flame Tongue both say what they are. Worn and attuned gear
// is marked on the chip.
export function EquipmentChips({
  equipment,
}: {
  equipment: Array<{ name: string; qty: number; equipped?: boolean; attuned?: boolean }>;
}) {
  return (
    <InfoChipList
      items={equipment.map((item) => ({
        name: item.qty > 1 ? `${item.name} x${item.qty}` : item.name,
        icon: { kind: "item" as const, key: item.name, family: "item-gear" },
        note: [item.equipped ? "worn" : null, item.attuned ? "attuned" : null].filter(Boolean).join(", ") || undefined,
        reference: { kind: "items", slug: contentSlug(item.name), name: item.name },
      }))}
    />
  );
}

export function FeatureChips({
  features,
  classId,
  subclass,
}: {
  features: Array<{ name: string; source?: string; level?: number }>;
  classId: string;
  subclass?: string | null;
}) {
  return (
    <InfoChipList
      items={features.map((feature) => ({
        name: feature.name,
        icon: { kind: "feature" as const, key: feature.name, family: `class-${classId.toLowerCase()}` },
        note: feature.source === "story" ? "(story)" : undefined,
        meta: feature.level ? `Level ${feature.level}` : undefined,
        text: describeFeature(classId, subclass ?? "", feature.name) ?? undefined,
      }))}
    />
  );
}

export function FeatChips({ feats, classId, subclass }: { feats: string[]; classId: string; subclass?: string | null }) {
  return (
    <InfoChipList
      items={feats.map((feat) => ({
        name: feat,
        icon: { kind: "feat" as const, key: feat },
        text: describeFeature(classId, subclass ?? "", feat) ?? undefined,
        reference: { kind: "feats", slug: contentSlug(feat), name: feat },
      }))}
    />
  );
}

export function ConditionChips({
  conditions,
  rounds,
}: {
  conditions: string[];
  rounds?: Record<string, { rounds?: number } | undefined>;
}) {
  return (
    <div className="stagger-pop flex flex-wrap gap-1.5">
      {conditions.map((condition) => (
        <span key={condition} className="sheet-condition motion-pop">
          <GameIcon icon={{ kind: "condition", key: condition }} size="size-5" />
          {condition}
          {rounds?.[condition]?.rounds ? ` (${rounds[condition]?.rounds} rd)` : ""}
        </span>
      ))}
    </div>
  );
}
