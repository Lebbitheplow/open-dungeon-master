// Restarts a one-shot CSS animation on an element that is already mounted:
// clear it, force a reflow, set it again. Used for the shake on a refused
// field and any beat that has to play a second time without a remount.
export function replayAnimation(el: HTMLElement | null, animation: string): void {
  if (!el) return;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = animation;
}
