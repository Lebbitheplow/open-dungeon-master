"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CORRECTION_REASON_LABELS, CORRECTION_REASONS, type CorrectionReason } from "@/lib/correction-reasons";
import { CORRECTION_OFFER_EVENT, type CorrectionOffer } from "@/lib/correction-offer";

// After a fix to the AI (an undo, an edit, a reroll, a rewind...), one
// optional tap says why (issue #460). The fix is already done when this
// shows; ignoring it, closing it or letting it fade leaves the reason
// blank, which the correction ledger counts like any other fix. "Changed my
// mind" is left out of every rate.
const SHOWN_MS = 15_000;

export function CorrectionReasonChips({ campaignId }: { campaignId: string }) {
  const [offer, setOffer] = useState<CorrectionOffer | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<CorrectionOffer>).detail;
      if (!detail || detail.campaignId !== campaignId || !detail.ids.length) {
        return;
      }
      clear();
      setSaved(false);
      setOffer(detail);
      timer.current = window.setTimeout(() => setOffer(null), SHOWN_MS);
    };
    window.addEventListener(CORRECTION_OFFER_EVENT, listener);
    return () => {
      window.removeEventListener(CORRECTION_OFFER_EVENT, listener);
      clear();
    };
  }, [campaignId]);

  if (!offer) {
    return null;
  }

  const choose = (reason: CorrectionReason) => {
    const ids = offer.ids;
    setSaved(true);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => setOffer(null), 1_500);
    // Best effort: a reason that does not arrive leaves the fix recorded
    // without one, which is what skipping does too.
    void fetch(`/api/campaigns/${campaignId}/corrections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, reason }),
    }).catch(() => undefined);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4" data-correction-chips="">
      <div role="group" aria-label="Why the fix" className="panel pointer-events-auto flex max-w-xl flex-wrap items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-stone-300 shadow-lg">
        {saved ? (
          <span data-correction-saved="">Noted, thank you.</span>
        ) : (
          <>
            <span className="mr-1 text-stone-400">Why the fix? Optional:</span>
            {CORRECTION_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                data-correction-reason={reason}
                onClick={() => choose(reason)}
                className="rounded-full border border-stone-600/60 bg-stone-900/60 px-2.5 py-1 text-stone-200 hover:border-amber-500/50 hover:text-amber-100 motion-press"
              >
                {CORRECTION_REASON_LABELS[reason]}
              </button>
            ))}
          </>
        )}
        <button type="button" aria-label="Skip" onClick={() => setOffer(null)} className="ml-auto rounded-md p-1 text-stone-500 hover:text-stone-200">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
