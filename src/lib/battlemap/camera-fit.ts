// The board's resting view (issue 87). The board is laid out as wide as the
// frame around it. Where the frame is as tall as the board (the side panel,
// a phone) that is the whole board and the resting view is the plain one.
// Where the frame is a fixed window (the fight stage, the enlarged
// tabletop, the shared screen) a tall board would run out of the bottom, so
// the resting view shrinks it until all of it shows and centres it.

export type FitCamera = { zoom: number; x: number; y: number };

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 3;

export function fitCamera(frame: { width: number; height: number }, board: { width: number; height: number }): FitCamera {
  if (frame.width <= 0 || frame.height <= 0 || board.width <= 0 || board.height <= 0) {
    return { zoom: 1, x: 0, y: 0 };
  }
  // The board's height in frame pixels at zoom 1.
  const tall = (frame.width * board.height) / board.width;
  // A pixel of slack: a frame sized by its own board rounds either way.
  if (tall <= frame.height + 1) {
    return { zoom: 1, x: 0, y: 0 };
  }
  const zoom = frame.height / tall;
  return { zoom, x: (frame.width - frame.width * zoom) / 2, y: 0 };
}

// The furthest out a view may go: the usual floor, or the fit when a tall
// board in a short window needs to go further to show whole.
export function minZoomFor(fit: FitCamera): number {
  return Math.min(MIN_ZOOM, fit.zoom);
}

export function clampZoomTo(zoom: number, floor: number): number {
  return Math.min(MAX_ZOOM, Math.max(floor, zoom));
}
