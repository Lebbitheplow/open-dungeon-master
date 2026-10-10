"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { RulebookDialog } from "@/components/rulebook/RulebookDialog";
import { CONTENT_KIND } from "@/app/workshop/homebrew/CatalogStart";
import { draftFromCatalog, type CopiedFrom, type HomebrewDraft } from "@/app/workshop/homebrew/draft";
import type { PickerEntry } from "@/app/characters/builder/useContentSearch";
import type { EditorKind } from "@/app/workshop/homebrew/types";

// Where a copy came from, kept on the entry (draft.ts copiedFromOf): the
// entry it started as and its book, the rulebook page it is printed on
// (opened over the editor, so the draft stays where it is), and what the
// copy has changed since, worked out against the source as the catalog
// serves it now.

// The words a changed field is called by.
const FIELD_LABELS: Record<string, string> = {
  desc: "description",
  higher_level: "at higher levels",
  level: "level",
  school: "school",
  classes: "classes",
  ritual: "ritual",
  concentration: "concentration",
  casting_time: "casting time",
  range: "range",
  components: "components",
  duration: "duration",
  material: "material",
  materialCostGp: "material cost",
  materialConsumed: "material consumed",
  mech: "mechanics block",
  runsAs: "runs as",
  itemKind: "kind",
  rarity: "rarity",
  cost: "cost",
  weight: "weight",
  weapon: "weapon",
  armor: "armour",
  effects: "effects",
  weaponRiders: "weapon riders",
  armorRiders: "armour riders",
  charges: "charges",
  checks: "check bonuses",
  spells: "spells it casts",
  requiresAttunement: "attunement",
  attunedBy: "who may attune",
  cursed: "curse",
  prerequisite: "prerequisite",
  grants: "grants",
  feature: "feature",
  feature_desc: "feature text",
  traits: "traits",
  size: "size",
  speed: "speed",
  asi: "ability scores",
  languages: "languages",
  levels: "features by level",
  classSlug: "class",
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The fields a draft holds that differ from the draft its source would make.
export function changedFields(draft: HomebrewDraft, source: HomebrewDraft): string[] {
  const keys = new Set([...Object.keys(draft.data), ...Object.keys(source.data)]);
  keys.delete("copiedFrom");
  return [...keys]
    .filter((key) => !same(draft.data[key], source.data[key]) && !(draft.data[key] === "" && source.data[key] === undefined))
    .map((key) => FIELD_LABELS[key] ?? key);
}

export function CopySource({ kind, draft }: { kind: EditorKind; draft: HomebrewDraft }) {
  const from = draft.data.copiedFrom as CopiedFrom | undefined;
  const [reading, setReading] = useState(false);
  const [source, setSource] = useState<PickerEntry | null>(null);
  const [lookedUp, setLookedUp] = useState(false);

  useEffect(() => {
    if (!from?.name) return;
    let live = true;
    const url = from.slug?.startsWith("homebrew:")
      ? `/api/content/${CONTENT_KIND[kind]}/${encodeURIComponent(from.slug)}`
      : `/api/content/${CONTENT_KIND[kind]}?${new URLSearchParams({ q: from.name, mechanics: "1", limit: "20", ...(kind === "archetype" && draft.data.classSlug ? { class: String(draft.data.classSlug) } : {}) })}`;
    fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { results?: PickerEntry[]; entry?: PickerEntry } | null) => {
        if (!live) return;
        const rows = body?.results ?? (body?.entry ? [body.entry] : []);
        setSource(rows.find((row) => (from.slug && row.slug === from.slug) || row.name === from.name) ?? null);
        setLookedUp(true);
      })
      .catch(() => live && setLookedUp(true));
    return () => {
      live = false;
    };
    // The source is looked up once per copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.name, from?.slug, kind]);

  const changes = useMemo(
    () => (source ? changedFields(draft, draftFromCatalog(kind, source, { classSlug: String(draft.data.classSlug ?? "") || undefined })) : null),
    [source, draft, kind],
  );

  if (!from?.name) return null;
  // Where it came from: the table's own shelf, the bundled book, or the
  // book a pack row is printed in.
  const where = from.source === "homebrew" ? "your homebrew" : from.source === "bundled" ? "the bundled SRD 5.1" : from.document || "the published books";
  return (
    <div className="panel space-y-1 rounded-lg px-3 py-2 text-xs text-stone-400" data-testid="copy-source">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Copied from <span className="text-amber-200/80">{from.name}</span> ({where}).
        </span>
        {from.rulebook ? (
          <button type="button" onClick={() => setReading(true)} className={cn(ui.btnSmall, "motion-press gap-1")}>
            <BookOpen className="size-3.5" /> Read it in the rulebook
          </button>
        ) : null}
      </div>
      {changes === null ? (
        lookedUp ? <p className="text-stone-500">The source is not in the catalog any more, so what changed cannot be shown.</p> : null
      ) : changes.length ? (
        <p>Changed from it: {changes.join(", ")}.</p>
      ) : (
        <p>Nothing changed from it yet.</p>
      )}
      {from.rulebook ? <RulebookDialog open={reading} onOpenChange={setReading} startAt={from.rulebook} /> : null}
    </div>
  );
}
