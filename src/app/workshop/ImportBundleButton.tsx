"use client";

import { appNotice } from "@/components/ui/ConfirmDialog";
import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { ui } from "@/lib/ui";
import { MAX_BUNDLE_BYTES } from "@/lib/workshop/bundle";
import { navigateTo } from "@/lib/navigation";
import { BundlePreview, kindsOf, type BundlePreviewData } from "@/app/workshop/BundlePreview";

// Opening somebody else's workshop, or a world from WorldForge: its JSON
// export opens the same way, its world landing in the new workshop's
// WorldForge (src/lib/db/world-forge-io.ts).
//
// Two steps on purpose. The preview reads the file and validates it without
// writing anything, so what a DM agrees to is a named thing with counts and
// a licensing notice rather than a filename. The second press is what
// creates the workshop. The preview card is BundlePreview.tsx, which an
// addon's import ends on too.

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
  const [preview, setPreview] = useState<BundlePreviewData | null>(null);
  // Which kinds to take. Everything the bundle offers, until unticked.
  const [kinds, setKinds] = useState<string[]>([]);
  // The importer's workshop a chapter's shared records link to, or "" to
  // bring them in as this workshop's own.
  const [sharedWorkshopId, setSharedWorkshopId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/workshops/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // The browser's own words ("Failed to fetch") say nothing to anybody.
      throw new Error("Could not reach the server. Nothing was imported; try again.");
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
      setKinds(kindsOf(data));
      setSharedWorkshopId((data as BundlePreviewData).sharedHomes?.[0]?.id ?? "");
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
      const data = await post({ text, kinds, sharedWorkshopId });
      // Arrivals kept beside the importer's own entries of the same name,
      // said before the new workshop opens (workshop-bundle-shelf.ts).
      const renamed = ((data as { shelf?: { renamed?: string[] } }).shelf?.renamed ?? []).filter(Boolean);
      if (renamed.length) {
        await appNotice(`${renamed.join(" ")} The new workshop's Cast, fights and pregens use these names; your other workshops are unchanged.`, "Kept beside your own");
      }
      navigateTo(`/workshop/${data.workshopId}`);
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
        title="A workshop bundle, or a world exported from WorldForge"
      >
        {busy && !preview ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        {label}
      </button>

      {error ? <p className="motion-shake mt-2 text-sm text-red-300">{error}</p> : null}

      {preview ? (
        <BundlePreview
          preview={preview}
          kinds={kinds}
          onKinds={setKinds}
          sharedWorkshopId={sharedWorkshopId}
          onSharedWorkshopId={setSharedWorkshopId}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => {
            setPreview(null);
            setText("");
          }}
        />
      ) : null}
    </div>
  );
}
