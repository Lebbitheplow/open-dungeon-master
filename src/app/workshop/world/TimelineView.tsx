"use client";

import { CalendarPlus, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { CANON_STATES, newId, type Calendar, type WorldEvent } from "@/lib/worldforge/model";
import { absoluteYear, formatYear, lifespan, lifespanIssue, sortEvents } from "@/lib/worldforge/time";
import type { WorldApi, WorldState } from "./useWorld";
import { EntityAvatar, EntityPicker, typeOf } from "./world-ui";

// The timeline, after WorldForge's: calendars are reckonings, each with an
// offset that places its year 0 on one shared line, so an event dated in one
// reads in all of them. Events run in that line's order, grouped by era, and
// a person named in an event outside their own life is flagged.

const blankEvent = (calendarId: string): WorldEvent => ({ id: "", title: "", body: "", era: "", when: { calendarId, yearNum: null, year: "" }, refs: [], canon: "canon" });

export function TimelineView({ api, world, onOpen }: { api: WorldApi; world: WorldState; onOpen: (ref: string) => void }) {
  const { doc, entities } = world;
  const [editing, setEditing] = useState<WorldEvent | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const byRef = useMemo(() => new Map(entities.map((entity) => [entity.ref, entity])), [entities]);
  const events = sortEvents(doc.events, doc.calendars);
  const eras = [...new Set(doc.events.map((event) => event.era).filter(Boolean))];

  async function saveEvent(event: WorldEvent) {
    const id = event.id || newId("ev");
    await api.patch({ events: [...doc.events.filter((entry) => entry.id !== id), { ...event, id }] });
    setEditing(null);
  }
  async function saveCalendar(next: Calendar) {
    const id = next.id || newId("cal");
    await api.patch({ calendars: [...doc.calendars.filter((entry) => entry.id !== id), { ...next, id }] });
    setCalendar(null);
  }
  async function dropCalendar(entry: Calendar) {
    if (await appConfirm("Years written in it keep their numbers and read on the shared line.", { title: `Remove ${entry.name}?`, actionLabel: "Remove" })) {
      await api.patch({ calendars: doc.calendars.filter((other) => other.id !== entry.id) });
    }
  }

  // An era's heading stands over its first event in the line.
  const headers = events.map((event, index) => {
    const before = events.slice(0, index).reverse().find((entry) => entry.era)?.era ?? null;
    return event.era && event.era !== before ? event.era : null;
  });
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-2" aria-label="Calendars">
        <span className="eyebrow text-[10px] text-stone-500">Calendars</span>
        {doc.calendars.map((entry) => (
          <span key={entry.id} className="pk-chip motion-pop group text-[11px]">
            <span className="text-amber-100">{entry.abbrev || entry.name}</span>
            <span className="text-stone-500">{entry.name}{entry.epochOffset ? `, year 0 at ${entry.epochOffset}` : ""}</span>
            <button type="button" aria-label={`Edit ${entry.name}`} onClick={() => setCalendar(entry)} className="reveal-on-hover text-stone-500 hover:text-amber-200">
              <Pencil className="size-3" />
            </button>
            <button type="button" aria-label={`Remove ${entry.name}`} onClick={() => dropCalendar(entry)} className="reveal-on-hover text-stone-500 hover:text-red-300">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <KitButton tone="link" onClick={() => setCalendar({ id: "", name: "", abbrev: "", epochOffset: 0, notes: "" })}>
          <CalendarPlus className="size-3.5" /> Add a calendar
        </KitButton>
      </section>
      {calendar ? <CalendarForm calendar={calendar} onSave={saveCalendar} onCancel={() => setCalendar(null)} /> : null}

      <div className="flex justify-between">
        <h3 className="eyebrow text-[10px] text-amber-400/80">{events.length} event{events.length === 1 ? "" : "s"}</h3>
        <KitButton tone="primary" onClick={() => setEditing(blankEvent(doc.calendars[0]?.id ?? ""))} data-tour="world-new-event">
          <Plus className="size-3.5" /> New event
        </KitButton>
      </div>
      {editing && !editing.id ? <EventForm event={editing} world={world} eras={eras} onSave={saveEvent} onCancel={() => setEditing(null)} /> : null}

      <ol className="relative flex flex-col gap-2 border-l border-amber-500/25 pl-5 motion-rule" aria-label="Timeline">
        {events.length === 0 ? <li className="text-sm text-stone-500">Nothing has happened yet.</li> : null}
        {events.map((event, index) => {
          const header = headers[index];
          const year = formatYear(event.when, doc.calendars);
          const at = absoluteYear(event.when, doc.calendars);
          const issues = event.refs
            .map((ref) => byRef.get(ref))
            .filter((entity) => entity !== undefined)
            .map((entity) => ({ entity, issue: lifespanIssue(lifespan(typeOf(doc, entity), entity.entry, doc.calendars), at) }))
            .filter((entry) => entry.issue);
          if (editing?.id === event.id) {
            return (
              <li key={event.id}>
                <EventForm event={editing} world={world} eras={eras} onSave={saveEvent} onCancel={() => setEditing(null)} />
              </li>
            );
          }
          return (
            <li key={event.id} className="wf-rise group relative" style={{ "--i": index } as React.CSSProperties}>
              {header ? <p className="eyebrow mb-1.5 mt-2 text-[10px] text-amber-400/80">{header}</p> : null}
              <span className={cn("absolute -left-[1.62rem] size-2.5 rounded-full border border-amber-400 bg-stone-950", header ? "top-9" : "top-3.5")} aria-hidden="true" />
              <div className="panel rounded-lg p-2.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-sm text-amber-200">{year.primary || "Undated"}</span>
                  <span className="text-sm text-stone-100">{event.title}</span>
                  {event.canon !== "canon" ? <span className="text-[10px] uppercase tracking-[0.12em] text-stone-500">{event.canon}</span> : null}
                  <span className="ml-auto flex gap-1">
                    <KitButton tone="icon" aria-label={`Edit ${event.title}`} onClick={() => setEditing(event)}>
                      <Pencil className="size-3.5" />
                    </KitButton>
                    <KitButton tone="iconDanger" aria-label={`Delete ${event.title}`} onClick={() => api.patch({ events: doc.events.filter((entry) => entry.id !== event.id) })}>
                      <Trash2 className="size-3.5" />
                    </KitButton>
                  </span>
                </div>
                {year.conversions ? <p className="text-[11px] text-stone-500">{year.conversions}</p> : null}
                {event.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-stone-300">{event.body}</p> : null}
                {event.refs.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {event.refs.map((ref) => {
                      const entity = byRef.get(ref);
                      return entity ? (
                        <button key={ref} type="button" onClick={() => onOpen(ref)} className="pk-chip motion-press text-[11px]">
                          <EntityAvatar entity={entity} type={typeOf(doc, entity)} size="size-4" /> {entity.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                ) : null}
                {issues.map(({ entity, issue }) => (
                  <p key={entity.ref} className="mt-1 text-xs text-ember-400 motion-pop">
                    {entity.name}: {issue}
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CalendarForm({ calendar, onSave, onCancel }: { calendar: Calendar; onSave: (calendar: Calendar) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(calendar);
  return (
    <form className="panel motion-pop grid gap-2 rounded-lg p-3 sm:grid-cols-[1fr_6rem_8rem]" onSubmit={(event) => { event.preventDefault(); if (draft.name.trim()) onSave(draft); }}>
      <input className={ui.input} placeholder="Reckoning of Tides" aria-label="Calendar name" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
      <input className={ui.input} placeholder="RT" aria-label="Abbreviation" maxLength={12} value={draft.abbrev} onChange={(event) => setDraft({ ...draft, abbrev: event.target.value })} />
      <input className={ui.input} type="number" aria-label="Where its year 0 falls" value={draft.epochOffset} onChange={(event) => setDraft({ ...draft, epochOffset: Math.round(Number(event.target.value) || 0) })} />
      <p className="text-[11px] text-stone-500 sm:col-span-3">The last box places this calendar&apos;s year 0 on the shared line: give the first calendar 0, and a later reckoning that began 1240 years after it 1240.</p>
      <div className="flex justify-end gap-1.5 sm:col-span-3">
        <KitButton tone="small" onClick={onCancel}><X className="size-3.5" /> Cancel</KitButton>
        <KitButton tone="primary" type="submit" disabled={!draft.name.trim()}><Check className="size-3.5" /> Save</KitButton>
      </div>
    </form>
  );
}

function EventForm({ event, world, eras, onSave, onCancel }: { event: WorldEvent; world: WorldState; eras: string[]; onSave: (event: WorldEvent) => void; onCancel: () => void }) {
  const { doc, entities } = world;
  const [draft, setDraft] = useState(event);
  const [picking, setPicking] = useState(false);
  const toggle = (ref: string) => setDraft((current) => ({ ...current, refs: current.refs.includes(ref) ? current.refs.filter((entry) => entry !== ref) : [...current.refs, ref] }));
  return (
    <form className="panel motion-pop flex flex-col gap-2 rounded-lg p-3" onSubmit={(submit) => { submit.preventDefault(); if (draft.title.trim()) onSave(draft); }}>
      <div className="grid gap-2 sm:grid-cols-[1fr_7rem_9rem]">
        <input className={ui.input} placeholder="The Wall Breaks" aria-label="What happened" maxLength={120} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} autoFocus />
        <input className={ui.input} type="number" aria-label="Year" placeholder="Year" value={draft.when.yearNum ?? ""} onChange={(change) => setDraft({ ...draft, when: { ...draft.when, yearNum: change.target.value === "" ? null : Math.round(Number(change.target.value)) } })} />
        {doc.calendars.length ? (
          <Select label="Calendar" value={draft.when.calendarId} onChange={(calendarId) => setDraft({ ...draft, when: { ...draft.when, calendarId } })} options={doc.calendars.map((entry) => ({ value: entry.id, label: entry.abbrev || entry.name, hint: entry.name }))} />
        ) : (
          <span className="self-center text-[11px] text-stone-500">No calendar: the year stands alone.</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input className={cn(ui.input, "max-w-48 text-xs")} placeholder="Era (Second Tide)" aria-label="Era" maxLength={60} value={draft.era} onChange={(change) => setDraft({ ...draft, era: change.target.value })} />
        {eras.filter((era) => era !== draft.era).map((era) => (
          <button key={era} type="button" onClick={() => setDraft({ ...draft, era })} className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[11px] text-stone-400 hover:text-amber-100 motion-press">{era}</button>
        ))}
        <div className="ml-auto flex gap-1" role="radiogroup" aria-label="Canon">
          {CANON_STATES.map((state) => (
            <button key={state} type="button" role="radio" aria-checked={draft.canon === state} onClick={() => setDraft({ ...draft, canon: state })} className={cn("rounded-md border border-stone-700 px-1.5 py-0.5 text-[11px] motion-press", draft.canon === state ? "bg-amber-400/10 text-amber-100" : "text-stone-500")}>{state}</button>
          ))}
        </div>
      </div>
      <textarea className={cn(ui.input, "min-h-16")} placeholder="What happened, in a few lines" aria-label="What happened, in full" maxLength={4_000} value={draft.body} onChange={(change) => setDraft({ ...draft, body: change.target.value })} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="eyebrow text-[10px] text-stone-500">Who and where</span>
        {draft.refs.map((ref) => {
          const entity = entities.find((entry) => entry.ref === ref);
          return entity ? (
            <button key={ref} type="button" onClick={() => toggle(ref)} className="pk-chip motion-pop text-[11px]" aria-label={`Take ${entity.name} off`}>
              <EntityAvatar entity={entity} type={typeOf(doc, entity)} size="size-4" /> {entity.name} <X className="size-3" />
            </button>
          ) : null;
        })}
        <KitButton tone="link" onClick={() => setPicking((value) => !value)}><Plus className="size-3.5" /> Add</KitButton>
      </div>
      {picking ? <EntityPicker doc={doc} entities={entities} chosen={draft.refs} label="who or where" onPick={(entity) => toggle(entity.ref)} /> : null}
      <div className="flex justify-end gap-1.5">
        <KitButton tone="small" onClick={onCancel}><X className="size-3.5" /> Cancel</KitButton>
        <KitButton tone="primary" type="submit" disabled={!draft.title.trim()}><Check className="size-3.5" /> Save event</KitButton>
      </div>
    </form>
  );
}
