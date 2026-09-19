// "Everything answers the hand" (the Motion Kit mockup's first rule), for the
// controls that never opted in. The kit classes in src/lib/ui.tsx carry the
// full physics (magnet, tilt, sheen, ripple), but most of the app's buttons,
// chips, tabs and link tiles are written by hand and had none: they sat still.
//
// This gives every interactive element the two responses the mockup puts on
// everything: a small lift under the pointer, and a press that sinks and
// springs back on release. It is one delegated listener set and the Web
// Animations API on the individual `translate` and `scale` properties, so it
// never touches React state, never replaces an element's own `transform`,
// `transition` or CSS animation, and needs no class on the element.
//
// Left alone: anything that already has kit physics, anything that positions
// itself with `translate` or sizes itself with `scale` (the animation would
// fight it), inline text links, disabled controls, SVG, and anything inside
// `[data-no-motion]`. Nothing runs under reduced motion; the hover lift needs
// a fine pointer and rests under low effects, the press stays for touch.

const INTERACTIVE =
  'button, [role="button"], a[href], summary, select, label[for], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="radio"], [role="switch"], [role="checkbox"], [data-motion]';
const OWN_PHYSICS = ".motion-magnet, .motion-press, .motion-nudge, .motion-card, .motion-rail, [data-no-motion], [data-no-motion] *";

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SNAP = "cubic-bezier(0.3, 0, 0.5, 1)";

type Held = { press?: Animation; lift?: Animation };
const held = new WeakMap<HTMLElement, Held>();

function lowEffects(): boolean {
  return document.documentElement.dataset.effects === "low";
}

function candidate(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(INTERACTIVE);
  if (!(el instanceof HTMLElement)) return null;
  if (el.matches(OWN_PHYSICS) || el.matches(":disabled, [aria-disabled='true']")) return null;
  return el;
}

// What the element's own styles say, read once per gesture. An element that
// already uses the property is left to it.
function free(el: HTMLElement, property: "translate" | "scale"): boolean {
  const style = getComputedStyle(el);
  if (style.display === "inline" || style.display === "contents") return false;
  const value = style.getPropertyValue(property);
  return value === "none" || value === "";
}

// A wide row sinks less than a small chip, or the whole line seems to jump.
function depth(el: HTMLElement): number {
  const size = Math.max(el.offsetWidth, el.offsetHeight);
  if (size > 520) return 0.992;
  if (size > 260) return 0.98;
  return 0.955;
}

let installed = false;

export function installAnswering(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (typeof Element.prototype.animate !== "function") return;
  installed = true;

  const hovering = window.matchMedia("(hover: hover) and (pointer: fine)");
  let lifted: HTMLElement | null = null;
  let pressed: HTMLElement | null = null;

  const settle = (el: HTMLElement) => {
    const state = held.get(el);
    if (!state?.lift) return;
    state.lift.cancel();
    state.lift = undefined;
    if (el.isConnected) el.animate([{ translate: "0 -1.5px" }, { translate: "0 0" }], { duration: 320, easing: SPRING });
  };

  document.addEventListener(
    "pointerover",
    (event) => {
      if (!hovering.matches || lowEffects()) return;
      const el = candidate(event.target);
      if (el === lifted) return;
      if (lifted) settle(lifted);
      lifted = null;
      if (!el || !free(el, "translate")) return;
      lifted = el;
      const state = held.get(el) ?? {};
      state.lift = el.animate([{ translate: "0 0" }, { translate: "0 -1.5px" }], { duration: 180, easing: SNAP, fill: "forwards" });
      held.set(el, state);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    if (lifted) settle(lifted);
    lifted = null;
  });

  const release = () => {
    const el = pressed;
    pressed = null;
    if (!el) return;
    const state = held.get(el);
    const sunk = depth(el);
    state?.press?.cancel();
    if (state) state.press = undefined;
    if (el.isConnected) {
      el.animate([{ scale: String(sunk) }, { scale: "1.02" }, { scale: "1" }], { duration: 360, easing: SPRING });
    }
  };

  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      const el = candidate(event.target);
      if (!el || !free(el, "scale")) return;
      pressed = el;
      const state = held.get(el) ?? {};
      state.press?.cancel();
      state.press = el.animate([{ scale: "1" }, { scale: String(depth(el)) }], { duration: 110, easing: SNAP, fill: "forwards" });
      held.set(el, state);
    },
    { passive: true },
  );
  // A thing that turns ON lands with a small pop, so a toggle reads as
  // something that happened: a chip (aria-pressed), a switch or radio
  // (aria-checked), a tab or option (aria-selected), a native tick. Read a
  // frame after the click, once React has written the new state, and only in
  // answer to the user's own click, never on load.
  const ON = '[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]';
  document.addEventListener(
    "click",
    (event) => {
      const el = candidate(event.target);
      if (!el) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!el.isConnected || !el.matches(ON) || !free(el, "scale")) return;
          if (el.matches(".kit-switch, .seg-control *")) return;
          el.animate([{ scale: "0.94" }, { scale: "1.04" }, { scale: "1" }], { duration: 280, easing: SPRING });
        });
      });
    },
    { passive: true },
  );
  document.addEventListener(
    "change",
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.checked) return;
      if (input.type !== "checkbox" && input.type !== "radio") return;
      input.animate([{ scale: "0.6" }, { scale: "1.15" }, { scale: "1" }], { duration: 260, easing: SPRING });
    },
    { passive: true },
  );

  window.addEventListener("pointerup", release, { passive: true });
  window.addEventListener("pointercancel", release, { passive: true });
  window.addEventListener("blur", release);
}

installAnswering();
