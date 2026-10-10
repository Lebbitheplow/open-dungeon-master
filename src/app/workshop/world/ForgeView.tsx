"use client";

import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import type { ForgeEntity, ForgeLink, ForgePreview } from "@/lib/worldforge/forge";
import type { WorldApi, WorldState } from "./useWorld";
import { TypeChip, typeOf } from "./world-ui";

// The forge, after WorldForge's: paste notes (a session recap, a page of a
// setting, another tool's brainstorm) and the model lists what in them
// deserves an entry and how those things stand with each other. Nothing is
// written until the DM ticks what to keep, and the forge only adds: a name
// the world already has shows as there, never rewritten. Unticked names can
// be kept as names to write later.

type Row = ForgeEntity & { keep: boolean };
type LinkRow = ForgeLink & { keep: boolean };

export function ForgeView({ api, world, onOpen }: { api: WorldApi; world: WorldState; onOpen: (ref: string) => void }) {
  const { doc, entities } = world;
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [stubTheRest, setStubTheRest] = useState(true);
  const [report, setReport] = useState("");
  const nameOf = (key: string) => rows?.find((row) => row.key === key)?.name ?? entities.find((entity) => entity.ref === key)?.name ?? key;

  async function forge() {
    setBusy(true);
    setReport("");
    const payload = await api.ai("forge", { text, hint });
    setBusy(false);
    const preview = payload?.preview as ForgePreview | undefined;
    if (!preview) return;
    setRows(preview.entities.map((entity) => ({ ...entity, keep: !entity.existing })));
    setLinks(preview.links.map((link) => ({ ...link, keep: true })));
  }

  async function keep() {
    if (!rows) return;
    const chosen = rows.filter((row) => row.keep && !row.existing);
    const alive = new Set([...chosen.map((row) => row.key), ...entities.map((entity) => entity.ref)]);
    setBusy(true);
    const result = await api.ai("apply", {
      entities: chosen,
      links: links.filter((link) => link.keep && alive.has(link.from) && alive.has(link.to)),
      stubs: stubTheRest ? rows.filter((row) => !row.keep && !row.existing).map((row) => row.name) : [],
    });
    setBusy(false);
    if (!result) return;
    const made = Number(result.created ?? 0);
    setReport(`Added ${made} ${made === 1 ? "entry" : "entries"} and ${Number(result.links ?? 0)} links${Number(result.stubs ?? 0) ? `, and kept ${Number(result.stubs)} names to write` : ""}.`);
    setRows(null);
    setLinks([]);
    setText("");
  }

  const set = (key: string, patch: Partial<Row>) => setRows((current) => current?.map((row) => (row.key === key ? { ...row, ...patch } : row)) ?? null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-stone-400">Paste notes about the world and the forge lists what deserves an entry, and how those things stand with each other. You choose what to keep.</p>
      <textarea className={cn(ui.input, "min-h-36")} placeholder="The warden Ivo keeps the sea wall at Gullhaven. Nobody knows he sold the sluice codes to the Grey Lantern smugglers..." aria-label="Notes to forge" maxLength={20_000} value={text} onChange={(event) => setText(event.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <input className={cn(ui.input, "max-w-md flex-1 text-xs")} placeholder="Steer it (optional): only the people, say" aria-label="Steer the forge" maxLength={300} value={hint} onChange={(event) => setHint(event.target.value)} />
        <KitButton tone="primary" busy={busy && !rows} disabled={busy || !text.trim()} onClick={forge} data-tour="world-forge">
          {busy && !rows ? null : <Sparkles className="size-3.5" />} Forge
        </KitButton>
      </div>
      {api.error ? <PanelError>{api.error}</PanelError> : null}
      {report ? <p className="motion-pop rounded-lg border border-emerald-700/40 bg-emerald-900/15 px-3 py-2 text-xs text-stone-200" role="status">{report}</p> : null}

      {rows ? (
        <section className="flex flex-col gap-2 animate-fade-up" aria-label="What the forge found">
          <h3 className="eyebrow text-[10px] text-amber-400/80">Found {rows.length}: tick what to keep</h3>
          <ul className="flex flex-col gap-1.5">
            {rows.map((row, index) => (
              <li key={row.key} className={cn("panel wf-rise flex flex-col gap-1.5 rounded-lg p-2.5", !row.keep && "opacity-60")} style={{ "--i": index } as React.CSSProperties}>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" className="accent-amber-400" aria-label={`Keep ${row.name}`} checked={row.keep} disabled={Boolean(row.existing)} onChange={(event) => set(row.key, { keep: event.target.checked })} />
                  <input className={cn(ui.input, "w-48 py-1 text-sm")} aria-label="Name" maxLength={80} value={row.name} disabled={Boolean(row.existing)} onChange={(event) => set(row.key, { name: event.target.value })} />
                  {row.existing ? (
                    <button type="button" onClick={() => onOpen(row.existing)} className="pk-chip text-[11px] text-stone-400">already in the world</button>
                  ) : (
                    <div className="w-44">
                      <Select label="Type" size="sm" value={row.typeId} onChange={(typeId) => set(row.key, { typeId })} options={doc.types.map((type) => ({ value: type.id, label: type.name }))} />
                    </div>
                  )}
                  {row.existing ? <TypeChip type={typeOf(doc, entities.find((entity) => entity.ref === row.existing)!)} /> : null}
                </div>
                {!row.existing ? (
                  <textarea className={cn(ui.input, "min-h-12 text-xs")} aria-label={`${row.name}, summary`} maxLength={2_000} value={row.summary} onChange={(event) => set(row.key, { summary: event.target.value })} />
                ) : null}
                {row.hiddenTruth && !row.existing ? <p className="text-xs text-red-300">Hidden truth: {row.hiddenTruth}</p> : null}
              </li>
            ))}
          </ul>
          {links.length ? (
            <>
              <h3 className="eyebrow mt-1 text-[10px] text-amber-400/80">Links</h3>
              <ul className="flex flex-col gap-1">
                {links.map((link, index) => (
                  <li key={`${link.from}-${link.to}-${link.label}`} className="wf-rise flex items-center gap-2 text-sm text-stone-300" style={{ "--i": index } as React.CSSProperties}>
                    <input type="checkbox" className="accent-amber-400" aria-label={`Keep ${nameOf(link.from)} ${link.label} ${nameOf(link.to)}`} checked={link.keep} onChange={(event) => setLinks((current) => current.map((entry, at) => (at === index ? { ...entry, keep: event.target.checked } : entry)))} />
                    {nameOf(link.from)} <span className="text-stone-500">{link.label}</span> {nameOf(link.to)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-stone-400">
            <input type="checkbox" className="accent-amber-400" checked={stubTheRest} onChange={(event) => setStubTheRest(event.target.checked)} />
            Keep the unticked names in To write
          </label>
          <div className="flex justify-end gap-2">
            <KitButton tone="small" onClick={() => { setRows(null); setLinks([]); }}>Throw it away</KitButton>
            <KitButton tone="primary" busy={busy} disabled={busy || !rows.some((row) => row.keep && !row.existing)} onClick={keep}>
              {busy ? null : <Check className="size-3.5" />} Add the ticked
            </KitButton>
          </div>
        </section>
      ) : null}
    </div>
  );
}
