"use client";

import { CalendarDays, Loader2, Moon, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { CalendarDefinition, CampaignClock } from "@/lib/dm/calendar";

// The Calendar section of the Rules panel (docs/vtt-parity-implementation-plan.md
// 7.1 and 7.2): the year's months, the week's days, the sky's moons and the
// year's festivals, picked from a preset and then edited by hand; below
// them, the events the clock will bring round.

type Preset = { id: string; name: string };
type EventView = { id: string; title: string; body: string; when: string; visibility: "party" | "dm"; repeat: "none" | "yearly" | "monthly"; fired: boolean };
type EventDraft = { title: string; body: string; month: number; day: number; hour: number; visibility: "party" | "dm"; repeat: "none" | "yearly" | "monthly" };

const field = "rounded border border-stone-700 bg-stone-900 px-1.5 py-0.5 text-[11px] text-stone-200 outline-none focus:border-amber-600";
const small = "flex items-center gap-1 rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-stone-200";

function blankEvent(): EventDraft {
  return { title: "", body: "", month: 1, day: 1, hour: 8, visibility: "party", repeat: "none" };
}

export function CalendarSection({ campaignId }: { campaignId: string }) {
  const [clock, setClock] = useState<CampaignClock | null>(null);
  const [reads, setReads] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<CalendarDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState<EventView[]>([]);
  const [eventDraft, setEventDraft] = useState<EventDraft>(blankEvent());
  const [addingEvent, setAddingEvent] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/campaigns/${campaignId}/dm/clock`).then((response) => (response.ok ? response.json() : {})),
      fetch(`/api/campaigns/${campaignId}/calendar/events`).then((response) => (response.ok ? response.json() : {})),
    ])
      .then(([clockData, eventData]: [{ clock?: CampaignClock; reads?: string; presets?: Preset[] }, { events?: EventView[] }]) => {
        if (cancelled) {
          return;
        }
        setClock(clockData.clock ?? null);
        setReads(clockData.reads ?? "");
        setPresets(clockData.presets ?? []);
        setDraft(clockData.clock ? { ...clockData.clock.calendar, moons: clockData.clock.calendar.moons ?? [], festivals: clockData.clock.calendar.festivals ?? [] } : null);
        setEvents(eventData.events ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload]);

  async function applyPreset(preset: string) {
    setSaving(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/dm/clock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ do: "calendar", preset }) });
      setReload((current) => current + 1);
    } finally {
      setSaving(false);
    }
  }

  async function saveDefinition() {
    if (!draft || !draft.months.length) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ do: "calendar", definition: { ...draft, id: "custom", name: draft.name || "Custom" } }),
      });
      if (response.ok) {
        setReload((current) => current + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  async function addEvent() {
    if (!eventDraft.title.trim()) {
      return;
    }
    setAddingEvent(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/calendar/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventDraft),
      });
      if (response.ok) {
        setEventDraft(blankEvent());
        setReload((current) => current + 1);
      }
    } finally {
      setAddingEvent(false);
    }
  }

  async function removeEvent(id: string) {
    await fetch(`/api/campaigns/${campaignId}/calendar/events/${id}`, { method: "DELETE" });
    setReload((current) => current + 1);
  }

  if (!clock || !draft) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-stone-500">
        <Loader2 className="size-3 animate-spin" /> Reading the almanac...
      </p>
    );
  }
  const moons = draft.moons ?? [];
  const festivals = draft.festivals ?? [];
  const update = (patch: Partial<CalendarDefinition>) => setDraft({ ...draft, ...patch });

  return (
    <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
        <CalendarDays className="size-3.5 text-amber-600" /> Calendar
      </p>
      <p className="text-[11px] text-stone-500">Now: {reads}</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">Start from</span>
        {presets.map((preset) => (
          <button key={preset.id} type="button" disabled={saving} onClick={() => void applyPreset(preset.id)} className={cn(small, clock.calendar.id === preset.id && "border-amber-700 text-amber-200")}>
            {preset.name}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-[11px] text-stone-400">
        Name
        <input value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={60} className={cn(field, "flex-1")} />
        <span className="text-stone-500">Year suffix</span>
        <input value={draft.yearSuffix} onChange={(event) => update({ yearSuffix: event.target.value })} maxLength={20} className={cn(field, "w-16")} />
      </label>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-stone-500">Months</p>
        {draft.months.map((month, index) => (
          <div key={index} className="flex items-center gap-1">
            <input value={month.name} onChange={(event) => update({ months: draft.months.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} maxLength={40} className={cn(field, "flex-1")} />
            <input type="number" min={1} max={400} value={month.days} onChange={(event) => update({ months: draft.months.map((entry, at) => (at === index ? { ...entry, days: Number(event.target.value) || 1 } : entry)) })} className={cn(field, "w-14")} />
            <button type="button" aria-label="Remove month" disabled={draft.months.length <= 1} onClick={() => update({ months: draft.months.filter((_, at) => at !== index) })} className="rounded p-0.5 text-stone-600 hover:text-red-300 disabled:opacity-30">
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
        {draft.months.length < 24 ? (
          <button type="button" onClick={() => update({ months: [...draft.months, { name: `Month ${draft.months.length + 1}`, days: 30 }] })} className={small}>
            <Plus className="size-3" /> Month
          </button>
        ) : null}
      </div>
      <label className="block text-[11px] text-stone-400">
        Weekdays, comma separated
        <input value={draft.weekdays.join(", ")} onChange={(event) => update({ weekdays: event.target.value.split(",").map((day) => day.trim()).filter(Boolean).slice(0, 12) })} className={cn(field, "mt-0.5 w-full")} />
      </label>
      <div className="space-y-1">
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-stone-500">
          <Moon className="size-3" /> Moons
        </p>
        {moons.map((moon, index) => (
          <div key={index} className="flex items-center gap-1">
            <input value={moon.name} placeholder="Name" onChange={(event) => update({ moons: moons.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} maxLength={40} className={cn(field, "flex-1")} />
            <input type="number" min={2} max={400} value={moon.cycleDays} title="Cycle in days" onChange={(event) => update({ moons: moons.map((entry, at) => (at === index ? { ...entry, cycleDays: Number(event.target.value) || 28 } : entry)) })} className={cn(field, "w-14")} />
            <input type="number" min={0} max={400} value={moon.offset} title="Days into the cycle on day one" onChange={(event) => update({ moons: moons.map((entry, at) => (at === index ? { ...entry, offset: Number(event.target.value) || 0 } : entry)) })} className={cn(field, "w-14")} />
            <button type="button" aria-label="Remove moon" onClick={() => update({ moons: moons.filter((_, at) => at !== index) })} className="rounded p-0.5 text-stone-600 hover:text-red-300">
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
        {moons.length < 6 ? (
          <button type="button" onClick={() => update({ moons: [...moons, { name: "Moon", cycleDays: 28, offset: 0 }] })} className={small}>
            <Plus className="size-3" /> Moon
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-stone-500">Festivals</p>
        {festivals.map((festival, index) => (
          <div key={index} className="flex items-center gap-1">
            <select value={festival.month} onChange={(event) => update({ festivals: festivals.map((entry, at) => (at === index ? { ...entry, month: Number(event.target.value) } : entry)) })} className={cn(field, "w-24")}>
              {draft.months.map((month, at) => (
                <option key={at} value={at + 1}>
                  {month.name}
                </option>
              ))}
            </select>
            <input type="number" min={1} max={400} value={festival.day} onChange={(event) => update({ festivals: festivals.map((entry, at) => (at === index ? { ...entry, day: Number(event.target.value) || 1 } : entry)) })} className={cn(field, "w-12")} />
            <input value={festival.name} placeholder="Name" onChange={(event) => update({ festivals: festivals.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} maxLength={60} className={cn(field, "flex-1")} />
            <button type="button" aria-label="Remove festival" onClick={() => update({ festivals: festivals.filter((_, at) => at !== index) })} className="rounded p-0.5 text-stone-600 hover:text-red-300">
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
        {festivals.length < 40 ? (
          <button type="button" onClick={() => update({ festivals: [...festivals, { month: 1, day: 1, name: "" }] })} className={small}>
            <Plus className="size-3" /> Festival
          </button>
        ) : null}
      </div>
      <button type="button" disabled={saving} onClick={() => void saveDefinition()} className="flex items-center gap-1 rounded border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[11px] text-amber-100 disabled:opacity-50">
        {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save calendar
      </button>

      <div className="space-y-1 border-t border-stone-800 pt-2">
        <p className="text-[10px] uppercase tracking-wide text-stone-500">Events</p>
        {events.length ? (
          <ul className="space-y-1">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-1 text-[11px]">
                <span className="min-w-0 flex-1">
                  <span className={cn("font-medium", event.fired ? "text-stone-500 line-through" : "text-stone-200")}>{event.title}</span>
                  <span className="text-stone-500"> {event.when}</span>
                  {event.repeat !== "none" ? <span className="ml-1 rounded border border-stone-700 px-1 text-[9px] text-stone-400">{event.repeat}</span> : null}
                  {event.visibility === "dm" ? <span className="ml-1 rounded border border-violet-900/60 px-1 text-[9px] text-violet-300">DM only</span> : null}
                </span>
                <button type="button" aria-label={`Remove ${event.title}`} onClick={() => void removeEvent(event.id)} className="rounded p-0.5 text-stone-600 hover:text-red-300">
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] italic text-stone-600">Nothing on the calendar yet.</p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <input value={eventDraft.title} placeholder="What happens" onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} maxLength={120} className={cn(field, "min-w-0 flex-1")} />
          <select value={eventDraft.month} onChange={(event) => setEventDraft({ ...eventDraft, month: Number(event.target.value) })} className={cn(field, "w-24")}>
            {draft.months.map((month, at) => (
              <option key={at} value={at + 1}>
                {month.name}
              </option>
            ))}
          </select>
          <input type="number" min={1} max={400} value={eventDraft.day} onChange={(event) => setEventDraft({ ...eventDraft, day: Number(event.target.value) || 1 })} className={cn(field, "w-12")} />
          <select value={eventDraft.repeat} onChange={(event) => setEventDraft({ ...eventDraft, repeat: event.target.value as EventDraft["repeat"] })} className={cn(field, "w-20")}>
            <option value="none">once</option>
            <option value="monthly">monthly</option>
            <option value="yearly">yearly</option>
          </select>
          <select value={eventDraft.visibility} onChange={(event) => setEventDraft({ ...eventDraft, visibility: event.target.value as EventDraft["visibility"] })} className={cn(field, "w-20")}>
            <option value="party">party</option>
            <option value="dm">DM only</option>
          </select>
          <button type="button" disabled={addingEvent || !eventDraft.title.trim()} onClick={() => void addEvent()} className={cn(small, "disabled:opacity-50")}>
            <Plus className="size-3" /> Add
          </button>
        </div>
        <textarea value={eventDraft.body} placeholder="What the table learns when it comes round" rows={2} maxLength={600} onChange={(event) => setEventDraft({ ...eventDraft, body: event.target.value })} className={cn(field, "w-full")} />
      </div>
    </div>
  );
}
