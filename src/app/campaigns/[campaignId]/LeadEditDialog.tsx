"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Trash2, Wrench, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { spellClassFor } from "@/lib/classes";
import MultiContentPicker from "@/app/characters/builder/MultiContentPicker";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

type ItemRow = { name: string; qty: string; slug?: string };

// Removable name chips backing the spell and feat lists; adding goes
// through the searchable multi-select pickers below each list.
function ChipList({ values, onRemove }: { values: string[]; onRemove: (value: string) => void }) {
  if (!values.length) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="flex items-center gap-1 rounded-full bg-stone-800 px-2 py-0.5 text-xs text-stone-200"
        >
          {value}
          <button
            type="button"
            onClick={() => onRemove(value)}
            aria-label={`Remove ${value}`}
            className="text-stone-500 hover:text-red-400"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

// Party lead correction of any character's numbers, items, and spells, for
// when the AI DM gets something wrong. Server clamps values and writes an
// audit entry.
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
  const [items, setItems] = useState<ItemRow[]>(
    sheet.equipment.map((item) => ({ name: item.name, qty: String(item.qty), slug: item.slug })),
  );
  const [prepared, setPrepared] = useState<string[]>(sheet.spellcasting?.prepared ?? []);
  const [known, setKnown] = useState<string[]>(sheet.spellcasting?.known ?? []);
  const [slots, setSlots] = useState<Record<string, { max: string; used: string }>>(() =>
    Object.fromEntries(
      Object.entries(sheet.spellcasting?.slots ?? {}).map(([level, slot]) => [
        level,
        { max: String(slot.max), used: String(slot.used) },
      ]),
    ),
  );
  const [feats, setFeats] = useState<string[]>(sheet.feats);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function setItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function splitList(raw: string): string[] {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function save() {
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
    const nextConditions = splitList(conditions);
    if (nextConditions.join("|") !== sheet.conditions.join("|")) {
      patch.conditions = nextConditions;
    }
    const nextEquipment: EquipmentItem[] = items
      .map((row) => ({
        name: row.name.trim(),
        qty: Math.min(999, Math.max(1, Math.round(Number(row.qty)) || 1)),
        ...(row.slug ? { slug: row.slug } : {}),
      }))
      .filter((item) => item.name);
    if (JSON.stringify(nextEquipment) !== JSON.stringify(sheet.equipment)) {
      patch.equipment = nextEquipment;
    }
    if (sheet.spellcasting) {
      const nextSpellcasting = {
        ability: sheet.spellcasting.ability,
        slots: Object.fromEntries(
          Object.entries(sheet.spellcasting.slots).map(([level, slot]) => {
            const edited = slots[level];
            const max = Math.max(0, Math.round(Number(edited?.max)) || slot.max);
            const used = Math.min(max, Math.max(0, Math.round(Number(edited?.used ?? "0")) || 0));
            return [level, { max, used }];
          }),
        ),
        prepared,
        known,
      };
      if (JSON.stringify(nextSpellcasting) !== JSON.stringify(sheet.spellcasting)) {
        patch.spellcasting = nextSpellcasting;
      }
    }
    if (feats.join("|") !== sheet.feats.join("|")) {
      patch.feats = feats;
    }
    void (async () => {
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
    })();
  }

  const field =
    "w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm outline-none focus:border-amber-600";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-50">
              <Wrench className="size-4 text-amber-300" /> Adjust {sheet.name}
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-stone-500">
            Party lead correction of stats, items, and spells. Changes are logged to the session
            event log.
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

          <div className="mt-3 space-y-1 text-xs">
            <span className="text-stone-500">Items</span>
            {items.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                {row.slug ? (
                  <span className={cn(field, "truncate")}>{row.name}</span>
                ) : (
                  <input
                    value={row.name}
                    onChange={(event) => setItem(index, { name: event.target.value })}
                    placeholder="Item name"
                    className={field}
                  />
                )}
                <input
                  type="number"
                  min={1}
                  value={row.qty}
                  onChange={(event) => setItem(index, { qty: event.target.value })}
                  className={cn(field, "w-16 shrink-0")}
                />
                <button
                  type="button"
                  onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}
                  className="shrink-0 text-stone-500 hover:text-red-400"
                  aria-label="Remove item"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <div className="mt-1">
              <MultiContentPicker
                kind="items"
                placeholder="Search items to add"
                selectedNames={items.map((row) => row.name)}
                onAdd={(entries) =>
                  setItems((rows) => [
                    ...rows,
                    ...entries.map((entry) => ({
                      name: entry.name,
                      qty: "1",
                      ...(entry.slug ? { slug: entry.slug } : {}),
                    })),
                  ])
                }
                renderMeta={(entry) =>
                  [entry.kind, entry.rarity ?? entry.cost].filter(Boolean).join(" · ")
                }
              />
            </div>
          </div>

          {sheet.spellcasting ? (
            <div className="mt-3 space-y-2 text-xs">
              <span className="text-stone-500">Spells</span>
              <div className="space-y-1">
                <span className="text-stone-600">Known</span>
                <ChipList
                  values={known}
                  onRemove={(value) => setKnown((list) => list.filter((entry) => entry !== value))}
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{ class: spellClassFor(sheet.class) }}
                  placeholder="Search spells to add as known"
                  selectedNames={known}
                  onAdd={(entries) =>
                    setKnown((list) => [...list, ...entries.map((entry) => entry.name)])
                  }
                  renderMeta={(entry) =>
                    entry.level !== undefined
                      ? entry.level === 0
                        ? "cantrip"
                        : `level ${entry.level}`
                      : ""
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="text-stone-600">Prepared</span>
                <ChipList
                  values={prepared}
                  onRemove={(value) =>
                    setPrepared((list) => list.filter((entry) => entry !== value))
                  }
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{ class: spellClassFor(sheet.class) }}
                  placeholder="Search spells to add as prepared"
                  selectedNames={prepared}
                  onAdd={(entries) =>
                    setPrepared((list) => [...list, ...entries.map((entry) => entry.name)])
                  }
                  renderMeta={(entry) =>
                    entry.level !== undefined
                      ? entry.level === 0
                        ? "cantrip"
                        : `level ${entry.level}`
                      : ""
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(sheet.spellcasting.slots).map(([level]) => (
                  <label key={level} className="space-y-1">
                    <span className="text-stone-600">L{level} used/max</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={slots[level]?.used ?? "0"}
                        onChange={(event) =>
                          setSlots((prev) => ({
                            ...prev,
                            [level]: { max: prev[level]?.max ?? "0", used: event.target.value },
                          }))
                        }
                        className={cn(field, "w-14")}
                      />
                      <span className="text-stone-600">/</span>
                      <input
                        type="number"
                        min={0}
                        value={slots[level]?.max ?? "0"}
                        onChange={(event) =>
                          setSlots((prev) => ({
                            ...prev,
                            [level]: { used: prev[level]?.used ?? "0", max: event.target.value },
                          }))
                        }
                        className={cn(field, "w-14")}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 space-y-1 text-xs">
            <span className="text-stone-500">Feats</span>
            <ChipList
              values={feats}
              onRemove={(value) => setFeats((list) => list.filter((entry) => entry !== value))}
            />
            <MultiContentPicker
              kind="feats"
              placeholder="Search feats to add"
              selectedNames={feats}
              onAdd={(entries) =>
                setFeats((list) => [...list, ...entries.map((entry) => entry.name)])
              }
            />
          </div>
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
