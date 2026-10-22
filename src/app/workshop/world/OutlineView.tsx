"use client";

import { Check, CircleAlert, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { forgeReport, type ForgeApplied, type ReportLine } from "@/lib/worldforge/forge";
import { outlineCounts, type Outline, type OutlineAsset, type OutlineEntry } from "@/lib/worldforge/outline";
import type { Shelf } from "@/lib/worldforge/model";
import type { MadeAsset } from "@/lib/dm/world-outline";
import type { WorldApi, WorldState } from "./useWorld";
import type { OpenSystem } from "./WorldForgePanel";
import { TypeChip } from "./world-ui";

// "Draft a world from this idea" (plan M5 item 1, audit WF-08). A line or
// two about the world comes back as an outline, with counts: people,
// places, factions and lore as World entries, and a few creatures and items
// to play with. Nothing is made until the author ticks rows and asks. Then
// each ticked row is one task, made in turn and shown as it goes: entries
// through the forge's own apply, a creature through the Bestiary's builder
// and validator, an item through Homebrew's. A task that fails says why and
// can be retried on its own; nothing beyond the ticked rows is ever made.
// The forge (ForgeView.tsx) is the other operation: it reads notes and
// invents nothing.

type Task = { state: "waiting" | "making" | "made" | "failed"; ref?: string; error?: string; made?: MadeAsset };
type Phase = "review" | "making" | "done";

const SHELVES: ReadonlyArray<{ shelf: Shelf; label: string }> = [
  { shelf: "npc", label: "People" },
  { shelf: "location", label: "Places" },
  { shelf: "faction", label: "Factions" },
  { shelf: "lore", label: "Lore" },
];

// A tick with a finger-sized target: the box sits in a 40px square that
// passes its click on, without growing the row.
const TICK = "-m-3 flex size-10 shrink-0 cursor-pointer items-center justify-center [&>input]:cursor-pointer";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function OutlineView({ api, world, onOpen, onOpenSystem }: { api: WorldApi; world: WorldState; onOpen: (ref: string) => void; onOpenSystem?: OpenSystem }) {
  const { doc } = world;
  const [idea, setIdea] = useState("");
  const [hint, setHint] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [outline, setOutline] = useState<Outline | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [linkPicked, setLinkPicked] = useState<boolean[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("review");
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  // Links written, by index, and the report of every link call so far.
  const [linksDone, setLinksDone] = useState<Set<number>>(new Set());
  const [linkLines, setLinkLines] = useState<ReportLine[]>([]);

  const post = async (path: string, body: object): Promise<{ ok: boolean; json: Record<string, unknown> }> => {
    try {
      const response = await fetch(`/api/campaigns/${api.campaignId}/world/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { ok: response.ok, json: await response.json().catch(() => ({})) };
    } catch {
      return { ok: false, json: { error: "The server could not be reached." } };
    }
  };

  async function draft() {
    setDrafting(true);
    setError("");
    const { ok, json } = await post("outline", { step: "outline", idea, hint });
    setDrafting(false);
    if (!ok || !json.outline) {
      setError(typeof json.error === "string" ? json.error : "The outline could not be drafted.");
      return;
    }
    const next = json.outline as Outline;
    setOutline(next);
    setPicked(Object.fromEntries([...next.entries.map((row) => [row.key, !row.existing]), ...next.assets.map((row) => [row.key, true])]));
    setLinkPicked(next.links.map(() => true));
    setNames(Object.fromEntries([...next.entries, ...next.assets].map((row) => [row.key, row.name])));
    setPhase("review");
    setTasks({});
    setLinksDone(new Set());
    setLinkLines([]);
  }

  function reset() {
    setOutline(null);
    setPhase("review");
    setTasks({});
    setLinksDone(new Set());
    setLinkLines([]);
  }

  const entries = outline?.entries ?? [];
  const assets = outline?.assets ?? [];
  const nameOf = (key: string) => names[key] ?? entries.find((row) => row.existing === key)?.name ?? world.entities.find((entity) => entity.ref === key)?.name ?? key;
  const ticked = [...entries.filter((row) => picked[row.key] && !row.existing), ...assets.filter((row) => picked[row.key])];
  const counts = outline ? outlineCounts(outline) : null;

  // The World ref a link end has now: an entry the world already had, or a
  // row made here.
  const rowKeys = new Set([...entries, ...assets].filter((row) => !("existing" in row && row.existing)).map((row) => row.key));
  const refFor = (end: string, made: Record<string, Task>) => (rowKeys.has(end) ? made[end]?.ref ?? "" : end);

  async function runTask(row: OutlineEntry | OutlineAsset, current: Record<string, Task>): Promise<Record<string, Task>> {
    const name = (names[row.key] ?? row.name).trim() || row.name;
    let next: Record<string, Task> = { ...current, [row.key]: { state: "making" } };
    setTasks(next);
    let task: Task;
    if ("shelf" in row) {
      const { ok, json } = await post("ai", { tool: "apply", entities: [{ ...row, name }], links: [], stubs: [] });
      const applied = json as unknown as ForgeApplied;
      const made = ok ? applied.made?.[0] : undefined;
      task = made ? { state: "made", ref: made.ref } : { state: "failed", error: applied.failed?.[0]?.error ?? (typeof json.error === "string" ? json.error : "It could not be made.") };
    } else {
      const { ok, json } = await post("outline", { step: "asset", asset: { ...row, name }, premise: outline?.premise ?? "" });
      const made = ok ? (json.made as MadeAsset | undefined) : undefined;
      task = made ? { state: "made", ref: made.entryRef, made } : { state: "failed", error: typeof json.error === "string" ? json.error : "It could not be made." };
    }
    next = { ...next, [row.key]: task };
    setTasks(next);
    return next;
  }

  // The ticked links whose two ends both exist now, written once each.
  async function writeLinks(made: Record<string, Task>, done: Set<number>) {
    const ready = (outline?.links ?? [])
      .map((link, index) => ({ link, index }))
      .filter(({ link, index }) => linkPicked[index] && !done.has(index) && refFor(link.from, made) && refFor(link.to, made));
    if (!ready.length) return;
    const { ok, json } = await post("ai", {
      tool: "apply",
      entities: [],
      links: ready.map(({ link }) => ({ from: refFor(link.from, made), to: refFor(link.to, made), label: link.label, fromName: nameOf(link.from), toName: nameOf(link.to) })),
      stubs: [],
    });
    if (!ok) {
      setLinkLines((lines) => [...lines, { text: `Links not written: ${typeof json.error === "string" ? json.error : "the server could not be reached"}.`, left: true }]);
      return;
    }
    const next = new Set([...done, ...ready.map(({ index }) => index)]);
    setLinksDone(next);
    setLinkLines((lines) => [...lines, ...forgeReport(json as unknown as ForgeApplied).lines]);
  }

  async function makeTicked() {
    setPhase("making");
    let made: Record<string, Task> = Object.fromEntries(ticked.map((row) => [row.key, { state: "waiting" } as Task]));
    setTasks(made);
    for (const row of ticked) made = await runTask(row, made);
    await writeLinks(made, linksDone);
    setPhase("done");
    api.refresh();
  }

  async function retry(row: OutlineEntry | OutlineAsset) {
    setPhase("making");
    const made = await runTask(row, tasks);
    await writeLinks(made, linksDone);
    setPhase("done");
    api.refresh();
  }

  const taskRows = [...entries, ...assets].filter((row) => tasks[row.key]);
  const madeCount = taskRows.filter((row) => tasks[row.key].state === "made").length;
  const failedCount = taskRows.filter((row) => tasks[row.key].state === "failed").length;
  // A ticked link not written yet: waiting on an end that failed (a retry
  // that makes it writes the link), or left out with an end that was not
  // ticked.
  const unwritten = phase === "done" ? (outline?.links ?? []).filter((link, index) => linkPicked[index] && !linksDone.has(index)) : [];
  const unticked = (end: string) => rowKeys.has(end) && !tasks[end];
  const linksUnticked = unwritten.filter((link) => unticked(link.from) || unticked(link.to));
  const waitingLinks = unwritten.filter((link) => !linksUnticked.includes(link));

  return (
    <div className="flex flex-col gap-3" data-testid="world-outline">
      {!outline ? (
        <>
          <p className="text-sm text-stone-400">
            Write a line or two about the world you want. A model drafts an outline: people, places, factions and lore, and a few creatures and items to play with, each counted. Nothing is made until you tick what to keep.
          </p>
          <textarea className={cn(ui.input, "min-h-28")} placeholder="A drowned kingdom where the tide-priests ration dry land, and smugglers trade in the bones of sea giants..." aria-label="Your idea for the world" maxLength={4_000} value={idea} onChange={(event) => setIdea(event.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <input className={cn(ui.input, "max-w-md flex-1 text-xs")} placeholder="Steer it (optional): grim, low magic, say" aria-label="Steer the outline" maxLength={300} value={hint} onChange={(event) => setHint(event.target.value)} />
            <KitButton tone="primary" busy={drafting} disabled={drafting || !idea.trim()} onClick={draft} data-tour="world-outline">
              {drafting ? null : <Wand2 className="size-3.5" />} Draft an outline
            </KitButton>
          </div>
          <p className="text-[11px] text-stone-500">To pull names out of notes you already have, without inventing anything, use Forge instead.</p>
        </>
      ) : null}
      {error ? <PanelError>{error}</PanelError> : null}

      {outline && phase === "review" ? (
        <section className="flex flex-col gap-2 animate-fade-up" aria-label="The outline">
          {outline.premise ? <p className="text-sm text-stone-200">{outline.premise}</p> : null}
          {counts ? (
            <p className="text-xs text-stone-400" data-testid="outline-counts">
              {[
                plural(counts.people, "person", "people"),
                plural(counts.places, "place", "places"),
                plural(counts.factions, "faction", "factions"),
                plural(counts.lore, "lore entry", "lore entries"),
                plural(counts.creatures, "creature", "creatures"),
                plural(counts.items, "item", "items"),
              ].join(" · ")}
              . Nothing is made yet.
            </p>
          ) : null}
          {outline.left.map((line) => (
            <p key={line} className="text-xs text-amber-300">{line}</p>
          ))}
          {SHELVES.map(({ shelf, label }) => {
            const rows = entries.filter((row) => row.shelf === shelf);
            if (!rows.length) return null;
            return (
              <div key={shelf} className="flex flex-col gap-1">
                <h3 className="eyebrow text-[10px] text-amber-400/80">{label}</h3>
                <ul className="flex flex-col gap-1.5">
                  {rows.map((row) => (
                    <OutlineRow key={row.key} name={names[row.key] ?? row.name} summary={row.summary} picked={Boolean(picked[row.key])} existing={Boolean(row.existing)} onPick={(value) => setPicked((now) => ({ ...now, [row.key]: value }))} onName={(value) => setNames((now) => ({ ...now, [row.key]: value }))} onOpen={row.existing ? () => onOpen(row.existing) : undefined}>
                      <TypeChip type={doc.types.find((type) => type.id === row.typeId) ?? doc.types[0]} />
                    </OutlineRow>
                  ))}
                </ul>
              </div>
            );
          })}
          {assets.length ? (
            <div className="flex flex-col gap-1">
              <h3 className="eyebrow text-[10px] text-amber-400/80">To play with</h3>
              <p className="text-[11px] text-stone-500">Each is built and checked by its own tool, the way that tool&apos;s own are, with a World entry linked to it. One model call each.</p>
              <ul className="flex flex-col gap-1.5">
                {assets.map((row) => (
                  <OutlineRow key={row.key} name={names[row.key] ?? row.name} summary={row.summary} picked={Boolean(picked[row.key])} existing={false} onPick={(value) => setPicked((now) => ({ ...now, [row.key]: value }))} onName={(value) => setNames((now) => ({ ...now, [row.key]: value }))}>
                    <span className="pk-chip text-[11px] text-stone-300">{assetLine(row)}</span>
                  </OutlineRow>
                ))}
              </ul>
            </div>
          ) : null}
          {outline.links.length ? (
            <div className="flex flex-col gap-1">
              <h3 className="eyebrow text-[10px] text-amber-400/80">Links</h3>
              <ul className="flex flex-col gap-1">
                {outline.links.map((link, index) => (
                  <li key={`${link.from}-${link.to}-${link.label}`} className="flex items-center gap-2 text-sm text-stone-300">
                    <label className={TICK}>
                      <input type="checkbox" className="size-4 accent-amber-400" aria-label={`Keep ${nameOf(link.from)} ${link.label} ${nameOf(link.to)}`} checked={Boolean(linkPicked[index])} onChange={(event) => setLinkPicked((now) => now.map((value, at) => (at === index ? event.target.checked : value)))} />
                    </label>
                    {nameOf(link.from)} <span className="text-stone-500">{link.label}</span> {nameOf(link.to)}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-stone-500">A link is made once both its ends are.</p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <KitButton tone="small" onClick={reset}>Throw it away</KitButton>
            <KitButton tone="primary" disabled={!ticked.length} onClick={makeTicked} data-testid="outline-make">
              <Check className="size-3.5" /> Make the ticked ({ticked.length})
            </KitButton>
          </div>
        </section>
      ) : null}

      {outline && phase !== "review" ? (
        <section className="flex flex-col gap-2" aria-label="Making the outline">
          <p className={cn("rounded-lg border px-3 py-2 text-xs", failedCount && phase === "done" ? "border-amber-600/50 bg-amber-900/15 text-amber-100" : "border-emerald-700/40 bg-emerald-900/15 text-stone-200")} role="status" data-testid="outline-progress">
            {phase === "making"
              ? `Making ${Math.min(madeCount + failedCount + 1, taskRows.length)} of ${taskRows.length}...`
              : failedCount
                ? `Made ${madeCount} of ${taskRows.length}. ${failedCount === 1 ? "One was" : `${failedCount} were`} not made: each can be retried on its own below.`
                : `Made all ${taskRows.length}.`}
          </p>
          <ul className="flex flex-col gap-1.5">
            {taskRows.map((row) => {
              const task = tasks[row.key];
              return (
                <li key={row.key} className="panel flex flex-col gap-1.5 rounded-lg p-2.5" data-testid="outline-task" data-state={task.state}>
                  <div className="flex flex-wrap items-center gap-2">
                    {task.state === "made" ? <Check className="size-4 text-emerald-400" aria-hidden="true" /> : task.state === "failed" ? <CircleAlert className="size-4 text-ember-300" aria-hidden="true" /> : task.state === "making" ? <Loader2 className="size-4 animate-spin text-amber-300" aria-hidden="true" /> : <span className="size-4 rounded-full border border-stone-600" aria-hidden="true" />}
                    {task.state === "failed" ? (
                      <input className={cn(ui.input, "w-48 py-1 text-sm")} aria-label={`Name for ${row.name}`} maxLength={80} value={names[row.key] ?? row.name} onChange={(event) => setNames((now) => ({ ...now, [row.key]: event.target.value }))} />
                    ) : (
                      <span className="text-sm text-stone-100">{names[row.key] ?? row.name}</span>
                    )}
                    <span className="text-[11px] text-stone-500">{"shelf" in row ? "World entry" : row.kind === "creature" ? "Bestiary" : "Homebrew"}</span>
                    <span className="sr-only">{task.state === "made" ? "made" : task.state === "failed" ? "failed" : task.state === "making" ? "making" : "waiting"}</span>
                    <span className="ml-auto flex flex-wrap gap-1">
                      {task.state === "made" && task.made && onOpenSystem ? (
                        <KitButton tone="small" onClick={() => onOpenSystem(task.made!.kind === "creature" ? "bestiary" : "homebrew", { id: task.made!.id, from: task.made!.entryRef })}>
                          {task.made.kind === "creature" ? "Edit stats" : "Edit item"}
                        </KitButton>
                      ) : null}
                      {task.state === "made" && task.ref ? <KitButton tone="small" onClick={() => onOpen(task.ref!)}>World entry</KitButton> : null}
                      {task.state === "failed" && phase === "done" ? (
                        <KitButton tone="small" onClick={() => retry(row)} aria-label={`Retry ${names[row.key] ?? row.name}`}>
                          <RotateCcw className="size-3.5" /> Retry
                        </KitButton>
                      ) : null}
                    </span>
                  </div>
                  {task.state === "made" && task.made ? (
                    <p className="text-xs text-stone-400">
                      Made {task.made.name} in {task.made.lands}: {task.made.detail}.{task.made.entryError ? ` Its World entry was not made: ${task.made.entryError}` : ""}
                    </p>
                  ) : null}
                  {task.state === "failed" ? <p className="text-xs text-ember-300" role="alert">{task.error}</p> : null}
                </li>
              );
            })}
          </ul>
          {linkLines.map((line, at) => (
            <p key={at} className={cn("text-xs", line.left ? "text-amber-300" : "text-stone-300")}>{line.text}</p>
          ))}
          {linksUnticked.length ? (
            <p className="text-xs text-amber-300">
              Links not made, because one end was not ticked: {linksUnticked.map((link) => `${nameOf(link.from)} ${link.label} ${nameOf(link.to)}`).join("; ")}.
            </p>
          ) : null}
          {waitingLinks.length ? (
            <p className="text-xs text-amber-300">
              Links waiting for an end that was not made: {waitingLinks.map((link) => `${nameOf(link.from)} ${link.label} ${nameOf(link.to)}`).join("; ")}. A retry that makes it writes them.
            </p>
          ) : null}
          {phase === "done" ? (
            <div className="flex justify-end">
              <KitButton tone="small" onClick={reset}>Draft another outline</KitButton>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function assetLine(row: OutlineAsset): string {
  if (row.kind === "creature") return `Creature, CR ${row.cr < 1 ? `1/${Math.round(1 / row.cr)}` : row.cr}${row.basis ? `, built on the ${row.basis}` : ", original"} · Bestiary`;
  return `Item, ${row.itemKind.replace(/_/g, " ")} · Homebrew`;
}

function OutlineRow({ name, summary, picked, existing, onPick, onName, onOpen, children }: { name: string; summary: string; picked: boolean; existing: boolean; onPick: (value: boolean) => void; onName: (value: string) => void; onOpen?: () => void; children: React.ReactNode }) {
  return (
    <li className={cn("panel flex flex-col gap-1 rounded-lg p-2.5", !picked && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <label className={TICK}>
          <input type="checkbox" className="size-4 accent-amber-400" aria-label={`Make ${name}`} checked={picked} disabled={existing} onChange={(event) => onPick(event.target.checked)} />
        </label>
        <input className={cn(ui.input, "w-48 max-w-full py-1 text-sm")} aria-label="Name" maxLength={80} value={name} disabled={existing} onChange={(event) => onName(event.target.value)} />
        {existing && onOpen ? (
          <button type="button" onClick={onOpen} className="pk-chip text-[11px] text-stone-400">already in the world</button>
        ) : null}
        {children}
      </div>
      {summary ? <p className="text-xs text-stone-400">{summary}</p> : null}
    </li>
  );
}
