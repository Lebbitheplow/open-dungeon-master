"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Listed, PanelError, RowMenu, panelRow } from "@/app/campaigns/[campaignId]/PanelKit";
import { findLostCreate, readLoad, readWrite, useLoadStatus, type LostCreate } from "@/lib/load-state";
import { formatRoster, rosterSummary, TEMPLATE_NAME_MAX } from "@/lib/dm/encounter-template-logic";
import { thresholdsForParty } from "@/lib/srd/encounter-math";
import { targetPartyLevels, type TargetParty } from "@/lib/workshop/kind";
import { Sheet } from "@/components/ui/Sheet";
import { useTourPrepare } from "@/lib/tours/prepare";
import { DmWorkbenchPanel } from "@/app/campaigns/[campaignId]/DmWorkbenchPanel";
import { EncounterForm } from "@/app/workshop/encounters/EncounterForm";
import { EncounterRows } from "@/app/workshop/encounters/EncounterRows";
import {
  EMPTY_ENCOUNTER_DRAFT,
  type EncounterDraft,
  type MapOption,
  type PreparedEncounter,
  type TemplateReadout,
} from "@/app/workshop/encounters/types";
import { useOpenOnArrival } from "@/app/workshop/world/WorldEntryLink";

// Prepared encounters: the roster a DM writes down before the session and
// deploys in one action.
//
// The difficulty line under each one is not stored. It is recomputed on
// every read from the party as it stands today, because the party levels up
// between the prep and the table and a saved verdict would quietly go stale.
//
// Two layouts over one set of requests. "list" is the DM console's: the
// prepared fights as compact entries with the create form underneath. "rows"
// is the workshop's: the what-if workbench folded into a card at the top,
// one full-width row per fight with a CR budget bar, and the editor in a
// sheet. The bar's thresholds come from the target party the caller passes,
// through the same thresholdsForParty the workbench route and the target
// party bar read, so the three never disagree about what "deadly" is.

// At a table the AI narrates (where the lead cues fights), the storyteller
// cuts a fight beyond the party down to fit, or holds it when even its
// strongest creature is too much (src/lib/dm/prepared-fit.ts); a DM's own
// Deploy is refused as written, for the DM to change.
function refusedLine(readout: TemplateReadout, cue: boolean): string {
  if (!readout.tooDeadly) {
    return "";
  }
  if (cue && readout.held) {
    return ". Beyond the party even cut down: the storyteller holds it until they are stronger.";
  }
  if (cue && readout.scaledWithout) {
    return `. The storyteller cuts it to fit: it runs without ${readout.scaledWithout}.`;
  }
  return ". The engine will refuse this as written.";
}

function DifficultyLine({ readout, cue }: { readout: TemplateReadout; cue: boolean }) {
  if (readout.unknownMonster) {
    return (
      <p className="text-[11px] text-red-400">
        Nothing in this world is called &quot;{readout.unknownMonster}&quot;.
      </p>
    );
  }
  return (
    <p
      className={cn(
        "text-[11px]",
        !readout.tooDeadly ? "text-stone-400" : cue && readout.scaledWithout && !readout.held ? "text-amber-400" : "text-red-400",
      )}
    >
      {readout.count} creature{readout.count === 1 ? "" : "s"}, {readout.verdict} ({readout.adjustedXp} XP
      against a {readout.ceiling} ceiling)
      {refusedLine(readout, cue)}
    </p>
  );
}

export function DmEncounterPrepPanel({
  campaignId,
  layout = "list",
  targetParty,
  cue = false,
  openOnArrival,
  only = false,
  onClose,
}: {
  campaignId: string;
  // The fight to open on arrival, by id: a World entry's "Add to a fight"
  // (src/app/workshop/world/BoundRecords.tsx), a place's "Open encounter"
  // (PlaceBattleMaps.tsx).
  openOnArrival?: string | null;
  // That one fight's form and nothing else, in a sheet that calls onClose
  // when it shuts: the table's World tab, which has no list of its own.
  only?: boolean;
  onClose?: () => void;
  layout?: "list" | "rows";
  // The lead's desk at an AI-narrated table (#154): Deploy becomes a cue the
  // storyteller runs when the scene reaches the fight, and can be taken back.
  cue?: boolean;
  // Read only in rows mode: the party the CR budget bar is drawn against. A
  // workshop declares one; a real campaign has no need of it because the
  // console never shows the bar.
  targetParty?: TargetParty;
}) {
  const [templates, setTemplates] = useState<PreparedEncounter[]>([]);
  const [draft, setDraft] = useState<EncounterDraft>(EMPTY_ENCOUNTER_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [maps, setMaps] = useState<MapOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const rows = layout === "rows";

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  // A refused or failed list is settled, not dropped (issue 140), so the
  // list says "nothing prepared" only once the server has said so.
  // The list it read, or null when it could not, so a create whose answer
  // was lost can look for its fight.
  const { loaded, loadError, settle } = useLoadStatus();
  const load = useCallback(
    () =>
      readLoad<{ templates: PreparedEncounter[] }>(fetch(`/api/campaigns/${campaignId}/dm/encounter-templates`), "The prepared fights").then(
        (outcome) => {
          if (outcome.payload) {
            setTemplates(outcome.payload.templates);
          }
          settle(outcome);
          return outcome.payload?.templates ?? null;
        },
      ),
    [campaignId, settle],
  );

  // The map drawer, for the "On which map" link. Same load-once shape as the
  // templates themselves.
  const loadMaps = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/maps`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { maps: MapOption[] } | null) => {
          if (payload) {
            setMaps(payload.maps);
          }
        })
        .catch(() => {
          // transient; the picker just offers the generator until the next load
        }),
    [campaignId],
  );

  // The server costs every roster against the party it knows about, so when
  // the workshop's target party changes the readouts are stale until refetched.
  const partyKey = targetParty ? `${targetParty.size}:${targetParty.level}` : "";
  useEffect(() => {
    void load();
    void loadMaps();
  }, [load, loadMaps, partyKey]);

  // The tour's "open the editor" step, answered only where the editor is a
  // sheet; in the console the form is always on screen.
  useTourPrepare((name) => {
    if (name !== "open-encounter-editor") return;
    if (rows && !editorOpen) openEditor(null);
    return true;
  });

  useOpenOnArrival(openOnArrival, loaded ? templates : null, openEditor);

  function openEditor(template: PreparedEncounter | null) {
    setError("");
    setNote("");
    setEditingId(template?.id ?? null);
    setDraft(
      template
        ? {
            name: template.name,
            enemies: formatRoster(template.enemies),
            battlefield: template.battlefield,
            scene: template.map.scene ?? "",
            notes: template.notes,
            mapId: template.map.mapId ?? "",
            extras: template.extras,
          }
        : EMPTY_ENCOUNTER_DRAFT,
    );
    setEditorOpen(true);
  }

  // One request for both a new fight and an edit to an old one: the create
  // and update routes take the same body, so the only difference is where it
  // goes. The list layout never sets editingId and so always creates.
  function showEditor(open: boolean) {
    setEditorOpen(open);
    if (!open && only) onClose?.();
  }

  // Every write goes through readWrite (WA-05), so one that dies on the
  // connection is said here and leaves the roster in the form. A create
  // whose answer was lost never clears the form and never invites a blind
  // second press: the list is read again first, and the fight found there
  // counts as prepared.
  function lostCreate(found: LostCreate, what: { made: string; missing: string; unknown: string }) {
    if (found === "made") {
      setNote(what.made);
      return true;
    }
    setError(found === "missing" ? what.missing : what.unknown);
    return false;
  }

  async function save() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const base = `/api/campaigns/${campaignId}/dm/encounter-templates`;
      const sent = await readWrite(
        fetch(editingId ? `${base}/${editingId}` : base, {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            enemies: draft.enemies,
            battlefield: draft.battlefield,
            notes: draft.notes,
            map: { mapId: draft.mapId || null, scene: draft.scene || null },
            extras: draft.extras,
          }),
        }),
        "That could not be saved.",
      );
      if (sent.error !== null) {
        if (sent.unanswered && !editingId) {
          const name = draft.name.trim();
          const found = await findLostCreate(templates, load, (template) => template.name === name);
          const prepared = lostCreate(found, {
            made: "Prepared. The server's answer was lost on the way, so the list was read again to make sure.",
            missing: "The server did not answer and the fight is not in the list, so it was not prepared. Your roster is kept; press Prepare it again.",
            unknown: "The server could not be reached, so it is not known yet whether the fight was prepared. Your roster is kept. Check the list before preparing it again.",
          });
          if (prepared) {
            setDraft(EMPTY_ENCOUNTER_DRAFT);
            setEditingId(null);
            showEditor(false);
          }
          return;
        }
        setError(sent.unanswered ? `${sent.error} Your changes are kept here; the list was read again.` : sent.error);
        // An edit with no answer may have landed all the same.
        if (sent.unanswered) await load();
        return;
      }
      setDraft(EMPTY_ENCOUNTER_DRAFT);
      setEditingId(null);
      showEditor(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // A second copy of the fight, for the version-two-of-this-ambush workflow:
  // same create route, name suffixed, linked map carried along.
  async function duplicate(template: PreparedEncounter) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const name = `${template.name} (copy)`.slice(0, TEMPLATE_NAME_MAX);
      const sent = await readWrite(
        fetch(`/api/campaigns/${campaignId}/dm/encounter-templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            enemies: formatRoster(template.enemies),
            battlefield: template.battlefield,
            notes: template.notes,
            map: template.map,
            extras: template.extras,
          }),
        }),
        "That could not be copied.",
      );
      if (sent.error !== null) {
        if (sent.unanswered) {
          const copy = name.trim();
          const found = await findLostCreate(templates, load, (row) => row.name === copy);
          lostCreate(found, {
            made: "Copied. The server's answer was lost on the way, so the list was read again to make sure.",
            missing: "The server did not answer and the copy is not in the list, so it was not made. Duplicate it again.",
            unknown: "The server could not be reached, so it is not known yet whether the copy was made. Check the list before duplicating it again.",
          });
          return;
        }
        setError(sent.error);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Asks first, and a refusal is shown rather than swallowed.
  async function remove(template: PreparedEncounter) {
    const id = template.id;
    if (!(await appConfirm(`Delete the prepared fight "${template.name}"?`, { actionLabel: "Delete" }))) {
      return;
    }
    setError("");
    setNote("");
    const sent = await readWrite(fetch(`/api/campaigns/${campaignId}/dm/encounter-templates/${id}`, { method: "DELETE" }), "That could not be deleted.");
    if (sent.error !== null) {
      setError(sent.error);
      // No answer: it may be gone all the same, and the list says which.
      if (sent.unanswered) await load();
      return;
    }
    if (editingId === id) {
      setEditingId(null);
      setEditorOpen(false);
    }
    await load();
  }

  async function deploy(id: string, cueIt = true) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const sent = await readWrite<{ mapError?: string | null; cued?: boolean }>(
        fetch(`/api/campaigns/${campaignId}/dm/encounter-templates/${id}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cue ? { cue: cueIt } : {}),
        }),
        "That could not be deployed.",
      );
      if (sent.error !== null) {
        // A deploy with no answer may have put the fight on the table; a
        // second press would put it there twice.
        setError(sent.unanswered ? `${sent.error} The fight may already be on the table; look before deploying it again.` : sent.error);
        if (sent.unanswered) await load();
        return;
      }
      const payload = sent.payload;
      if (payload.cued !== undefined) {
        setNote(
          payload.cued
            ? "Cued. The storyteller runs it, map and plan included, as soon as the scene allows. The players are not told."
            : "Cue taken back.",
        );
        await load();
        return;
      }
      setNote(
        payload.mapError
          ? `The fight is on the table. Its saved map could not be used: ${payload.mapError}`
          : "The fight is on the table. Ask the party for initiative.",
      );
    } finally {
      setBusy(false);
    }
  }

  // In the sheet the sentence sits under a long form; a new one is scrolled
  // to, so it is seen as well as announced.
  const sheetFeedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) sheetFeedback.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const feedback = (
    <>
      {error ? <PanelError className="text-[11px]">{error}</PanelError> : null}
      {note ? <p className="live-in text-[11px] text-emerald-400">{note}</p> : null}
    </>
  );

  if (only) {
    const editing = templates.find((template) => template.id === editingId) ?? null;
    return (
      <Sheet open={editorOpen} onOpenChange={showEditor} title={editing ? editing.name : "Encounter"} className="lg:w-[min(92vw,40rem)]">
        <EncounterForm campaignId={campaignId} value={draft} onChange={setDraft} maps={maps} busy={busy} submitLabel="Save" onSubmit={() => void save()} variant="sheet" />
        <div ref={sheetFeedback} className="mt-2">{feedback}</div>
      </Sheet>
    );
  }

  if (rows) {
    const thresholds = targetParty ? thresholdsForParty(targetPartyLevels(targetParty)) : null;
    const editing = templates.find((template) => template.id === editingId) ?? null;
    return (
      <div className="space-y-3">
        <DmWorkbenchPanel campaignId={campaignId} collapsible />
        <Listed loaded={loaded} error={loadError} onRetry={() => void load()} loading="Opening the fights...">
          <EncounterRows
            encounters={templates}
            maps={maps}
            thresholds={thresholds}
            busy={busy}
            onOpen={openEditor}
            onDeploy={(template) => void deploy(template.id)}
            onDuplicate={(template) => void duplicate(template)}
            onDelete={(template) => void remove(template)}
          />
        </Listed>
        {feedback}
        <Sheet
          open={editorOpen}
          onOpenChange={showEditor}
          title={editing ? editing.name : "New encounter"}
          className="lg:w-[min(92vw,40rem)]"
        >
          <EncounterForm
            campaignId={campaignId}
            value={draft}
            onChange={setDraft}
            maps={maps}
            busy={busy}
            submitLabel={editing ? "Save" : "Prepare it"}
            onSubmit={() => void save()}
            variant="sheet"
          />
          <div ref={sheetFeedback} className="mt-2">{feedback}</div>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section>
        <SectionHead
          title="Prepared encounters"
          glyph="system-encounters"
          aside={templates.length ? <span key={templates.length} className="count-pop">{templates.length}</span> : undefined}
        />
        <Listed loaded={loaded} error={loadError} onRetry={() => void load()} loading="Opening the fights...">
        {templates.length ? (
          <ul className="stagger space-y-1.5">
            {templates.map((template) => {
              // Deploy stays the row's one visible button; the two that were
              // icons keep the names they announced, in the row's menu.
              const deployLabel = cue ? (template.cued ? "Take back the cue" : "Cue the storyteller") : "Deploy";
              const items: ContextMenuItem[] = [
                {
                  id: "deploy",
                  label: deployLabel,
                  glyph: "tab-battle",
                  disabled: busy,
                  onSelect: () => void deploy(template.id, !template.cued),
                },
                { id: "duplicate", label: `Duplicate ${template.name}`, glyph: "ui-duplicate", disabled: busy, onSelect: () => void duplicate(template) },
                { id: "delete", label: `Delete ${template.name}`, glyph: "ui-delete", tone: "danger", separated: true, onSelect: () => void remove(template) },
              ];
              return (
                <ContextMenu key={template.id} as="li" items={items} label={template.name} className={panelRow}>
                  <div className="flex items-start gap-2">
                    <GameIcon icon={{ kind: "glyph", key: "system-encounters" }} size="size-7" className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-stone-100">
                        {template.name}
                        {cue && template.cued ? (
                          <span className="live-in ml-1.5 rounded-sm border border-amber-500/40 px-1 text-[10px] text-amber-300">
                            cued
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-stone-400">
                        {rosterSummary(template.enemies, template.readout.names)}
                        {template.battlefield ? ` on ${template.battlefield}` : ""}
                      </p>
                      <DifficultyLine readout={template.readout} cue={cue} />
                      {template.notes ? (
                        <p className="reveal mt-0.5 whitespace-pre-wrap text-[11px] text-stone-500">
                          {template.notes}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={() => void deploy(template.id, !template.cued)}
                        className={cn(cue && template.cued ? ui.btnSecondary : ui.btnPrimary, "h-9 px-3 text-[11px]")}
                      >
                        {cue ? (template.cued ? "Take back" : "Cue") : "Deploy"}
                      </button>
                      <RowMenu items={items} label={template.name} />
                    </div>
                  </div>
                </ContextMenu>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            size="sm"
            art="map"
            title="Nothing prepared. Write a roster below and it is one button at the table."
            hint="Pick monsters from the Bestiary or the rulebook and a map to fight on; the difficulty is measured against the party."
          />
        )}
        </Listed>
      </section>

      <EncounterForm
        campaignId={campaignId}
        value={draft}
        onChange={setDraft}
        maps={maps}
        busy={busy}
        submitLabel="Prepare it"
        onSubmit={() => void save()}
      />

      {feedback}
    </div>
  );
}
