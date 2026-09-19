// Where a hand-made portal should land. In a browser that is the document
// body. In the desktop and mobile apps the game's stylesheet is confined to
// the element the pages are drawn into (`.game-root`, the client repo's
// scripts/scope-css.mjs), so anything portalled to the body arrives with no
// styles at all: a context menu's anchor loses its `position: fixed` and the
// menu opens in the wrong place, a docked panel arrives bare. Radix's own
// portals are pointed the same way by the apps' portal shim.
export function overlayRoot(from?: Element | null): HTMLElement {
  return from?.closest<HTMLElement>(".game-root") ?? document.querySelector<HTMLElement>(".game-root") ?? document.body;
}
