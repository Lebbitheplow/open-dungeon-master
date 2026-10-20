"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CharacterPortrait, ui } from "@/lib/ui";
import { portraitPhase, portraitReadyLine, type PortraitSubject } from "@/app/characters/portrait-arrival";

// The roster card's portrait while it is painted (backlog F25), in three
// pieces the page places: the picture itself, the card's line saying what
// the painter is doing, and the page's toast when one is done. Styles:
// styles/moments.css, "portrait arrival".

type RosterSubject = PortraitSubject & { race: string; class: string; sheet?: PortraitSubject["sheet"] & { gender?: string } };

// The picture. A portrait that has just finished fades in, briefly, unless
// this device is still (low effects or reduced motion): then it is simply
// there.
export function RosterPortraitSlot({
  character,
  arriving,
  still,
}: {
  character: RosterSubject;
  arriving: boolean;
  still: boolean;
}) {
  const phase = portraitPhase(character);
  if (phase === "painted") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={character.sheet!.portrait!.url}
        alt={character.name}
        className={cn(
          "size-12 shrink-0 rounded-lg border border-amber-500/30 object-cover shadow-glow-gold",
          arriving && !still && "portrait-arrive",
        )}
      />
    );
  }
  if (phase === "painting") {
    // The words are on the card's status line below; the spinner is the
    // picture of them.
    return (
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-stone-900"
      >
        <Loader2 className="size-4 animate-spin text-amber-200" />
      </span>
    );
  }
  return (
    <CharacterPortrait
      look={{ race: character.race, class: character.class, gender: character.sheet?.gender }}
      alt={character.name}
      size="size-12"
      className="border-amber-500/30 shadow-glow-gold"
    />
  );
}

// The card's line about its portrait. The status region is always there, so
// a screen reader hears it when painting starts and when it fails; it falls
// quiet once the picture lands, because the page's toast says that once.
// A failed painting offers to paint again, outside the region.
export function RosterPortraitStatus({
  character,
  retrying,
  retryError,
  onRetry,
}: {
  character: PortraitSubject;
  retrying: boolean;
  retryError: string;
  onRetry: () => void;
}) {
  const phase = portraitPhase(character);
  return (
    <div className={cn(phase === "painting" || phase === "failed" ? "mt-2 flex flex-wrap items-center gap-2" : "contents")}>
      <p role="status" className={cn("text-xs", phase === "failed" ? "text-red-300" : "text-amber-200/90")}>
        {phase === "painting" ? (
          <>
            <span className="sr-only">{character.name}: </span>
            Painting portrait…
          </>
        ) : phase === "failed" ? (
          <>
            <span className="sr-only">{character.name}: </span>
            The portrait could not be painted.
          </>
        ) : null}
      </p>
      {phase === "failed" ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-label={`Paint ${character.name}'s portrait again`}
          className={cn(ui.btnSecondary, "min-h-10 px-3 py-1 text-xs")}
        >
          {retrying ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          Try again
        </button>
      ) : null}
      {phase === "failed" && retryError ? (
        <p role="alert" className="w-full text-xs text-red-300">
          {retryError}
        </p>
      ) : null}
    </div>
  );
}

// The page's toast. The region stays mounted and polite, so the line is
// heard once when it appears; it holds no control and never takes focus.
export function PortraitToast({ toast }: { toast: { id: string; name: string } | null }) {
  return (
    <div role="status" className="portrait-toast-region">
      {toast ? (
        <p key={toast.id} className="portrait-toast">
          {portraitReadyLine(toast.name)}
        </p>
      ) : null}
    </div>
  );
}
