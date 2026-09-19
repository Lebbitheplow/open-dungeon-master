"use client";

import { Check, CircleHelp, Plus, X } from "lucide-react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { UserAvatar, ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import { GameIcon } from "@/components/ui/GameIcon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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

// datetime-local wants local wall-clock time; toISOString would shift it by
// the timezone offset, so the parts are assembled by hand.
function toLocalInput(startsAt: string): string {
  const date = new Date(startsAt);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const DURATION_CHOICES = [60, 120, 180, 240];

// The part of the day a session falls in, as the painted glyph that heads its
// row, so "Saturday evening" reads at a glance before the numbers do.
function daypartOf(startsAt: string): string {
  const hour = new Date(startsAt).getHours();
  if (hour < 5) return "night";
  if (hour < 8) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 17) return "day";
  // The evening painting is near black at this size, so the dusk one stands
  // for the whole stretch from late afternoon to bedtime.
  if (hour < 22) return "dusk";
  return "night";
}

// One press sets the hour on the chosen day (tomorrow when none is chosen
// yet); the field beside them still takes any date and time by hand.
const QUICK_TIMES = [
  { glyph: "morning", label: "Morning", hour: 10 },
  { glyph: "day", label: "Afternoon", hour: 14 },
  { glyph: "dusk", label: "Evening", hour: 19 },
  { glyph: "night", label: "Late", hour: 21 },
];

function withHour(current: string, hour: number): string {
  const base = current ? new Date(current) : new Date(Date.now() + 86_400_000);
  if (Number.isNaN(base.getTime())) {
    return current;
  }
  base.setHours(hour, 0, 0, 0);
  return toLocalInput(base.toISOString());
}

function QuickTimes({ value, onPick }: { value: string; onPick: (next: string) => void }) {
  const hour = value ? new Date(value).getHours() : -1;
  const onTheHour = value ? new Date(value).getMinutes() === 0 : false;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick times">
      {QUICK_TIMES.map((choice) => {
        const active = onTheHour && hour === choice.hour;
        return (
          <button
            key={choice.glyph}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(withHour(value, choice.hour))}
            className={cn(
              "motion-press inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs",
              active
                ? "border-amber-400/60 bg-amber-400/15 text-amber-100"
                : "border-stone-700/70 bg-stone-900/50 text-stone-400 hover:border-amber-500/40 hover:text-amber-100",
            )}
          >
            <GameIcon icon={{ kind: "glyph", key: `daypart-${choice.glyph}` }} size="size-6" />
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow mb-1 block text-[9px] text-stone-400">{children}</span>;
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
  avatars,
  version,
  className,
  style,
}: {
  campaignId: string;
  meUserId: string;
  isLead: boolean;
  usernames: Record<string, string>;
  // Faces for the RSVP stacks. Optional: without one a player shows as the
  // sigil their id hashes to, the same as everywhere else.
  avatars?: Record<string, string | null | undefined>;
  version: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [planning, setPlanning] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(180);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The session being rescheduled, with its own form state so moving one
  // never disturbs the plan form above.
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveWhen, setMoveWhen] = useState("");
  const [moveError, setMoveError] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);

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
          durationMin: duration,
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
      setDuration(180);
      setNote("");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function move(event: React.FormEvent) {
    event.preventDefault();
    if (!movingId || !moveWhen) {
      setMoveError("Pick a new date and time.");
      return;
    }
    setMoveBusy(true);
    setMoveError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/schedule/${movingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsAt: new Date(moveWhen).toISOString() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMoveError(data.error || "Could not move the session.");
        return;
      }
      setMovingId(null);
      setMoveWhen("");
      await load();
    } catch {
      setMoveError("Could not reach the server.");
    } finally {
      setMoveBusy(false);
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
    if (!await appConfirm("Call this session off? Everyone gets told.")) {
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
    <section
      data-lobby-schedule
      className={cn(ui.card, "ornate mb-6 p-4 sm:p-5", className)}
      style={style}
    >
      <div className="lobby-head mb-3">
        <GameIcon icon={{ kind: "glyph", key: "tab-session" }} size="size-7" />
        <h2 className="lobby-head-title">Next session</h2>
        <span className="lobby-head-rule motion-rule" aria-hidden="true" />
        {isLead ? (
          <button
            type="button"
            onClick={() => setPlanning(!planning)}
            aria-expanded={planning}
            className={cn(ui.btnSmall, planning && "border-amber-500/40 text-amber-100")}
          >
            <Plus
              className={cn("size-4 transition-transform duration-300 ease-[var(--ease-spring)]", planning && "rotate-45")}
            />{" "}
            Plan a session
          </button>
        ) : null}
      </div>

      {planning ? (
        <form
          onSubmit={plan}
          className="motion-tab mb-4 space-y-3 rounded-xl border border-stone-700/60 bg-stone-950/40 p-3"
        >
          <label className="block">
            <FieldLabel>When</FieldLabel>
            {/* No native "required" here: plan() already refuses an empty time. */}
            <DateTimePicker value={when} onChange={setWhen} label="When" placeholder="Pick a date and time" className="w-full" />
          </label>
          <QuickTimes value={when} onPick={setWhen} />
          <div>
            <FieldLabel>How long</FieldLabel>
            <SegmentedControl
              size="sm"
              label="How long the session runs"
              className="w-full"
              options={DURATION_CHOICES.map((minutes) => ({
                value: String(minutes),
                label: `${minutes / 60} hour${minutes === 60 ? "" : "s"}`,
              }))}
              value={String(duration)}
              onChange={(next) => setDuration(Number(next))}
            />
          </div>
          <label className="block">
            <FieldLabel>Title</FieldLabel>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title (optional)"
              maxLength={120}
              className={ui.input}
            />
          </label>
          <label className="block">
            <FieldLabel>Note</FieldLabel>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note, e.g. we pick up at the bridge (optional)"
              maxLength={500}
              className={ui.input}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "h-9")}>
              Schedule
            </button>
            {error ? <p className="motion-shake text-sm text-red-400">{error}</p> : null}
          </div>
        </form>
      ) : null}

      {sessions.length === 0 ? (
        <EmptyState
          art="board"
          size="sm"
          title="Nothing planned yet."
          hint="Plan a session and everyone at the table is asked whether they can make it."
        />
      ) : (
        <ul className="stagger space-y-2.5">
          {sessions.map((session, index) => {
            const mine = session.rsvps.find((entry) => entry.userId === meUserId)?.response;
            const starts = new Date(session.startsAt);
            const going = (response: RsvpResponse) =>
              session.rsvps.filter((entry) => entry.response === response);
            const names = (response: RsvpResponse) =>
              going(response)
                .map((entry) => usernames[entry.userId] ?? "someone")
                .join(", ");
            return (
              <li
                key={session.id}
                style={{ "--i": Math.min(index, 6) } as CSSProperties}
                className={cn(
                  "lobby-seat rounded-xl border border-stone-700/60 bg-stone-900/50 p-3",
                  session.cancelledAt && "opacity-60",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="lobby-date" aria-hidden="true">
                    <span className="lobby-date-month">
                      {starts.toLocaleString(undefined, { month: "short" })}
                    </span>
                    <span className="lobby-date-day">{starts.getDate()}</span>
                    <span className="lobby-date-dow">
                      {starts.toLocaleString(undefined, { weekday: "short" })}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-amber-100">
                      <GameIcon
                        icon={{ kind: "glyph", key: `daypart-${daypartOf(session.startsAt)}` }}
                        size="size-6"
                      />
                      <span>{whenLabel(session.startsAt)}</span>
                      {session.cancelledAt ? <span className="text-red-400">cancelled</span> : null}
                    </p>
                    <p className="mt-0.5 font-serif text-sm text-stone-300">
                      {session.title || `${Math.round(session.durationMin / 60)}h session`}
                    </p>
                    {session.note ? (
                      <p className="reveal mt-0.5 text-xs text-stone-500">{session.note}</p>
                    ) : null}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                      {RSVP_CHOICES.map((choice) => {
                        const entries = going(choice.value);
                        return entries.length > 0 ? (
                          <span
                            key={choice.value}
                            title={names(choice.value)}
                            className="inline-flex items-center gap-1.5"
                          >
                            <span className="lobby-stack">
                              {entries.slice(0, 5).map((entry) => (
                                <UserAvatar
                                  key={entry.userId}
                                  url={avatars?.[entry.userId]}
                                  userId={entry.userId}
                                  size="size-5"
                                />
                              ))}
                            </span>
                            {choice.label} {entries.length}
                          </span>
                        ) : null;
                      })}
                    </p>
                  </div>
                </div>
                {!session.cancelledAt ? (
                  <div data-pill-group="" className="reveal mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-stone-700/40 pt-2.5">
                    {RSVP_CHOICES.map((choice) => (
                      <button data-on={mine === choice.value ? "" : undefined}
                        key={choice.value}
                        type="button"
                        onClick={() => void rsvp(session.id, choice.value)}
                        aria-pressed={mine === choice.value}
                        className={cn(
                          ui.btnSmall,
                          mine === choice.value &&
                            "border-amber-400/60 bg-amber-400/15 text-amber-100 shadow-glow-gold",
                        )}
                        title={choice.label}
                      >
                        <choice.icon
                          key={mine === choice.value ? "on" : "off"}
                          className={cn("size-4", mine === choice.value && "lobby-pop")}
                        />
                        <span>{choice.label}</span>
                      </button>
                    ))}
                    {isLead ? (
                      <span className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setMovingId(movingId === session.id ? null : session.id);
                            setMoveWhen(toLocalInput(session.startsAt));
                            setMoveError("");
                          }}
                          aria-expanded={movingId === session.id}
                          className="rounded-md px-2 py-1.5 text-xs text-stone-500 transition-colors hover:text-amber-300"
                        >
                          Move
                        </button>
                        <button
                          type="button"
                          onClick={() => void cancel(session.id)}
                          className="rounded-md px-2 py-1.5 text-xs text-stone-500 transition-colors hover:text-red-400"
                        >
                          Call off
                        </button>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {movingId === session.id && !session.cancelledAt ? (
                  <form onSubmit={move} className="motion-tab mt-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <DateTimePicker value={moveWhen} onChange={setMoveWhen} label="New date and time" placeholder="Pick a date and time" className="w-auto min-w-0 flex-1" />
                      <button type="submit" disabled={moveBusy} className={ui.btnSmall}>
                        Move it
                      </button>
                    </div>
                    <QuickTimes value={moveWhen} onPick={setMoveWhen} />
                    {moveError ? <p className="motion-shake text-sm text-red-400">{moveError}</p> : null}
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
