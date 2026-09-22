"use client";

import { useRef, useState } from "react";
import { EyeOff, Image as ImageIcon, Loader2, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { encodeImageForUpload } from "@/lib/image-encode";
import { ui } from "@/lib/ui";
import type { LoreLinkTarget, LoreVisibility } from "@/lib/dm/world-lore-logic";
import { Markdown } from "@/components/ui/Markdown";
import type { LoreEntryView } from "@/app/workshop/lore/types";

// The binder's extra fields (docs/workshop-parity-audit.md phase 14): who
// may read an entry, the picture that makes it a handout, and the body
// rendered with headings, lists and [[links]] instead of as a block of
// text.

const chip = cn(ui.btnSmall, "px-2.5 py-1.5");

export function VisibilitySelect({
  value,
  onChange,
}: {
  value: LoreVisibility;
  onChange: (next: LoreVisibility) => void;
}) {
  return (
    <div data-pill-group="" className="flex flex-wrap items-center gap-1.5 text-xs">
      <button data-on={value === "party" ? "" : undefined}
        type="button"
        aria-pressed={value === "party"}
        onClick={() => onChange("party")}
        className={cn(
          chip,
          value === "party" ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "",
        )}
      >
        <Users className="size-3" /> The table reads it
      </button>
      <button data-on={value === "dm" ? "" : undefined}
        type="button"
        aria-pressed={value === "dm"}
        onClick={() => onChange("dm")}
        className={cn(
          chip,
          value === "dm" ? "border-violet-700 bg-violet-950/40 text-violet-200" : "",
        )}
      >
        <EyeOff className="size-3" /> Only I read it
      </button>
      <span className="text-[11px] text-stone-500">
        {value === "dm"
          ? "A secret: the DM prompt knows it, the players never see it."
          : "Part of the world bible every player can open. With a picture, a handout."}
      </span>
    </div>
  );
}

export function LoreImageField({
  imagePath,
  onChange,
}: {
  imagePath: string;
  onChange: (path: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const { dataUrl, type } = await encodeImageForUpload(file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That image would not upload.");
        return;
      }
      onChange(payload.url);
    } catch {
      setError("That image would not upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void upload(file);
          }
          event.target.value = "";
        }}
      />
      {imagePath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagePath} alt="" className="h-12 w-12 rounded-md border border-stone-700 object-cover" />
      ) : null}
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className={chip}
      >
        {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
        {imagePath ? "Replace the picture" : "Add a picture"}
      </button>
      {imagePath ? (
        <button type="button" onClick={() => onChange("")} className={chip}>
          <Trash2 className="size-3" /> Take it away
        </button>
      ) : null}
      {error ? <span className="motion-shake inline-block text-[11px] text-red-400">{error}</span> : null}
    </div>
  );
}

// The entry as read: its picture, then its body with the formatting and
// the links resolved against the rest of the binder.
export function LoreBody({
  entry,
  targets,
  onLink,
  dmView = false,
}: {
  entry: Pick<LoreEntryView, "body" | "imagePath" | "title" | "style" | "attachmentPath">;
  targets: LoreLinkTarget[];
  onLink?: (target: LoreLinkTarget) => void;
  dmView?: boolean;
}) {
  return (
    <div className="space-y-2">
      {entry.imagePath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.imagePath}
          alt={entry.title}
          className="max-h-80 w-full rounded-lg border border-stone-800 object-contain"
        />
      ) : null}
      <Markdown source={entry.body} targets={targets} onLink={onLink} style={entry.style ?? "plain"} dmView={dmView} />
      {entry.attachmentPath ? (
        // The PDF's pages in the browser's own viewer (section 5.3). The
        // Android app has no viewer of its own, so its bridge opens the
        // file with the system's (docs/vtt-parity-implementation-plan.md 18.2).
        <>
          {typeof window !== "undefined" && window.odm?.openDocument ? (
            <button
              type="button"
              onClick={() => void window.odm?.openDocument?.(entry.attachmentPath ?? "")}
              className={cn(ui.btnSmall, "mb-2 text-sm")}
            >
              Open the pages in your reader
            </button>
          ) : null}
          <iframe
            src={entry.attachmentPath}
            title={`${entry.title} pages`}
            className="h-[70vh] w-full rounded-lg border border-stone-800 bg-stone-100"
          />
        </>
      ) : null}
    </div>
  );
}
