"use client";

import { Check, Download, Loader2, Puzzle, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useTourPrepare } from "@/lib/tours/prepare";
import { readLoad, readWrite } from "@/lib/load-state";
import { draftCount, worldPackDraftSchema, type WorldPackDraft } from "@/lib/worlds/draft";
import { LoadFailed, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { useUnsavedDraft } from "@/app/workshop/unsaved";
import { ArtSection } from "@/app/workshop/plugin/ArtSection";
import { IdentitySection } from "@/app/workshop/plugin/IdentityFields";
import { MonsterSection } from "@/app/workshop/plugin/MonsterSection";
import { PluginWizard } from "@/app/workshop/plugin/PluginWizard";
import { PublishSection } from "@/app/workshop/plugin/PublishSection";
import { MagicSection, PeopleSection } from "@/app/workshop/plugin/ReskinSection";
import { SettingSection } from "@/app/workshop/plugin/SettingSection";
import { PLUGIN_SECTIONS, type Flushed, type SectionId } from "@/app/workshop/plugin/types";

// The Plugin system: a world pack written in the workshop.
//
// Both ways in that the plan asked for. Guided setup is a wizard over the
// identity fields, opened on its own the first time the tool is empty and
// again from the header whenever wanted. The tabs are the builder: every
// part of a pack as its own editor, each one picking from a catalog rather
// than typing an id. Pull from this workshop is the bridge between the
// tool and the rest of the workshop: factions, lore, places, hook cards
// and cast already built here become the pack's setting lists, and the
// Publish tab lists what they leave behind.
//
// The draft is one JSON value on the server (one per workshop) and the
// panel autosaves it a moment after each change, the whole value each
// time. Nothing here is written to the server's world directory until the
// Publish tab says so.
//
// The save contract (WA-03, WA-04). Writes go out one at a time, in the
// order they were made, so an older write can never land after a newer one
// or flip the badge after it. Leaving the tool saves first (the workshop's
// leave check, src/app/workshop/unsaved.ts), and a panel taken down inside
// the autosave pause sends its last edit rather than dropping it. Pull and
// export wait for the save and stop when it did not land: both read the
// server's copy, and an older copy is not the draft on screen.

const SAVE_DELAY_MS = 700;

// The browser keeps a request alive past its page only up to 64 KB, so a
// panel already gone sends a larger draft as an ordinary request.
const KEEPALIVE_BYTES = 60_000;
// A save that hears nothing for this long is given up, so the writes queued
// behind it (a reopened panel's read, Pull, Try again) are not held forever.
const SAVE_TIMEOUT_MS = 60_000;
// Said when Pull stops for a save that did not land; gone once one does.
const PULL_WAITS = "Pull waits for the draft to save, and it did not. Nothing was pulled; your changes are kept here. Try again.";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type StoredReply = { draft?: unknown; updatedAt?: string | null };

// One write at a time per workshop, kept across remounts, so a panel opened
// again reads the draft after the last write from its previous visit.
const chains = new Map<string, Promise<unknown>>();

function inTurn<T>(workshopId: string, write: () => Promise<T>): Promise<T> {
  const run = (chains.get(workshopId) ?? Promise.resolve()).then(write);
  chains.set(workshopId, run.catch(() => undefined));
  return run;
}

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
  // Why the last autosave did not land, shown with a way to send it again.
  const [saveError, setSaveError] = useState("");
  // Anything else the server refused: the load, a pull, Start blank.
  const [error, setError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullNotice, setPullNotice] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  // The draft on screen, which a queued write reads when its turn comes.
  const latest = useRef<WorldPackDraft | null>(null);
  // The draft the server has, so a save only goes out when something moved,
  // and the revision it holds, which an export names.
  const savedJson = useRef("");
  const revision = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A write that finishes after the panel is gone still counts on the
  // workshop's card, but sets nothing here.
  const mounted = useRef(false);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  useTourPrepare((name) => {
    if (name !== "open-plugin-wizard") return;
    setWizardOpen(true);
    return true;
  });

  // The stored draft as the panel's own, saved copy.
  const adopt = useCallback((stored: WorldPackDraft, updatedAt: string | null) => {
    latest.current = stored;
    savedJson.current = JSON.stringify(stored);
    revision.current = updatedAt;
    setDraft(stored);
  }, []);

  const load = useCallback(
    () =>
      // After any write still on its way from an earlier visit to this tool.
      (chains.get(workshopId) ?? Promise.resolve())
        .then(() => readLoad<StoredReply>(fetch(`/api/workshops/${workshopId}/plugin`), "The draft"))
        .then((outcome) => {
          if (!mounted.current) return;
          if (outcome.error !== null) {
            setError(outcome.error);
            return;
          }
          const parsed = worldPackDraftSchema.safeParse(outcome.payload.draft);
          if (!parsed.success) {
            setError("The draft could not be read.");
            return;
          }
          setError("");
          adopt(parsed.data, outcome.payload.updatedAt ?? null);
          // A draft nobody has touched opens on the guide.
          if (!outcome.payload.updatedAt && !parsed.data.name) {
            setWizardOpen(true);
          }
        }),
    [workshopId, adopt],
  );

  // Writes the draft on screen once the writes before it are done; true
  // when the server holds it after.
  const save = useCallback(
    (): Promise<boolean> =>
      inTurn(workshopId, async () => {
        const next = latest.current;
        const json = JSON.stringify(next);
        if (!next || json === savedJson.current) {
          // Nothing to send: an edit that came back to what the server holds
          // (a letter typed and deleted, a value picked again) is saved.
          if (next && mounted.current) {
            setSaveError("");
            setSaveState("saved");
          }
          return true;
        }
        const live = mounted.current;
        if (live) setSaveState("saving");
        const body = JSON.stringify({ draft: next });
        const sent = await readWrite<StoredReply>(
          fetch(`/api/workshops/${workshopId}/plugin`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: !live && new TextEncoder().encode(body).length < KEEPALIVE_BYTES,
            signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
          }),
          "The draft could not be saved.",
        );
        if (sent.error !== null) {
          if (mounted.current) {
            setSaveError(sent.error);
            setSaveState("error");
          }
          return false;
        }
        savedJson.current = json;
        revision.current = sent.payload.updatedAt ?? null;
        onChangedRef.current?.(draftCount(next));
        if (mounted.current) {
          setSaveError("");
          // An edit made while this write was out is still to go.
          setSaveState(JSON.stringify(latest.current) === json ? "saved" : "dirty");
        }
        return true;
      }),
    [workshopId],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Taken down inside the autosave pause (a header link, the browser's
      // Back): the last edit is sent, not cancelled.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void save();
      }
    };
  }, [save]);

  useEffect(() => {
    void load();
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setIsAdmin(Boolean(data?.user?.isAdmin)))
      .catch(() => undefined);
  }, [load]);

  // Every edit lands here. The write goes out after a pause so a person
  // typing a blurb does not send thirty saves.
  const update = useCallback(
    (next: WorldPackDraft) => {
      latest.current = next;
      setDraft(next);
      setSaveState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void save();
      }, SAVE_DELAY_MS);
    },
    [save],
  );

  // Writes the draft now rather than after the autosave pause.
  const flushSave = useCallback(async (): Promise<Flushed> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return (await save()) ? { ok: true, revision: revision.current } : { ok: false };
  }, [save]);

  // Unsaved, saving or refused: leaving the tool saves first, and asks only
  // when that did not land.
  const flushOnLeave = useCallback(() => flushSave().then((result) => result.ok), [flushSave]);
  useUnsavedDraft(saveState === "dirty" || saveState === "saving" || saveState === "error", flushOnLeave);

  async function pull() {
    setPulling(true);
    setPullNotice("");
    setError("");
    try {
      // The pull merges into the server's copy and hands that back for the
      // screen, so it goes only once the screen's copy is the server's.
      if (!(await flushSave()).ok) {
        setError(PULL_WAITS);
        return;
      }
      const sent = await inTurn(workshopId, () =>
        readWrite<StoredReply & { added?: number; omissions?: Array<{ assets: string[] }> }>(
          fetch(`/api/workshops/${workshopId}/plugin/pull`, { method: "POST" }),
          "Nothing could be pulled.",
        ),
      );
      if (sent.error !== null) {
        setError(sent.error);
        // No answer: the pull may have landed, so the screen reads the draft again.
        if (sent.unanswered) void load();
        return;
      }
      const data = sent.payload;
      const parsed = worldPackDraftSchema.safeParse(data.draft);
      if (parsed.success) {
        adopt(parsed.data, data.updatedAt ?? null);
        setSaveState("saved");
        onChangedRef.current?.(draftCount(parsed.data));
      }
      // What stayed behind is listed whole on the Publish tab; the notice
      // only counts it, so a pull never reads as having taken everything.
      const left = (data.omissions ?? []).reduce((sum, omission) => sum + omission.assets.length, 0);
      const behind = left ? ` ${left} ${left === 1 ? "entry stays" : "entries stay"} in the workshop; Check & publish lists them.` : "";
      setPullNotice(
        data.added
          ? `Pulled ${data.added} ${data.added === 1 ? "entry" : "entries"} into the setting lists.${behind}`
          : `Nothing new to pull.${behind || " Write some factions, lore, places or hook cards first."}`,
      );
    } finally {
      setPulling(false);
    }
  }

  // Start blank. The pending autosave is cancelled and the throw-away waits
  // its turn, so no save still on its way can bring the old draft back.
  async function clear() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setError("");
    const sent = await inTurn(workshopId, () =>
      readWrite<StoredReply>(fetch(`/api/workshops/${workshopId}/plugin`, { method: "DELETE" }), "The draft could not be thrown away."),
    );
    if (sent.error !== null) {
      setError(`${sent.error} The draft on screen is kept.`);
      // The edit whose autosave was cancelled above still goes.
      if (JSON.stringify(latest.current) !== savedJson.current) void save();
      return;
    }
    const parsed = worldPackDraftSchema.safeParse(sent.payload.draft);
    if (!parsed.success) {
      void load();
      return;
    }
    adopt(parsed.data, sent.payload.updatedAt ?? null);
    setSaveState("saved");
    setSaveError("");
    onChangedRef.current?.(0);
    setSection("identity");
  }

  if (!draft) {
    return (
      <div className="flex justify-center py-10">
        {error ? (
          <LoadFailed
            error={error}
            onRetry={() => {
              setError("");
              void load();
            }}
          />
        ) : (
          <Loader2 className="size-5 animate-spin text-stone-500" />
        )}
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
        {pullNotice ? <p className="live-in basis-full text-xs text-amber-200/90">{pullNotice}</p> : null}
        {saveState === "error" && saveError ? (
          <LoadFailed error={`${saveError} Your changes are kept here.`} onRetry={() => void flushSave()} className="basis-full" />
        ) : null}
        {error && !(error === PULL_WAITS && saveState === "saved") ? <PanelError className="basis-full">{error}</PanelError> : null}
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

      <div key={section} className="motion-tab">
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
            saved={saveState === "saved"}
            onClear={clear}
          />
        ) : null}
      </div>

      <Sheet
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        title="Guided setup"
        hideTitle
        className="top-0 h-dvh max-h-none rounded-none pt-[max(0.5rem,env(safe-area-inset-top))] lg:top-1/2 lg:h-[min(92vh,44rem)] lg:w-[min(96vw,48rem)] lg:rounded-xl"
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
