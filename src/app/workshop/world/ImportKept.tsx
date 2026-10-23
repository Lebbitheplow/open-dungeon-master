"use client";

import { useState } from "react";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { describeValue } from "@/lib/worldforge/entry-merge";
import type { KeptImport } from "@/lib/worldforge/import-kept";

// What a reimport kept as this campaign has it, on the entry's page
// (src/lib/worldforge/import-kept.ts). The same amber notice as an entry
// form's clash with another author (EntityEditor, #348), one line per
// value: the import's version shown whole, and the two ways out. Once the
// import's version is in use, the line says so and offers yours back.
// Only the DM reads the World, so players never see it.

// A value as the reader reads it: a long text whole, in its own box.
export function KeptValueText({ value }: { value: unknown }) {
  if (typeof value === "string" && value.length > 60) {
    return <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-amber-800/40 bg-stone-950/50 px-2.5 py-1.5 text-xs leading-5 text-stone-200">{value}</blockquote>;
  }
  return <span className="text-stone-200">{describeValue(value)}</span>;
}

export function ImportKept({
  kept,
  onChoose,
}: {
  kept: KeptImport[];
  onChoose: (key: string, choice: "use" | "restore" | "dismiss") => Promise<unknown>;
}) {
  const [busy, setBusy] = useState("");
  if (!kept.length) return null;
  const choose = async (key: string, choice: "use" | "restore" | "dismiss") => {
    setBusy(`${key} ${choice}`);
    try {
      await onChoose(key, choice);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-100" data-testid="import-kept" aria-label="Kept when brought in again">
      <ul className="flex flex-col gap-3">
        {kept.map((item) => (
          <li key={item.key} className="flex flex-col gap-1.5" data-kept={item.key}>
            {item.taken ? (
              <>
                <p>
                  <strong>{item.label}</strong>: the import&apos;s version is in use. This campaign&apos;s version is kept, so you can go back to it:
                </p>
                <KeptValueText value={item.mine} />
              </>
            ) : (
              <>
                <p>
                  <strong>{item.label}</strong>: this campaign&apos;s version was kept when it was brought in again; the import&apos;s version differs:
                </p>
                <KeptValueText value={item.theirs} />
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {item.taken ? (
                <>
                  <KitButton tone="small" busy={busy === `${item.key} restore`} disabled={Boolean(busy)} onClick={() => choose(item.key, "restore")} aria-label={`Restore mine: ${item.label}`}>
                    Restore mine
                  </KitButton>
                  <KitButton tone="small" busy={busy === `${item.key} dismiss`} disabled={Boolean(busy)} onClick={() => choose(item.key, "dismiss")} aria-label={`Keep the import's: ${item.label}`}>
                    Keep the import&apos;s
                  </KitButton>
                </>
              ) : (
                <>
                  <KitButton tone="small" busy={busy === `${item.key} use`} disabled={Boolean(busy)} onClick={() => choose(item.key, "use")} aria-label={`Use the import's version of the ${item.label}`}>
                    Use the import&apos;s version
                  </KitButton>
                  <KitButton tone="small" busy={busy === `${item.key} dismiss`} disabled={Boolean(busy)} onClick={() => choose(item.key, "dismiss")} aria-label={`Keep mine: ${item.label}`}>
                    Keep mine
                  </KitButton>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-200/80">Players never see this.</p>
    </section>
  );
}
