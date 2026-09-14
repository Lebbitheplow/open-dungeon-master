"use client";

import { Dialog } from "@/components/ui/Dialog";

// Every key an editor answers to, on one sheet (docs/vtt-parity-
// implementation-plan.md section 10.7). Opened with `?` or the toolbar
// button; every key has an on-screen twin, so the phone loses nothing.

export type HotkeyRow = { keys: string[]; does: string };

export function HotkeyOverlay({
  open,
  onOpenChange,
  title = "Keys",
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  groups: Array<{ title: string; rows: HotkeyRow[] }>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width="w-[min(92vw,30rem)]">
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-stone-500">{group.title}</h3>
            <ul className="space-y-1">
              {group.rows.map((row) => (
                <li key={row.does} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-stone-300">{row.does}</span>
                  <span className="flex shrink-0 gap-1">
                    {row.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-stone-700 bg-stone-900 px-1.5 py-0.5 font-mono text-[11px] text-amber-100"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-[11px] text-stone-500">
          Every key has a button on screen; on a phone the buttons are the way in.
        </p>
      </div>
    </Dialog>
  );
}
