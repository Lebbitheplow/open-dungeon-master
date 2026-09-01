"use client";

import { CalendarClock, Check, CircleHelp, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { RsvpResponse, ScheduledSession } from "@/lib/db/scheduling";

// The out-of-game calendar: when the humans meet next. Lives in the lobby
// beside the party list. The lead plans and cancels; everyone RSVPs. The
// schedule_updated stream nudge bumps `version` and this refetches.

function whenLabel(startsAt: string): string {
  return new Date(startsAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RSVP_CHOICES: Array<{ value: RsvpResponse; label: string; icon: typeof Check }> = [
  { value: "yes", label: "Going", icon: Check },
  { value: "maybe", label: "Maybe", icon: CircleHelp },
  { value: "no", label: "Out", icon: X },
];

export function ScheduleSection({
  campaignId,
  meUserId,
  isLead,
  usernames,
  version,
}: {
  campaignId: string;
  meUserId: string;
  isLead: boolean;
  usernames: Record<string, string>;
  version: number;
}) {
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [planning, setPlanning] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/schedule`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions ?? []);
      }
    } catch {
      // Transient; the next nudge or visit retries.
    }
  }, [campaignId]);

  useEffect(() => {
    // Deferred a tick: load sets state, and state changes must not launch
    // synchronously from an effect body.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, version]);

  async function plan(event: React.FormEvent) {
    event.preventDefault();
    if (!when) {
      setError("Pick a date and time.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          startsAt: new Date(when).toISOString(),
          note: note.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not plan the session.");
        return;
      }
      setPlanning(false);
      setTitle("");
      setWhen("");
      setNote("");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function rsvp(sessionId: string, response: RsvpResponse) {
    await fetch(`/api/campaigns/${campaignId}/schedule/${sessionId}/rsvp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    }).catch(() => undefined);
    await load();
  }

  async function cancel(sessionId: string) {
    if (!window.confirm("Call this session off? Everyone gets told.")) {
      return;
    }
    await fetch(`/api/campaigns/${campaignId}/schedule/${sessionId}`, {
      method: "DELETE",
    }).catch(() => undefined);
    await load();
  }

  if (sessions.length === 0 && !isLead) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="eyebrow text-sm text-amber-200/90">
          <CalendarClock className="mr-1.5 inline size-4" />
          Next session
        </h2>
        {isLead ? (
          <button type="button" onClick={() => setPlanning(!planning)} className={ui.btnSmall}>
            <Plus className="size-4" /> Plan a session
          </button>
        ) : null}
      </div>

      {planning ? (
        <form
          onSubmit={plan}
          className="mb-3 space-y-2 rounded-xl border border-stone-800 bg-stone-900/60 p-3"
        >
          <div className="flex flex-wrap gap-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              className={cn(ui.input, "w-auto")}
              required
            />
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title (optional)"
              maxLength={120}
              className={cn(ui.input, "flex-1")}
            />
          </div>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note, e.g. we pick up at the bridge (optional)"
            maxLength={500}
            className={ui.input}
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className={ui.btnSmall}>
              Schedule
            </button>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </div>
        </form>
      ) : null}

      {sessions.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing planned yet.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => {
            const mine = session.rsvps.find((entry) => entry.userId === meUserId)?.response;
            const names = (response: RsvpResponse) =>
              session.rsvps
                .filter((entry) => entry.response === response)
                .map((entry) => usernames[entry.userId] ?? "someone")
                .join(", ");
            return (
              <li
                key={session.id}
                className={cn(
                  "rounded-xl border border-stone-800 bg-stone-900/60 p-3",
                  session.cancelledAt && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-amber-100">
                      {whenLabel(session.startsAt)}
                      <span className="ml-2 text-stone-400">
                        {session.title || `${Math.round(session.durationMin / 60)}h session`}
                      </span>
                      {session.cancelledAt ? (
                        <span className="ml-2 text-red-400">cancelled</span>
                      ) : null}
                    </p>
                    {session.note ? (
                      <p className="text-xs text-stone-500">{session.note}</p>
                    ) : null}
                    <p className="text-xs text-stone-500">
                      {RSVP_CHOICES.map((choice) => {
                        const count = session.rsvps.filter(
                          (entry) => entry.response === choice.value,
                        ).length;
                        return count > 0 ? (
                          <span
                            key={choice.value}
                            title={names(choice.value)}
                            className="mr-3"
                          >
                            {choice.label} {count}
                          </span>
                        ) : null;
                      })}
                    </p>
                  </div>
                  {!session.cancelledAt ? (
                    <div className="flex items-center gap-1">
                      {RSVP_CHOICES.map((choice) => (
                        <button
                          key={choice.value}
                          type="button"
                          onClick={() => void rsvp(session.id, choice.value)}
                          className={cn(
                            ui.btnSmall,
                            mine === choice.value && "border-amber-400/60 text-amber-200",
                          )}
                          title={choice.label}
                        >
                          <choice.icon className="size-4" />
                          <span className="hidden sm:inline">{choice.label}</span>
                        </button>
                      ))}
                      {isLead ? (
                        <button
                          type="button"
                          onClick={() => void cancel(session.id)}
                          className="ml-1 text-xs text-stone-500 transition-colors hover:text-red-400"
                        >
                          Call off
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
