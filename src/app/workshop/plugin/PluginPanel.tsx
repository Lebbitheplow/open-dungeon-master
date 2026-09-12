"use client";

import { Check, Download, Loader2, Puzzle, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useTourPrepare } from "@/lib/tours/prepare";
import { draftCount, worldPackDraftSchema, type WorldPackDraft } from "@/lib/worlds/draft";
import { ArtSection } from "@/app/workshop/plugin/ArtSection";
import { IdentitySection } from "@/app/workshop/plugin/IdentityFields";
import { MonsterSection } from "@/app/workshop/plugin/MonsterSection";
import { PluginWizard } from "@/app/workshop/plugin/PluginWizard";
import { PublishSection } from "@/app/workshop/plugin/PublishSection";
import { MagicSection, PeopleSection } from "@/app/workshop/plugin/ReskinSection";
import { SettingSection } from "@/app/workshop/plugin/SettingSection";
import { PLUGIN_SECTIONS, type SectionId } from "@/app/workshop/plugin/types";

// The Plugin system: a world pack written in the workshop.
//
// Both ways in that the plan asked for. Guided setup is a wizard over the
// identity fields, opened on its own the first time the tool is empty and
// again from the header whenever wanted. The tabs are the builder: every
// part of a pack as its own editor, each one picking from a catalog rather
// than typing an id. Pull from this workshop is the bridge between the
// tool and the rest of the workshop: lore, places, hook cards and cast
// already built here become the pack's setting lists.
//
// The draft is one JSON value on the server (one per workshop) and the
// panel autosaves it a moment after each change, the whole value each
// time. Nothing here is written to the server's world directory until the
// Publish tab says so.

const SAVE_DELAY_MS = 700;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function PluginPanel({
  workshopId,
  onChanged,
}: {
  workshopId: string;
  onChanged?: (count: number) => void;
}) {
  const [draft, setDraft] = useState<WorldPackDraft | null>(null);
  const [section, setSection] = useState<SectionId>("identity");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullNotice, setPullNotice] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  // The draft the server has, so a save only goes out when something moved.
  const savedJson = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useTourPrepare((name) => {
    if (name === "open-plugin-wizard") setWizardOpen(true);
  });

  const load = useCallback(
    () =>
      fetch(`/api/workshops/${workshopId}/plugin`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { draft?: unknown; updatedAt?: string | null } | null) => {
          const parsed = worldPackDraftSchema.safeParse(data?.draft);
          if (!parsed.success) {
            setError("The draft could not be read.");
            return;
          }
          savedJson.current = JSON.stringify(parsed.data);
          setDraft(parsed.data);
          // A draft nobody has touched opens on the guide.
          if (!data?.updatedAt && !parsed.data.name) {
            setWizardOpen(true);
          }
        })
        .catch(() => setError("Could not reach the server.")),
    [workshopId],
  );

  useEffect(() => {
    void load();
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setIsAdmin(Boolean(data?.user?.isAdmin)))
      .catch(() => undefined);
  }, [load]);

  const save = useCallback(
    async (next: WorldPackDraft) => {
      const json = JSON.stringify(next);
      if (json === savedJson.current) {
        setSaveState("saved");
        return;
      }
      setSaveState("saving");
      try {
        const response = await fetch(`/api/workshops/${workshopId}/plugin`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: next }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error ?? "The draft could not be saved.");
          setSaveState("error");
          return;
        }
        savedJson.current = json;
        setError("");
        setSaveState("saved");
        onChanged?.(draftCount(next));
      } catch {
        setError("Could not reach the server; the last change is not saved.");
        setSaveState("error");
      }
    },
    [workshopId, onChanged],
  );

  // Every edit lands here. The write goes out after a pause so a person
  // typing a blurb does not send thirty saves.
  const update = useCallback(
    (next: WorldPackDraft) => {
      setDraft(next);
      setSaveState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(next), SAVE_DELAY_MS);
    },
    [save],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flushSave = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (draft) await save(draft);
  }, [draft, save]);

  async function pull() {
    setPulling(true);
    setPullNotice("");
    try {
      await flushSave();
      const response = await fetch(`/api/workshops/${workshopId}/plugin/pull`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Nothing could be pulled.");
        return;
      }
      const parsed = worldPackDraftSchema.safeParse(data.draft);
      if (parsed.success) {
        savedJson.current = JSON.stringify(parsed.data);
        setDraft(parsed.data);
        setSaveState("saved");
        onChanged?.(draftCount(parsed.data));
      }
      const refusals = (data.refusals ?? []) as Array<{ reason: string }>;
      setPullNotice(
        data.added
          ? `Pulled ${data.added} ${data.added === 1 ? "entry" : "entries"} into the setting lists.${refusals.length ? ` ${refusals[0].reason}` : ""}`
          : `Nothing new to pull. ${refusals[0]?.reason ?? "Write some lore, places or hook cards first."}`,
      );
    } finally {
      setPulling(false);
    }
  }

  async function clear() {
    const response = await fetch(`/api/workshops/${workshopId}/plugin`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    const parsed = worldPackDraftSchema.safeParse(data?.draft);
    if (parsed.success) {
      savedJson.current = JSON.stringify(parsed.data);
      setDraft(parsed.data);
      setSaveState("saved");
      onChanged?.(0);
      setSection("identity");
    }
  }

  if (!draft) {
    return (
      <div className="flex justify-center py-10">
        {error ? <p className="text-sm text-red-300">{error}</p> : <Loader2 className="size-5 animate-spin text-stone-500" />}
      </div>
    );
  }

  const count = draftCount(draft);
  const cover = draft.art.cover;

  return (
    <div className="space-y-4">
      <section className={cn(ui.card, "flex flex-wrap items-center gap-3 p-3")}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-12 w-20 shrink-0 rounded-md border border-amber-400/20 object-cover" />
        ) : (
          <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-stone-700 text-stone-600">
            <Puzzle className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display tracking-wide text-amber-50">{draft.name.trim() || "An unnamed world"}</p>
          <p className="text-[11px] text-stone-500">
            {count ? `${count} ${count === 1 ? "entry" : "entries"}` : "Nothing named yet"}
            {Object.keys(draft.art).length ? `, ${Object.keys(draft.art).length} pictures` : ""}
            <span className="ml-2 inline-flex items-center gap-1 text-stone-600" aria-live="polite">
              {saveState === "saving" ? <Loader2 className="size-3 animate-spin" /> : null}
              {saveState === "saved" ? <Check className="size-3 text-emerald-500" /> : null}
              {saveState === "saving" ? "saving" : saveState === "saved" ? "saved" : saveState === "dirty" ? "unsaved" : saveState === "error" ? "not saved" : ""}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setWizardOpen(true)} data-tour="plugin-guided" className={cn(ui.btnSmall, "text-xs")}>
            <Wand2 className="size-3.5" /> Guided setup
          </button>
          <button type="button" onClick={() => void pull()} disabled={pulling} data-tour="plugin-pull" className={cn(ui.btnSmall, "text-xs")}>
            {pulling ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Pull from this workshop
          </button>
          <button type="button" onClick={() => setSection("publish")} data-tour="plugin-publish" className={cn(ui.btnSmall, "text-xs")}>
            <Download className="size-3.5" /> Check &amp; publish
          </button>
        </div>
        {pullNotice ? <p className="basis-full text-xs text-amber-200/90">{pullNotice}</p> : null}
        {error ? <p className="basis-full text-xs text-red-300">{error}</p> : null}
      </section>

      <div data-tour="plugin-sections" className="w-fit max-w-full">
        <SegmentedControl
          options={PLUGIN_SECTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
          value={section}
          onChange={setSection}
          size="sm"
          label="Part of the pack"
        />
      </div>

      {section === "identity" ? <IdentitySection draft={draft} onDraft={update} /> : null}
      {section === "people" ? <PeopleSection draft={draft} onDraft={update} /> : null}
      {section === "magic" ? <MagicSection draft={draft} onDraft={update} /> : null}
      {section === "bestiary" ? <MonsterSection draft={draft} onDraft={update} /> : null}
      {section === "setting" ? <SettingSection draft={draft} onDraft={update} /> : null}
      {section === "art" ? <ArtSection draft={draft} onDraft={update} /> : null}
      {section === "publish" ? (
        <PublishSection
          draft={draft}
          onDraft={update}
          workshopId={workshopId}
          isAdmin={isAdmin}
          flushSave={flushSave}
          onClear={clear}
        />
      ) : null}

      <Sheet
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        title="Guided setup"
        hideTitle
        className="top-0 h-dvh max-h-none rounded-none lg:top-1/2 lg:h-[min(92vh,44rem)] lg:w-[min(96vw,48rem)] lg:rounded-xl"
      >
        <PluginWizard
          draft={draft}
          onDraft={update}
          onCancel={() => setWizardOpen(false)}
          onDone={(pullNow) => {
            setWizardOpen(false);
            setSection("people");
            if (pullNow) void pull();
          }}
        />
      </Sheet>
    </div>
  );
}
