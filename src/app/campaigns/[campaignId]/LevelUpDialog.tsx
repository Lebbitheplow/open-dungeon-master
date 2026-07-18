"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Dices, Loader2, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { abilityMod, findClass, spellSlotsFor } from "@/lib/srd";
import { applyAsiChoices, crossedAsiLevels } from "@/lib/srd/asi";
import AsiFeatEditor from "@/app/characters/builder/AsiFeatEditor";
import type { AsiChoice, CharacterSheet } from "@/lib/schemas/sheet";

// Guided level-up: pick average or rolled HP, then resolve any Ability
// Score Improvements the new level crosses (4/8/12/16/19). Everything is
// saved through a single sheet PATCH.
export function LevelUpDialog({
  campaignId,
  sheet,
  targetLevel,
  onDone,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  targetLevel: number;
  onDone: () => void;
}) {
  const [rolledHp, setRolledHp] = useState<number | null>(null);
  const [hpGain, setHpGain] = useState<number | null>(null);
  const [asiChoices, setAsiChoices] = useState<Array<AsiChoice | null>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const klass = findClass(sheet.class);
  const hitDie = klass?.hitDie ?? Number(sheet.hitDice.die.replace("d", "")) ?? 8;
  const conMod = abilityMod(sheet.abilities.con);
  const levelsGained = Math.max(1, targetLevel - sheet.level);
  const averageGain = Math.max(1, (Math.floor(hitDie / 2) + 1 + conMod) * levelsGained);
  const rolledGain =
    rolledHp !== null ? Math.max(1, rolledHp + conMod * levelsGained) : null;

  const asiLevels = useMemo(
    () => crossedAsiLevels(sheet.level, targetLevel),
    [sheet.level, targetLevel],
  );
  const asiResolved = asiLevels.every((_, index) => asiChoices[index]);

  function rollHp() {
    let total = 0;
    for (let i = 0; i < levelsGained; i += 1) {
      total += 1 + Math.floor(Math.random() * hitDie);
    }
    setRolledHp(total);
  }

  // With ASIs to resolve, an HP pick advances to step two; otherwise it
  // applies immediately, as before.
  function pickHp(gain: number) {
    if (asiLevels.length) {
      setHpGain(gain);
    } else {
      apply(gain, []);
    }
  }

  async function apply(gain: number, choices: AsiChoice[]) {
    setBusy(true);
    setError("");
    try {
      const slots = spellSlotsFor(sheet.class, targetLevel);
      const newFeats = choices.flatMap((choice) =>
        choice.mode === "feat" ? [choice.feat] : [],
      );
      const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: targetLevel,
          maxHp: sheet.maxHp + gain,
          currentHp: Math.min(sheet.currentHp + gain, sheet.maxHp + gain),
          hitDice: { ...sheet.hitDice, total: targetLevel },
          ...(choices.length
            ? { abilities: applyAsiChoices(sheet.abilities, choices) }
            : {}),
          ...(newFeats.length
            ? { feats: [...new Set([...sheet.feats, ...newFeats])] }
            : {}),
          ...(sheet.spellcasting && Object.keys(slots).length
            ? {
                spellcasting: {
                  ...sheet.spellcasting,
                  slots: Object.fromEntries(
                    Object.entries(slots).map(([slotLevel, max]) => [
                      slotLevel,
                      {
                        max,
                        used: Math.min(
                          sheet.spellcasting?.slots[slotLevel]?.used ?? 0,
                          max,
                        ),
                      },
                    ]),
                  ),
                },
              }
            : {}),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not level up.");
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const onAsiStep = hpGain !== null;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 panel ornate rounded-xl border-amber-500/40 p-6",
            onAsiStep
              ? "max-h-[85vh] w-[min(92vw,32rem)] overflow-y-auto"
              : "w-[min(92vw,24rem)]",
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-100">
              <Sparkles className="size-5 text-amber-200" />
              Level {targetLevel}!
            </Dialog.Title>
            <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {!onAsiStep ? (
            <>
              <p className="mb-4 text-sm text-stone-300">
                {sheet.name} advances to level {targetLevel}. Choose how to gain hit points
                ({levelsGained} d{hitDie}
                {conMod ? ` ${conMod > 0 ? "+" : ""}${conMod} CON each` : ""}):
              </p>

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pickHp(averageGain)}
                  className="flex w-full items-center justify-between rounded-md border border-stone-700 px-4 py-2.5 text-sm hover:border-amber-700 hover:bg-stone-900 disabled:opacity-50"
                >
                  <span>Take the average</span>
                  <span className="font-mono text-amber-400">+{averageGain} HP</span>
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={rollHp}
                    className="flex flex-1 items-center justify-center gap-2 rounded-md border border-stone-700 px-4 py-2.5 text-sm hover:border-amber-700 hover:bg-stone-900 disabled:opacity-50"
                  >
                    <Dices className="size-4" />
                    {rolledHp === null ? `Roll ${levelsGained}d${hitDie}` : `Rolled ${rolledHp}`}
                  </button>
                  {rolledGain !== null ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => pickHp(rolledGain)}
                      className={cn(
                        "rounded-lg bg-amber-200 px-4 py-2.5 text-sm font-medium text-stone-950",
                        "hover:bg-amber-100 disabled:opacity-50",
                      )}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : `Take +${rolledGain} HP`}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-stone-300">
                +{hpGain} HP locked in. This level also grants
                {asiLevels.length === 1 ? " an ability score improvement" : " ability score improvements"}:
              </p>
              <AsiFeatEditor
                slotLevels={asiLevels}
                baseScores={sheet.abilities}
                choices={asiLevels.map((_, index) => asiChoices[index] ?? null)}
                onChange={setAsiChoices}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setHpGain(null)}
                  className="rounded-md border border-stone-700 px-4 py-2.5 text-sm text-stone-300 hover:bg-stone-900 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy || !asiResolved}
                  onClick={() =>
                    apply(
                      hpGain,
                      asiChoices.filter((choice): choice is AsiChoice => choice !== null),
                    )
                  }
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-200 px-4 py-2.5 text-sm font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Confirm level up"}
                </button>
              </div>
            </div>
          )}
          {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
