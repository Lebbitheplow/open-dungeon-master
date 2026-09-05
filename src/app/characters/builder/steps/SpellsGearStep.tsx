"use client";

import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import ContentPicker from "../ContentPicker";
import EquipmentSection from "../EquipmentSection";
import type { ClassOption } from "../useBuilderOptions";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { Chip, StepPanel, inputClass } from "./shared";

// Step 5: spells for a caster (the section is absent for everyone else) and
// the equipment block: auto loadout, suggestions, catalog search, gold.
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
      {klass?.spellAbility ? (
        <SpellsSection state={state} derived={derived} pack={pack} />
      ) : null}
      <EquipmentSection
        equipment={derived.fullEquipment}
        suggestions={derived.equipmentSuggestions}
        onAdd={actions.addEquipmentItem}
        onAddMany={actions.addEquipmentItems}
        onRemove={actions.removeEquipmentItem}
        gold={state.gold}
        setGold={state.setGold}
        chip={(label, onRemove, homebrew) => (
          <Chip key={label} label={label} onRemove={onRemove} homebrew={homebrew} />
        )}
        inputClass={inputClass}
      />
    </div>
  );
}

function SpellsSection({
  state,
  derived,
  pack,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  pack: WorldPack | null;
}) {
  const { spells, setSpells, setCantripNames } = state;
  const { spellAdvice, cantripAdvice, chosenCantrips, maxSpellLevel, starters, spellSearchClass } =
    derived;
  const levelled = Math.max(0, spells.length - chosenCantrips.length);
  return (
    <StepPanel title="Spells" ornate>
      {/* Counts, so nobody leaves picks unspent without noticing. The picker
          knows each spell's level, so chosen cantrips are counted separately
          from levelled spells. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {cantripAdvice ? (
          <span className={cn(chosenCantrips.length >= cantripAdvice ? "text-stone-500" : "text-amber-300")}>
            <GameTerm id="cantrip">Cantrips</GameTerm> {chosenCantrips.length}/{cantripAdvice}
          </span>
        ) : null}
        {spellAdvice ? (
          <span className={cn(levelled >= spellAdvice.count ? "text-stone-500" : "text-amber-300")}>
            {spellAdvice.label} {levelled}/{spellAdvice.count}
          </span>
        ) : null}
        <span className="text-stone-500">
          Up to level {maxSpellLevel}. Suggestions, not limits; homebrew varies.
        </span>
      </div>
      {starters ? (
        <div className="mb-3 rounded-lg border border-stone-700/60 bg-stone-950/60 p-3">
          <p className="text-xs text-stone-400">{starters.why}</p>
          <p className="eyebrow mt-2 mb-1.5 text-[10px] text-amber-400/80">Good picks if you are new</p>
          <div className="flex flex-wrap gap-1.5">
            {[...starters.cantrips, ...starters.spells].map((pick) => {
              const chosen = spells.some((entry) => entry.toLowerCase() === pick.n.toLowerCase());
              return (
                <span key={pick.n} className="flex items-center">
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() =>
                      setSpells((current) =>
                        chosen
                          ? current.filter((entry) => entry.toLowerCase() !== pick.n.toLowerCase())
                          : [...current, pick.n],
                      )
                    }
                    className={cn(
                      "rounded-l-full border py-0.5 pl-2.5 pr-1.5 text-xs transition-colors",
                      chosen
                        ? "border-amber-500/60 bg-amber-400/10 text-amber-100"
                        : "border-stone-600/60 text-stone-300 hover:border-amber-500/40",
                    )}
                  >
                    {chosen ? "✓ " : "+ "}
                    {pick.n}
                  </button>
                  <span
                    className={cn(
                      "rounded-r-full border border-l-0 py-0.5 pl-1 pr-2",
                      chosen ? "border-amber-500/60 bg-amber-400/10" : "border-stone-600/60",
                    )}
                  >
                    <InfoButton label={pick.n} text={pick.d} />
                  </span>
                </span>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() =>
              setSpells((current) => [
                ...current,
                ...[...starters.cantrips, ...starters.spells]
                  .map((pick) => pick.n)
                  .filter(
                    (spellName) =>
                      !current.some((entry) => entry.toLowerCase() === spellName.toLowerCase()),
                  ),
              ])
            }
            className="mt-2 text-xs text-amber-300 underline-offset-2 hover:underline"
          >
            Add all recommended
          </button>
        </div>
      ) : null}
      <ContentPicker
        kind="spells"
        extraParams={{ class: spellSearchClass, level: String(maxSpellLevel) }}
        placeholder="Search spells (e.g. cure wounds)"
        onPick={(entry) => {
          if (entry.level === 0) {
            setCantripNames((current) =>
              current.includes(entry.name) ? current : [...current, entry.name],
            );
          }
          setSpells((current) => (current.includes(entry.name) ? current : [...current, entry.name]));
        }}
        renderMeta={(entry) => (entry.level === 0 ? "cantrip" : `level ${entry.level}`)}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {/* The chip shows the world's name; the value in state stays the
            canonical one the sheet and the rules engine need. */}
        {spells.map((spell) => (
          <Chip
            key={spell}
            label={displayName(pack, "spells", spell)}
            onRemove={() => setSpells((current) => current.filter((entry) => entry !== spell))}
          />
        ))}
      </div>
    </StepPanel>
  );
}
