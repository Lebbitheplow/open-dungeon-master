"use client";

import { Check, Lock, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { LoreImageField } from "@/app/workshop/lore/LoreFields";
import { CANON_STATES, type Canon, type FieldDef, type FieldValue, type WorldDoc, type YearValue } from "@/lib/worldforge/model";
import { folderTree } from "@/lib/worldforge/tree";
import type { WorldEntity } from "@/lib/db/world-forge";
import type { EntryInput } from "./useWorld";
import { typeOf } from "./world-ui";

// Editing one entry: what its own record holds (name, its line or its text,
// aliases, tags, picture) and what WorldForge adds (type, folder, canon, the
// type's fields, the hidden truth, the author's notes), saved together.

const CANON_WORDS: Record<Canon, string> = { canon: "Canon", draft: "Draft", alternate: "Alternate", retired: "Retired" };
const LINE_LIMIT = { npc: 200, faction: 400 } as const;
const TEXT_LIMIT = { location: 2_000, lore: 4_000 } as const;

const field = (label: string, child: React.ReactNode, hint?: string) => (
  <label className="flex flex-col gap-1">
    <span className="eyebrow text-[10px] text-stone-500">{label}</span>
    {child}
    {hint ? <span className="text-[11px] text-stone-500">{hint}</span> : null}
  </label>
);

function listText(values: string[]): string {
  return values.join(", ");
}
function textList(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export function EntityEditor({
  doc,
  entity,
  saving,
  error,
  onSave,
  onCancel,
}: {
  doc: WorldDoc;
  entity: WorldEntity;
  saving: boolean;
  error: string;
  onSave: (input: EntryInput) => void;
  onCancel: () => void;
}) {
  const type = typeOf(doc, entity);
  const [draft, setDraft] = useState({
    name: entity.name,
    tagline: entity.tagline,
    text: entity.text,
    article: entity.entry.article,
    aliases: listText(entity.aliases),
    tags: listText(entity.tags),
    portrait: entity.portrait,
    typeId: type.id,
    folderId: entity.entry.folderId,
    canon: entity.entry.canon,
    hiddenTruth: entity.entry.hiddenTruth,
    notes: entity.entry.notes,
    fields: { ...entity.entry.fields } as Record<string, FieldValue>,
  });
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const chosenType = doc.types.find((entry) => entry.id === draft.typeId) ?? type;
  const sameShelf = doc.types.filter((entry) => entry.shelf === entity.shelf);
  const shortRow = entity.shelf === "npc" || entity.shelf === "faction";

  const setField = (def: FieldDef, value: FieldValue | undefined) =>
    setDraft((current) => {
      const fields = { ...current.fields };
      if (value === undefined || value === "") delete fields[def.id];
      else fields[def.id] = value;
      return { ...current, fields };
    });

  function save() {
    onSave({
      name: draft.name,
      ...(shortRow ? { tagline: draft.tagline } : { text: draft.text }),
      article: draft.article,
      aliases: textList(draft.aliases),
      tags: textList(draft.tags),
      portrait: draft.portrait,
      typeId: draft.typeId,
      folderId: draft.folderId,
      canon: draft.canon,
      hiddenTruth: draft.hiddenTruth,
      notes: draft.notes,
      fields: draft.fields,
    });
  }

  return (
    <form
      className="flex flex-col gap-3 animate-fade-up"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field("Name", <input className={ui.input} maxLength={80} value={draft.name} onChange={(event) => set("name", event.target.value)} required />)}
        {field(
          "Type",
          <Select
            label="Type"
            value={draft.typeId}
            onChange={(value) => set("typeId", value)}
            options={sameShelf.map((entry) => ({ value: entry.id, label: entry.name }))}
          />,
          sameShelf.length > 1 ? undefined : "Other types live on other shelves: this one stays where it is.",
        )}
        {field(
          "Folder",
          <Select
            label="Folder"
            value={draft.folderId || "__none"}
            onChange={(value) => set("folderId", value === "__none" ? "" : value)}
            options={[{ value: "__none", label: "No folder" }, ...folderTree(doc.folders).map(({ folder, depth }) => ({ value: folder.id, label: `${" ".repeat(depth)}${folder.name}` }))]}
          />,
        )}
        {field(
          "Canon",
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Canon">
            {CANON_STATES.map((state) => (
              <button key={state} type="button" role="radio" aria-checked={draft.canon === state} onClick={() => set("canon", state)} className={cn(ui.btnSmall, "px-2 py-1 text-xs", draft.canon === state && "border-amber-500/60 bg-amber-400/10 text-amber-100")}>
                {CANON_WORDS[state]}
              </button>
            ))}
          </div>,
          draft.canon === "canon" ? undefined : "Not canon yet: kept from what players read.",
        )}
      </div>

      {shortRow
        ? field(
            entity.shelf === "npc" ? "In one line (what the table sees in the Cast)" : "In one line (the faction's blurb)",
            <input className={ui.input} maxLength={LINE_LIMIT[entity.shelf as "npc" | "faction"]} value={draft.tagline} onChange={(event) => set("tagline", event.target.value)} />,
          )
        : field(
            entity.shelf === "location" ? "The place (what the DM reads on arrival)" : "The entry",
            <textarea className={cn(ui.input, "min-h-28")} maxLength={TEXT_LIMIT[entity.shelf as "location" | "lore"]} value={draft.text} onChange={(event) => set("text", event.target.value)} />,
            `${draft.text.length} of ${TEXT_LIMIT[entity.shelf as "location" | "lore"]} characters`,
          )}
      {shortRow || draft.article
        ? field(
            "Article",
            <textarea className={cn(ui.input, "min-h-32")} maxLength={12_000} value={draft.article} onChange={(event) => set("article", event.target.value)} />,
            "The wiki's full account. Names of other entries link themselves.",
          )
        : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {field("Also called", <input className={ui.input} placeholder="the Tidewarden, Old Ivo" value={draft.aliases} onChange={(event) => set("aliases", event.target.value)} />, "Separated by commas.")}
        {field("Tags", <input className={ui.input} placeholder="harbour, smugglers" value={draft.tags} onChange={(event) => set("tags", event.target.value)} />, "Separated by commas.")}
      </div>

      {chosenType.fields.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {chosenType.fields.map((def) => (
            <FieldInput key={def.id} def={def} doc={doc} value={draft.fields[def.id]} onChange={(value) => setField(def, value)} />
          ))}
        </div>
      ) : null}

      {field("Picture", <LoreImageField imagePath={draft.portrait} onChange={(path) => set("portrait", path)} />)}

      <div className="grid gap-3 sm:grid-cols-2">
        {field(
          "Hidden truth (yours alone)",
          <textarea className={cn(ui.input, "min-h-20 border-red-900/50")} maxLength={4_000} value={draft.hiddenTruth} onChange={(event) => set("hiddenTruth", event.target.value)} />,
          "True in the world, unknown to it. The DM may let it surface; players never read it here.",
        )}
        {field(
          "Author's notes",
          <textarea className={cn(ui.input, "min-h-20")} maxLength={4_000} value={draft.notes} onChange={(event) => set("notes", event.target.value)} />,
          "Out of the world: inspirations, reminders.",
        )}
      </div>

      {error ? <PanelError>{error}</PanelError> : null}
      <div className="flex justify-end gap-2">
        <KitButton tone="small" onClick={onCancel}>
          <X className="size-3.5" /> Cancel
        </KitButton>
        <KitButton tone="primary" type="submit" busy={saving} disabled={saving || !draft.name.trim()}>
          {saving ? null : <Check className="size-3.5" />} Save
        </KitButton>
      </div>
    </form>
  );
}

function FieldInput({ def, doc, value, onChange }: { def: FieldDef; doc: WorldDoc; value: FieldValue | undefined; onChange: (value: FieldValue | undefined) => void }) {
  const label = (
    <span className="eyebrow flex items-center gap-1 text-[10px] text-stone-500">
      {def.name}
      {def.authorOnly ? <Lock className="size-3 text-red-400" aria-label="Author only" /> : null}
    </span>
  );
  if (def.kind === "select") {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <Select label={def.name} value={(value as string) ?? ""} placeholder="Not set" onChange={(next) => onChange(next === "__none" ? undefined : next)} options={[{ value: "__none", label: "Not set" }, ...def.options.map((option) => ({ value: option, label: option }))]} />
      </div>
    );
  }
  if (def.kind === "year") {
    const year = (value && typeof value === "object" ? value : { calendarId: doc.calendars[0]?.id ?? "", yearNum: null, year: "" }) as YearValue;
    return (
      <div className="flex flex-col gap-1">
        {label}
        <div className="flex gap-1.5">
          <input
            className={cn(ui.input, "w-24")}
            type="number"
            aria-label={`${def.name}, year`}
            value={year.yearNum ?? ""}
            onChange={(event) => onChange(event.target.value === "" ? undefined : { ...year, yearNum: Math.round(Number(event.target.value)) })}
          />
          {doc.calendars.length ? (
            <Select label={`${def.name}, calendar`} size="sm" className="flex-1" value={year.calendarId} onChange={(calendarId) => onChange({ ...year, calendarId })} options={doc.calendars.map((calendar) => ({ value: calendar.id, label: calendar.abbrev || calendar.name, hint: calendar.name }))} />
          ) : (
            <span className="self-center text-[11px] text-stone-500">Add a calendar in Timeline to name the reckoning.</span>
          )}
        </div>
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        className={ui.input}
        type={def.kind === "number" ? "number" : "text"}
        maxLength={400}
        value={value === undefined ? "" : String(value)}
        onChange={(event) => onChange(def.kind === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value)}
      />
    </label>
  );
}
