"use client";

import { EmptyState } from "@/components/EmptyState";
import { BookMarked, Check, Eye, EyeOff, Pin, PinOff, X } from "lucide-react";
import { useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import type { WorldFact } from "@/lib/db/facts";
import { FACT_CATEGORIES, type FactCategory } from "@/lib/dm/fact-logic";
import { KitButton, PanelError, RowMenu, panelField, panelRow } from "./PanelKit";

// The world-state fact sheet: server-tracked canon extracted at chapter
// close (plus manual pins). Everyone sees party-known facts; the lead can
// pin, edit, retire, add facts, and peek at DM-only secrets.

const CATEGORY_LABELS: Record<FactCategory, string> = {
  location: "Places",
  npc: "People",
  promise: "Promises & debts",
  world: "World state",
  party: "The party",
  lore: "Lore & rules",
};

// The painted glyph each heading leads with.
const CATEGORY_GLYPHS: Record<FactCategory, string> = {
  location: "tab-map",
  npc: "tab-bonds",
  promise: "coin-purse",
  world: "system-region",
  party: "tab-party",
  lore: "system-lore",
};

function FactCard({
  campaignId,
  fact,
  steersStory,
  refresh,
}: {
  campaignId: string;
  fact: WorldFact;
  steersStory: boolean;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.fact);
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/facts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factId: fact.id, ...payload }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const pinTitle = fact.pinned ? "Unpin" : "Pin: always kept in front of the DM, never auto-replaced";
  const items: ContextMenuItem[] = steersStory
    ? [
        { id: "pin", label: pinTitle, glyph: "tab-facts", disabled: busy, onSelect: () => void patch({ pinned: !fact.pinned }) },
        { id: "edit", label: "Edit", glyph: "tab-notes", onSelect: () => setEditing(true) },
        {
          id: "retire",
          label: "Retire: the DM stops treating this as true",
          glyph: "quest-failed",
          tone: "danger",
          separated: true,
          disabled: busy,
          onSelect: () => void patch({ status: "retired" }),
        },
      ]
    : [];

  return (
    <ContextMenu as="li" items={editing ? [] : items} label={fact.subject || CATEGORY_LABELS[fact.category]} className={panelRow}>
      {editing ? (
        <div className="reveal space-y-1.5">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={300}
            aria-label="Fact"
            className={cn(panelField, "leading-5")}
          />
          <div className="flex gap-1.5">
            <KitButton
              tone="primary"
              disabled={busy || !text.trim()}
              busy={busy}
              onClick={async () => {
                await patch({ fact: text.trim() });
                setEditing(false);
              }}
            >
              {busy ? null : <Check className="size-3.5" />}
              Save
            </KitButton>
            <KitButton
              onClick={() => {
                setEditing(false);
                setText(fact.fact);
              }}
            >
              <X className="size-3.5" /> Cancel
            </KitButton>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs leading-5 text-stone-300">
            {fact.pinned ? <Pin className="mr-1 inline size-3 text-amber-400" /> : null}
            {fact.subject ? (
              <span className="font-medium text-amber-200">{fact.subject}: </span>
            ) : null}
            {fact.fact}
          </p>
          <div className="mt-1 flex min-h-6 items-center gap-2 text-[11px] text-stone-500">
            <span className={fact.knownBy === "dm" ? "text-violet-300" : undefined}>
              {fact.knownBy === "dm" ? "DM secret" : CATEGORY_LABELS[fact.category]}
            </span>
            {steersStory ? (
              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                <KitButton
                  tone="icon"
                  always
                  disabled={busy}
                  busy={busy}
                  onClick={() => patch({ pinned: !fact.pinned })}
                  title={pinTitle}
                  aria-label={pinTitle}
                  aria-pressed={fact.pinned}
                >
                  {busy ? null : fact.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </KitButton>
                <RowMenu items={items} label={fact.subject || CATEGORY_LABELS[fact.category]} />
              </span>
            ) : null}
          </div>
        </>
      )}
    </ContextMenu>
  );
}

function FactComposer({
  campaignId,
  refresh,
}: {
  campaignId: string;
  refresh: () => Promise<void>;
}) {
  const [category, setCategory] = useState<FactCategory>("world");
  const [subject, setSubject] = useState("");
  const [fact, setFact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!fact.trim() || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/facts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject: subject.trim(), fact: fact.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not save the fact.");
        return;
      }
      setSubject("");
      setFact("");
      await refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel rounded-lg p-2.5">
      <SectionHead title="Pin a fact" glyph="tab-facts" level="h4" />
      <div data-pill-group="" role="group" aria-label="Category" className="mb-1.5 flex flex-wrap gap-1">
        {FACT_CATEGORIES.map((value) => (
          <button
            data-on={category === value ? "" : undefined}
            aria-pressed={category === value}
            key={value}
            type="button"
            onClick={() => setCategory(value)}
            className="pk-pill pk-tap motion-press"
          >
            {CATEGORY_LABELS[value]}
          </button>
        ))}
      </div>
      <input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        maxLength={80}
        placeholder="Subject (who or what it is about)"
        aria-label="Subject"
        className={cn(panelField, "mb-1.5")}
      />
      <textarea
        value={fact}
        onChange={(event) => setFact(event.target.value)}
        rows={2}
        maxLength={300}
        placeholder="One sentence the DM must never contradict"
        aria-label="Fact"
        className={cn(panelField, "leading-5")}
      />
      {error ? <PanelError className="mt-1">{error}</PanelError> : null}
      <KitButton tone="secondary" onClick={submit} disabled={busy || !fact.trim()} busy={busy} className="mt-1.5 w-full">
        {busy ? null : <BookMarked className="size-3.5" />}
        Pin fact
      </KitButton>
    </div>
  );
}

export function FactsPanel({
  campaignId,
  facts,
  steersStory,
  refreshFacts,
}: {
  campaignId: string;
  facts: WorldFact[];
  steersStory: boolean;
  refreshFacts: () => Promise<void>;
}) {
  // Lead-only peek at DM secrets: fetched separately so the spoilers never
  // sit in shared state, and merged in only while the toggle is on.
  const [secrets, setSecrets] = useState<WorldFact[] | null>(null);

  async function toggleSecrets() {
    if (secrets) {
      setSecrets(null);
      return;
    }
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/facts?secrets=1`);
      if (response.ok) {
        const data = await response.json();
        setSecrets(
          ((data.facts ?? []) as WorldFact[]).filter((fact) => fact.knownBy === "dm"),
        );
      }
    } catch {
      // transient; the button retries
    }
  }

  const refresh = async () => {
    await refreshFacts();
    if (secrets) {
      setSecrets(null);
      await toggleSecrets();
    }
  };

  const pinned = facts.filter((fact) => fact.pinned);

  return (
    <div className="space-y-3">
      {steersStory ? <FactComposer campaignId={campaignId} refresh={refresh} /> : null}

      {pinned.length ? (
        <div className="reveal space-y-1.5">
          <SectionHead title="Pinned" glyph="tab-facts" aside={pinned.length} />
          <ul className="stagger space-y-1.5">
            {pinned.map((fact) => (
              <FactCard
                key={fact.id}
                campaignId={campaignId}
                fact={fact}
                steersStory={steersStory}
                refresh={refresh}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {FACT_CATEGORIES.map((category) => {
        const entries = facts.filter((fact) => fact.category === category && !fact.pinned);
        if (!entries.length) {
          return null;
        }
        return (
          <div key={category} className="space-y-1.5">
            <SectionHead title={CATEGORY_LABELS[category]} glyph={CATEGORY_GLYPHS[category]} aside={entries.length} />
            <ul className="stagger space-y-1.5">
              {entries.map((fact) => (
                <FactCard
                  key={fact.id}
                  campaignId={campaignId}
                  fact={fact}
                  steersStory={steersStory}
                  refresh={refresh}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {!facts.length ? (
        <EmptyState size="sm" art="board" title={`Nothing recorded yet. The DM writes durable facts here as chapters close${steersStory ? ", or pin one yourself above" : ""}.`} />
      ) : null}

      {steersStory ? (
        <div className="reveal space-y-1.5">
          <KitButton tone="link" onClick={toggleSecrets} aria-expanded={Boolean(secrets)}>
            {secrets ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {secrets ? "Hide DM secrets" : "Show DM secrets (spoilers)"}
          </KitButton>
          {secrets ? (
            secrets.length ? (
              <ul className="stagger space-y-1.5">
                {secrets.map((fact) => (
                  <FactCard
                    key={fact.id}
                    campaignId={campaignId}
                    fact={fact}
                    steersStory={steersStory}
                    refresh={refresh}
                  />
                ))}
              </ul>
            ) : (
              <p className="live-in px-1 text-xs text-stone-500">No DM secrets recorded.</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
