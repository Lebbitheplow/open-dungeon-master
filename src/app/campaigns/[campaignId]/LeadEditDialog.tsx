"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { Switch } from "@/components/ui/Switch";
import { KitButton, PanelError } from "./PanelKit";
import {
  ChipList,
  ItemFlags,
  SlotSteppers,
  equipmentFrom,
  highestStoredSlot,
  itemRowsOf,
  levelMeta,
  spellListOf,
  syncCasterLists,
  type ItemRow,
  type SlotEdits,
} from "./LeadEditParts";
import { acBreakdownFor, effectiveAcFor } from "@/lib/srd";
import { isCantripName } from "@/lib/srd/spell-lists";
import { spellStyleFor } from "@/lib/srd/spell-prep";
import MultiContentPicker from "@/app/characters/builder/MultiContentPicker";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
  // A pinned armor class stays where a person put it; unpinned, the armor
  // engine sets it from what is worn on every write. The lead can hand a
  // pinned one back (U:UC7), which before this could never be undone.
  const [pinned, setPinned] = useState(sheet.acOverride);
  // What the armor engine would set, for the switch's label.
  const derived = acBreakdownFor({ ...sheet, classes: sheet.classes.length ? sheet.classes : undefined });
  // What attacks would face with the draft as it stands, Shield and Haste included.
  const facing = effectiveAcFor({ ...sheet, ac: pinned ? Number(ac) || 0 : derived.ac, acOverride: pinned });
  // Lines the server held when it saved (a counter cannot hold more spent
  // than it has); shown before the dialog closes (U:UC12).
  const [held, setHeld] = useState<string[]>([]);
  const [gold, setGold] = useState(String(sheet.gold));
  const [xp, setXp] = useState(String(sheet.xp));
  const [conditions, setConditions] = useState(sheet.conditions.join(", "));
  const [items, setItems] = useState<ItemRow[]>(() => itemRowsOf(sheet.equipment));
  const [prepared, setPrepared] = useState<string[]>(sheet.spellcasting?.prepared ?? []);
  const [known, setKnown] = useState<string[]>(sheet.spellcasting?.known ?? []);
  const [cantrips, setCantrips] = useState<string[]>(sheet.spellcasting?.cantrips ?? []);
  const [pending, setPending] = useState<string[]>(sheet.spellcasting?.pending ?? []);
  // Which lists this class actually uses (src/lib/srd/spell-prep.ts), so the
  // dialog never offers a cleric a "known" list or a bard a "prepared" one.
  // Anything already on the sheet stays editable whatever the class says.
  const style = spellStyleFor(sheet.class);
  // The list and the level the pickers search: the class's own list (the
  // wizard's for a third caster) up to the highest slot the sheet stores.
  const listClass = spellListOf(sheet);
  const topLevel = String(highestStoredSlot(sheet.spellcasting));
  // A wizard's prepared spells are in the book even on a sheet written
  // before the book was kept.
  const [spellbook, setSpellbook] = useState<string[]>(() =>
    style === "spellbook" && sheet.spellcasting
      ? [...new Set([...(sheet.spellcasting.spellbook ?? []), ...sheet.spellcasting.prepared])]
      : (sheet.spellcasting?.spellbook ?? []),
  );
  // A cantrip is recognised by the level its search row carries, or by name
  // for one typed in by hand.
  const isCantrip = (entry: { name: string; level?: number }) =>
    entry.level === 0 || (entry.level === undefined && isCantripName(entry.name));
  // A cantrip picked from any levelled search still lands in the cantrip
  // list; the other lists hold levelled spells only.
  const addCantrips = (entries: Array<{ name: string; level?: number }>) => {
    const picked = entries.filter(isCantrip).map((entry) => entry.name);
    if (picked.length) {
      setCantrips((list) => [...list, ...picked.filter((name) => !list.includes(name))]);
    }
  };
  const spellNamesOf = (entries: Array<{ name: string; level?: number }>) =>
    entries.filter((entry) => !isCantrip(entry)).map((entry) => entry.name);
  const pact = sheet.spellcasting?.pact;
  const [slots, setSlots] = useState<SlotEdits>(() => ({
    ...Object.fromEntries(
      Object.entries(sheet.spellcasting?.slots ?? {}).map(([level, slot]) => [
        level,
        { max: String(slot.max), used: String(slot.used) },
      ]),
    ),
    ...(pact ? { pact: { max: String(pact.max), used: String(pact.used) } } : {}),
  }));
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
      // An unpinned AC is the armor engine's; only a pinned one is sent.
      ...(pinned ? ([["ac", ac, sheet.ac]] as Array<[string, string, number]>) : []),
      ["gold", gold, sheet.gold],
      ["xp", xp, sheet.xp],
    ];
    for (const [key, raw, previous] of numbers) {
      const value = Number(raw);
      if (Number.isFinite(value) && value !== previous) {
        patch[key] = value;
      }
    }
    if (pinned !== sheet.acOverride) {
      patch.acOverride = pinned;
    }
    const nextConditions = splitList(conditions);
    if (nextConditions.join("|") !== sheet.conditions.join("|")) {
      patch.conditions = nextConditions;
    }
    const nextEquipment = equipmentFrom(items);
    if (JSON.stringify(nextEquipment) !== JSON.stringify(sheet.equipment)) {
      patch.equipment = nextEquipment;
    }
    if (sheet.spellcasting) {
      const nextSpellcasting: NonNullable<CharacterSheet["spellcasting"]> = {
        ...sheet.spellcasting,
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
        cantrips,
      };
      // Pact slots are one level, kept apart from the shared pool.
      if (pact) {
        const max = Math.min(4, Math.max(0, Math.round(Number(slots.pact?.max)) || 0));
        nextSpellcasting.pact = {
          level: pact.level,
          max,
          used: Math.min(max, Math.max(0, Math.round(Number(slots.pact?.used ?? "0")) || 0)),
        };
      }
      // The optional lists stay off a sheet that never had them.
      if (pending.length) {
        nextSpellcasting.pending = pending;
      } else {
        delete nextSpellcasting.pending;
      }
      if (spellbook.length || sheet.spellcasting.spellbook) {
        nextSpellcasting.spellbook = spellbook;
      }
      // A sheet that keeps per-class lists (casters) is read from them by the
      // spell book; editing only the top-level lists left the two telling
      // different stories. The edit goes into the class lists too.
      if (sheet.spellcasting.casters?.length) {
        Object.assign(
          nextSpellcasting,
          syncCasterLists(sheet.spellcasting, nextSpellcasting, sheet),
        );
      }
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
        const data = (await response.json().catch(() => ({}))) as { error?: string; held?: string[] };
        if (!response.ok) {
          setError(data.error || "Could not save the correction.");
          return;
        }
        if (Array.isArray(data.held) && data.held.length) {
          setHeld(data.held);
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
          <div className="mt-2 space-y-1.5 rounded-lg border border-stone-700/50 bg-stone-950/40 p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-stone-400">
                <GameIcon icon={{ kind: "glyph", key: "rest-ac" }} size="size-4" /> AC
              </span>
              <Switch on={pinned} onChange={setPinned} label="Pin the armor class by hand" />
            </div>
            {pinned ? (
              <div className="reveal flex flex-wrap items-center gap-2">
                <NumberStepper size="sm" value={Number(ac) || 0} min={1} max={40} onChange={(next) => setAc(String(next))} label="AC" />
                <span className="text-[11px] text-stone-500">
                  Pinned. Armor would set {derived.ac}. Unpin to hand it back.
                </span>
              </div>
            ) : (
              <p className="reveal text-[11px] text-stone-400">
                Armor sets it: <span className="text-stone-100">{derived.ac}</span>
                {derived.parts.length ? ` (${derived.parts.join(", ")})` : ""}
              </p>
            )}
            {facing !== (pinned ? Number(ac) : derived.ac) ? (
              <p className="live-in text-[11px] text-sky-300/90">
                Attacks face {facing} right now: spells and forms on top ride along.
              </p>
            ) : null}
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
              <div key={index} className="live-in space-y-0.5">
              <div className="flex items-center gap-2">
                <GameIcon icon={{ kind: "item", key: row.name, family: "item-gear" }} size="size-6" className="shrink-0" />
                {row.base.slug ? (
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
              <ItemFlags item={row.base} />
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
                      base: { name: entry.name, qty: 1, ...(entry.slug ? { slug: entry.slug } : {}) },
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
                <span className="eyebrow text-[10px] text-amber-400/80">Cantrips</span>
                <ChipList
                  values={cantrips}
                  onRemove={(value) =>
                    setCantrips((list) => list.filter((entry) => entry !== value))
                  }
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{ class: listClass, level: "0" }}
                  placeholder="Search cantrips to add"
                  selectedNames={cantrips}
                  onAdd={(entries) => addCantrips(entries)}
                  renderMeta={() => "cantrip"}
                />
              </div>
              {style === "known" || known.length ? (
              <div className="space-y-1">
                <span className="eyebrow text-[10px] text-amber-400/80">Known</span>
                <ChipList
                  values={known}
                  onRemove={(value) => setKnown((list) => list.filter((entry) => entry !== value))}
                />
                <MultiContentPicker
                  kind="spells"
                  extraParams={{ class: listClass, level: topLevel }}
                  placeholder="Search spells to add as known"
                  selectedNames={known}
                  onAdd={(entries) => {
                    addCantrips(entries);
                    setKnown((list) => [...list, ...spellNamesOf(entries)]);
                  }}
                  renderMeta={levelMeta}
                />
              </div>
              ) : null}
              {style === "spellbook" || spellbook.length ? (
                <div className="space-y-1">
                  <span className="eyebrow text-[10px] text-amber-400/80">Spellbook</span>
                  <ChipList
                    values={spellbook}
                    onRemove={(value) => {
                      setSpellbook((list) => list.filter((entry) => entry !== value));
                      setPrepared((list) => list.filter((entry) => entry !== value));
                    }}
                  />
                  <MultiContentPicker
                    kind="spells"
                    extraParams={{ class: listClass, level: topLevel }}
                    placeholder="Search spells to write in the spellbook"
                    selectedNames={spellbook}
                    onAdd={(entries) => {
                      addCantrips(entries);
                      setSpellbook((list) => [...list, ...spellNamesOf(entries)]);
                    }}
                    renderMeta={levelMeta}
                  />
                </div>
              ) : null}
              {style !== "known" || prepared.length ? (
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
                  extraParams={{ class: listClass, level: topLevel }}
                  placeholder="Search spells to add as prepared"
                  selectedNames={prepared}
                  onAdd={(entries) => {
                    addCantrips(entries);
                    const names = spellNamesOf(entries);
                    setPrepared((list) => [...list, ...names]);
                    // A wizard's prepared spell is written in the book too.
                    if (style === "spellbook") {
                      setSpellbook((list) => [...list, ...names.filter((name) => !list.includes(name))]);
                    }
                  }}
                  renderMeta={levelMeta}
                />
              </div>
              ) : null}
              {pending.length ? (
                <div className="space-y-1">
                  <span className="eyebrow text-[10px] text-sky-300/80">Prepared at the next long rest</span>
                  <ChipList
                    values={pending}
                    onRemove={(value) => setPending((list) => list.filter((entry) => entry !== value))}
                  />
                </div>
              ) : null}
              <SlotSteppers levels={[...Object.keys(sheet.spellcasting.slots), ...(pact ? ["pact"] : [])]} slots={slots} onChange={setSlots} />
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
          {held.length ? (
            <div role="status" className="reveal mt-2 space-y-1 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-100">
              <p>Saved. The server held these to what the sheet has:</p>
              <ul className="stagger list-disc space-y-0.5 pl-4 text-amber-200/90">
                {held.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            {held.length ? (
              <KitButton tone="primary" onClick={onClose} className="h-10 px-4 text-[13px]">
                Done
              </KitButton>
            ) : (
              <>
                <button type="button" onClick={onClose} className={ui.btnSmall}>
                  Cancel
                </button>
                <KitButton tone="primary" onClick={save} disabled={busy} busy={busy} className="h-10 px-4 text-[13px]">
                  Save
                </KitButton>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
