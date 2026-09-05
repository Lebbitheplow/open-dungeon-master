"use client";

import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoChipList } from "@/components/ui/InfoDialog";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { contentSlug, describeFeature } from "@/lib/help";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { abilityMod, formatModifier } from "@/lib/srd";
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
export function SheetSections({ sheet }: { sheet: CreateSheetInput }) {
  const abilities = sheet.abilities;
  return (
    <div className="space-y-4">
      <SheetPanel title="Abilities" className="ornate">
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {(Object.entries(abilities) as Array<[string, number]>).map(([ability, score]) => (
            <div
              key={ability}
              className="rounded-lg border border-stone-700/60 bg-stone-950/60 p-2 shadow-[0_2px_6px_rgba(4,2,12,0.45)_inset]"
            >
              <p className="eyebrow text-[10px] text-stone-500">{ability}</p>
              <p className="font-display text-xl text-amber-50">{score}</p>
              <p className="text-xs text-amber-200/80">{formatModifier(abilityMod(score))}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-stone-300 sm:grid-cols-4">
          <span>
            <GameTerm id="hit_points">HP</GameTerm> {sheet.maxHp}
          </span>
          <span>
            <GameTerm id="armor_class">AC</GameTerm> {sheet.ac}
          </span>
          <span>Speed {sheet.speed} ft</span>
          <span>Gold {sheet.gold}</span>
        </div>
      </SheetPanel>

      {sheet.spellcasting ? (
        <SheetPanel title="Spells">
          <InfoChipList
            items={[
              ...new Set([...sheet.spellcasting.known, ...sheet.spellcasting.prepared]),
            ].map((spell) => ({
              name: spell,
              reference: { kind: "spells", slug: contentSlug(spell), name: spell },
            }))}
            emptyText="None chosen."
          />
        </SheetPanel>
      ) : null}

      {sheet.equipment.length ? (
        <SheetPanel title="Equipment">
          <p className="text-sm text-stone-400">
            {sheet.equipment
              .map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name))
              .join(", ")}
          </p>
        </SheetPanel>
      ) : null}

      {sheet.features?.length ? (
        <SheetPanel title="Features and traits">
          <InfoChipList
            items={sheet.features.map((feature) => ({
              name: feature.name,
              note: feature.source === "story" ? "(story)" : undefined,
              meta: feature.level ? `Level ${feature.level}` : undefined,
              text: describeFeature(sheet.class, sheet.subclass, feature.name),
            }))}
          />
        </SheetPanel>
      ) : null}

      {sheet.feats.length ? (
        <SheetPanel title="Feats">
          <InfoChipList
            items={sheet.feats.map((feat) => ({
              name: feat,
              text: describeFeature(sheet.class, sheet.subclass, feat),
              reference: { kind: "feats", slug: contentSlug(feat), name: feat },
            }))}
          />
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
        <p className="rounded-lg border border-dashed border-stone-700/60 p-5 text-center text-sm text-stone-500">
          Nothing recorded yet. Milestones from campaigns land here: victories, treasures,
          bonds, and worse.
        </p>
      ) : (
        <ol className="relative ml-2 space-y-3 border-l border-amber-400/20 pl-5">
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
