"use client";

import { Eye, EyeOff, FileText, Loader2, Trash2, Users, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { appendTerm, insertAt } from "@/lib/workshop/pickers";
import { AddFromList } from "@/components/ui/AddFromList";
import { Markdown } from "@/components/ui/Markdown";
import { LORE_STYLES, WORLD_LORE_CATEGORIES, type LoreLinkTarget, type LoreStyle, type WorldLoreCategory } from "@/lib/dm/world-lore-logic";
import { LoreImageField, VisibilitySelect } from "@/app/workshop/lore/LoreFields";
import { CATEGORY_LABELS, type LoreDraft } from "@/app/workshop/lore/types";

// The binder's author form (docs/vtt-parity-implementation-plan.md
// sections 5.1 to 5.6): who reads it, how it is dressed, the picture and
// the PDF that ride with it, a [[ autocomplete as you type, and a live
// preview beside the text above lg and as a tab below it.

const chip = "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]";

const STYLE_LABELS: Record<LoreStyle, string> = { plain: "Plain page", parchment: "Parchment", notice: "Notice" };

export function LoreEditorForm({
  draft,
  onChange,
  linkable,
  knownTags,
  members,
  targets,
  rows,
}: {
  draft: LoreDraft;
  onChange: (next: LoreDraft) => void;
  linkable: Array<{ value: string; label: string }>;
  knownTags: string[];
  // The table, for the "some players" audience; absent in the workshop.
  members?: Array<{ userId: string; username: string }>;
  targets: LoreLinkTarget[];
  rows: boolean;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<"write" | "preview">("write");
  const [complete, setComplete] = useState<{ at: number; query: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const pdfRef = useRef<HTMLInputElement>(null);

  function insertLink(title: string) {
    const field = bodyRef.current;
    const at = complete ? complete.at : field?.selectionStart ?? draft.body.length;
    // A typed "[[que" is replaced whole; a picked link lands at the caret.
    const before = complete ? draft.body.slice(0, at) : draft.body.slice(0, at);
    const after = complete ? draft.body.slice(at + 2 + complete.query.length) : draft.body.slice(at);
    const next = insertAt(`${before}${after}`, before.length, `[[${title}]]`);
    onChange({ ...draft, body: next.text });
    setComplete(null);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.caret, next.caret);
    });
  }

  // Typing "[[" opens the list; the letters after it filter; Escape closes.
  function onBodyChange(value: string, caret: number) {
    onChange({ ...draft, body: value });
    const open = value.lastIndexOf("[[", caret);
    if (open !== -1 && !value.slice(open, caret).includes("]]") && caret - open <= 40) {
      setComplete({ at: open, query: value.slice(open + 2, caret) });
    } else {
      setComplete(null);
    }
  }
  const suggestions = useMemo(() => {
    if (!complete) {
      return [];
    }
    const needle = complete.query.toLowerCase();
    return linkable.filter((option) => option.value.toLowerCase().includes(needle)).slice(0, 8);
  }, [complete, linkable]);

  async function uploadPdf(file: File) {
    setPdfBusy(true);
    setPdfError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: "application/pdf" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPdfError(payload.error || "That PDF would not upload.");
        return;
      }
      onChange({ ...draft, attachmentPath: payload.url });
    } catch {
      setPdfError("That PDF would not upload.");
    } finally {
      setPdfBusy(false);
    }
  }

  const textarea = (
    <div className="relative">
      <textarea
        ref={bodyRef}
        value={draft.body}
        onChange={(event) => onBodyChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
        onKeyDown={(event) => {
          if (!complete) {
            return;
          }
          if (event.key === "Escape") {
            setComplete(null);
          } else if (event.key === "Enter" && suggestions[0]) {
            event.preventDefault();
            insertLink(suggestions[0].value);
          }
        }}
        rows={rows ? 10 : 5}
        maxLength={4000}
        placeholder={"What is established about it...\n\n# Headings, **bold**, - lists, [[The Mill]] to link, [[1d6]] to roll, and :::secret ... ::: for what only you read."}
        data-tour="lore-body"
        className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
      />
      {complete && suggestions.length ? (
        <ul role="listbox" className="fx-pop absolute left-2 top-full z-20 mt-0.5 w-64 rounded-md border border-stone-700 bg-stone-950 p-1 shadow-elev-2">
          {suggestions.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => insertLink(option.value)}
                className={cn("w-full rounded px-2 py-1 text-left text-[11px]", index === 0 ? "bg-amber-950/50 text-amber-100" : "text-stone-300 hover:bg-stone-900")}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  const previewPane = (
    <div className="min-h-24 rounded border border-stone-800 bg-stone-950/60 p-2">
      {draft.body.trim() ? (
        <Markdown source={draft.body} targets={targets} style={draft.style} dmView />
      ) : (
        <p className="text-[11px] italic text-stone-600">Nothing to show yet.</p>
      )}
    </div>
  );

  return (
    <>
      <div className="flex gap-1.5" data-tour="lore-title">
        <select
          value={draft.category}
          onChange={(event) => onChange({ ...draft, category: event.target.value as WorldLoreCategory })}
          className="rounded border border-stone-700 bg-stone-900 px-1.5 py-1 text-[11px] outline-none focus:border-amber-600"
        >
          {WORLD_LORE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <input
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          maxLength={120}
          placeholder="Title (The Ashen League, The Sundering...)"
          className="flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
        />
      </div>
      <div className="flex items-center gap-1 lg:hidden">
        {(["write", "preview"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={preview === tab}
            onClick={() => setPreview(tab)}
            className={cn(chip, preview === tab ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-stone-700 text-stone-400")}
          >
            {tab === "write" ? "Write" : "Preview"}
          </button>
        ))}
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        <div className={cn(preview === "preview" && "hidden lg:block")}>{textarea}</div>
        <div className={cn(preview === "write" && "hidden lg:block")}>{previewPane}</div>
      </div>
      {linkable.length ? (
        <div className="flex flex-wrap items-center gap-1.5" data-tour="lore-link">
          <AddFromList prompt="Link another entry" options={linkable} onPick={insertLink} />
          <span className="text-[10px] text-stone-600">Or type [[ and the first letters.</span>
        </div>
      ) : null}
      <VisibilitySelect value={draft.visibility} onChange={(visibility) => onChange({ ...draft, visibility })} />
      {draft.visibility === "party" && members?.length ? (
        <AudienceSelect
          audience={draft.audience}
          members={members}
          onChange={(audience) => onChange({ ...draft, audience })}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {LORE_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={draft.style === style}
            onClick={() => onChange({ ...draft, style })}
            className={cn(chip, draft.style === style ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-stone-700 text-stone-400")}
          >
            {STYLE_LABELS[style]}
          </button>
        ))}
        <span className="text-[10px] text-stone-600">How it reads when shown.</span>
      </div>
      <LoreImageField imagePath={draft.imagePath} onChange={(imagePath) => onChange({ ...draft, imagePath })} />
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={pdfRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadPdf(file);
            }
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={pdfBusy}
          onClick={() => pdfRef.current?.click()}
          className={cn(chip, "border-stone-700 text-stone-300 hover:bg-stone-900 disabled:opacity-50")}
        >
          {pdfBusy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />}
          {draft.attachmentPath ? "Replace the PDF" : "Attach a PDF"}
        </button>
        {draft.attachmentPath ? (
          <>
            <a href={draft.attachmentPath} target="_blank" rel="noreferrer" className="text-[11px] text-amber-200 underline">
              Open it
            </a>
            <button type="button" onClick={() => onChange({ ...draft, attachmentPath: "" })} className={cn(chip, "border-stone-700 text-stone-400 hover:bg-stone-900")}>
              <Trash2 className="size-3" /> Take it away
            </button>
          </>
        ) : null}
        <span className="text-[10px] text-stone-600">Tag it &quot;rules&quot; and the DM can quote it.</span>
        {pdfError ? <span className="text-[11px] text-red-400">{pdfError}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={draft.tags}
          onChange={(event) => onChange({ ...draft, tags: event.target.value })}
          placeholder="Tags, comma separated (optional)"
          className="min-w-40 flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
        />
        <AddFromList prompt="Add a tag you already use" options={knownTags} onPick={(tag) => onChange({ ...draft, tags: appendTerm(draft.tags, tag) })} />
      </div>
    </>
  );
}

// The third chip (section 5.1): the table, or some of it by name.
function AudienceSelect({
  audience,
  members,
  onChange,
}: {
  audience: string[] | null;
  members: Array<{ userId: string; username: string }>;
  onChange: (audience: string[] | null) => void;
}) {
  const some = audience !== null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-pressed={!some}
        onClick={() => onChange(null)}
        className={cn(chip, !some ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-stone-700 text-stone-400")}
      >
        <Users className="size-3" /> Everyone
      </button>
      <button
        type="button"
        aria-pressed={some}
        onClick={() => onChange(some ? audience : [])}
        className={cn(chip, some ? "border-sky-700 bg-sky-950/40 text-sky-200" : "border-stone-700 text-stone-400")}
      >
        <Eye className="size-3" /> Some players
      </button>
      {some
        ? members.map((member) => {
            const on = audience.includes(member.userId);
            return (
              <button
                key={member.userId}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? audience.filter((id) => id !== member.userId) : [...audience, member.userId])}
                className={cn(chip, on ? "border-sky-600 bg-sky-950/60 text-sky-100" : "border-stone-800 text-stone-500")}
              >
                {on ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                {member.username}
              </button>
            );
          })
        : null}
      {some && audience.length === 0 ? (
        <span className="flex items-center gap-1 text-[10px] text-amber-300">
          <X className="size-3" /> Pick at least one, or it reads as everyone.
        </span>
      ) : null}
    </div>
  );
}
