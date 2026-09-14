"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";

// Theatre inserts (docs/vtt-parity-implementation-plan.md 8.3): when the
// latest passage carries attributed speech, the speakers' portraits slide
// in at the lower edge of the scene art over --dur-move with the settle
// curve, two of them left and right, and slide out when the next passage
// has nobody talking or after the lines have had their time.

const HOLD_MS = 20_000;

export function TheatreInserts({ speakers, cast, messageId }: { speakers: Speaker[]; cast: CastMember[]; messageId: string }) {
  const [shownFor, setShownFor] = useState<string | null>(null);
  useEffect(() => {
    if (!speakers.length) {
      return;
    }
    const show = window.setTimeout(() => setShownFor(messageId), 0);
    const hide = window.setTimeout(() => setShownFor((current) => (current === messageId ? null : current)), HOLD_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [messageId, speakers.length]);
  const visible = shownFor === messageId && speakers.length > 0;
  const shown = speakers.slice(0, 2);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-2 pb-1">
      {shown.map((speaker, index) => {
        const face = cast.find((member) => member.id === speaker.id || member.name.toLowerCase() === speaker.name.toLowerCase())?.portraitUrl;
        return (
          <figure
            key={speaker.name}
            className={cn(
              "flex flex-col items-center gap-0.5 transition-all duration-[var(--dur-move)] ease-[var(--ease-settle)]",
              index === 1 ? "ml-auto" : "",
              visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
            )}
          >
            {face ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={face} alt="" className="size-16 rounded-full border-2 border-amber-500/80 object-cover shadow-glow-gold sm:size-20" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-full border-2 border-amber-500/60 bg-stone-950/80 font-display text-xl text-amber-100 sm:size-20">
                {speaker.name.charAt(0).toUpperCase()}
              </span>
            )}
            <figcaption className="rounded bg-stone-950/80 px-1.5 text-[10px] uppercase tracking-wide text-amber-100">{speaker.name}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
