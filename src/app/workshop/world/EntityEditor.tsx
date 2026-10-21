"use client";

import { Check, Lock, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { LoreImageField } from "@/app/workshop/lore/LoreFields";
import { CANON_STATES, LIMITS, type Canon, type FieldDef, type FieldValue, type WorldDoc, type YearValue } from "@/lib/worldforge/model";
import { folderTree } from "@/lib/worldforge/tree";
import type { WorldEntity } from "@/lib/db/world-forge";
import { changesSince, describeValue, editableOf, same, type Editable, type EntryConflict } from "@/lib/worldforge/entry-merge";
import { ROW_TEXT, olderText } from "@/lib/worldforge/account";
import { useUnsavedDraft } from "@/app/workshop/unsaved";
import type { EntryInput, UpdateOutcome } from "./useWorld";
import { typeOf } from "./world-ui";

// Editing one entry: what its own record holds (name, its line or its text,
// aliases, tags, picture) and what WorldForge adds (type, folder, canon, the
// type's fields, the hidden truth, the author's notes), saved together.
// Only the fields the author changed are sent, each with the value the
// editor opened with, so another author's change elsewhere survives and a
// clash on the same field is shown here with the draft kept.

const CANON_WORDS: Record<Canon, string> = { canon: "Canon", draft: "Draft", alternate: "Alternate", retired: "Retired" };
const LINE_LIMIT = { npc: 200, faction: 400 } as const;
// What each record's own row holds (src/lib/worldforge/account.ts).
const TEXT_LIMIT = ROW_TEXT;

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

type Draft = Omit<Editable, "aliases" | "tags"> & { aliases: string; tags: string };
const draftOf = (values: Editable): Draft => ({ ...values, aliases: listText(values.aliases), tags: listText(values.tags), fields: { ...values.fields } });
const valuesOf = (draft: Draft): Editable => ({ ...draft, aliases: textList(draft.aliases), tags: textList(draft.tags) });

// After a clash: the fields this author left alone take the other author's
// values, the ones they changed keep theirs, and what the entry holds now
// becomes the new base, so saving again writes this author's choices.
function rebase(opened: Editable, theirs: Editable, mine: Editable): Editable {
  const next = { ...mine } as Record<string, unknown>;
  for (const key of Object.keys(theirs) as (keyof Editable)[]) {
    if (key === "fields") continue;
    if (same(mine[key], opened[key])) next[key] = theirs[key];
  }
  const fields = { ...mine.fields };
  for (const id of new Set([...Object.keys(theirs.fields), ...Object.keys(opened.fields), ...Object.keys(mine.fields)])) {
    if (!same(mine.fields[id], opened.fields[id])) continue;
    if (theirs.fields[id] === undefined) delete fields[id];
    else fields[id] = theirs.fields[id];
  }
  next.fields = fields;
  return next as Editable;
}

export function EntityEditor({
  doc,
  entity,
  saving,
  error,
  onSave,
  onCancel,
  onDraft,
}: {
  doc: WorldDoc;
  entity: WorldEntity;
  saving: boolean;
  error: string;
  // The changed fields and the value each had when the editor opened.
  onSave: (input: EntryInput, opened: Partial<Editable>) => Promise<UpdateOutcome>;
  onCancel: () => void;
  // The model's draft of the entry's text, or null when there is no text
  // model (the button is then not offered at all).
  onDraft: ((hint: string) => Promise<string | null>) | null;
}) {
  const [drafting, setDrafting] = useState(false);
  const [draftHint, setDraftHint] = useState("");
  const type = typeOf(doc, entity);
  const [opened, setOpened] = useState(() => editableOf(doc, entity));
  const [draft, setDraft] = useState<Draft>(() => draftOf(opened));
  const [conflicts, setConflicts] = useState<EntryConflict[]>([]);
  const clashRef = useRef<HTMLDivElement>(null);
  // Set by a clash until the next save: the notice says what the error
  // would, and stays quiet once its fields are settled.
  const [rebased, setRebased] = useState(false);
  const clashed = conflicts.length > 0;
  // The notice sits at the top of the form; a long form puts it out of view.
  useEffect(() => {
    if (clashed) clashRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [clashed]);
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

  // The draft lands in the entry's account, unsaved, for the DM to keep,
  // cut or throw away: a lore entry's body, every other entry's article
  // (src/lib/worldforge/account.ts). A place's arrival text stays the DM's.
  async function draftIt() {
    if (!onDraft) return;
    setDrafting(true);
    const text = await onDraft(draftHint);
    setDrafting(false);
    if (!text) return;
    if (entity.shelf === "lore") set("text", text.slice(0, TEXT_LIMIT.lore));
    else set("article", text);
  }

  // A lore entry's older article, when it says something its body does not.
  const older = olderText({ shelf: entity.shelf, text: draft.text, entry: { article: draft.article } });

  // Changes not saved yet, as save would send them.
  const unsaved = Object.keys(changesSince(opened, entity.shelf === "lore" ? { ...valuesOf(draft), article: older } : valuesOf(draft)).patch).length > 0;
  useUnsavedDraft(unsaved);

  async function save() {
    setRebased(false);
    const values = valuesOf(draft);
    // A lore entry keeps an older article only while it differs from the
    // body; one the body already holds is cleared.
    const mine = entity.shelf === "lore" ? { ...values, article: older } : values;
    const { patch, base } = changesSince(opened, mine);
    const outcome = await onSave(patch as EntryInput, base);
    if (!outcome || !("conflicts" in outcome)) return;
    const theirs = editableOf(doc, outcome.entity);
    setDraft(draftOf(rebase(opened, theirs, mine)));
    setOpened(theirs);
    setConflicts(outcome.conflicts);
    setRebased(true);
  }

  // Takes the other author's value for one clashing field.
  function takeTheirs(conflict: EntryConflict) {
    if (conflict.key.startsWith("fields.")) {
      const id = conflict.key.slice("fields.".length);
      setDraft((current) => {
        const fields = { ...current.fields };
        if (conflict.theirs === undefined) delete fields[id];
        else fields[id] = conflict.theirs as FieldValue;
        return { ...current, fields };
      });
    } else {
      const key = conflict.key as keyof Editable;
      const value = key === "aliases" || key === "tags" ? listText((conflict.theirs as string[]) ?? []) : conflict.theirs;
      setDraft((current) => ({ ...current, [key]: value }));
    }
    setConflicts((current) => current.filter((entry) => entry.key !== conflict.key));
  }

  return (
    <form
      className="flex flex-col gap-3 animate-fade-up"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {conflicts.length ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-100" role="alert" data-testid="entry-conflicts" ref={clashRef} tabIndex={-1}>
          <p>Another author saved this entry while you had it open. Their other changes are now in the form. These fields clash with yours:</p>
          <ul className="flex flex-col gap-1.5">
            {conflicts.map((conflict) => (
              <li key={conflict.key} className="flex flex-wrap items-center gap-2">
                <span>
                  <strong>{conflict.label}</strong>: theirs is {describeValue(conflict.theirs)}.
                </span>
                <KitButton tone="small" onClick={() => takeTheirs(conflict)}>
                  Use theirs
                </KitButton>
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-200/80">Save keeps yours for any field you leave as it is.</p>
        </div>
      ) : null}
      <div className="grid gap-3 @lg:grid-cols-2">
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
          draft.canon === "canon"
                ? undefined
                : entity.shelf === "lore"
                  ? "Not canon yet: kept from what players read until it is."
                  : "Not canon yet: the AI DM treats it as uncertain.",
        )}
      </div>

      {shortRow
        ? field(
            entity.shelf === "npc" ? "In one line (what the table sees in the Cast)" : "In one line (the faction's blurb)",
            <input className={ui.input} maxLength={LINE_LIMIT[entity.shelf as "npc" | "faction"]} value={draft.tagline} onChange={(event) => set("tagline", event.target.value)} />,
          )
        : field(
            entity.shelf === "location" ? "On arrival (what the DM reads when the party arrives)" : "The entry",
            <textarea className={cn(ui.input, "min-h-28")} maxLength={TEXT_LIMIT[entity.shelf as "location" | "lore"]} value={draft.text} onChange={(event) => set("text", event.target.value)} />,
            `${draft.text.length.toLocaleString("en")} of ${TEXT_LIMIT[entity.shelf as "location" | "lore"].toLocaleString("en")} characters${entity.shelf === "lore" ? ". Players read this one when the entry is theirs to read." : ""}`,
          )}
      {entity.shelf !== "lore"
        ? field(
            entity.shelf === "location" ? "In full (the wiki's article)" : "Article",
            <textarea className={cn(ui.input, "min-h-32")} maxLength={LIMITS.article} value={draft.article} onChange={(event) => set("article", event.target.value)} />,
            entity.shelf === "location"
              ? "The wiki's full account, shown above the arrival text. Leave it empty and the wiki shows the arrival text alone."
              : "The wiki's full account. Names of other entries link themselves.",
          )
        : null}
      {older ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-100" data-testid="older-text">
          <span className="eyebrow text-[10px] text-amber-300">An older text from an import</span>
          <p className="text-xs text-amber-200/80">Kept beside the entry because the two say different things. Players never see it. Nothing is lost until you remove one.</p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-stone-950/40 p-2 text-xs leading-5 text-stone-300">{older}</p>
          <span className="flex flex-wrap gap-2">
            <KitButton tone="small" onClick={() => setDraft((current) => ({ ...current, text: current.article.slice(0, TEXT_LIMIT.lore), article: current.text }))}>
              Use this one instead
            </KitButton>
            <KitButton tone="small" onClick={() => set("article", "")}>
              Remove it
            </KitButton>
          </span>
        </div>
      ) : null}

      {onDraft ? (
        <div className="flex flex-wrap items-center gap-2 motion-pop">
          <KitButton tone="small" busy={drafting} disabled={drafting} onClick={draftIt} data-tour="world-draft">
            {drafting ? null : <Sparkles className="size-3.5" />} {drafting ? "Drafting" : "Draft it"}
          </KitButton>
          <input className={cn(ui.input, "max-w-sm flex-1 py-1 text-xs")} placeholder="Steer the draft (optional)" aria-label="Steer the draft" maxLength={300} value={draftHint} onChange={(event) => setDraftHint(event.target.value)} />
          <span className="text-[11px] text-stone-500">Fills the text above; nothing is kept until Save.</span>
        </div>
      ) : null}

      <div className="grid gap-3 @lg:grid-cols-2">
        {field("Also called", <input className={ui.input} placeholder="another name, a title" value={draft.aliases} onChange={(event) => set("aliases", event.target.value)} />, "Separated by commas.")}
        {field("Tags", <input className={ui.input} placeholder="harbour, smugglers" value={draft.tags} onChange={(event) => set("tags", event.target.value)} />, "Separated by commas.")}
      </div>

      {chosenType.fields.length ? (
        <div className="grid gap-3 @lg:grid-cols-2">
          {chosenType.fields.map((def) => (
            <FieldInput key={def.id} def={def} doc={doc} value={draft.fields[def.id]} onChange={(value) => setField(def, value)} />
          ))}
        </div>
      ) : null}

      {field("Picture", <LoreImageField imagePath={draft.portrait} onChange={(path) => set("portrait", path)} />)}

      <div className="grid gap-3 @lg:grid-cols-2">
        {field(
          "Hidden truth (kept from players)",
          <textarea className={cn(ui.input, "min-h-20 border-red-900/50")} maxLength={4_000} value={draft.hiddenTruth} onChange={(event) => set("hiddenTruth", event.target.value)} />,
          "True in the world, unknown to it. The DM may let it surface; players never read it here.",
        )}
        {field(
          "Author's notes",
          <textarea className={cn(ui.input, "min-h-20")} maxLength={4_000} value={draft.notes} onChange={(event) => set("notes", event.target.value)} />,
          "Out of the world: inspirations, reminders.",
        )}
      </div>

      {error && !rebased ? <PanelError>{error}</PanelError> : null}
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
