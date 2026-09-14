"use client";

import { cn } from "@/lib/cn";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";

// One attributed line in the transcript (docs/vtt-parity-implementation-
// plan.md 8.1): the face at the left, the name in eyebrow caps, the words
// in a speech tone, entering with the fade-up the rest of the log uses.

export function SpeechLine({ speaker, cast, children, className }: { speaker: Speaker; cast: CastMember[]; children: React.ReactNode; className?: string }) {
  const face = cast.find((member) => member.id === speaker.id || member.name.toLowerCase() === speaker.name.toLowerCase())?.portraitUrl;
  return (
    <div className={cn("animate-fade-up flex items-start gap-2.5", className)}>
      {face ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={face} alt="" className="mt-0.5 size-9 shrink-0 rounded-full border border-amber-700/60 object-cover shadow-glow-gold" />
      ) : (
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900 font-display text-sm text-amber-100">
          {speaker.name.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="eyebrow text-[10px] text-amber-300/80">{speaker.name}</p>
        <p className="whitespace-pre-wrap text-pretty font-serif text-base italic leading-relaxed text-amber-50">{children}</p>
      </div>
    </div>
  );
}
