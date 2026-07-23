"use client";

import {
  BookMarked,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { WorldFact } from "@/lib/db/facts";
import { FACT_CATEGORIES, type FactCategory } from "@/lib/dm/fact-logic";

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

function FactCard({
  campaignId,
  fact,
  isLead,
  refresh,
}: {
  campaignId: string;
  fact: WorldFact;
  isLead: boolean;
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

  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={300}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={async () => {
                await patch({ fact: text.trim() });
                setEditing(false);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(fact.fact);
              }}
              className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-900"
            >
              <X className="size-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[11px] leading-4 text-stone-300">
            {fact.pinned ? <Pin className="mr-1 inline size-3 text-amber-400" /> : null}
            {fact.subject ? (
              <span className="font-medium text-amber-200">{fact.subject}: </span>
            ) : null}
            {fact.fact}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-stone-600">
            <span>
              {fact.knownBy === "dm" ? "DM secret" : CATEGORY_LABELS[fact.category]}
            </span>
            {isLead ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ pinned: !fact.pinned })}
                  title={
                    fact.pinned
                      ? "Unpin"
                      : "Pin: always kept in front of the DM, never auto-replaced"
                  }
                  className="text-stone-500 hover:text-amber-300"
                >
                  {fact.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Edit"
                  className="text-stone-500 hover:text-stone-300"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ status: "retired" })}
                  title="Retire: the DM stops treating this as true"
                  className="text-stone-500 hover:text-red-400"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ) : null}
          </div>
        </>
      )}
    </li>
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
    <div className="rounded-lg border border-dashed border-stone-800 p-2.5">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {FACT_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategory(value)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              category === value
                ? "border-amber-700 bg-amber-950/40 text-amber-200"
                : "border-stone-800 text-stone-500 hover:text-stone-300",
            )}
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
        className="mb-1.5 w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600"
      />
      <textarea
        value={fact}
        onChange={(event) => setFact(event.target.value)}
        rows={2}
        maxLength={300}
        placeholder="One sentence the DM must never contradict"
        className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
      />
      {error ? <p className="mt-1 text-[10px] text-red-400">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !fact.trim()}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-[11px] text-stone-400 hover:bg-stone-900 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <BookMarked className="size-3" />}
        Pin fact
      </button>
    </div>
  );
}

export function FactsPanel({
  campaignId,
  facts,
  isLead,
  refreshFacts,
}: {
  campaignId: string;
  facts: WorldFact[];
  isLead: boolean;
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
  const section = "px-1 text-[10px] font-medium uppercase tracking-wide text-stone-500";

  return (
    <div className="space-y-3">
      {isLead ? <FactComposer campaignId={campaignId} refresh={refresh} /> : null}

      {pinned.length ? (
        <div className="space-y-1.5">
          <h3 className={cn(section, "text-amber-400")}>Pinned</h3>
          <ul className="space-y-1.5">
            {pinned.map((fact) => (
              <FactCard
                key={fact.id}
                campaignId={campaignId}
                fact={fact}
                isLead={isLead}
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
            <h3 className={section}>{CATEGORY_LABELS[category]}</h3>
            <ul className="space-y-1.5">
              {entries.map((fact) => (
                <FactCard
                  key={fact.id}
                  campaignId={campaignId}
                  fact={fact}
                  isLead={isLead}
                  refresh={refresh}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {!facts.length ? (
        <p className="px-1 text-[11px] text-stone-600">
          Nothing recorded yet. The DM writes durable facts here as chapters close
          {isLead ? ", or pin one yourself above" : ""}.
        </p>
      ) : null}

      {isLead ? (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={toggleSecrets}
            className="flex items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-wide text-stone-500 hover:text-amber-300"
          >
            {secrets ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {secrets ? "Hide DM secrets" : "Show DM secrets (spoilers)"}
          </button>
          {secrets ? (
            secrets.length ? (
              <ul className="space-y-1.5">
                {secrets.map((fact) => (
                  <FactCard
                    key={fact.id}
                    campaignId={campaignId}
                    fact={fact}
                    isLead={isLead}
                    refresh={refresh}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-1 text-[11px] text-stone-600">No DM secrets recorded.</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
