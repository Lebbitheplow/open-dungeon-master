"use client";

import { AlertTriangle, Hammer, Info, Loader2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { FieldLabel } from "@/app/workshop/kit";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ui } from "@/lib/ui";
import {
  IMPORT_KINDS,
  WORLD_RECORD_KINDS,
  IMPORT_KIND_LABELS,
  SINGULAR_KINDS,
  type ImportKind,
  type ImportPlan,
} from "@/lib/workshop/import";
import type { ImportSourceSummary } from "@/app/workshop/types";

// Choosing what crosses over into a table.
//
// The source is a workshop or another campaign. Both are campaigns rows
// holding the same content tables, so both are the same copy, and the server
// decides which ones this person may copy out of
// (src/lib/db/import-sources.ts).
//
// Used in two places with one difference. In the lobby (and the table's
// Setup tab, once play has begun) a campaign already
// exists, so the picker asks the server what the import WOULD do and shows
// the collisions and overwrites. At campaign creation there is no campaign
// yet, so there is nothing to collide with: a fresh table is empty, and the
// counts from the source are the whole truth.

export type ImportSelection = {
  sourceId: string;
  select: ImportKind[];
  houseRules: "replace" | "append";
  // What an earlier import from the same source brought: kept as this
  // campaign has it, or copied again under a number.
  again?: "skip" | "copy";
  // A board meeting the arc the table is playing: left alone, or added as
  // the next act (#157).
  arc?: "leave" | "append";
};

// With WorldForge ticked, a record kind it needs that is not ticked is one
// the DM leaves out on purpose (audit finding WF-07): said to the server so
// the plan names what goes, rather than bringing it anyway.
export function exclusionsOf(selection: Pick<ImportSelection, "select">): ImportKind[] {
  return selection.select.includes("world") ? WORLD_RECORD_KINDS.filter((kind) => !selection.select.includes(kind)) : [];
}

export const EMPTY_SELECTION: ImportSelection = {
  sourceId: "",
  select: [],
  houseRules: "replace",
  again: "skip",
  arc: "leave",
};

export function ContentImportPicker({
  campaignId,
  selection,
  onChange,
  onImported,
  storyboardNote,
  onChosen,
}: {
  // Omitted at campaign creation, where the target does not exist yet.
  campaignId?: string;
  selection: ImportSelection;
  onChange: (selection: ImportSelection) => void;
  // Only meaningful with a campaignId: importing happens immediately.
  onImported?: (copied: number) => void;
  // Drawn under the choices when the board being brought in will write the
  // table's story arc (the AI Story Setup warning, issue 249).
  storyboardNote?: (arcComing: boolean) => ReactNode;
  // Told which source is chosen and whether its board will write the arc,
  // so a summary elsewhere (the creator's review) can name it and repeat the
  // warning.
  onChosen?: (chosen: { title: string; arcComing: boolean } | null) => void;
}) {
  const [sources, setSources] = useState<ImportSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import-sources")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setSources(data.sources ?? []);
        }
      })
      .catch(() => {
        // No sources is a valid state; the section explains itself.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A campaign cannot import from itself, and offering it would be the one
  // option guaranteed to fail.
  const offered = sources.filter((source) => source.id !== campaignId);
  const workshops = offered.filter((source) => source.kind === "workshop");
  const campaigns = offered.filter((source) => source.kind !== "workshop");
  const chosen = offered.find((source) => source.id === selection.sourceId) ?? null;

  // The available kinds are the ones this source actually holds. Offering a
  // tickbox for something that would copy nothing is a lie the DM only
  // discovers after pressing the button.
  const available = chosen
    ? IMPORT_KINDS.filter((kind) => (chosen.contents?.[kind] ?? 0) > 0)
    : [];
  // The board writes the table's arc: it compiles into one, it is ticked,
  // and the table has none it would be left out of (the plan says so once a
  // campaign exists to plan against).
  const arcComing =
    Boolean(chosen?.boardArc) && selection.select.includes("storyboard") && !plan?.board?.targetHasArc;

  const chosenTitle = chosen?.title ?? null;
  useEffect(() => {
    onChosen?.(chosenTitle === null ? null : { title: chosenTitle, arcComing });
  }, [onChosen, chosenTitle, arcComing]);

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is. Same shape as DmMapStudioPanel.
  const refreshPlan = useCallback(() => {
    if (!campaignId || !selection.sourceId || !selection.select.length) {
      return Promise.resolve().then(() => setPlan(null));
    }
    const params = new URLSearchParams({
      sourceId: selection.sourceId,
      again: selection.again ?? "skip",
      arc: selection.arc ?? "leave",
    });
    for (const kind of selection.select) {
      params.append("select", kind);
    }
    for (const kind of exclusionsOf({ select: selection.select })) {
      params.append("exclude", kind);
    }
    return fetch(`/api/campaigns/${campaignId}/import?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setPlan(data?.plan ?? null))
      .catch(() => {
        // transient; the next change reloads
      });
  }, [campaignId, selection.sourceId, selection.select, selection.again, selection.arc]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  function choose(source: ImportSourceSummary | null) {
    if (!source) {
      onChange(EMPTY_SELECTION);
      return;
    }
    // Everything the source has, ticked. Bringing all of it is the common
    // case, and unticking is easier than hunting for what exists.
    onChange({
      ...selection,
      sourceId: source.id,
      select: IMPORT_KINDS.filter((kind) => (source.contents?.[kind] ?? 0) > 0),
    });
  }

  // Ticking WorldForge ticks what it describes too (WF-07): its links,
  // secrets and pins point at those records. Unticking one afterwards is a
  // deliberate exclusion, and the plan says what it loses.
  function toggle(kind: ImportKind) {
    const on = !selection.select.includes(kind);
    const brought = on && kind === "world" ? WORLD_RECORD_KINDS.filter((other) => available.includes(other)) : [];
    const select = on ? [...new Set([...selection.select, kind, ...brought])] : selection.select.filter((entry) => entry !== kind);
    onChange({ ...selection, select: IMPORT_KINDS.filter((entry) => select.includes(entry)) });
  }

  async function importNow() {
    if (!campaignId || !selection.sourceId || !selection.select.length) {
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selection, exclude: exclusionsOf(selection) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNote(data.error || "Could not import.");
        return;
      }
      setNote(
        [
          `Brought ${data.copied} item${data.copied === 1 ? "" : "s"} across.`,
          data.kept ? `Kept ${data.kept} already here.` : "",
          data.beatsAdded ? `${data.beatsAdded} beat${data.beatsAdded === 1 ? "" : "s"} joined the arc.` : "",
          // Names this table's Cast or fights use that nothing here answers
          // to (a monster on another author's shelf), and links both worlds
          // changed (src/lib/db/content-import.ts).
          Array.isArray(data.unresolved) && data.unresolved.length
            ? `No monster here answers to ${data.unresolved.join(", ")}: add them to your bestiary, or point those NPCs and fights at another.`
            : "",
          Array.isArray(data.worldConflicts) && data.worldConflicts.length ? data.worldConflicts.join(" ") : "",
          // Hand-built monsters this table's authors did not have, copied in
          // so the NPCs and fights that name them still fight (WF-07).
          Array.isArray(data.monstersBrought) && data.monstersBrought.length
            ? `Copied into this table's bestiary: ${data.monstersBrought.join(", ")}.`
            : "",
          Array.isArray(data.monstersReused) && data.monstersReused.length
            ? `Already in this table's bestiary: ${data.monstersReused.join(", ")}.`
            : "",
          Array.isArray(data.itemsBrought) && data.itemsBrought.length
            ? `Copied into this table's Homebrew: ${data.itemsBrought.join(", ")}.`
            : "",
          Array.isArray(data.itemsReused) && data.itemsReused.length
            ? `Already in this table's Homebrew: ${data.itemsReused.join(", ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      // Clearing the ticks re-runs the plan effect, which clears the plan.
      // Refetching here as well raced it with the old ticks and left the
      // last import's warnings and notes on screen.
      onChange({ ...selection, select: [] });
      onImported?.(data.copied ?? 0);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Loader2 className="size-4 animate-spin text-stone-500" />;
  }

  if (!offered.length) {
    return (
      <p className="text-xs text-stone-500">
        You have nothing to copy from yet. Build maps, lore and encounters in the Workshop, or run
        a campaign, and you can bring any of it straight in here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="block">
        <FieldLabel className="mb-1 block">Start from</FieldLabel>
        <Select
          label="Start from"
          value={selection.sourceId}
          onChange={(id) => choose(offered.find((source) => source.id === id) ?? null)}
          options={[
            { value: "", label: "None" },
            ...workshops.map((source) => ({
              value: source.id,
              label: source.title,
              group: "Workshops",
              icon: { kind: "glyph" as const, key: "system-storyboard" },
            })),
            ...campaigns.map((source) => ({
              value: source.id,
              label: source.title,
              group: "Campaigns",
              icon: { kind: "glyph" as const, key: "tab-campaigns" },
            })),
          ]}
        />
      </div>

      {chosen ? (
        available.length ? (
          <>
            <div className="stagger space-y-1">
              {available.map((kind) => (
                <div key={kind} className="flex min-h-9 items-center gap-2 text-sm text-stone-300">
                  <Switch on={selection.select.includes(kind)} onChange={() => toggle(kind)} label={IMPORT_KIND_LABELS[kind]} />
                  <span>{IMPORT_KIND_LABELS[kind]}</span>
                  {SINGULAR_KINDS.has(kind) ? null : (
                    <span className="text-xs text-stone-500">({chosen.contents[kind]})</span>
                  )}
                  {selection.select.includes("world") && (WORLD_RECORD_KINDS as readonly string[]).includes(kind) ? (
                    <span className="text-xs text-stone-500" data-testid={`import-world-needs-${kind}`}>
                      {selection.select.includes(kind) ? "WorldForge needs these" : "Left out on purpose"}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            {selection.select.includes("houseRules") ? (
              <div className="block">
                <FieldLabel className="mb-1 block">Existing house rules</FieldLabel>
                <Select<"replace" | "append">
                  label="Existing house rules"
                  value={selection.houseRules}
                  onChange={(houseRules) => onChange({ ...selection, houseRules })}
                  options={[
                    { value: "replace", label: "Replace them" },
                    { value: "append", label: "Keep them and add these" },
                  ]}
                />
              </div>
            ) : null}

            {selection.select.includes("storyboard") && plan?.board?.targetHasArc ? (
              <div className="reveal block">
                <FieldLabel className="mb-1 block">The board&apos;s beats</FieldLabel>
                <Select<"leave" | "append">
                  label="The board's beats"
                  value={selection.arc ?? "leave"}
                  onChange={(arc) => onChange({ ...selection, arc })}
                  options={[
                    {
                      value: "leave",
                      label: "Leave this campaign's arc alone",
                      hint: "Places, quests, fights and notes still land.",
                    },
                    {
                      value: "append",
                      label: `Add them as act ${plan.board.act}`,
                      hint: "After the beats already played. Nothing played is changed.",
                    },
                  ]}
                />
              </div>
            ) : null}

            {storyboardNote?.(arcComing)}

            {plan?.kept || selection.again === "copy" ? (
              <div className="reveal block">
                <FieldLabel className="mb-1 block">Already brought in before</FieldLabel>
                <Select<"skip" | "copy">
                  label="Already brought in before"
                  value={selection.again ?? "skip"}
                  onChange={(again) => onChange({ ...selection, again })}
                  options={[
                    { value: "skip", label: "Keep them as this campaign has them" },
                    { value: "copy", label: "Bring second copies, numbered" },
                  ]}
                />
              </div>
            ) : null}

            {plan?.warnings.length ? (
              <ul className="stagger space-y-1">
                {plan.warnings.map((warning, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-1.5 text-xs text-amber-300/90"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{warning.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {plan?.notes?.length ? (
              <ul className="stagger space-y-1">
                {plan.notes.map((note, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-xs text-stone-400">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-sky-300/70" />
                    <span>{note.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {campaignId ? (
              <div className="reveal flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={importNow}
                  disabled={busy || !selection.select.length || Boolean(plan?.empty)}
                  className={ui.btnSmall}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />}
                  Bring it in
                </button>
                {note ? <span className="live-in text-xs text-emerald-400">{note}</span> : null}
              </div>
            ) : (
              <p className="text-xs text-stone-500">
                This lands in the campaign right after it is created. Nothing is removed from
                where it came from.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-stone-500">
            {chosen.kind === "workshop"
              ? "That workshop is still empty. Build something in it first."
              : "That campaign has no prep to copy yet."}
          </p>
        )
      ) : null}
    </div>
  );
}

// Posts the chosen import after a campaign row exists. Mirrors
// submitWorldSetup in src/app/WorldSetupFields.tsx, which is the same
// pattern for the same reason: the campaign has to exist before anything can
// be written into it.
export async function submitContentImport(campaignId: string, selection: ImportSelection) {
  if (!selection.sourceId || !selection.select.length) {
    return;
  }
  await fetch(`/api/campaigns/${campaignId}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...selection, exclude: exclusionsOf(selection) }),
  }).catch(() => undefined);
}
