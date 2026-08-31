"use client";

import { useState } from "react";
import { Loader2, LogOut, Skull } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  coverActive,
  describeCover,
  MAX_COVER_TURNS,
  type DmCover,
} from "@/lib/dm/delegation";

// The two delegations the DM triggers by hand: handing the monsters their
// turn, and handing the whole table over for a counted stretch while they step
// away.
//
// Both are buttons rather than background behaviour, and that is the design.
// In this mode the person is the author; the AI does what it is asked to do,
// when it is asked, and says so in the transcript afterwards.

function MonsterButton({ campaignId }: { campaignId: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function run() {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/monsters`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(data.error || "The monsters could not act.");
        return;
      }
      const notes = Array.isArray(data.notes) ? (data.notes as string[]) : [];
      // The full account is already a table note in the transcript, which is
      // where a DM will actually read it; this is only the receipt.
      setNotice(
        notes.length
          ? `${notes.length} ${notes.length === 1 ? "monster" : "monsters"} acted. See the log.`
          : "Nothing to do.",
      );
    } catch {
      setNotice("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Every living enemy takes one action, chosen by the AI and resolved by the rules engine. It does not move the initiative pointer; that stays yours."
        className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Skull className="size-3.5" />}
        Take the monsters&apos; turn
      </button>
      {notice ? <p className="mt-1 text-[11px] text-stone-500">{notice}</p> : null}
    </div>
  );
}

function CoverControl({ campaignId, cover }: { campaignId: string; cover: DmCover | null }) {
  const [turns, setTurns] = useState(5);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = coverActive(cover);

  async function set(nextTurns: number) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: nextTurns, brief }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not hand it over.");
        return;
      }
      if (nextTurns === 0) {
        setBrief("");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {running ? (
        <>
          <p className="text-xs text-amber-200">{describeCover(cover)}</p>
          <button
            type="button"
            onClick={() => set(0)}
            disabled={busy}
            className="rounded-md border border-amber-700 bg-amber-950/50 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-900/50 disabled:opacity-40"
          >
            {busy ? "Taking it back..." : "I am back"}
          </button>
        </>
      ) : (
        <>
          <input
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="They are haggling in the market; keep it light and do not let them leave town."
            className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={turns}
              onChange={(event) => setTurns(Number(event.target.value))}
              className="rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300 focus:border-amber-700 focus:outline-none"
            >
              {[1, 3, 5, 10, MAX_COVER_TURNS].map((count) => (
                <option key={count} value={count}>
                  {count === 1 ? "1 answer" : `${count} answers`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => set(turns)}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40",
                "border-stone-700 text-stone-300 hover:bg-stone-900",
              )}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
              Step away
            </button>
          </div>
          {cover && cover.turnsLeft <= 0 ? (
            <p className="text-[11px] text-stone-500">
              The AI answered the last stretch you handed over.
            </p>
          ) : null}
        </>
      )}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

export function DmDelegationPanel({
  campaignId,
  cover,
  canMonsters,
  canCover,
}: {
  campaignId: string;
  cover: DmCover | null;
  canMonsters: boolean;
  canCover: boolean;
}) {
  if (!canMonsters && !canCover) {
    return null;
  }
  return (
    <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Hand it over</p>
      {canMonsters ? <MonsterButton campaignId={campaignId} /> : null}
      {canCover ? <CoverControl campaignId={campaignId} cover={cover} /> : null}
    </section>
  );
}

// The table's view of the same thing. Every seat sees it, not just the DM:
// a player owed an answer is owed the knowledge that the person answering
// them stepped out and the AI is standing in.
export function DmCoverNotice({ cover }: { cover: DmCover | null }) {
  if (!coverActive(cover)) {
    return null;
  }
  return (
    <p className="mb-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-200/90">
      {describeCover(cover)}
    </p>
  );
}
