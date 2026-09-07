"use client";

import { AlertTriangle, Copy, Info, Loader2, OctagonX, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { VariantRules } from "@/lib/rulesets/logic";
import type { Finding } from "@/lib/rulesets/validate";
import { CatalogStart } from "@/app/workshop/homebrew/CatalogStart";
import { TextArea, TextField } from "@/app/workshop/homebrew/fields";
import { ItemFields } from "@/app/workshop/homebrew/ItemFields";
import { OptionFields } from "@/app/workshop/homebrew/OptionFields";
import { SpellFields } from "@/app/workshop/homebrew/SpellFields";
import { draftFindings, draftFromCatalog, type HomebrewDraft } from "@/app/workshop/homebrew/draft";
import { KIND_SINGULAR } from "@/app/workshop/homebrew/types";

// One homebrew entry, open for editing: its name and description, the
// fields its kind carries, and what the table's ruleset says about it. The
// findings run on every keystroke through src/lib/rulesets/validate.ts, so
// a weapon that hits harder than anything in the SRD is flagged while the
// DM is still deciding, not after they saved it.

const LEVEL_STYLE: Record<Finding["level"], { icon: typeof Info; className: string }> = {
  error: { icon: OctagonX, className: "text-red-300" },
  warn: { icon: AlertTriangle, className: "text-amber-300" },
  note: { icon: Info, className: "text-stone-400" },
};

export function HomebrewEditor({
  draft,
  isNew,
  busy,
  error,
  variantRules,
  onDraft,
  onSave,
  onDuplicate,
  onDelete,
}: {
  draft: HomebrewDraft;
  isNew: boolean;
  busy: boolean;
  error: string;
  variantRules: Partial<VariantRules>;
  onDraft: (draft: HomebrewDraft) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const findings = draftFindings(draft, variantRules);
  const refused = findings.some((finding) => finding.level === "error");
  const setData = (data: HomebrewDraft["data"]) => onDraft({ ...draft, data });

  return (
    <div className="space-y-3">
      <div data-tour="homebrew-start">
        <CatalogStart
          kind={draft.kind}
          onPick={(entry, extra) => onDraft(draftFromCatalog(draft.kind, entry, extra))}
        />
      </div>

      <TextField
        label="Name"
        value={draft.name}
        onChange={(name) => onDraft({ ...draft, name: name.slice(0, 80) })}
        placeholder={`What this ${KIND_SINGULAR[draft.kind]} is called`}
        maxLength={80}
      />

      {draft.kind === "item" ? <ItemFields data={draft.data} onChange={setData} /> : null}
      {draft.kind === "spell" ? <SpellFields data={draft.data} onChange={setData} /> : null}
      {draft.kind !== "item" && draft.kind !== "spell" ? (
        <OptionFields kind={draft.kind} data={draft.data} onChange={setData} />
      ) : null}

      <TextArea
        label="Description"
        value={String(draft.data.desc ?? "")}
        onChange={(desc) => setData({ ...draft.data, desc })}
        rows={draft.kind === "spell" ? 5 : 3}
        placeholder={
          draft.kind === "spell"
            ? "Each creature in a 15-foot cone must make a Dexterity saving throw, taking 3d6 fire damage on a failed save, or half as much on a successful one."
            : "What it is, in the words the players will read."
        }
        hint={draft.kind === "spell" ? "The engine reads the damage, the save and the damage type out of this." : undefined}
      />

      {findings.length ? (
        <ul className="space-y-1 rounded-md border border-stone-800 bg-stone-950/60 p-2">
          {findings.map((finding, index) => {
            const { icon: Icon, className } = LEVEL_STYLE[finding.level];
            return (
              <li key={index} className={cn("flex items-start gap-1.5 text-[11px]", className)}>
                <Icon className="mt-0.5 size-3 shrink-0" />
                <span>{finding.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy || refused || !draft.name.trim()}
          onClick={onSave}
          data-tour="homebrew-save"
          className="flex items-center gap-1 rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          {isNew ? "Keep it" : "Save"}
        </button>
        {!isNew ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onDuplicate}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              <Copy className="size-3" /> Duplicate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="ml-auto flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-500 hover:text-red-300 disabled:opacity-50"
            >
              <Trash2 className="size-3" /> Forget it
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
