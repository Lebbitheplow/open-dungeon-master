"use client";

import { useEffect } from "react";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { contentSlug } from "@/lib/help";
import { displayName } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import CatalogBrowser from "../CatalogBrowser";
import ContentPicker from "../ContentPicker";
import EquipmentSection from "../EquipmentSection";
import type { ClassOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import type { PickerEntry } from "../useContentSearch";
import { Chip, StepPanel, inputClass } from "./shared";

// Step 5: spells for a caster who has something to cast at this level (the
// section is absent for everyone else, a level 1 paladin included) and the
// equipment block: auto loadout, suggestions, catalog search, gold.
export function SpellsGearStep({
  state,
  derived,
  actions,
  klass,
  pack,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  actions: BuilderActions;
  klass: ClassOption | undefined;
  pack: WorldPack | null;
}) {
  return (
    <div className="space-y-4">
      {klass && derived.casts ? (
        <SpellsSection state={state} derived={derived} klass={klass} pack={pack} />
      ) : null}
      <EquipmentSection
        equipment={derived.fullEquipment}
        suggestions={derived.equipmentSuggestions}
        onAdd={actions.addEquipmentItem}
        onAddMany={actions.addEquipmentItems}
        onRemove={actions.removeEquipmentItem}
        gold={state.gold}
        setGold={state.setGold}
        inputClass={inputClass}
      />
    </div>
  );
}

function SpellsSection({
  state,
  derived,
  klass,
  pack,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  klass: ClassOption;
  pack: WorldPack | null;
}) {
  const { spells, setSpells, setCantripNames } = state;
  const {
    spellAdvice,
    cantripAdvice,
    chosenCantrips,
    maxSpellLevel,
    starters,
    subclassSpells,
    spellSearchClass,
  } = derived;
  const levelled = Math.max(0, spells.length - chosenCantrips.length);
  const cantripsLeft = Math.max(0, (cantripAdvice ?? 0) - chosenCantrips.length);
  const spellsLeft = Math.max(0, (spellAdvice?.count ?? 0) - levelled);

  // Which names are cantrips is only known from the pack. Load the class's
  // cantrip list once so picks from the recommended tier, and the spells of a
  // sheet that arrived for editing, are counted as cantrips rather than as
  // levelled spells (which read as "Cantrips 0/3, spells 8/4").
  useEffect(() => {
    if (!spellSearchClass) {
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ class: spellSearchClass, level: "0", limit: "200" });
    fetch(`/api/content/spells?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { results?: PickerEntry[] } | null) => {
        const names = (data?.results ?? [])
          .filter((entry) => entry.level === 0)
          .map((entry) => entry.name);
        if (names.length) {
          setCantripNames((current) => [...new Set([...current, ...names])]);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [spellSearchClass, setCantripNames]);

  const pick = (entry: PickerEntry) => {
    if (entry.level === 0) {
      setCantripNames((current) =>
        current.includes(entry.name) ? current : [...current, entry.name],
      );
    }
    setSpells((current) => (current.includes(entry.name) ? current : [...current, entry.name]));
  };
  const unpick = (spellName: string) =>
    setSpells((current) =>
      current.filter((entry) => entry.toLowerCase() !== spellName.toLowerCase()),
    );

  // The recommended tier: the class's starter picks, then whatever the
  // subclass grants for free (domain, circle, oath, patron spells).
  const recommendedEntries = [
    ...(starters?.cantrips.map((entry) => ({ name: entry.n, note: "cantrip", level: 0 })) ?? []),
    ...(starters?.spells.map((entry) => ({ name: entry.n })) ?? []),
    ...subclassSpells
      .filter(
        (spellName) =>
          !starters?.spells.some((entry) => entry.n.toLowerCase() === spellName.toLowerCase()),
      )
      .map((spellName) => ({ name: spellName, note: "always prepared, free" })),
  ];

  return (
    <StepPanel
      title="Spells"
      ornate
      help={
        <>
          A <GameTerm id="cantrip">cantrip</GameTerm> is a small spell you can cast as often as
          you like. The rest use your spell slots. The whole list is below with the recommended
          picks first; tap ⓘ on any row to read what it does before choosing.
        </>
      }
    >
      {/* Counts, so nobody leaves picks unspent without noticing. The picker
          knows each spell's level, so chosen cantrips are counted separately
          from levelled spells. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {cantripAdvice ? (
          <span className={cn(cantripsLeft === 0 ? "text-stone-500" : "text-amber-300")}>
            Cantrips {chosenCantrips.length}/{cantripAdvice}
            {cantripsLeft > 0 ? ` (${cantripsLeft} still to choose)` : ""}
          </span>
        ) : null}
        {spellAdvice ? (
          <span className={cn(spellsLeft === 0 ? "text-stone-500" : "text-amber-300")}>
            {spellAdvice.label} {levelled}/{spellAdvice.count}
            {spellsLeft > 0 ? ` (${spellsLeft} still to choose)` : ""}
          </span>
        ) : null}
        <span className="text-stone-500">
          Up to level {maxSpellLevel}.{klass.genres ? " Suggestions, not limits; homebrew varies." : ""}
        </span>
      </div>
      {starters ? (
        <div className="mb-3 rounded-lg border border-stone-700/60 bg-stone-950/60 p-3">
          <p className="text-xs text-stone-400">{starters.why}</p>
          <p className="eyebrow mt-2 mb-1.5 text-[10px] text-amber-400/80">Good picks if you are new</p>
          <div className="flex flex-wrap gap-1.5">
            {[...starters.cantrips, ...starters.spells].map((entry) => {
              const chosen = spells.some((spell) => spell.toLowerCase() === entry.n.toLowerCase());
              const isCantrip = starters.cantrips.some((cantrip) => cantrip.n === entry.n);
              return (
                <span key={entry.n} className="flex items-center">
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() =>
                      chosen
                        ? unpick(entry.n)
                        : pick({
                            slug: contentSlug(entry.n),
                            name: entry.n,
                            source: "open5e",
                            data: {},
                            level: isCantrip ? 0 : undefined,
                          })
                    }
                    className={cn(
                      "rounded-l-full border py-0.5 pl-2.5 pr-1.5 text-xs transition-colors",
                      chosen
                        ? "border-amber-500/60 bg-amber-400/10 text-amber-100"
                        : "border-stone-600/60 text-stone-300 hover:border-amber-500/40",
                    )}
                  >
                    {chosen ? "✓ " : "+ "}
                    {entry.n}
                  </button>
                  <span
                    className={cn(
                      "rounded-r-full border border-l-0 py-0.5 pl-1 pr-2",
                      chosen ? "border-amber-500/60 bg-amber-400/10" : "border-stone-600/60",
                    )}
                  >
                    <InfoButton label={entry.n} text={entry.d} />
                  </span>
                </span>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              setCantripNames((current) => [
                ...new Set([...current, ...starters.cantrips.map((entry) => entry.n)]),
              ]);
              setSpells((current) => [
                ...current,
                ...[...starters.cantrips, ...starters.spells]
                  .map((entry) => entry.n)
                  .filter(
                    (spellName) =>
                      !current.some((entry) => entry.toLowerCase() === spellName.toLowerCase()),
                  ),
              ]);
            }}
            className="mt-2 text-xs text-amber-300 underline-offset-2 hover:underline"
          >
            Add all recommended
          </button>
        </div>
      ) : null}
      {/* The whole list, open from the start: every spell this class may
          take, the recommended ones first, cantrips before levelled spells,
          each readable before it is chosen. A player who has never read a
          spell list cannot search for a spell they have never heard of. */}
      <CatalogBrowser
        kind="spells"
        buttonLabel={`Every ${klass.name.toLowerCase()} spell you can take`}
        defaultOpen
        openSections={[`spells:${spellSearchClass}:${maxSpellLevel}`]}
        selectedNames={spells}
        onPick={pick}
        onUnpick={unpick}
        recommended={
          recommendedEntries.length
            ? { label: `Recommended for a ${klass.name.toLowerCase()}`, entries: recommendedEntries }
            : undefined
        }
        sections={[
          {
            key: `spells:${spellSearchClass}:${maxSpellLevel}`,
            label: `Every spell up to level ${maxSpellLevel}`,
            params: { class: spellSearchClass, level: String(maxSpellLevel) },
          },
        ]}
        bucketOf={(entry) =>
          entry.level === 0
            ? { key: "cantrips", label: "Cantrips", order: 0 }
            : {
                key: `level-${entry.level}`,
                label: `Level ${entry.level}`,
                order: entry.level ?? 99,
              }
        }
        metaOf={(entry) => entry.school ?? ""}
      />
      <p className="mt-3 mb-1 text-xs text-stone-500">Or search by name:</p>
      <ContentPicker
        kind="spells"
        extraParams={{ class: spellSearchClass, level: String(maxSpellLevel) }}
        placeholder="Search spells (e.g. cure wounds)"
        onPick={pick}
        renderMeta={(entry) => (entry.level === 0 ? "cantrip" : `level ${entry.level}`)}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {/* The chip shows the world's name; the value in state stays the
            canonical one the sheet and the rules engine need. The ⓘ reads the
            canonical name, which is what the pack rows are filed under. */}
        {spells.map((spell) => (
          <Chip
            key={spell}
            label={displayName(pack, "spells", spell)}
            info={{ reference: { kind: "spells", slug: contentSlug(spell), name: spell } }}
            onRemove={() => unpick(spell)}
          />
        ))}
      </div>
    </StepPanel>
  );
}
