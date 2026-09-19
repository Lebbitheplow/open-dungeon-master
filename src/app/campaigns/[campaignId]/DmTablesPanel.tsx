"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { Switch } from "@/components/ui/Switch";
import { PanelLoading, RowMenu, panelRow } from "@/app/campaigns/[campaignId]/PanelKit";
import { DeskCard } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import {
  dieForTable,
  formatRollTable,
  parseRollTable,
  tableGaps,
  TABLE_NAME_MAX,
} from "@/lib/dm/roll-table-logic";
import type { RollTable } from "@/lib/db/roll-tables";
import { offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import { Sheet } from "@/components/ui/Sheet";
import { useTourPrepare } from "@/lib/tours/prepare";
import { appendLine } from "@/lib/workshop/pickers";
import { RefPicker } from "@/app/workshop/tables/RefPicker";
import { inputClass, StatblockFinder } from "@/app/workshop/tables/StatblockFinder";
import { TableRows, type RollResult } from "@/app/workshop/tables/TableRows";

// The DM's random tables, and the monster lookup beside them. Both are the
// DM's own reference: rolling a table writes an ordinary roll everyone can
// see, but what the row SAYS comes back here alone.
//
// The painted die a table rolls on, where the kit has one that size.
const PAINTED_DICE = new Set([4, 6, 8, 10, 12, 20, 100]);
function dieGlyph(sides: number): string {
  return PAINTED_DICE.has(sides) ? `die-d${sides}` : "die-d20";
}

// Two layouts over one set of requests. "list" is the DM console's: the
// tables, the new-table form and the lookup stacked in three sections.
// "rows" is the workshop's: a searchable row per table with its coverage at
// a glance, the editor in a sheet (which is also how a saved table gets
// edited), and the lookup folded into a card of its own.

export function DmTablesPanel({
  campaignId,
  layout = "list",
}: {
  campaignId: string;
  layout?: "list" | "rows";
}) {
  const [tables, setTables] = useState<RollTable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  // The saved table the editor has open, or "" for a new one. Only the rows
  // layout ever sets it, so the console's form keeps creating as it always
  // has.
  const [editingId, setEditingId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  // Draw without replacement: a rumour heard once is not heard again.
  const [noReplacement, setNoReplacement] = useState(false);
  // Drafting rows is the story model's job; a server without one offers the
  // paste box alone.
  const canDraft = offersStoryModel(useCapabilities());
  const [error, setError] = useState("");
  const [result, setResult] = useState<RollResult | null>(null);
  const rows = layout === "rows";

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/roll-tables`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      setTables(data.tables ?? []);
    } finally {
      setLoaded(true);
    }
  }, [campaignId]);

  // Refetches on mount and after every edit, the same shape as BondsPanel.
  useEffect(() => {
    load().catch(() => {
      // transient; the next action reloads
    });
  }, [load]);

  async function draft() {
    if (!prompt.trim()) {
      return;
    }
    setBusy("draft");
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/roll-tables/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), rows: 12 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not draft that.");
        return;
      }
      setText(data.text ?? "");
      if (!name.trim()) {
        setName(prompt.trim().slice(0, TABLE_NAME_MAX));
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  // Creates a table, or rewrites the one the editor has open. The PATCH
  // takes the same name-and-text shape the POST does.
  async function save() {
    if (!name.trim() || !text.trim()) {
      return;
    }
    setBusy("save");
    setError("");
    try {
      const response = await fetch(
        editingId
          ? `/api/campaigns/${campaignId}/dm/roll-tables/${editingId}`
          : `/api/campaigns/${campaignId}/dm/roll-tables`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), text, noReplacement }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not save that.");
        return;
      }
      setName("");
      setText("");
      setPrompt("");
      setNoReplacement(false);
      setEditingId("");
      setEditorOpen(false);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  async function roll(table: RollTable) {
    setBusy(table.id);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/dm/roll-tables/${table.id}/roll`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: "dm" }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not roll that.");
        return;
      }
      setResult({
        tableId: table.id,
        total: data.total,
        text: data.final?.text ?? data.entry?.text ?? "Nothing. That result is not on the table.",
        chain: Array.isArray(data.chain) && data.chain.length > 1 ? data.chain : [],
        remaining: typeof data.remaining === "number" ? data.remaining : null,
      });
      // A no-replacement draw changed the table's memory; the rows show it.
      if (typeof data.remaining === "number") {
        await load();
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  // Forget every result dealt so far, so the deck is whole again.
  async function reset(table: RollTable) {
    setBusy(table.id);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/roll-tables/${table.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not reset that.");
        return;
      }
      setResult(null);
      await load();
    } finally {
      setBusy("");
    }
  }

  async function remove(table: RollTable) {
    setBusy(table.id);
    try {
      await fetch(`/api/campaigns/${campaignId}/dm/roll-tables/${table.id}`, {
        method: "DELETE",
      });
      // A save after this would otherwise PATCH a table that is gone.
      if (editingId === table.id) {
        open(null);
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  // Same create route the save button uses, with the rows written back to
  // the text shorthand it takes.
  async function duplicate(table: RollTable) {
    setBusy(`copy-${table.id}`);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/roll-tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${table.name} (copy)`.slice(0, TABLE_NAME_MAX),
          text: formatRollTable(table.entries),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not copy that.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  // Puts a saved table in the editor, or clears it for a new one. A half
  // typed new table survives closing and reopening the sheet; it is only
  // thrown away when a saved table had taken its place.
  // The tour's "open the editor" step, answered where the editor is a sheet.
  useTourPrepare((name) => {
    if (name === "open-table-editor" && rows && !editorOpen) open(null);
  });

  function open(table: RollTable | null) {
    setError("");
    if (table) {
      setEditingId(table.id);
      setName(table.name);
      setText(formatRollTable(table.entries));
      setNoReplacement(table.noReplacement);
      setPrompt("");
    } else if (editingId) {
      setEditingId("");
      setName("");
      setText("");
      setNoReplacement(false);
      setPrompt("");
    }
    setEditorOpen(true);
  }

  const draftEntries = parseRollTable(text);
  const gaps = draftEntries.length ? tableGaps(draftEntries) : null;
  const editing = tables.find((table) => table.id === editingId) ?? null;

  const editor = (
    <>
      <input
        value={name}
        onChange={(event) => setName(event.target.value.slice(0, TABLE_NAME_MAX))}
        placeholder="Rumours in the Salt Wharf"
        aria-label="Table name"
        data-tour="tables-name"
        className={inputClass}
      />
      {canDraft ? (
        <div className="reveal mt-1.5 flex gap-1.5">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, 300))}
            placeholder="what the dockhands are whispering about"
            aria-label="What the table is about"
            className={inputClass}
          />
          <button
            type="button"
            onClick={draft}
            disabled={busy === "draft" || !prompt.trim()}
            title="Drafts rows for you to edit. Nothing is saved until you save it."
            aria-busy={busy === "draft"}
            className={cn(ui.btnSmall, "shrink-0 text-xs")}
          >
            {busy === "draft" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Draft
          </button>
        </div>
      ) : null}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={rows ? 10 : 5}
        placeholder={"1-3 A press gang is working the taproom.\n4. The harbourmaster has not been seen in a week.\nOr just paste a table straight out of a book."}
        aria-label="Table rows"
        data-tour="tables-body"
        className={cn(inputClass, "mt-1.5 resize-y font-mono text-xs")}
      />
      <div className="mt-1.5">
        <RefPicker
          campaignId={campaignId}
          tables={tables}
          editingId={editingId}
          onInsert={(line) => setText((current) => appendLine(current, line))}
        />
      </div>
      {draftEntries.length ? (
        <p className="reveal mt-1 text-[11px] text-stone-500">
          {draftEntries.length} rows, rolled on a d{dieForTable(draftEntries)}.
          {gaps?.uncovered.length
            ? ` Nothing on ${gaps.uncovered.join(", ")}.`
            : ""}
          {gaps?.overlapping.length
            ? ` Two rows both cover ${gaps.overlapping.join(", ")}.`
            : ""}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="flex min-h-10 items-center gap-2 text-xs text-stone-300">
          <Switch on={noReplacement} onChange={setNoReplacement} label="Draw without replacement" />
          Draw without replacement
        </span>
        {editing?.noReplacement && editing.drawn.length ? (
          <button
            type="button"
            onClick={() => void reset(editing)}
            className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}
          >
            Reset ({editing.drawn.length} dealt)
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-stone-500">
        Bare rows can carry a weight (x3 A goblin patrol). A row can be a thing: @table: Gems rolls
        that table too; @monster: wolf, @item: Potion of Healing, @npc: Marla name what they are.
        The picker above writes those rows for you.
      </p>
      {error ? <p className="motion-shake mt-1 text-xs text-red-400">{error}</p> : null}
      <button
        type="button"
        onClick={save}
        disabled={busy === "save" || !name.trim() || !text.trim()}
        aria-busy={busy === "save"}
        data-tour="tables-save"
        className={cn(ui.btnPrimary, "mt-2")}
      >
        {busy === "save" ? "Saving..." : "Save table"}
      </button>
    </>
  );

  if (rows) {
    return (
      <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-4 lg:space-y-0">
        <TableRows
          tables={tables}
          loaded={loaded}
          busy={busy}
          result={result}
          onOpen={open}
          onRoll={roll}
          onDuplicate={duplicate}
          onDelete={remove}
        />
        <StatblockFinder campaignId={campaignId} collapsible />
        {/* A roll or a copy that fails happens in the rows, not the sheet,
            so its message has to show out here as well. */}
        {error && !editorOpen ? (
          <p className="motion-shake text-xs text-red-400 lg:col-span-2">{error}</p>
        ) : null}
        <Sheet
          open={editorOpen}
          onOpenChange={setEditorOpen}
          title={editing ? editing.name : "New table"}
          className="lg:w-[min(92vw,40rem)]"
        >
          {editor}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DeskCard
        glyph="system-tables"
        title="Your tables"
        aside={tables.length ? <span key={tables.length} className="count-pop">{tables.length}</span> : undefined}
      >
        {tables.length ? (
          <ul className="stagger space-y-1.5">
            {tables.map((table) => {
              const sides = dieForTable(table.entries);
              // Roll stays the row's visible button. The two that were icons
              // live in the row's menu under the words they always carried.
              const items: ContextMenuItem[] = [
                { id: "roll", label: "Roll", glyph: dieGlyph(sides), disabled: busy === table.id, onSelect: () => void roll(table) },
                { id: "duplicate", label: `Duplicate ${table.name}`, glyph: "system-homebrew", disabled: busy === `copy-${table.id}`, onSelect: () => void duplicate(table) },
                { id: "delete", label: "Delete this table", glyph: "quest-failed", tone: "danger", separated: true, onSelect: () => void remove(table) },
              ];
              return (
                <ContextMenu key={table.id} as="li" items={items} label={table.name} className={panelRow}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-stone-100">
                      <GameIcon icon={{ kind: "glyph", key: dieGlyph(sides) }} size="size-6" className="shrink-0" />
                      <span className="min-w-0 truncate">{table.name}</span>
                      <span className="shrink-0 text-[11px] text-stone-400">d{sides}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => roll(table)}
                        disabled={busy === table.id}
                        aria-busy={busy === table.id}
                        className={cn(ui.btnPrimary, "h-9 px-3 text-[11px]")}
                      >
                        {busy === table.id ? <Loader2 className="size-3.5 animate-spin" /> : "Roll"}
                      </button>
                      <RowMenu items={items} label={table.name} />
                    </span>
                  </div>
                  {result?.tableId === table.id ? (
                    <div className="live-in mt-1.5 rounded-lg border border-amber-500/25 bg-stone-950/50 px-2 py-1.5 text-xs text-stone-200">
                      <p>
                        <span key={result.total} className="count-pop inline-block font-display text-amber-200">{result.total}:</span> {result.text}
                      </p>
                      {result.chain.map((line, index) => (
                        <p key={index} className="text-[11px] text-stone-400">
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </ContextMenu>
              );
            })}
          </ul>
        ) : loaded ? (
          <EmptyState size="sm" art="scrolls" title="No tables yet. Paste one in below." />
        ) : (
          <PanelLoading label="Loading..." rows={2} />
        )}
      </DeskCard>

      <DeskCard glyph="system-homebrew" title="New table">
        {editor}
      </DeskCard>

      <StatblockFinder campaignId={campaignId} />
    </div>
  );
}
