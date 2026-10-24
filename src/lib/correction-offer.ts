// The table's half of the reason chip (issue #460): a fix's answer carries
// the ids of the correction ledger rows it wrote, and the control that made
// the fix hands them here. One strip (src/components/CorrectionReasonChips.tsx)
// listens and offers the chips; the fix itself has already happened, so the
// chips are never in its way. Browser only, and no "@/" imports.

export const CORRECTION_OFFER_EVENT = "odm:correction-offer";

export type CorrectionOffer = { campaignId: string; ids: string[] };

// Called with a fix's parsed answer. An answer with no rows offers nothing.
export function offerCorrectionReason(campaignId: string, answer: unknown): void {
  if (typeof window === "undefined" || !answer || typeof answer !== "object") {
    return;
  }
  const raw = (answer as { corrections?: unknown }).corrections;
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  if (!ids.length) {
    return;
  }
  window.dispatchEvent(new CustomEvent<CorrectionOffer>(CORRECTION_OFFER_EVENT, { detail: { campaignId, ids } }));
}
