"use client";

import { EmptyState } from "@/components/EmptyState";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import {
  AbilityTiles,
  EquipmentChips,
  FeatChips,
  FeatureChips,
  SkillRows,
  VitalTiles,
} from "@/components/sheet/SheetParts";
import { SheetSpells } from "@/components/sheet/SheetSpells";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { computeSheetDerived, formatModifier, type DerivedPart } from "@/lib/srd";
import { ui } from "@/lib/ui";

export type CharacterEvent = {
  id: string;
  campaignId: string;
  kind: string;
  summary: string;
  createdAt: string;
};

const KIND_LABELS: Record<string, string> = {
  achievement: "Achievement",
  item: "Treasure",
  relationship: "Bond",
  death: "Death",
  level_up: "Level up",
  story: "Story",
};

// A titled block of the read-only sheet: Ribbon rule, then whatever the
// section shows. Same shape as the builder's StepPanel so the detail page
// reads like the wizard that made it.
function SheetPanel({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(ui.card, "p-4", className)}>
      <Ribbon className="mb-3">{title}</Ribbon>
      {children}
    </section>
  );
}

// The six scores, the vitals line, and the lists a library sheet carries:
// spells, equipment, features, feats, backstory. Read-only; editing happens
// through the builder in a campaign lobby.
export function SheetSections({ sheet, level = 1 }: { sheet: CreateSheetInput; level?: number }) {
  // The same working the session sheet shows, from the same function, so a
  // library character reads its saves and skills before it ever sits down.
  const derived = computeSheetDerived({
    abilities: sheet.abilities,
    level,
    proficiencies: sheet.proficiencies,
    spellcasting: sheet.spellcasting ?? null,
    class: sheet.class,
    features: sheet.features,
    feats: sheet.feats,
    equipment: sheet.equipment,
  });
  const explain = (parts: DerivedPart[]) => parts.map((part) => `${formatModifier(part.value)} ${part.label}`).join(", ");
  return (
    <div className="space-y-4">
      <SheetPanel title="Abilities" className="ornate">
        <AbilityTiles
          abilities={sheet.abilities}
          mods={derived.abilityMods}
          saves={derived.saves}
          saveProficiencies={sheet.proficiencies.saves}
          explainSave={(ability) => explain(derived.parts.saves[ability])}
        />
        <div className="mt-3">
          <VitalTiles
            vitals={[
              { glyph: "rest-hp", label: <GameTerm id="hit_points">Hit points</GameTerm>, value: sheet.maxHp },
              { glyph: "rest-ac", label: <GameTerm id="armor_class">Armor class</GameTerm>, value: sheet.ac },
              { glyph: "rest-speed", label: "Speed", value: `${sheet.speed} ft` },
              { glyph: "coin-gp", label: "Gold", value: `${sheet.gold} gp` },
              {
                glyph: "rest-initiative",
                label: <GameTerm id="initiative">Initiative</GameTerm>,
                value: formatModifier(derived.initiative),
                title: explain(derived.parts.initiative),
              },
              {
                glyph: "sense-passive-perception",
                label: <GameTerm id="passive_perception">Passive perception</GameTerm>,
                value: derived.passivePerception,
                title: explain(derived.parts.passivePerception),
              },
              { glyph: "rest-proficiency", label: "Proficiency", value: formatModifier(derived.proficiencyBonus) },
              ...(derived.spellSaveDc
                ? [{ glyph: "rest-spell-slot", label: "Spell save DC", value: derived.spellSaveDc, title: explain(derived.parts.spellSaveDc) }]
                : []),
            ]}
          />
        </div>
      </SheetPanel>

      <SheetPanel title={<GameTerm id="skill">Skills</GameTerm>}>
        <SkillRows
          skills={derived.skills}
          proficient={sheet.proficiencies.skills}
          explain={(skillId) => explain(derived.parts.skills[skillId])}
        />
      </SheetPanel>

      {sheet.spellcasting ? (
        <SheetPanel title="Spells">
          <SheetSpells sheet={{ ...sheet, level }} />
        </SheetPanel>
      ) : null}

      {sheet.equipment.length ? (
        <SheetPanel title="Equipment">
          <EquipmentChips equipment={sheet.equipment} />
        </SheetPanel>
      ) : null}

      {sheet.features?.length ? (
        <SheetPanel title="Features and traits">
          <FeatureChips features={sheet.features} classId={sheet.class} subclass={sheet.subclass} />
        </SheetPanel>
      ) : null}

      {sheet.feats.length ? (
        <SheetPanel title="Feats">
          <FeatChips feats={sheet.feats} classId={sheet.class} subclass={sheet.subclass} />
        </SheetPanel>
      ) : null}

      {sheet.backstory ? (
        <SheetPanel title="Backstory">
          <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-300">
            {sheet.backstory}
          </p>
        </SheetPanel>
      ) : null}
    </div>
  );
}

// Milestones the campaigns recorded for this character, newest first as the
// API returns them, drawn as a timeline down a gold hairline.
export function StorySoFar({ events }: { events: CharacterEvent[] }) {
  return (
    <SheetPanel
      title={
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="size-3" aria-hidden="true" /> Story so far
        </span>
      }
    >
      {events.length === 0 ? (
        <EmptyState size="md" art="scrolls" title="Nothing recorded yet. Milestones from campaigns land here: victories, treasures, bonds, and worse." />
      ) : (
        <ol className="stagger relative ml-2 space-y-3 border-l border-amber-400/20 pl-5">
          {events.map((event) => (
            <li key={event.id} className="relative text-sm">
              <span
                className="absolute -left-[1.45rem] top-1.5 size-2.5 rounded-full border border-amber-300/60 bg-stone-950 shadow-glow-gold"
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="eyebrow rounded-sm border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] leading-none text-amber-300">
                  {KIND_LABELS[event.kind] ?? event.kind}
                </span>
                <span className="text-xs text-stone-500">
                  {new Date(event.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-stone-200">{event.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </SheetPanel>
  );
}
