import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CampaignCover as CampaignCoverRef } from "@/lib/campaign-types";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";

// The campaign's cover art, or the themed placeholder when there is none.
// One component for the home-screen tile, the lobby hero and the edit
// dialog's preview, so a campaign looks the same everywhere it is shown.
// Size comes from the caller: the default is a 16:9 block that fills its
// column, and className overrides it (cn merges Tailwind classes).
//
// Status is the in-memory render state from src/lib/campaign-cover.ts. Only
// queued and generating draw anything (a spinner over the placeholder);
// a failed render simply shows the placeholder again, because the dialog is
// the place to say why, not every tile.
export type CoverStatus = "queued" | "generating" | "failed" | null;

export function CampaignCover({
  cover,
  title,
  status = null,
  className,
}: {
  cover: CampaignCoverRef | null;
  title: string;
  status?: CoverStatus;
  className?: string;
}) {
  const pending = status === "queued" || status === "generating";
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl border border-amber-400/25 bg-stone-950 shadow-glow-gold",
        className,
      )}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.url}
          alt={`${title} cover art`}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center bg-gradient-to-br from-indigo-950 via-stone-950 to-black"
          aria-label={`${title} has no cover art yet`}
        >
          <PixelTile src={PIXEL_ICONS.story} size="size-14" className={pending ? "opacity-40" : ""} />
        </div>
      )}
      {pending ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2 className="size-6 animate-spin text-amber-200" aria-label="Painting the cover" />
        </div>
      ) : null}
    </div>
  );
}
