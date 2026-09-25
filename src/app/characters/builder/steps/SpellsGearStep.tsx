"use client";

import { useState } from "react";
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
import { srdClass } from "../submit";
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
  const { spells, setSpells, cantrips, setCantrips } = state;
  const {
    spellAdvice,
    cantripAdvice,
    chosenCantrips,
    chosenSpells,
    maxSpellLevel,
    starters,
    subclassSpells,
    spellSearchClass,
  } = derived;
  // SRD classes hold to the 5e tables; setting classes keep their counts as
  // advice, the way the rest of the builder treats them.
  const enforce = srdClass(klass);
  const cantripCap = enforce ? cantripAdvice : null;
  const spellCap = enforce ? (spellAdvice?.count ?? null) : null;
  const cantripsLeft = Math.max(0, (cantripAdvice ?? 0) - chosenCantrips.length);
  const spellsLeft = Math.max(0, (spellAdvice?.count ?? 0) - chosenSpells.length);
  const [limitNote, setLimitNote] = useState("");

  const lower = (name: string) => name.toLowerCase();
  const isGranted = (name: string) => subclassSpells.some((spell) => lower(spell) === lower(name));
  const has = (list: string[], name: string) => list.some((entry) => lower(entry) === lower(name));

  const pick = (entry: PickerEntry) => {
    if (entry.level === 0) {
      if (has(cantrips, entry.name)) {
        return;
      }
      if (cantripCap !== null && cantrips.length >= cantripCap) {
        setLimitNote(
          `You already know ${cantripCap} ${cantripCap === 1 ? "cantrip" : "cantrips"}. Remove one to choose ${entry.name}.`,
        );
        return;
      }
      setLimitNote("");
      setCantrips((current) => [...current, entry.name]);
      return;
    }
    // Subclass spells are granted on top of the allowance; nothing to pick.
    if (isGranted(entry.name) || has(spells, entry.name)) {
      return;
    }
    if (spellCap !== null && chosenSpells.length >= spellCap) {
      setLimitNote(
        `You already have ${spellCap} ${spellAdvice?.label ?? "spells"}. Remove one to choose ${entry.name}.`,
      );
      return;
    }
    setLimitNote("");
    setSpells((current) => [...current, entry.name]);
  };
  const unpick = (spellName: string) => {
    setLimitNote("");
    setCantrips((current) => current.filter((entry) => lower(entry) !== lower(spellName)));
    setSpells((current) => current.filter((entry) => lower(entry) !== lower(spellName)));
  };

  // Fills whatever room is left, recommended cantrips and spells in order.
  const addAllRecommended = () => {
    if (!starters) {
      return;
    }
    const cantripRoom = cantripCap === null ? Infinity : cantripCap - cantrips.length;
    const newCantrips = starters.cantrips
      .map((entry) => entry.n)
      .filter((name) => !has(cantrips, name))
      .slice(0, Math.max(0, cantripRoom));
    const spellRoom = spellCap === null ? Infinity : spellCap - chosenSpells.length;
    const newSpells = starters.spells
      .map((entry) => entry.n)
      .filter((name) => !has(spells, name) && !isGranted(name))
      .slice(0, Math.max(0, spellRoom));
    setLimitNote("");
    setCantrips((current) => [...current, ...newCantrips]);
    setSpells((current) => [...current, ...newSpells]);
  };

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
  // Granted spells read as chosen, so nobody spends a pick on one.
  const selectedNames = [...cantrips, ...spells, ...subclassSpells];
  const levelledChips = spells.filter((spell) => !isGranted(spell));

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
      {/* Counts, so nobody leaves picks unspent without noticing. Cantrips
          and levelled spells are separate lists with separate limits. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {cantripAdvice ? (
          <span className={cn(cantripsLeft === 0 ? "text-stone-500" : "text-amber-300")}>
            Cantrips {chosenCantrips.length}/{cantripAdvice}
            {cantripsLeft > 0 ? ` (${cantripsLeft} still to choose)` : ""}
          </span>
        ) : null}
        {spellAdvice ? (
          <span className={cn(spellsLeft === 0 ? "text-stone-500" : "text-amber-300")}>
            {spellAdvice.label} {chosenSpells.length}/{spellAdvice.count}
            {spellsLeft > 0 ? ` (${spellsLeft} still to choose)` : ""}
          </span>
        ) : null}
        <span className="text-stone-500">
          Up to level {maxSpellLevel}.{klass.genres ? " Suggestions, not limits; homebrew varies." : ""}
        </span>
      </div>
      {limitNote ? (
        <p role="status" className="reveal mb-2 text-xs text-amber-300">
          {limitNote}
        </p>
      ) : null}
      {starters ? (
        <div className="mb-3 rounded-lg border border-stone-700/60 bg-stone-950/60 p-3">
          <p className="text-xs text-stone-400">{starters.why}</p>
          <p className="eyebrow mt-2 mb-1.5 text-[10px] text-amber-400/80">Good picks if you are new</p>
          {[
            { label: "Cantrips", entries: starters.cantrips, isCantrip: true },
            { label: "Spells", entries: starters.spells, isCantrip: false },
          ].map((group) =>
            group.entries.length ? (
              <div key={group.label} className="mb-1.5">
                <p className="mb-1 text-[10px] text-stone-500">{group.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.entries.map((entry) => {
                    const chosen = selectedNames.some((spell) => lower(spell) === lower(entry.n));
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
                                  level: group.isCantrip ? 0 : undefined,
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
              </div>
            ) : null,
          )}
          <button
            type="button"
            onClick={addAllRecommended}
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
        selectedNames={selectedNames}
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
      {/* The chip shows the world's name; the value in state stays the
          canonical one the sheet and the rules engine need. The ⓘ reads the
          canonical name, which is what the pack rows are filed under. */}
      {[
        { label: "Cantrips", names: cantrips, removable: true },
        { label: spellAdvice?.label ?? "Spells", names: levelledChips, removable: true },
        { label: "Granted by your subclass (free)", names: subclassSpells, removable: false },
      ].map((group) =>
        group.names.length ? (
          <div key={group.label} className="mt-2">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-stone-500">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.names.map((spell) => (
                <Chip
                  key={spell}
                  label={displayName(pack, "spells", spell)}
                  info={{ reference: { kind: "spells", slug: contentSlug(spell), name: spell } }}
                  {...(group.removable ? { onRemove: () => unpick(spell) } : {})}
                />
              ))}
            </div>
          </div>
        ) : null,
      )}
    </StepPanel>
  );
}
