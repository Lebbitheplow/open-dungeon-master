"use client";

import { useState } from "react";
import { AlertTriangle, BookOpen, Copy, Info, Loader2, OctagonX, Trash2 } from "lucide-react";
import { RulebookDialog } from "@/components/rulebook/RulebookDialog";
import { ui } from "@/lib/ui";
import { SectionHead } from "@/components/ui/SectionHead";
import { KIND_GLYPHS } from "@/app/workshop/homebrew/HomebrewIcon";
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
import { HazardFields } from "@/app/workshop/homebrew/HazardFields";
import { homebrewAvailability } from "@/lib/homebrew/availability";
import { subclassLevelFor } from "@/lib/srd/features";
import { CopySource } from "@/app/workshop/homebrew/CopySource";
import dynamic from "next/dynamic";

// The class form and the catalog it borrows from load when a class is
// opened, not with the workshop (scripts/bundle-budget.json).
const ClassFields = dynamic(() => import("@/app/workshop/homebrew/ClassFields").then((module) => module.ClassFields), {
  loading: () => <p className="text-xs text-stone-500">Loading the class form...</p>,
});

// A spell draft that already names its classes searches that class's list
// first; the catalogue is otherwise the whole book.
function catalogScope(draft: HomebrewDraft): Record<string, string> {
  // A subclass starts from its own class's subclasses.
  if (draft.kind === "archetype") {
    const classSlug = String(draft.data.classSlug ?? "");
    return classSlug ? { class: classSlug } : {};
  }
  if (draft.kind !== "spell") return {};
  const classes = Array.isArray(draft.data.classes) ? (draft.data.classes as string[]) : [];
  return classes.length ? { class: String(classes[0]).toLowerCase() } : {};
}

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
  savedName,
  busy,
  error,
  notice = "",
  variantRules,
  onDraft,
  onSave,
  onDuplicate,
  onDelete,
  workshopClasses = [],
}: {
  draft: HomebrewDraft;
  isNew: boolean;
  // The name it was saved under, for an entry that exists.
  savedName?: string;
  busy: boolean;
  error: string;
  // What the last save did besides saving (a rename carried everywhere).
  notice?: string;
  variantRules: Partial<VariantRules>;
  onDraft: (draft: HomebrewDraft) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  // The author's own classes, for a subclass to sit under.
  workshopClasses?: Array<{ id: string; name: string; subclassLevel?: number }>;
}) {
  const findings = draftFindings(draft, variantRules, isNew ? undefined : savedName);
  const refused = findings.some((finding) => finding.level === "error");
  const setData = (data: HomebrewDraft["data"]) => onDraft({ ...draft, data });
  // The rulebook page a finding measures against, open over the draft.
  const [reading, setReading] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div data-tour="homebrew-start">
        <SectionHead title="Start from the books" glyph="tab-reference" />
        <CatalogStart
          kind={draft.kind}
          scope={catalogScope(draft)}
          onPick={(entry, extra) => onDraft(draftFromCatalog(draft.kind, entry, extra))}
        />
      </div>

      <CopySource kind={draft.kind} draft={draft} />

      <SectionHead title={`The ${KIND_SINGULAR[draft.kind]}`} glyph={KIND_GLYPHS[draft.kind]} className="mb-0" />
      <TextField
        label="Name"
        value={draft.name}
        onChange={(name) => onDraft({ ...draft, name: name.slice(0, 80) })}
        placeholder={`What this ${KIND_SINGULAR[draft.kind]} is called`}
        maxLength={80}
      />

      {draft.kind === "item" ? <ItemFields data={draft.data} onChange={setData} /> : null}
      {draft.kind === "spell" ? <SpellFields data={draft.data} onChange={setData} /> : null}
      {draft.kind === "hazard" ? <HazardFields data={draft.data} onChange={setData} /> : null}
      {draft.kind === "class" ? <ClassFields data={draft.data} set={(patch) => setData({ ...draft.data, ...patch })} /> : null}
      {draft.kind !== "item" && draft.kind !== "spell" && draft.kind !== "hazard" && draft.kind !== "class" ? (
        <OptionFields kind={draft.kind} data={draft.data} onChange={setData} workshopClasses={workshopClasses} />
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
        hint={
          draft.kind === "spell"
            ? "What players read. The engine reads the damage, the save and the damage type out of it only where the block above leaves them empty; \"What the table resolves\" says which it used."
            : undefined
        }
      />

      {findings.length ? (
        <ul className="panel stagger space-y-1 rounded-lg p-3">
          {findings.map((finding, index) => {
            const { icon: Icon, className } = LEVEL_STYLE[finding.level];
            return (
              <li key={index} className={cn("flex items-start gap-1.5 text-xs", className)}>
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {finding.text}
                  {finding.page ? (
                    <button
                      type="button"
                      onClick={() => setReading(finding.page ?? null)}
                      className="motion-press ml-1.5 inline-flex items-center gap-0.5 text-stone-500 underline-offset-2 hover:text-amber-200 hover:underline"
                    >
                      <BookOpen className="size-3" /> the rule
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {reading ? <RulebookDialog open onOpenChange={(open) => !open && setReading(null)} startAt={reading} /> : null}

      {error ? <p role="alert" className="motion-shake text-xs text-red-400">{error}</p> : null}
      {notice ? <p role="status" className="live-in text-xs text-emerald-400">{notice}</p> : null}
      {!isNew ? (
        // Where it is offered, said once it is kept (workshop import audit F06).
        <p className="flex items-start gap-1.5 text-xs text-stone-400" data-testid="homebrew-availability">
          <Info className="mt-0.5 size-3.5 shrink-0 text-sky-300/70" aria-hidden="true" />
          <span>{homebrewAvailability(draft.kind, archetypeParent(draft, workshopClasses))}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          disabled={busy || refused || !draft.name.trim()}
          onClick={onSave}
          data-tour="homebrew-save"
          className={ui.btnPrimary}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {isNew ? "Keep it" : "Save"}
        </button>
        {!isNew ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onDuplicate}
              className={ui.btnSecondary}
            >
              <Copy className="size-3.5" /> Duplicate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className={cn(ui.btnSmall, "ml-auto hover:border-red-500/50 hover:text-red-300")}
            >
              <Trash2 className="size-3.5" /> Forget it
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// A subclass's class, by name, and the level it picks its subclass at.
function archetypeParent(draft: HomebrewDraft, workshopClasses: Array<{ id: string; name: string; subclassLevel?: number }>): { name: string; subclassLevel: number | null } | undefined {
  if (draft.kind !== "archetype") return undefined;
  const classId = String(draft.data.classSlug ?? "");
  const own = workshopClasses.find((klass) => klass.id === classId);
  if (own) return { name: own.name, subclassLevel: own.subclassLevel ?? null };
  return classId ? { name: classId.charAt(0).toUpperCase() + classId.slice(1), subclassLevel: subclassLevelFor(classId) ?? null } : undefined;
}
