"use client";

import { appNotice } from "@/components/ui/ConfirmDialog";
import { Check, FileUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { SectionHead } from "@/components/ui/SectionHead";
import { chip, chipOn, chipRow } from "@/app/workshop/kit";
import { useRef, useState } from "react";
import { ui } from "@/lib/ui";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { Select } from "@/components/ui/Select";
import { BUNDLE_KIND_LABELS, MAX_BUNDLE_BYTES, type BundleDependency } from "@/lib/workshop/bundle";
import { navigateTo } from "@/lib/navigation";

// Opening somebody else's workshop, or a world from WorldForge: its JSON
// export opens the same way, its world landing in the new workshop's
// WorldForge (src/lib/db/world-forge-io.ts).
//
// Two steps on purpose. The preview reads the file and validates it without
// writing anything, so what a DM agrees to is a named thing with counts and
// a licensing notice rather than a filename. The second press is what
// creates the workshop.
//
// The ticks say what an untick costs: a card that picks an NPC loses that
// pick when the NPCs stay behind, and the preview says so for whatever is
// ticked right now (#158). A chapter bundle offers to link its shared
// records to the importer's own copy of the shared workshop (#159).

type SharedHome = { id: string; title: string; found: number; total: number };

type Preview = {
  manifest: { name: string; blurb: string; author: string; inspiredBy: string; rightsHolder: string };
  counts: Record<string, number>;
  houseRules?: boolean;
  plugin?: boolean;
  overworld?: boolean;
  dependencies?: BundleDependency[];
  dependsOn?: { name: string } | null;
  sharedHomes?: SharedHome[];
  warnings: string[];
};

// The kinds a preview offers, in the order the counts came: every kind with
// something in it, then the house rules, the region map and the world pack
// draft when the bundle carries them.
function kindsOf(preview: Preview): string[] {
  const kinds = Object.entries(preview.counts)
    .filter(([, count]) => count > 0)
    .map(([kind]) => kind);
  return [
    ...kinds,
    ...(preview.houseRules ? ["rules"] : []),
    ...(preview.overworld ? ["overworld"] : []),
    ...(preview.plugin ? ["plugin"] : []),
  ];
}

// What the current ticks drop: every link from a ticked kind into an
// unticked one.
function droppedLinks(preview: Preview, kinds: string[]): string[] {
  return (preview.dependencies ?? [])
    .filter((dependency) => kinds.includes(dependency.from) && !kinds.includes(dependency.to))
    .map(
      (dependency) =>
        `${dependency.count} link${dependency.count === 1 ? "" : "s"} from ${BUNDLE_KIND_LABELS[dependency.from] ?? dependency.from} to ${BUNDLE_KIND_LABELS[dependency.to] ?? dependency.to} ${dependency.count === 1 ? "is" : "are"} dropped while those stay behind.`,
    );
}

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
      setSharedWorkshopId((data as Preview).sharedHomes?.[0]?.id ?? "");
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
        <div className={`${ui.card} mt-3 p-4`}>
          <SectionHead title={preview.manifest.name} glyph="system-share" />
          <p className="text-sm text-stone-400">{preview.manifest.blurb}</p>
          {preview.manifest.author ? (
            <p className="reveal mt-0.5 text-xs text-stone-500">by {preview.manifest.author}</p>
          ) : null}

          {/* Each kind is a tick: a DM who only wants the monsters takes the
              monsters. Unticking every one leaves an empty workshop, which
              the button below says out loud. */}
          <ul className={cn("stagger mt-3", chipRow)}>
            {kindsOf(preview).map((kind) => {
              const ticked = kinds.includes(kind);
              return (
                <li key={kind}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={ticked}
                    onClick={() =>
                      setKinds((current) => (ticked ? current.filter((entry) => entry !== kind) : [...current, kind]))
                    }
                    className={cn(ui.btnSmall, chip, "rounded-full normal-case", ticked ? chipOn : "text-stone-500")}
                  >
                    <Check className={cn("size-3.5", ticked ? "text-amber-300" : "opacity-20")} aria-hidden="true" />
                    {preview.counts[kind] === undefined ? "" : `${preview.counts[kind]} `}
                    {BUNDLE_KIND_LABELS[kind] ?? kind}
                  </button>
                </li>
              );
            })}
          </ul>

          {droppedLinks(preview, kinds).length ? (
            <ul className="stagger mt-2 space-y-1">
              {droppedLinks(preview, kinds).map((line) => (
                <li key={line} className="reveal text-xs text-amber-300/90">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          {preview.dependsOn ? (
            <div className="reveal mt-3">
              {preview.sharedHomes?.length ? (
                <>
                  <p className="mb-1 text-xs text-stone-400">
                    The records its cards pick from &quot;{preview.dependsOn.name}&quot;:
                  </p>
                  <Select
                    label="Shared records"
                    value={sharedWorkshopId}
                    onChange={setSharedWorkshopId}
                    options={[
                      ...preview.sharedHomes.map((home) => ({
                        value: home.id,
                        label: `Link to my "${home.title}"`,
                        hint: `${home.found} of ${home.total} found there; the rest land here.`,
                      })),
                      { value: "", label: "Bring them in as this workshop's own" },
                    ]}
                  />
                </>
              ) : (
                <p className="text-xs text-stone-400">
                  Its records from &quot;{preview.dependsOn.name}&quot; land as this workshop&apos;s
                  own. Import that workshop&apos;s bundle first to link them to it instead.
                </p>
              )}
            </div>
          ) : null}

          <UnofficialPackNotice
            rightsHolder={preview.manifest.rightsHolder}
            inspiredBy={preview.manifest.inspiredBy}
            className="mt-3"
          />

          {preview.warnings.length ? (
            <ul className="stagger mt-3 space-y-1">
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
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
              {kinds.length === 0
                ? "Import an empty workshop"
                : kinds.length === kindsOf(preview).length
                  ? "Import it"
                  : `Import ${kinds.length} of ${kindsOf(preview).length} kinds`}
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
