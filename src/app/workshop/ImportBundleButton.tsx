"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { ui } from "@/lib/ui";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { BUNDLE_KIND_LABELS, MAX_BUNDLE_BYTES } from "@/lib/workshop/bundle";

// Opening somebody else's workshop.
//
// Two steps on purpose. The preview reads the file and validates it without
// writing anything, so what a DM agrees to is a named thing with counts and
// a licensing notice rather than a filename. The second press is what
// creates the workshop.

type Preview = {
  manifest: { name: string; blurb: string; author: string; inspiredBy: string; rightsHolder: string };
  counts: Record<string, number>;
  warnings: string[];
};

// `label` and `className` let the hub header show the same control as a
// small "Import a bundle" action; the shelf keeps the defaults.
export function ImportBundleButton({
  label = "Open a bundle",
  className = ui.btnSecondary,
}: {
  label?: string;
  className?: string;
} = {}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/workshops/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error ?? "That bundle could not be read.");
    }
    return data;
  }

  async function pick(file: File | undefined) {
    if (!file) {
      return;
    }
    setError("");
    setPreview(null);
    // Checked here as well as on the server: reading a gigabyte into memory
    // to be told no is a bad experience even when the answer is correct.
    if (file.size > MAX_BUNDLE_BYTES) {
      setError(`That file is larger than ${MAX_BUNDLE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setBusy(true);
    try {
      const contents = await file.text();
      const data = await post({ text: contents, preview: true });
      setText(contents);
      setPreview(data);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That bundle could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const data = await post({ text });
      window.location.href = `/workshop/${data.workshopId}`;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That bundle could not be imported.");
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={className}
      >
        {busy && !preview ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        {label}
      </button>

      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}

      {preview ? (
        <div className={`${ui.card} mt-3 p-4`}>
          <p className="font-display tracking-wide text-amber-50">{preview.manifest.name}</p>
          <p className="text-sm text-stone-400">{preview.manifest.blurb}</p>
          {preview.manifest.author ? (
            <p className="mt-0.5 text-xs text-stone-500">by {preview.manifest.author}</p>
          ) : null}

          <ul className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(preview.counts)
              .filter(([, count]) => count > 0)
              .map(([kind, count]) => (
                <li
                  key={kind}
                  className="rounded-full border border-stone-700 px-2.5 py-0.5 text-xs text-stone-400"
                >
                  {count} {BUNDLE_KIND_LABELS[kind] ?? kind}
                </li>
              ))}
          </ul>

          <UnofficialPackNotice
            rightsHolder={preview.manifest.rightsHolder}
            inspiredBy={preview.manifest.inspiredBy}
            className="mt-3"
          />

          {preview.warnings.length ? (
            <ul className="mt-3 space-y-1">
              {preview.warnings.map((warning) => (
                <li key={warning} className="text-xs text-amber-200/80">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 text-xs text-stone-500">
            This creates a new workshop of your own. Nothing is written into any campaign you
            already have.
          </p>

          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void confirm()} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Import it
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setText("");
              }}
              className={ui.btnSecondary}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
