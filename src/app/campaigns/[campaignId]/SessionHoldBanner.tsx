"use client";

import { useEffect, useState } from "react";
import { ScheduleSection } from "@/components/ScheduleSection";
import { Dialog } from "@/components/ui/Dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import {
  nextSessionWords,
  pickNextSession,
  sessionWhenLocal,
  type NextSession,
  type SessionHold,
} from "@/lib/dm/session-hold-logic";
import type { ScheduledSession } from "@/lib/db/scheduling";

// End the session or start the next (issue 586): the header carries it from
// sm up, the phone's table menu below. Only whoever steers the story or the
// party lead is handed one (src/lib/dm/session-hold-logic.ts).
export type SessionControl = {
  // Between sessions: the button starts the next one.
  held: boolean;
  // The session it would start.
  next: number;
  onEnd: () => void;
  onStart: () => void;
};

// Between sessions, shown to every seat (src/lib/dm/session-hold.ts). It
// floats under the header, as a break's banner does, so a phone on the
// party or map tab sees it too, and it carries what the table needs until
// it meets again: when that is, the RSVP (the lobby's schedule, which the
// table had no way back to once play began), and for whoever may, Start.
// The story, the sheets and table talk stay open underneath.
export function SessionHoldBanner({
  hold,
  campaignId,
  meUserId,
  isLead,
  members,
  scheduleVersion,
  mayStart,
  onStart,
}: {
  hold: SessionHold | null;
  campaignId: string;
  meUserId: string;
  isLead: boolean;
  members: Array<{ userId: string; username: string; avatar?: { url?: string } | null }>;
  scheduleVersion: number;
  mayStart: boolean;
  onStart: () => Promise<void>;
}) {
  const [top, setTop] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [next, setNext] = useState<NextSession | null | undefined>(undefined);
  const held = hold !== null;
  // Under the session header, whatever its height (TableBreakBanner.tsx).
  useEffect(() => {
    if (!held) {
      return;
    }
    const header = document.querySelector<HTMLElement>(".session-header");
    if (!header) {
      return;
    }
    const place = () => setTop(Math.round(header.getBoundingClientRect().bottom) + 6);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(header);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [held]);
  // The next meeting, read again whenever the schedule changes.
  useEffect(() => {
    if (!held) {
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/schedule`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { sessions?: ScheduledSession[] } | null) => {
        if (!cancelled) setNext(pickNextSession(data?.sessions ?? [], Date.now()));
      })
      .catch(() => {
        if (!cancelled) setNext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [held, campaignId, scheduleVersion]);
  if (!hold) {
    return null;
  }
  async function start() {
    setBusy(true);
    try {
      await onStart();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-[calc(4.25rem+env(safe-area-inset-top))] z-[51] flex justify-center px-3"
        style={top === null ? undefined : { top }}
      >
        <SessionBanner
          glyph="rest-long"
          title={`Session ${hold.number} is over`}
          className="session-hold-banner pointer-events-auto w-full max-w-xl shadow-elev-2"
          actions={
            <>
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className={bannerButtonClass(!mayStart)}
                data-session-schedule=""
              >
                Next session
              </button>
              {mayStart ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void start()}
                  className={bannerButtonClass(true)}
                  data-session-start=""
                >
                  Start session {hold.number + 1}
                </button>
              ) : null}
            </>
          }
        >
          <span role="status" className="block text-sm text-stone-300" data-session-next="">
            {next === undefined ? " " : nextSessionWords(next, next ? sessionWhenLocal(next.startsAt) : "")}
          </span>
          <span className="block text-xs text-stone-400">
            The story waits where it stopped. Sheets, the chronicle and OOC table talk stay open.
          </span>
        </SessionBanner>
      </div>
      <Dialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        title="The schedule"
        icon={<GameIcon icon={{ kind: "glyph", key: "tab-session" }} size="size-6" />}
      >
        <ScheduleSection
          campaignId={campaignId}
          meUserId={meUserId}
          isLead={isLead}
          usernames={Object.fromEntries(members.map((member) => [member.userId, member.username]))}
          avatars={Object.fromEntries(members.map((member) => [member.userId, member.avatar?.url]))}
          version={scheduleVersion}
        />
      </Dialog>
    </>
  );
}
