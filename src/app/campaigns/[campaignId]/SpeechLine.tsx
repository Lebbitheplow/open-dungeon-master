"use client";

import { cn } from "@/lib/cn";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";
import { useFaceChain } from "@/app/campaigns/[campaignId]/useFaceChain";
import { useFaceSize } from "@/app/campaigns/[campaignId]/useFaceSize";
import { textKey } from "@/lib/language/text-logic";

// One attributed line in the transcript (docs/vtt-parity-implementation-
// plan.md 8.1): the face at the left, the name in eyebrow caps, the words
// in a speech tone, entering with the fade-up the rest of the log uses.

export function SpeechLine({
  speaker,
  cast,
  children,
  className,
  // Faces from somewhere other than the cast, best first: a character's
  // own portrait, then their plate (speakerFaces).
  faces: given,
}: {
  speaker: Speaker;
  cast: CastMember[];
  children: React.ReactNode;
  className?: string;
  faces?: readonly string[];
}) {
  const painted = cast.find((member) => member.id === speaker.id || textKey(member.name) === textKey(speaker.name))?.portraitUrl;
  // A picture that fails to load gives way to the next, and to the initial
  // once none is left (useFaceChain).
  const [face, onFaceError] = useFaceChain(given?.length ? given : painted ? [painted] : undefined);
  // A painted face grows with the line it speaks (useFaceSize); the initial
  // that stands in for an unpainted one keeps its small circle.
  const [faceStyle, textColumn] = useFaceSize<HTMLDivElement>();
  return (
    <div className={cn("animate-fade-up flex items-start gap-2.5", className)} style={face ? faceStyle : undefined}>
      {face ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={face} alt="" onError={onFaceError} className="speech-face mt-0.5 shrink-0 rounded-full border border-amber-700/60 object-cover shadow-glow-gold" />
      ) : (
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900 font-display text-sm text-amber-100">
          {speaker.name.charAt(0).toUpperCase()}
        </span>
      )}
      <div ref={face ? textColumn : undefined} className="min-w-0 flex-1">
        <p className="eyebrow text-[10px] text-amber-300/80">{speaker.name}</p>
        <p className="whitespace-pre-wrap text-pretty font-serif text-base italic leading-relaxed text-amber-50">{children}</p>
      </div>
    </div>
  );
}
