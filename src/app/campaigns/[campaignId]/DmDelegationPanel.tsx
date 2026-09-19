"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { Select } from "@/components/ui/Select";
import { DeskCard } from "@/app/campaigns/[campaignId]/DmConsoleParts";
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
        disabled={busy} aria-busy={busy}
        title="Every living enemy takes one action, chosen by the AI and resolved by the rules engine. It does not move the initiative pointer; that stays yours."
        className={cn(ui.btnSmall, "min-h-10 w-full text-left text-sm")}
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <GameIcon icon={{ kind: "glyph", key: "system-bestiary" }} size="size-6" />}
        Take the monsters&apos; turn
      </button>
      {notice ? <p className="live-in mt-1 text-[11px] text-stone-400">{notice}</p> : null}
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
          <p className="live-in flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-100">
            <GameIcon icon={{ kind: "glyph", key: "tab-dm" }} size="size-5" className="shrink-0" />
            {describeCover(cover)}
          </p>
          <button
            type="button"
            onClick={() => set(0)}
            disabled={busy}
            aria-busy={busy}
            className={ui.btnPrimary}
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
            aria-label="Brief for the AI while you are away"
            className={ui.input}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              value={String(turns)}
              onChange={(next) => setTurns(Number(next))}
              options={[1, 3, 5, 10, MAX_COVER_TURNS].map((count) => ({
                value: String(count),
                label: count === 1 ? "1 answer" : `${count} answers`,
              }))}
              label="How many answers to hand over"
              size="sm"
              className="w-auto min-w-[8rem]"
            />
            <button
              type="button"
              onClick={() => set(turns)}
              disabled={busy}
              aria-busy={busy}
              className={ui.btnSecondary}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
              Step away
            </button>
          </div>
          {cover && cover.turnsLeft <= 0 ? (
            <p className="reveal text-[11px] text-stone-500">
              The AI answered the last stretch you handed over.
            </p>
          ) : null}
        </>
      )}
      {error ? <p className="motion-shake text-xs text-red-400">{error}</p> : null}
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
    <DeskCard glyph="tab-dm" title="Hand it over">
      <div className="space-y-2.5">
        {canMonsters ? <MonsterButton campaignId={campaignId} /> : null}
        {canCover ? <CoverControl campaignId={campaignId} cover={cover} /> : null}
      </div>
    </DeskCard>
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
    <p className="live-in mb-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-100">
      <GameIcon icon={{ kind: "glyph", key: "tab-dm" }} size="size-5" className="shrink-0" />
      {describeCover(cover)}
    </p>
  );
}
