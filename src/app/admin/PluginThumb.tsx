"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { campaignPlaceholder } from "@/lib/placeholders";

// A plugin's picture in the browser: its thumbnail or cover when it has one,
// and otherwise, or when that fails to load, the genre's own cover plate, so
// every entry in the list has a picture and a missing file never shows as a
// broken image.
export function PluginThumb({
  src,
  genre,
  seed,
  className,
}: {
  src?: string;
  genre?: string;
  seed: string;
  className?: string;
}) {
  const [failed, setFailed] = useState("");
  const url = src && src !== failed ? src : campaignPlaceholder(genre, seed);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(src ?? "")}
      className={cn(
        "aspect-video shrink-0 rounded-md border border-amber-500/20 bg-stone-950/60 object-cover",
        className,
      )}
    />
  );
}
