"use client";

import { EmptyState } from "@/components/EmptyState";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { KitButton, PanelLoading, panelField } from "./PanelKit";
import type { CalendarDefinition, CampaignClock } from "@/lib/dm/calendar";

// The Calendar section of the Rules panel (docs/vtt-parity-implementation-plan.md
// 7.1 and 7.2): the year's months, the week's days, the sky's moons and the
// year's festivals, picked from a preset and then edited by hand; below
// them, the events the clock will bring round.

type Preset = { id: string; name: string };
type EventView = { id: string; title: string; body: string; when: string; visibility: "party" | "dm"; repeat: "none" | "yearly" | "monthly"; fired: boolean };
type EventDraft = { title: string; body: string; month: number; day: number; hour: number; visibility: "party" | "dm"; repeat: "none" | "yearly" | "monthly" };

const field = cn(panelField, "w-auto");
const REPEAT_OPTIONS: Array<{ value: EventDraft["repeat"]; label: string }> = [
  { value: "none", label: "once" },
  { value: "monthly", label: "monthly" },
  { value: "yearly", label: "yearly" },
];
const VISIBILITY_OPTIONS: Array<{ value: EventDraft["visibility"]; label: string }> = [
  { value: "party", label: "party" },
  { value: "dm", label: "DM only" },
];

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
    return <PanelLoading label="Reading the almanac..." rows={2} />;
  }
  const moons = draft.moons ?? [];
  const festivals = draft.festivals ?? [];
  const update = (patch: Partial<CalendarDefinition>) => setDraft({ ...draft, ...patch });
  const monthOptions = draft.months.map((month, at) => ({ value: String(at + 1), label: month.name }));

  return (
    <div className="panel space-y-3 rounded-lg p-3">
      <SectionHead title="Calendar" glyph="daypart-day" />
      <p className="flex items-center gap-1.5 text-xs text-stone-400">
        <GameIcon icon={{ kind: "glyph", key: "daypart-dawn" }} size="size-5" /> Now: {reads}
      </p>
      <div data-pill-group="" role="group" aria-label="Start from" className="flex flex-wrap items-center gap-1">
        <span className="eyebrow mr-1 text-[10px] text-amber-400/80">Start from</span>
        {presets.map((preset) => (
          <button key={preset.id} type="button" disabled={saving} aria-busy={saving} data-on={clock.calendar.id === preset.id ? "" : undefined} aria-pressed={clock.calendar.id === preset.id} onClick={() => void applyPreset(preset.id)} className="pk-pill pk-tap motion-press">
            {preset.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-stone-400">
        <label className="flex min-w-[9rem] flex-1 items-center gap-1.5">
          Name
          <input value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={60} className={cn(field, "min-w-0 flex-1")} />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-stone-500">Year suffix</span>
          <input value={draft.yearSuffix} onChange={(event) => update({ yearSuffix: event.target.value })} maxLength={20} className={cn(field, "w-20")} />
        </label>
      </div>
      <div className="space-y-1.5">
        <SectionHead title="Months" glyph="daypart-morning" level="h4" aside={draft.months.length} />
        {draft.months.map((month, index) => (
          <div key={index} className="group flex items-center gap-1.5">
            <input value={month.name} aria-label={`Month ${index + 1} name`} onChange={(event) => update({ months: draft.months.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} maxLength={40} className={cn(field, "min-w-0 flex-1")} />
            <NumberStepper size="sm" min={1} max={400} value={month.days} label={`Days in ${month.name || `month ${index + 1}`}`} onChange={(days) => update({ months: draft.months.map((entry, at) => (at === index ? { ...entry, days: days || 1 } : entry)) })} />
            <KitButton tone="iconDanger" always aria-label="Remove month" disabled={draft.months.length <= 1} onClick={() => update({ months: draft.months.filter((_, at) => at !== index) })} className="disabled:opacity-30">
              <Trash2 className="size-3.5" />
            </KitButton>
          </div>
        ))}
        {draft.months.length < 24 ? (
          <KitButton onClick={() => update({ months: [...draft.months, { name: `Month ${draft.months.length + 1}`, days: 30 }] })}>
            <Plus className="size-3.5" /> Month
          </KitButton>
        ) : null}
      </div>
      <label className="block text-xs text-stone-400">
        Weekdays, comma separated
        <input value={draft.weekdays.join(", ")} onChange={(event) => update({ weekdays: event.target.value.split(",").map((day) => day.trim()).filter(Boolean).slice(0, 12) })} className={cn(panelField, "mt-1")} />
      </label>
      <div className="space-y-1.5">
        <SectionHead title="Moons" glyph="daypart-night" level="h4" aside={moons.length || null} />
        {moons.map((moon, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <input value={moon.name} placeholder="Name" aria-label="Moon name" onChange={(event) => update({ moons: moons.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} maxLength={40} className={cn(field, "min-w-[7rem] flex-1")} />
            <span title="Cycle in days">
              <NumberStepper size="sm" min={2} max={400} value={moon.cycleDays} label="Cycle in days" onChange={(cycleDays) => update({ moons: moons.map((entry, at) => (at === index ? { ...entry, cycleDays: cycleDays || 28 } : entry)) })} />
            </span>
            <span title="Days into the cycle on day one">
              <NumberStepper size="sm" min={0} max={400} value={moon.offset} label="Days into the cycle on day one" onChange={(offset) => update({ moons: moons.map((entry, at) => (at === index ? { ...entry, offset: offset || 0 } : entry)) })} />
            </span>
            <KitButton tone="iconDanger" always aria-label="Remove moon" onClick={() => update({ moons: moons.filter((_, at) => at !== index) })}>
              <Trash2 className="size-3.5" />
            </KitButton>
          </div>
        ))}
        {moons.length < 6 ? (
          <KitButton onClick={() => update({ moons: [...moons, { name: "Moon", cycleDays: 28, offset: 0 }] })}>
            <Plus className="size-3.5" /> Moon
          </KitButton>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <SectionHead title="Festivals" glyph="cue-festive" level="h4" aside={festivals.length || null} />
        {festivals.map((festival, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <Select size="sm" label="Festival month" value={String(festival.month)} options={monthOptions} onChange={(value) => update({ festivals: festivals.map((entry, at) => (at === index ? { ...entry, month: Number(value) } : entry)) })} className="pk-w-28" />
            <NumberStepper size="sm" min={1} max={400} value={festival.day} label="Festival day" onChange={(day) => update({ festivals: festivals.map((entry, at) => (at === index ? { ...entry, day: day || 1 } : entry)) })} />
            <input value={festival.name} placeholder="Name" aria-label="Festival name" onChange={(event) => update({ festivals: festivals.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} maxLength={60} className={cn(field, "min-w-[7rem] flex-1")} />
            <KitButton tone="iconDanger" always aria-label="Remove festival" onClick={() => update({ festivals: festivals.filter((_, at) => at !== index) })}>
              <Trash2 className="size-3.5" />
            </KitButton>
          </div>
        ))}
        {festivals.length < 40 ? (
          <KitButton onClick={() => update({ festivals: [...festivals, { month: 1, day: 1, name: "" }] })}>
            <Plus className="size-3.5" /> Festival
          </KitButton>
        ) : null}
      </div>
      <KitButton tone="primary" disabled={saving} busy={saving} onClick={() => void saveDefinition()}>
        {saving ? null : <Save className="size-3.5" />} Save calendar
      </KitButton>

      <div className="space-y-1.5 pt-1">
        <SectionHead title="Events" glyph="tab-timeline" level="h4" aside={events.length || null} />
        {events.length ? (
          <ul className="stagger space-y-1">
            {events.map((event) => (
              <li key={event.id} className="group flex items-start gap-1.5 text-xs">
                <GameIcon icon={{ kind: "glyph", key: event.fired ? "quest-done" : "quest-active" }} size="size-5" className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1 leading-5">
                  <span className={cn("font-medium", event.fired ? "text-stone-500 line-through" : "text-stone-200")}>{event.title}</span>
                  <span className="text-stone-500"> {event.when}</span>
                  {event.repeat !== "none" ? <span className="pk-chip ml-1 px-1.5">{event.repeat}</span> : null}
                  {event.visibility === "dm" ? <span className="pk-chip ml-1 border-violet-500/40 px-1.5 text-violet-300">DM only</span> : null}
                </span>
                <KitButton tone="iconDanger" always aria-label={`Remove ${event.title}`} onClick={() => void removeEvent(event.id)}>
                  <Trash2 className="size-3.5" />
                </KitButton>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState size="sm" art="scrolls" title="Nothing on the calendar yet." />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={eventDraft.title} placeholder="What happens" aria-label="What happens" onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} maxLength={120} className={cn(field, "min-w-[9rem] flex-1")} />
          <Select size="sm" label="Event month" value={String(eventDraft.month)} options={monthOptions} onChange={(value) => setEventDraft({ ...eventDraft, month: Number(value) })} className="pk-w-28" />
          <NumberStepper size="sm" min={1} max={400} value={eventDraft.day} label="Event day" onChange={(day) => setEventDraft({ ...eventDraft, day: day || 1 })} />
          <Select size="sm" label="Repeats" value={eventDraft.repeat} options={REPEAT_OPTIONS} onChange={(repeat) => setEventDraft({ ...eventDraft, repeat })} className="pk-w-24" />
          <Select size="sm" label="Who sees it" value={eventDraft.visibility} options={VISIBILITY_OPTIONS} onChange={(visibility) => setEventDraft({ ...eventDraft, visibility })} className="pk-w-24" />
          <KitButton disabled={addingEvent || !eventDraft.title.trim()} busy={addingEvent} onClick={() => void addEvent()}>
            {addingEvent ? null : <Plus className="size-3.5" />} Add
          </KitButton>
        </div>
        <textarea value={eventDraft.body} placeholder="What the table learns when it comes round" aria-label="What the table learns when it comes round" rows={2} maxLength={600} onChange={(event) => setEventDraft({ ...eventDraft, body: event.target.value })} className={panelField} />
      </div>
    </div>
  );
}
