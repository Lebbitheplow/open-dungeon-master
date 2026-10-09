"use client";

import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/app/campaigns/[campaignId]/PanelKit";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import { useCallback, useEffect, useState } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { describeHomebrew } from "@/lib/homebrew/gear";
import type { VariantRules } from "@/lib/rulesets/logic";
import { Sheet } from "@/components/ui/Sheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useTourPrepare } from "@/lib/tours/prepare";
import { ListTally, sortRows, type RowSort } from "@/app/workshop/ListHead";
import { GameIcon } from "@/components/ui/GameIcon";
import { HomebrewEditor } from "@/app/workshop/homebrew/HomebrewEditor";
import { HomebrewPlate } from "@/app/workshop/homebrew/HomebrewIcon";
import { blankDraft, copyName, draftFromCatalog, type HomebrewDraft } from "@/app/workshop/homebrew/draft";
import { CONTENT_KIND } from "@/app/workshop/homebrew/CatalogStart";
import type { PickerEntry } from "@/app/characters/builder/useContentSearch";
import { useSearchParams } from "next/navigation";
import {
  HOMEBREW_EDITOR_KINDS,
  KIND_BLURB,
  KIND_LABELS,
  KIND_SINGULAR,
  type EditorKind,
  type HomebrewEntryView,
} from "@/app/workshop/homebrew/types";

// The Homebrew system: the user's items, spells and character options, one
// kind at a time, with the editor in a sheet. User-scoped like the bestiary,
// so an item written in one workshop is there in the next; nothing here
// needs importing into a campaign because every picker already searches it.

export function HomebrewPanel({
  variantRules,
  onChanged,
}: {
  variantRules: Partial<VariantRules>;
  onChanged?: () => void;
}) {
  const [entries, setEntries] = useState<HomebrewEntryView[]>([]);
  const [kind, setKind] = useState<EditorKind>("item");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RowSort>("made");
  const [editing, setEditing] = useState<{ id: string | null; draft: HomebrewDraft; savedName?: string } | null>(null);
  // The forgotten entries (archived: off the shelf and the pickers, still
  // running wherever they are carried), shown on asking.
  const [forgotten, setForgotten] = useState<HomebrewEntryView[] | null>(null);
  const [showForgotten, setShowForgotten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A refused or failed read of the shelf is said so, with a way to ask
  // again, never shown as "nothing of your own yet" (issue 140).
  const { loaded, loadError, settle } = useLoadStatus();

  // The tour's "open the editor" step.
  useTourPrepare((name) => {
    if (name === "open-homebrew-editor" && !editing) {
      setError("");
      setEditing({ id: null, draft: blankDraft(kind) });
    }
  });

  const load = useCallback(
    () =>
      readLoad<{ entries?: HomebrewEntryView[] }>(fetch("/api/homebrew"), "Your homebrew").then((outcome) => {
        settle(outcome);
        if (outcome.payload?.entries) {
          setEntries(outcome.payload.entries.filter((entry) => entry.kind !== "monster"));
        }
      }),
    [settle],
  );

  const loadForgotten = useCallback(
    () =>
      fetch("/api/homebrew?archived=1")
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { entries?: HomebrewEntryView[] } | null) => setForgotten((body?.entries ?? []).filter((entry) => entry.kind !== "monster")))
        .catch(() => setForgotten([])),
    [],
  );

  useEffect(() => {
    void load();
    void loadForgotten();
  }, [load, loadForgotten]);

  // "Start a workshop copy of this" from the rulebook (src/components/
  // rulebook/PagePrep.tsx): ?start=<kind>:<book page>. The page's catalog
  // row opens as an unsaved draft of its kind, the way "start from" opens
  // one; the parameter is then dropped so a reload does not open it again.
  const params = useSearchParams();
  const start = params.get("start");
  useEffect(() => {
    if (!start) return;
    const [startKind, pageId] = start.split(":");
    if (!HOMEBREW_EDITOR_KINDS.includes(startKind as EditorKind) || !pageId) return;
    const editorKind = startKind as EditorKind;
    let live = true;
    void (async () => {
      const page = (await fetch(`/api/rulebook/pages/${encodeURIComponent(pageId)}`).then((response) => (response.ok ? response.json() : null))) as
        | { page?: { title: string }; crosswalk?: { catalogName?: string; classId?: string } }
        | null;
      if (!live || !page?.page) return;
      // The parameter goes once the draft is open: dropping it re-renders
      // this panel without it, which ends this effect.
      const done = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("start");
        window.history.replaceState(null, "", url.toString());
      };
      setKind(editorKind);
      setError("");
      if (editorKind === "archetype") {
        const draft = blankDraft("archetype");
        setEditing({ id: null, draft: { ...draft, data: { ...draft.data, classSlug: page.crosswalk?.classId ?? "fighter" } } });
        done();
        return;
      }
      const wanted = page.crosswalk?.catalogName ?? page.page.title;
      const query = new URLSearchParams({ q: wanted, mechanics: "1", limit: "20", book: "1" });
      const body = (await fetch(`/api/content/${CONTENT_KIND[editorKind]}?${query}`).then((response) => (response.ok ? response.json() : null))) as
        | { results?: PickerEntry[] }
        | null;
      const rows = body?.results ?? [];
      const row =
        rows.find((entry) => entry.rulebook === pageId) ??
        rows.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase() && (entry.documentSlug === "wotc-srd" || entry.source === "srd")) ??
        rows.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase());
      if (!live) return;
      if (row) {
        setEditing({ id: null, draft: draftFromCatalog(editorKind, { ...row, rulebook: row.rulebook ?? pageId }) });
      } else {
        setError(`${page.page.title} is not in the catalog on this server.`);
      }
      done();
    })();
    return () => {
      live = false;
    };
  }, [start]);

  const ofKind = entries.filter((entry) => entry.kind === kind);
  const needle = query.trim().toLowerCase();
  const shown = sortRows(
    needle
      ? ofKind.filter((entry) =>
          [entry.name, String(entry.data.desc ?? ""), describeHomebrew(entry.kind, entry.data)].some((text) =>
            text.toLowerCase().includes(needle),
          ),
        )
      : ofKind,
    sort,
    (entry) => entry.name,
  );

  function open(entry: HomebrewEntryView) {
    setError("");
    setEditing({ id: entry.id, draft: { kind: entry.kind as EditorKind, name: entry.name, data: entry.data }, savedName: entry.name });
  }

  async function save() {
    if (!editing) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { id, draft } = editing;
      const response = await fetch(id ? `/api/homebrew/${id}` : "/api/homebrew", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          id ? { name: draft.name.trim(), data: draft.data } : { kind: draft.kind, name: draft.name.trim(), data: draft.data },
        ),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That was refused.");
        return;
      }
      await load();
      onChanged?.();
      const saved = (payload as { entry?: HomebrewEntryView }).entry;
      setEditing(saved ? { id: saved.id, draft: { kind: saved.kind as EditorKind, name: saved.name, data: saved.data }, savedName: saved.name } : null);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (!editing?.id) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { draft } = editing;
      const response = await fetch("/api/homebrew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: draft.kind, name: copyName(draft.name), data: { ...draft.data, copiedFrom: { name: draft.name, source: "homebrew", slug: `homebrew:${editing.id}` } } }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "The copy was refused.");
        return;
      }
      await load();
      onChanged?.();
      const saved = (payload as { entry?: HomebrewEntryView }).entry;
      if (saved) {
        setEditing({ id: saved.id, draft: { kind: saved.kind as EditorKind, name: saved.name, data: saved.data }, savedName: saved.name });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing?.id) {
      return;
    }
    if (
      !(await appConfirm(
        `Forget "${editing.draft.name}"? It leaves your shelf and every picker, so nothing new is made with it. Sheets, spell lists, NPCs and tables that already carry it keep it working exactly as it is now. You can bring it back from Forgotten.`,
        { title: "Forget this entry?", actionLabel: "Forget it" },
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/homebrew/${editing.id}`, { method: "DELETE" });
      setEditing(null);
      await Promise.all([load(), loadForgotten()]);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function restore(entry: HomebrewEntryView) {
    setBusy(true);
    try {
      await fetch(`/api/homebrew/${entry.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restore: true }) });
      await Promise.all([load(), loadForgotten()]);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function purge(entry: HomebrewEntryView) {
    if (
      !(await appConfirm(
        `Delete "${entry.name}" for good? Anything that still carries it keeps only its name: its rules stop working at every table, and this cannot be undone.`,
        { title: "Delete for good?", actionLabel: "Delete for good" },
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/homebrew/${entry.id}?purge=1`, { method: "DELETE" });
      await loadForgotten();
    } finally {
      setBusy(false);
    }
  }

  const forgottenOfKind = (forgotten ?? []).filter((entry) => entry.kind === kind);

  return (
    <div className="space-y-3">
      <div data-tour="homebrew-kinds" className="w-fit max-w-full">
        <SegmentedControl
          options={HOMEBREW_EDITOR_KINDS.map((value) => ({
            value,
            label: `${KIND_LABELS[value]}${entries.some((entry) => entry.kind === value) ? ` ${entries.filter((entry) => entry.kind === value).length}` : ""}`,
          }))}
          value={kind}
          onChange={setKind}
          size="sm"
          label="Kind of homebrew"
        />
      </div>

      <p className="text-xs text-stone-400">{KIND_BLURB[kind]}</p>

      <label className="relative block" data-tour="homebrew-search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search your ${KIND_LABELS[kind].toLowerCase()}`}
          aria-label={`Search your ${KIND_LABELS[kind].toLowerCase()}`}
          className={`${ui.input} pl-9`}
        />
      </label>
      <ListTally shown={shown.length} total={ofKind.length} noun={["piece", "pieces"]} sort={sort} onSort={setSort} />

      <ul className="stagger-up grid gap-2 lg:grid-cols-2">
        {shown.map((entry) => (
          <li key={entry.id} className="min-w-0">
            <button
              type="button"
              onClick={() => open(entry)}
              className={cn(
                ui.cardHover,
                "flex h-full w-full items-start gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
              )}
            >
              <HomebrewPlate kind={entry.kind} name={entry.name} data={entry.data} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-display tracking-wide text-amber-50">{entry.name}</span>
                <span className="line-clamp-1 text-[11px] text-stone-400">{describeHomebrew(entry.kind, entry.data)}</span>
                {entry.data.desc ? (
                  <span className="line-clamp-1 text-sm text-stone-300">{String(entry.data.desc)}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => {
              setError("");
              setEditing({ id: null, draft: blankDraft(kind) });
            }}
            data-tour="homebrew-new"
            className={cn(
              ui.cardHover,
              "flex h-full w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
            )}
          >
            <span className="relative shrink-0">
              <GameIcon icon={{ kind: "glyph", key: "system-homebrew" }} size="size-10" />
              <Plus className="absolute -bottom-1 -right-1 size-4 rounded-full bg-stone-900 text-amber-300" aria-hidden="true" />
            </span>
            <span className="font-display tracking-wide">New {KIND_SINGULAR[kind]}</span>
          </button>
        </li>
      </ul>

      {forgottenOfKind.length ? (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowForgotten((value) => !value)}
            aria-expanded={showForgotten}
            className={cn(ui.btnSmall, "motion-press")}
          >
            Forgotten ({forgottenOfKind.length})
          </button>
          {showForgotten ? (
            <ul className="reveal stagger-up space-y-1">
              {forgottenOfKind.map((entry) => (
                <li key={entry.id} className="panel flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-stone-300">{entry.name}</span>
                  <span className="text-[11px] text-stone-500">still runs where it is carried</span>
                  <button type="button" disabled={busy} onClick={() => void restore(entry)} className={cn(ui.btnSmall, "motion-press")}>
                    Bring back
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void purge(entry)}
                    className={cn(ui.btnSmall, "motion-press hover:border-red-500/50 hover:text-red-300")}
                  >
                    Delete for good
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {loadError ? <LoadFailed error={loadError} onRetry={() => void load()} /> : null}
      {!loaded && !loadError ? (
        <p className="text-xs text-stone-500" aria-busy="true">Reading your shelf...</p>
      ) : loaded && ofKind.length === 0 ? (
        <EmptyState art="chest" title="Nothing of your own yet. Start from something in the books and change what you like." />
      ) : shown.length === 0 ? (
        <p className="live-in text-xs text-stone-500">Nothing by that name.</p>
      ) : null}

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
        title={editing?.id ? editing.draft.name || KIND_SINGULAR[kind] : `New ${KIND_SINGULAR[editing?.draft.kind ?? kind]}`}
        className="top-0 h-dvh max-h-none rounded-none lg:top-1/2 lg:h-auto lg:max-h-[92vh] lg:w-[min(96vw,56rem)] lg:rounded-xl"
      >
        {editing ? (
          <div className="reveal overflow-y-auto pb-2">
            <HomebrewEditor
              draft={editing.draft}
              isNew={editing.id === null}
              savedName={editing.savedName}
              busy={busy}
              error={error}
              variantRules={variantRules}
              onDraft={(draft) => setEditing({ ...editing, draft })}
              onSave={() => void save()}
              onDuplicate={() => void duplicate()}
              onDelete={() => void remove()}
            />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
