"use client";

import { Check, Lock, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { FIELD_KINDS, FIELD_KIND_LABELS, LORE_CATEGORIES, SHELF_LABELS, SHELVES, TYPE_COLORS, newId, type FieldDef, type WorldType } from "@/lib/worldforge/model";
import type { WorldApi, WorldState } from "./useWorld";
import { tint, typeOf } from "./world-ui";

// The types of thing the world holds, after WorldForge's type manager. Each
// type lives on one of the table's shelves (the Cast, places, factions,
// lore), chosen when it is made, since its entries are rows there. Its
// fields are the facts every entry of it keeps: text, a number, a pick from
// a list, or a year in one of the world's calendars; a year can be a birth
// or a death, and any field can be the author's alone.

export function TypesView({ api, world }: { api: WorldApi; world: WorldState }) {
  const { doc, entities } = world;
  const [editing, setEditing] = useState<WorldType | null>(null);
  const used = (type: WorldType) => entities.filter((entity) => typeOf(doc, entity).id === type.id).length;

  async function save(type: WorldType) {
    const exists = doc.types.some((entry) => entry.id === type.id);
    await api.patch({ types: exists ? doc.types.map((entry) => (entry.id === type.id ? type : entry)) : [...doc.types, type] });
    setEditing(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-400">{doc.types.length} types. A type&apos;s fields are what every entry of it keeps.</p>
        <KitButton
          tone="primary"
          onClick={() => setEditing({ id: newId("t"), name: "", color: TYPE_COLORS[doc.types.length % TYPE_COLORS.length], shelf: "lore", loreCategory: "other", fields: [] })}
          data-tour="world-new-type"
        >
          <Plus className="size-3.5" /> New type
        </KitButton>
      </div>
      {editing && !doc.types.some((type) => type.id === editing.id) ? <TypeForm type={editing} isNew onSave={save} onCancel={() => setEditing(null)} /> : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {doc.types.map((type, index) =>
          editing?.id === type.id ? (
            <li key={type.id} className="md:col-span-2">
              <TypeForm type={editing} isNew={false} onSave={save} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={type.id} className="panel wf-rise flex flex-col gap-1.5 rounded-lg p-3" style={{ "--i": index, borderColor: tint(type.color, 0.35) } as React.CSSProperties}>
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ background: type.color }} />
                <span className="font-display text-sm" style={{ color: type.color }}>{type.name}</span>
                <span className="text-[11px] text-stone-500">{SHELF_LABELS[type.shelf]}{type.shelf === "lore" ? `, ${type.loreCategory}` : ""}, {used(type)} {used(type) === 1 ? "entry" : "entries"}</span>
                <span className="ml-auto flex gap-1">
                  <KitButton tone="small" onClick={() => setEditing(type)}>Edit</KitButton>
                  <KitButton
                    tone="iconDanger"
                    always
                    aria-label={`Remove the type ${type.name}`}
                    title={used(type) ? "Entries still use it" : doc.types.filter((other) => other.shelf === type.shelf).length < 2 ? "Each shelf keeps one type" : "Remove"}
                    disabled={used(type) > 0 || doc.types.filter((other) => other.shelf === type.shelf).length < 2}
                    onClick={() => api.patch({ types: doc.types.filter((other) => other.id !== type.id) })}
                  >
                    <Trash2 className="size-3.5" />
                  </KitButton>
                </span>
              </div>
              {type.fields.length ? (
                <p className="text-xs text-stone-400">
                  {type.fields.map((field) => (
                    <span key={field.id} className={cn("mr-2 inline-flex items-center gap-0.5", field.authorOnly && "text-red-300")}>
                      {field.name}
                      <span className="text-stone-600">({FIELD_KIND_LABELS[field.kind].toLowerCase()}{field.role ? `, ${field.role}` : ""})</span>
                      {field.authorOnly ? <Lock className="size-3" /> : null}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="text-xs text-stone-500">No fields.</p>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function TypeForm({ type, isNew, onSave, onCancel }: { type: WorldType; isNew: boolean; onSave: (type: WorldType) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(type);
  const setField = (id: string, patch: Partial<FieldDef>) => setDraft((current) => ({ ...current, fields: current.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)) }));
  return (
    <form className="panel motion-pop flex flex-col gap-2.5 rounded-lg p-3" onSubmit={(event) => { event.preventDefault(); if (draft.name.trim()) onSave({ ...draft, name: draft.name.trim(), fields: draft.fields.filter((field) => field.name.trim()) }); }}>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className={ui.input} placeholder="Deity, Ship, Noble House" aria-label="Type name" maxLength={40} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
          {TYPE_COLORS.map((color) => (
            <button key={color} type="button" role="radio" aria-checked={draft.color === color} aria-label={color} onClick={() => setDraft({ ...draft, color })} className={cn("size-5 rounded-full border-2 motion-press", draft.color === color ? "border-amber-100" : "border-transparent")} style={{ background: color }} />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow text-[10px] text-stone-500">Lives in</span>
        {isNew ? (
          SHELVES.map((shelf) => (
            <button key={shelf} type="button" onClick={() => setDraft({ ...draft, shelf })} className={cn(ui.btnSmall, "px-2 py-1 text-xs", draft.shelf === shelf && "border-amber-500/60 bg-amber-400/10 text-amber-100")}>
              {SHELF_LABELS[shelf]}
            </button>
          ))
        ) : (
          <span className="text-xs text-stone-300">{SHELF_LABELS[draft.shelf]} (its entries are rows there)</span>
        )}
        {draft.shelf === "lore" ? (
          <Select label="Lore shelf" size="sm" value={draft.loreCategory} onChange={(loreCategory) => setDraft({ ...draft, loreCategory })} options={LORE_CATEGORIES.map((category) => ({ value: category, label: category }))} />
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow text-[10px] text-stone-500">Fields</span>
        {draft.fields.map((field) => (
          <div key={field.id} className="motion-pop grid items-center gap-1.5 sm:grid-cols-[1fr_9rem_auto_auto_auto]">
            <input className={cn(ui.input, "py-1 text-xs")} placeholder="Field name" aria-label="Field name" maxLength={60} value={field.name} onChange={(event) => setField(field.id, { name: event.target.value })} />
            <Select label="Kind" size="sm" value={field.kind} onChange={(kind) => setField(field.id, { kind, role: kind === "year" ? field.role : "" })} options={FIELD_KINDS.map((kind) => ({ value: kind, label: FIELD_KIND_LABELS[kind] }))} />
            {field.kind === "year" ? (
              <Select label="Marks" size="sm" value={field.role || "none"} onChange={(role) => setField(field.id, { role: role === "none" ? "" : role })} options={[{ value: "none", label: "No role" }, { value: "birth", label: "Birth" }, { value: "death", label: "Death" }]} />
            ) : (
              <span />
            )}
            <label className="flex items-center gap-1 text-[11px] text-stone-400" title="Never shown outside the DM's own view">
              <input type="checkbox" checked={field.authorOnly} onChange={(event) => setField(field.id, { authorOnly: event.target.checked })} className="accent-red-400" />
              Author only
            </label>
            <KitButton tone="iconDanger" always aria-label={`Remove the field ${field.name}`} onClick={() => setDraft({ ...draft, fields: draft.fields.filter((entry) => entry.id !== field.id) })}>
              <X className="size-3.5" />
            </KitButton>
            {field.kind === "select" ? (
              <input
                className={cn(ui.input, "py-1 text-xs sm:col-span-5")}
                placeholder="The choices, separated by commas"
                aria-label={`${field.name} choices`}
                value={field.options.join(", ")}
                onChange={(event) => setField(field.id, { options: event.target.value.split(",").map((option) => option.trimStart()).filter((option, index, all) => option || index === all.length - 1) })}
              />
            ) : null}
          </div>
        ))}
        <KitButton tone="link" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { id: newId("f"), name: "", kind: "text", options: [], authorOnly: false, role: "" }] })}>
          <Plus className="size-3.5" /> Add a field
        </KitButton>
      </div>
      <div className="flex justify-end gap-1.5">
        <KitButton tone="small" onClick={onCancel}><X className="size-3.5" /> Cancel</KitButton>
        <KitButton tone="primary" type="submit" disabled={!draft.name.trim()}><Check className="size-3.5" /> Save type</KitButton>
      </div>
    </form>
  );
}
