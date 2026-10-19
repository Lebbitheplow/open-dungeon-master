"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { formatLeft, type TableWaitView } from "@/lib/dm/table-wait-logic";

// Wait for the table (src/lib/dm/table-wait.ts): who the DM is waiting on
// before its next turn, how long it will wait once someone has answered,
// and the Pass button for a player with nothing to add this beat.
export function TableWaitBanner({
  campaignId,
  wait,
  meUserId,
  steersStory = false,
  onGoOn,
}: {
  campaignId: string;
  wait: TableWaitView | null;
  meUserId: string;
  // Whoever steers the story may stop waiting and let the DM answer now.
  steersStory?: boolean;
  onGoOn?: () => void;
}) {
  const [passing, setPassing] = useState(false);
  const [refusal, setRefusal] = useState("");
  const now = useSecondClock(Boolean(wait?.deadline));
  if (!wait || (!wait.waitingOn.length && !wait.answered.length)) {
    return null;
  }
  const mine = wait.waitingOn.some((seat) => seat.userId === meUserId);
  const left = wait.deadline ? Math.max(0, Math.ceil((new Date(wait.deadline).getTime() - now) / 1000)) : null;

  async function pass() {
    setPassing(true);
    setRefusal("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pass`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setRefusal(data.error ?? "The pass did not go through.");
      }
    } catch {
      setRefusal("Could not reach the table.");
    } finally {
      setPassing(false);
    }
  }

  return (
    <SessionBanner
      glyph="tab-party"
      tone="quiet"
      title={wait.waitingOn.length ? "The DM is waiting on" : "Everyone has answered"}
      actions={
        mine || (steersStory && wait.deadline && onGoOn) ? (
          <>
            {mine ? (
              <button
                type="button"
                onClick={pass}
                disabled={passing}
                className={bannerButtonClass(true)}
                title="Nothing to add this beat: the DM stops waiting on you."
              >
                Pass
              </button>
            ) : null}
            {steersStory && wait.deadline && onGoOn ? (
              <button
                type="button"
                onClick={onGoOn}
                className={bannerButtonClass()}
                title="Stop waiting: the DM answers whoever has acted."
              >
                Go on now
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      <span data-table-wait="">
        {wait.waitingOn.map((seat, index) => (
          <span key={seat.userId}>
            {index > 0 ? ", " : ""}
            {seat.userId === meUserId ? "you" : seat.name}
          </span>
        ))}
        {wait.answered.map((seat, index) => (
          <span key={seat.userId} className="opacity-50">
            {index > 0 || wait.waitingOn.length ? ", " : ""}
            {seat.name}
            {seat.passed ? " (passed)" : <Check className="inline size-3 align-baseline" />}
          </span>
        ))}
        {left !== null ? (
          <span className="opacity-80"> · the DM goes on in {formatLeft(left)}</span>
        ) : (
          <span className="opacity-80"> · the DM answers once everyone has acted or passed</span>
        )}
      </span>
      {refusal ? (
        <span key={refusal} role="alert" className="mt-0.5 block animate-fade-up text-xs text-amber-200">
          {refusal}
        </span>
      ) : null}
    </SessionBanner>
  );
}

// A clock that ticks once a second only while there is a deadline to count.
function useSecondClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}
