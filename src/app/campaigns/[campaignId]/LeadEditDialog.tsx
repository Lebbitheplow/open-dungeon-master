"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { KitButton, PanelError } from "./PanelKit";
import { spellClassFor } from "@/lib/classes";
import { spellSlotsFor } from "@/lib/srd";
import MultiContentPicker from "@/app/characters/builder/MultiContentPicker";

// The highest spell level this character has a slot for, so the pickers
// below offer what they could actually cast rather than the whole list up
// to Wish. Cantrips (level 0) always pass.
function highestSlotLevel(classId: string, level: number): number {
  return Object.keys(spellSlotsFor(classId, level)).reduce(
    (top, slotLevel) => Math.max(top, Number(slotLevel)),
    0,
  );
}
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

type ItemRow = { name: string; qty: string; slug?: string };

// Removable name chips backing the spell and feat lists; adding goes
// through the searchable multi-select pickers below each list.
function ChipList({ values, onRemove }: { values: string[]; onRemove: (value: string) => void }) {
  if (!values.length) {
    return null;
  }
  return (
    <div className="stagger-pop flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="pk-chip gap-0.5 py-0 pl-2 pr-0.5 text-xs text-stone-200"
        >
          {value}
          <KitButton tone="iconDanger" always onClick={() => onRemove(value)} aria-label={`Remove ${value}`} className="p-1">
            <X className="size-3" />
          </KitButton>
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
    cn(ui.input, "px-2.5 py-1.5");

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide">
              <GameIcon icon={{ kind: "glyph", key: "tab-lead" }} size="size-7" />
              <span className="gold-title">Adjust {sheet.name}</span>
            </Dialog.Title>
            <Dialog.Close aria-label="Close" className="pk-tap rounded p-1 text-stone-500 hover:text-amber-200 motion-nudge">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-stone-500">
            Party lead correction of stats, items, and spells. Changes are logged to the session
            event log.
          </p>
          <SectionHead title="Numbers" glyph="rest-hp" level="h3" />
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {(
              [
                ["HP", currentHp, setCurrentHp, "rest-hp"],
                ["Temp HP", tempHp, setTempHp, "rest-temp-hp"],
                ["Max HP", maxHp, setMaxHp, "rest-hp"],
                ["AC", ac, setAc, "rest-ac"],
                ["Gold", gold, setGold, "coin-gp"],
                ["XP", xp, setXp, "rest-xp"],
              ] as Array<[string, string, (value: string) => void, string]>
            ).map(([label, value, setter, glyph]) => (
              <div key={label} className="space-y-1">
                <span className="flex items-center gap-1 text-stone-400">
                  <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-4" /> {label}
                </span>
                <NumberStepper size="sm" value={Number(value) || 0} onChange={(next) => setter(String(next))} label={label} />
              </div>
            ))}
          </div>
          <label className="mt-2 block space-y-1 text-xs">
            <span className="text-stone-400">Conditions (comma separated)</span>
            <input
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              placeholder="poisoned, prone"
              className={field}
            />
          </label>

          <div className="mt-3 space-y-1 text-xs">
            <SectionHead title="Items" glyph="tab-loot" level="h3" aside={items.length || null} />
            {items.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <GameIcon icon={{ kind: "item", key: row.name, family: "item-gear" }} size="size-6" className="shrink-0" />
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
                <NumberStepper size="sm" min={1} value={Number(row.qty) || 1} onChange={(next) => setItem(index, { qty: String(next) })} label={`Quantity of ${row.name || "item"}`} className="shrink-0" />
                <KitButton tone="iconDanger" always onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))} className="shrink-0" aria-label="Remove item">
                  <Trash2 className="size-4" />
                </KitButton>
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
            <div className="reveal mt-3 space-y-2 text-xs">
              <SectionHead title="Spells" glyph="rest-spell-slot" level="h3" />
              <div className="space-y-1">
                <span className="eyebrow text-[10px] text-amber-400/80">Known</span>
                <ChipList
                  values={known}
                  onRemove={(value) => setKnown((list) => list.filter((entry) => entry !== value))}
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{
                    class: spellClassFor(sheet.class),
                    level: String(highestSlotLevel(sheet.class, sheet.level)),
                  }}
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
                <span className="eyebrow text-[10px] text-amber-400/80">Prepared</span>
                <ChipList
                  values={prepared}
                  onRemove={(value) =>
                    setPrepared((list) => list.filter((entry) => entry !== value))
                  }
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{
                    class: spellClassFor(sheet.class),
                    level: String(highestSlotLevel(sheet.class, sheet.level)),
                  }}
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
              <div className="stagger-pop flex flex-wrap gap-2">
                {Object.entries(sheet.spellcasting.slots).map(([level]) => (
                  <div key={level} className="space-y-1">
                    <span className="text-stone-400">L{level} used/max</span>
                    <div className="flex items-center gap-1">
                      <NumberStepper
                        size="sm"
                        min={0}
                        value={Number(slots[level]?.used ?? "0") || 0}
                        label={`Level ${level} slots used`}
                        onChange={(next) =>
                          setSlots((prev) => ({
                            ...prev,
                            [level]: { max: prev[level]?.max ?? "0", used: String(next) },
                          }))
                        }
                      />
                      <span className="text-stone-500">/</span>
                      <NumberStepper
                        size="sm"
                        min={0}
                        value={Number(slots[level]?.max ?? "0") || 0}
                        label={`Level ${level} slots max`}
                        onChange={(next) =>
                          setSlots((prev) => ({
                            ...prev,
                            [level]: { used: prev[level]?.used ?? "0", max: String(next) },
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 space-y-1 text-xs">
            <SectionHead title="Feats" glyph="rest-level-up" level="h3" aside={feats.length || null} />
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
            <span className="text-stone-400">Reason (shown in the log)</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="DM double-counted the goblin's hit"
              className={field}
            />
          </label>
          {error ? <PanelError className="mt-2">{error}</PanelError> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={ui.btnSmall}>
              Cancel
            </button>
            <KitButton tone="primary" onClick={save} disabled={busy} busy={busy} className="h-10 px-4 text-[13px]">
              Save
            </KitButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
