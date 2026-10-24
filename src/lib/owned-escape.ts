// An Escape a control inside a dialog answers itself: the builder's swap
// question calls the swap off on Escape, and the companion builder's dialog
// around it must not close too. Radix hears Escape on the document before
// the question's own handler runs, so the dialog asks first: a control that
// carries OWNS_ESCAPE keeps the key (CompanionBuilderDialog.tsx).
export const OWNS_ESCAPE = "data-owns-escape";

// Whether the key landed inside a control that answers Escape itself.
export function escapeIsOwned(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest(`[${OWNS_ESCAPE}]`) !== null;
}
