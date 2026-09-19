// The travelling pill (the Motion Kit's "Segmented · the composer's kind
// pills"): in a row where one of several is chosen, the highlight is ONE
// element that slides to the choice on a spring, not a style that blinks off
// one button and on another.
//
// The kit's SegmentedControl and IconRail draw their own. This is the same
// motion for every row written by hand, and there are dozens: the composer's
// Do / Say / OOC / Direct, the DM's board controls, the tone chips, filters,
// sub-tabs. A row opts in with two attributes and no component:
//
//   <div data-pill-group> ... <button data-on={chosen ? "" : undefined}> ...
//
// The pill is a span this file appends to the row. It borrows the chosen
// button's own background, radius and shadow (so each row keeps its look and
// a differently coloured choice, like the composer's ember "Direct", carries
// its colour along), and globals.css blanks the button's own highlight while
// a pill is standing in for it. With this file absent, under reduced motion,
// or before the first measure, the button simply wears its highlight as
// before: nothing depends on the pill to show which one is chosen.

// Opted-in rows, plus every tab strip: a tablist already says which tab is
// chosen (aria-selected), so it needs no marking at all.
const GROUP = '[data-pill-group], [role="tablist"]';
const CHOSEN = '[data-on], [role="tab"][aria-selected="true"]';
// Rows that already carry their own travelling indicator.
const OWN_MARK = ".rail-mark, .seg-pill";
const PILL_CLASS = "motion-pill";

const pills = new WeakMap<HTMLElement, HTMLElement>();
let scheduled = false;
const dirty = new Set<HTMLElement>();

function place(group: HTMLElement): void {
  if (!group.isConnected) return;
  if (group.querySelector(OWN_MARK)) return;
  const chosen = group.querySelector<HTMLElement>(CHOSEN);
  let pill = pills.get(group) ?? null;
  if (!chosen || chosen.offsetParent === null) {
    group.removeAttribute("data-pill-ready");
    if (pill) pill.style.opacity = "0";
    return;
  }
  const first = !pill || !pill.isConnected;
  if (first) {
    pill = document.createElement("span");
    pill.className = PILL_CLASS;
    pill.setAttribute("aria-hidden", "true");
    if (getComputedStyle(group).position === "static") group.style.position = "relative";
    group.appendChild(pill);
    pills.set(group, pill);
  }
  if (!pill) return;

  // Read the chosen button's own highlight with the stand-in switched off,
  // or the blanked style is what gets copied.
  group.removeAttribute("data-pill-ready");
  const look = getComputedStyle(chosen);
  pill.style.backgroundImage = look.backgroundImage;
  pill.style.backgroundColor = look.backgroundColor;
  pill.style.boxShadow = look.boxShadow;
  pill.style.borderRadius = look.borderRadius;
  // The button keeps its own border (an underlined tab is nothing but one);
  // the pill carries only the fill and the glow.

  const from = group.getBoundingClientRect();
  const to = chosen.getBoundingClientRect();
  const x = to.left - from.left - group.clientLeft + group.scrollLeft;
  const y = to.top - from.top - group.clientTop + group.scrollTop;
  if (first) pill.style.transition = "none";
  pill.style.width = `${to.width}px`;
  pill.style.height = `${to.height}px`;
  pill.style.translate = `${x}px ${y}px`;
  pill.style.opacity = "1";
  group.setAttribute("data-pill-ready", "");
  if (first) {
    // Land in place on the first frame, slide from then on.
    void pill.offsetWidth;
    pill.style.transition = "";
  }
}

function flush(): void {
  scheduled = false;
  const groups = [...dirty];
  dirty.clear();
  for (const group of groups) place(group);
}

function mark(node: Node | null): void {
  const el = node instanceof Element ? node : node?.parentElement;
  const group = el?.closest<HTMLElement>(GROUP);
  if (!group) return;
  dirty.add(group);
  if (!scheduled) {
    scheduled = true;
    window.requestAnimationFrame(flush);
  }
}

let installed = false;

export function installPills(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  installed = true;

  const sweep = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>(GROUP).forEach((group) => mark(group));
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        mark(record.target);
        continue;
      }
      // Our own pill arriving is not news.
      if ([...record.addedNodes].every((node) => node instanceof Element && node.classList.contains(PILL_CLASS))) continue;
      mark(record.target);
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          if (node.matches(GROUP)) mark(node);
          sweep(node);
        }
      });
    }
  });

  const start = () => {
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-on", "aria-selected"] });
    sweep(document);
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  // A row that reflows (a resize, a font landing, a panel opening) moves its
  // buttons without changing which is chosen.
  window.addEventListener("resize", () => sweep(document), { passive: true });
  if (document.fonts?.ready) void document.fonts.ready.then(() => sweep(document));
}

installPills();
