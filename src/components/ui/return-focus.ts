// The game's Radix dialogs open from state, with no Radix trigger, so on
// close Radix has no trigger to focus and focus falls to the page body: a
// keyboard user loses their place behind the dialog. Spread these on a
// dialog's Content: it keeps the element that held focus when the dialog
// opened and hands focus back to it on close. An opener that is gone (a menu
// item that closed with its menu) leaves Radix's own handling in place.
// Both events are dispatched on the same Content element, so the opener is
// kept against it.
const openers = new WeakMap<EventTarget, Element | null>();

export const returnFocus = {
  onOpenAutoFocus(event: Event) {
    if (event.target) openers.set(event.target, document.activeElement);
  },
  onCloseAutoFocus(event: Event) {
    const back = event.target ? openers.get(event.target) : null;
    if (event.target) openers.delete(event.target);
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) {
      event.preventDefault();
      back.focus();
    }
  },
};
