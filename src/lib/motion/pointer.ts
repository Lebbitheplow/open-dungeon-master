// Pointer physics for the whole app: the magnet pull and cursor sheen on a
// button, the tilt and light on a card, the ripple where a press landed.
//
// One delegated listener per page, and a pointer never changes React state:
// everything is written as CSS custom properties on the element under the
// cursor and globals.css does the rest (docs/visual-overhaul-plan.md 2.1).
// Elements opt in with a class, which the shared styles in src/lib/ui.tsx
// already carry, so no component has to know this file exists.
//
// Nothing attaches under reduced motion. Tilt, magnet and sheen need a fine
// pointer that can hover and are skipped under low effects; the ripple is a
// press response, so it stays for touch.

const PHYSICS = ".motion-magnet, .motion-card";
const PRESSABLE = ".motion-magnet, .motion-press";

let installed = false;

function lowEffects(): boolean {
  return document.documentElement.dataset.effects === "low";
}

function rest(el: HTMLElement): void {
  for (const prop of ["--rx", "--ry"]) el.style.setProperty(prop, "0deg");
  for (const prop of ["--mgx", "--mgy"]) el.style.setProperty(prop, "0px");
  el.style.setProperty("--sheen", "0");
}

export function installPointerMotion(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  installed = true;

  const hovering = window.matchMedia("(hover: hover) and (pointer: fine)");
  let current: HTMLElement | null = null;
  let pending: PointerEvent | null = null;
  let frame = 0;

  const apply = () => {
    frame = 0;
    const event = pending;
    pending = null;
    if (!event || !hovering.matches || lowEffects()) {
      if (current) rest(current);
      current = null;
      return;
    }
    const target = event.target instanceof Element ? (event.target.closest(PHYSICS) as HTMLElement | null) : null;
    if (current && current !== target) rest(current);
    current = target;
    if (!target || target.matches(":disabled, [aria-disabled='true']")) return;
    const box = target.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // -0.5 to 0.5 across the element, clamped so a fast exit never overshoots.
    const dx = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const dy = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    target.style.setProperty("--mx", `${((dx + 0.5) * 100).toFixed(1)}%`);
    target.style.setProperty("--my", `${((dy + 0.5) * 100).toFixed(1)}%`);
    target.style.setProperty("--sheen", "1");
    if (target.classList.contains("motion-card")) {
      // A big surface tilts less than a small one, or a wide panel swings.
      const tilt = Number(target.dataset.tilt) || Math.max(2.5, Math.min(7, 1400 / Math.max(box.width, box.height)));
      target.style.setProperty("--ry", `${(dx * tilt).toFixed(2)}deg`);
      target.style.setProperty("--rx", `${(-dy * tilt * 0.8).toFixed(2)}deg`);
    } else {
      target.style.setProperty("--mgx", `${(dx * 4).toFixed(2)}px`);
      target.style.setProperty("--mgy", `${(dy * 3).toFixed(2)}px`);
    }
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      pending = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    if (current) rest(current);
    current = null;
  });

  // A press drops a ring where the pointer landed. The ring is a pseudo
  // element, so it restarts by clearing the attribute, forcing a reflow and
  // setting it again: the second press replays it.
  window.addEventListener(
    "pointerdown",
    (event) => {
      const el = event.target instanceof Element ? (event.target.closest(PRESSABLE) as HTMLElement | null) : null;
      if (!el || el.matches(":disabled, [aria-disabled='true']")) return;
      const box = el.getBoundingClientRect();
      el.style.setProperty("--rpx", `${(event.clientX - box.left).toFixed(0)}px`);
      el.style.setProperty("--rpy", `${(event.clientY - box.top).toFixed(0)}px`);
      el.removeAttribute("data-rippling");
      void el.offsetWidth;
      el.setAttribute("data-rippling", "");
    },
    { passive: true },
  );
}

installPointerMotion();
