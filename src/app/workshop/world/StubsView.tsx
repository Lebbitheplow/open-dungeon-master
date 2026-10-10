"use client";

import { Ban, Check, PenLine, Plus, ScanSearch, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { newId, type Stub } from "@/lib/worldforge/model";
import { stubResolved, stubScan } from "@/lib/worldforge/text";
import type { WorldApi, WorldState } from "./useWorld";
import { tint } from "./world-ui";

// Names still to be written, after WorldForge's stubs: a name the world's
// text keeps using that has no entry yet. The scan only suggests; a name is
// kept as a stub, written as an entry of a type, or dismissed, and a
// dismissed name never comes back. A stub whose name an entry now answers to
// is done and can be cleared.

export function StubsView({ api, world, onOpen }: { api: WorldApi; world: WorldState; onOpen: (ref: string) => void }) {
  const { doc, entities } = world;
  const [found, setFound] = useState<Array<{ name: string; count: number }> | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [manual, setManual] = useState({ name: "", note: "" });
  const named = useMemo(() => entities.map((entity) => ({ ref: entity.ref, name: entity.name, aliases: entity.aliases })), [entities]);

  function scan() {
    const texts = [
      ...entities.flatMap((entity) => [entity.tagline, entity.text, entity.entry.article, entity.entry.hiddenTruth, entity.entry.notes]),
      // Titles are capitalised as titles, not as names, so only the prose.
      ...doc.events.map((event) => event.body),
      ...doc.secrets.map((secret) => secret.notes),
    ].filter(Boolean);
    setFound(stubScan(texts, named, doc.stubs));
  }

  async function keep(stubs: Stub[]) {
    await api.patch({ stubs: [...doc.stubs, ...stubs] });
  }
  const forget = (name: string) => setFound((current) => current?.filter((entry) => entry.name !== name) ?? null);

  async function write(name: string, typeId: string, stub?: Stub) {
    const made = await api.create({ typeId, name });
    if (!made) return;
    setWriting(null);
    forget(name);
    if (stub) await api.patch({ stubs: doc.stubs.filter((entry) => entry.id !== stub.id) });
    onOpen(made.ref);
  }

  const typePicker = (name: string, stub?: Stub) => (
    <div className="motion-pop mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-stone-500">Write {name} as</span>
      {doc.types.map((type) => (
        <button key={type.id} type="button" onClick={() => write(name, type.id, stub)} className="rounded-md border px-1.5 py-0.5 text-[11px] motion-press" style={{ borderColor: tint(type.color, 0.45), color: type.color }}>
          {type.name}
        </button>
      ))}
    </div>
  );

  const open = doc.stubs.filter((stub) => stub.status === "open");
  const dismissed = doc.stubs.filter((stub) => stub.status === "dismissed");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="flex flex-col gap-2" aria-label="Scan">
        <div className="flex items-center justify-between">
          <h3 className="eyebrow text-[10px] text-amber-400/80">Names with no entry</h3>
          <KitButton tone="primary" onClick={scan} data-tour="world-scan">
            <ScanSearch className="size-3.5" /> Read the world for them
          </KitButton>
        </div>
        <p className="text-[11px] text-stone-500">Reads every article, line, note, event and secret for capitalised names nothing answers to. Nothing is kept until you say so.</p>
        {found === null ? null : found.length === 0 ? (
          <p className="text-sm text-stone-500 motion-pop">Every name the world uses has an entry.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {found.map((hit, index) => (
              <li key={hit.name} className="panel wf-rise rounded-lg p-2" style={{ "--i": index } as React.CSSProperties}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-stone-100">{hit.name}</span>
                  <span className="text-[11px] text-stone-500">{hit.count} time{hit.count === 1 ? "" : "s"}</span>
                  <span className="ml-auto flex gap-1">
                    <KitButton tone="small" onClick={() => setWriting(writing === hit.name ? null : hit.name)}><PenLine className="size-3.5" /> Write it</KitButton>
                    <KitButton tone="small" onClick={() => { forget(hit.name); void keep([{ id: newId("stub"), name: hit.name, note: "", source: "scan", status: "open" }]); }}><Plus className="size-3.5" /> Keep</KitButton>
                    <KitButton tone="small" title="Not a name: never suggested again" onClick={() => { forget(hit.name); void keep([{ id: newId("stub"), name: hit.name, note: "", source: "scan", status: "dismissed" }]); }}><Ban className="size-3.5" /></KitButton>
                  </span>
                </div>
                {writing === hit.name ? typePicker(hit.name) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="To write">
        <h3 className="eyebrow text-[10px] text-amber-400/80">To write ({open.length})</h3>
        <form className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5" onSubmit={(event) => { event.preventDefault(); if (manual.name.trim()) { void keep([{ id: newId("stub"), name: manual.name.trim(), note: manual.note.trim(), source: "manual", status: "open" }]); setManual({ name: "", note: "" }); } }}>
          <input className={cn(ui.input, "text-xs")} placeholder="Who built the wall?" aria-label="A name or a question" maxLength={120} value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} />
          <input className={cn(ui.input, "text-xs")} placeholder="Note (optional)" aria-label="Note" maxLength={400} value={manual.note} onChange={(event) => setManual({ ...manual, note: event.target.value })} />
          <KitButton tone="small" type="submit" disabled={!manual.name.trim()}><Plus className="size-3.5" /> Jot</KitButton>
        </form>
        <ul className="flex flex-col gap-1.5">
          {open.map((stub, index) => {
            const done = stubResolved(stub, named);
            return (
              <li key={stub.id} className="panel wf-rise rounded-lg p-2" style={{ "--i": index } as React.CSSProperties}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-stone-100">{stub.name}</span>
                  {done ? (
                    <button type="button" onClick={() => onOpen(done.ref)} className="pk-chip motion-pop text-[11px] text-emerald-300">
                      <Check className="size-3" /> written
                    </button>
                  ) : null}
                  <span className="ml-auto flex gap-1">
                    {done ? null : <KitButton tone="small" onClick={() => setWriting(writing === stub.id ? null : stub.id)}><PenLine className="size-3.5" /> Write it</KitButton>}
                    <KitButton tone="icon" always aria-label={done ? `Clear ${stub.name}` : `Dismiss ${stub.name}`} onClick={() => api.patch({ stubs: done ? doc.stubs.filter((entry) => entry.id !== stub.id) : doc.stubs.map((entry) => (entry.id === stub.id ? { ...entry, status: "dismissed" } : entry)) })}>
                      <X className="size-3.5" />
                    </KitButton>
                  </span>
                </div>
                {stub.note ? <p className="text-xs text-stone-400">{stub.note}</p> : null}
                {writing === stub.id ? typePicker(stub.name, stub) : null}
              </li>
            );
          })}
          {open.length === 0 ? <li className="text-sm text-stone-500">Nothing waiting.</li> : null}
        </ul>
        {dismissed.length ? (
          <details className="text-xs text-stone-500">
            <summary className="cursor-pointer">{dismissed.length} dismissed</summary>
            <p className="mt-1">{dismissed.map((stub) => stub.name).join(", ")}</p>
            <KitButton tone="link" onClick={() => api.patch({ stubs: open })}>Forget them all, so the scan may suggest them again</KitButton>
          </details>
        ) : null}
      </section>
    </div>
  );
}
