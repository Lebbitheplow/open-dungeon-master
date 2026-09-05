import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CampaignCover as CampaignCoverRef } from "@/lib/campaign-types";
import { campaignPlaceholder } from "@/lib/placeholders";

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
  genre,
  seed,
  status = null,
  className,
}: {
  cover: CampaignCoverRef | null;
  title: string;
  // The campaign's genre and its id. Together they pick one of the three
  // painted plates for that setting, and the id keeps a table on the same
  // plate every time it is drawn instead of reshuffling on each mount.
  genre?: string | null;
  seed?: string | null;
  status?: CoverStatus;
  className?: string;
}) {
  const pending = status === "queued" || status === "generating";
  const url = cover?.url ?? campaignPlaceholder(genre, seed ?? "");
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl border border-amber-400/25 bg-stone-950 shadow-glow-gold",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={cover ? `${title} cover art` : ""}
        aria-label={cover ? undefined : `${title} has no cover art yet`}
        className={cn("size-full object-cover", !cover && pending && "opacity-40")}
        loading="lazy"
      />
      {pending ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2 className="size-6 animate-spin text-amber-200" aria-label="Painting the cover" />
        </div>
      ) : null}
    </div>
  );
}
