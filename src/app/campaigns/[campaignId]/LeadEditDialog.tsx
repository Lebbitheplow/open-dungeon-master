"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Wrench, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Party lead correction of any character's core numbers, for when the AI
// DM gets something wrong. Server clamps values and writes an audit entry.
export function LeadEditDialog({
  campaignId,
  sheet,
  onClose,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  onClose: () => void;
}) {
  const [currentHp, setCurrentHp] = useState(String(sheet.currentHp));
  const [tempHp, setTempHp] = useState(String(sheet.tempHp));
  const [maxHp, setMaxHp] = useState(String(sheet.maxHp));
  const [ac, setAc] = useState(String(sheet.ac));
  const [gold, setGold] = useState(String(sheet.gold));
  const [xp, setXp] = useState(String(sheet.xp));
  const [conditions, setConditions] = useState(sheet.conditions.join(", "));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const patch: Record<string, unknown> = { reason };
    const numbers: Array<[string, string, number]> = [
      ["currentHp", currentHp, sheet.currentHp],
      ["tempHp", tempHp, sheet.tempHp],
      ["maxHp", maxHp, sheet.maxHp],
      ["ac", ac, sheet.ac],
      ["gold", gold, sheet.gold],
      ["xp", xp, sheet.xp],
    ];
    for (const [key, raw, previous] of numbers) {
      const value = Number(raw);
      if (Number.isFinite(value) && value !== previous) {
        patch[key] = value;
      }
    }
    const nextConditions = conditions
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (nextConditions.join("|") !== sheet.conditions.join("|")) {
      patch.conditions = nextConditions;
    }
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheets/${sheet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not save the correction.");
        return;
      }
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm outline-none focus:border-amber-600";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(ui.dialog, "fixed left-1/2 top-1/2 z-50 w-[22rem] -translate-x-1/2 -translate-y-1/2")}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-serif text-lg text-stone-100">
              <Wrench className="size-4 text-amber-300" /> Adjust {sheet.name}
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-stone-500">
            Party lead correction. Changes are logged to the session event log.
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {(
              [
                ["HP", currentHp, setCurrentHp],
                ["Temp HP", tempHp, setTempHp],
                ["Max HP", maxHp, setMaxHp],
                ["AC", ac, setAc],
                ["Gold", gold, setGold],
                ["XP", xp, setXp],
              ] as Array<[string, string, (value: string) => void]>
            ).map(([label, value, setter]) => (
              <label key={label} className="space-y-1">
                <span className="text-stone-500">{label}</span>
                <input
                  type="number"
                  value={value}
                  onChange={(event) => setter(event.target.value)}
                  className={field}
                />
              </label>
            ))}
          </div>
          <label className="mt-2 block space-y-1 text-xs">
            <span className="text-stone-500">Conditions (comma separated)</span>
            <input
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              placeholder="poisoned, prone"
              className={field}
            />
          </label>
          <label className="mt-2 block space-y-1 text-xs">
            <span className="text-stone-500">Reason (shown in the log)</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="DM double-counted the goblin's hit"
              className={field}
            />
          </label>
          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={ui.btnSmall}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
