"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Reveal } from "@/components/ui/Reveal";

// The pieces the spell block's groups share (SpellMechFields.tsx,
// SpellMechMore.tsx): one collapsible group and the readers that turn the
// loose block into numbers, lists and patches.

export type Mech = Record<string, unknown>;
export type MechProps = { mech: Mech; setMech: (patch: Mech) => void };

export const ABILITY_OPTIONS = [
  { value: "", label: "none" },
  ...(["str", "dex", "con", "int", "wis", "cha"] as const).map((value) => ({ value, label: value.toUpperCase() })),
];

export const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
export const sub = (value: unknown): Mech => (value && typeof value === "object" && !Array.isArray(value) ? (value as Mech) : {});
export const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
// A patch that drops an emptied field rather than storing "" or [].
export function clean(next: Mech): Mech | undefined {
  const out = Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && !value.length)),
  );
  return Object.keys(out).length ? out : undefined;
}

export function MechGroup({ title, summary, open: startOpen, children }: { title: string; summary: string; open: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="font-display text-[11px] tracking-[0.1em] text-amber-300/85">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-stone-500">
          <span className="truncate">{summary}</span>
          <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      <Reveal open={open}>
        {open ? <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-4">{children}</div> : null}
      </Reveal>
    </div>
  );
}

