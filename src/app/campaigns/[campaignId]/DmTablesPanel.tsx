"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Dices, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
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
import { inputClass, StatblockFinder } from "@/app/workshop/tables/StatblockFinder";
import { TableRows, type RollResult } from "@/app/workshop/tables/TableRows";

// The DM's random tables, and the monster lookup beside them. Both are the
// DM's own reference: rolling a table writes an ordinary roll everyone can
// see, but what the row SAYS comes back here alone.
//
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
          body: JSON.stringify({ name: name.trim(), text }),
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
        text: data.entry?.text ?? "Nothing. That result is not on the table.",
      });
    } catch {
      setError("Could not reach the server.");
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
  function open(table: RollTable | null) {
    setError("");
    if (table) {
      setEditingId(table.id);
      setName(table.name);
      setText(formatRollTable(table.entries));
      setPrompt("");
    } else if (editingId) {
      setEditingId("");
      setName("");
      setText("");
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
        className={inputClass}
      />
      {canDraft ? (
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, 300))}
            placeholder="what the dockhands are whispering about"
            className={inputClass}
          />
          <button
            type="button"
            onClick={draft}
            disabled={busy === "draft" || !prompt.trim()}
            title="Drafts rows for you to edit. Nothing is saved until you save it."
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
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
        className={cn(inputClass, "mt-1.5 resize-y font-mono text-xs")}
      />
      {draftEntries.length ? (
        <p className="mt-1 text-[11px] text-stone-500">
          {draftEntries.length} rows, rolled on a d{dieForTable(draftEntries)}.
          {gaps?.uncovered.length
            ? ` Nothing on ${gaps.uncovered.join(", ")}.`
            : ""}
          {gaps?.overlapping.length
            ? ` Two rows both cover ${gaps.overlapping.join(", ")}.`
            : ""}
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      <button
        type="button"
        onClick={save}
        disabled={busy === "save" || !name.trim() || !text.trim()}
        className="mt-1.5 rounded-md border border-amber-700 bg-amber-950/50 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-900/50 disabled:opacity-40"
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
          <p className="text-xs text-red-400 lg:col-span-2">{error}</p>
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
      <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <Dices className="size-3.5" />
          Your tables
        </p>
        {tables.length ? (
          <ul className="space-y-1.5">
            {tables.map((table) => (
              <li
                key={table.id}
                className="rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-stone-200">
                    {table.name}
                    <span className="ml-1.5 text-[11px] text-stone-500">
                      d{dieForTable(table.entries)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => roll(table)}
                      disabled={busy === table.id}
                      className="rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/50 disabled:opacity-40"
                    >
                      {busy === table.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        "Roll"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicate(table)}
                      disabled={busy === `copy-${table.id}`}
                      aria-label={`Duplicate ${table.name}`}
                      className="rounded-md border border-stone-700 p-1 text-stone-500 hover:text-stone-300 disabled:opacity-40"
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(table)}
                      aria-label={`Delete ${table.name}`}
                      title="Delete this table"
                      className="rounded-md border border-stone-700 p-1 text-stone-500 hover:text-red-300"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
                {result?.tableId === table.id ? (
                  <p className="mt-1 text-xs text-stone-300">
                    <span className="text-amber-200">{result.total}:</span> {result.text}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-stone-500">
            {loaded ? "No tables yet. Paste one in below." : "Loading..."}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <Plus className="size-3.5" />
          New table
        </p>
        {editor}
      </section>

      <StatblockFinder campaignId={campaignId} />
    </div>
  );
}
