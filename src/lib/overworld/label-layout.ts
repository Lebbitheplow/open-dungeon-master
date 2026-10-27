// Where each name on the region map goes (issue 548). Every name used to be
// printed at the same offset from its dot, so two places a few tiles apart
// wrote over each other. Here a name tries eight spots around its dot and
// takes the first that covers no other name and no dot; the places that
// matter most choose first; a long name that fits nowhere tries a shortened
// form, and one that still does not fit waits for the reader to zoom in or
// point at its dot. Pure and DOM-free: the canvas hands in a measure.

export type Box = { x: number; y: number; width: number; height: number };

export type LabelRequest = {
  id: string;
  text: string;
  // The point the name belongs to, and the radius of the dot drawn there.
  x: number;
  y: number;
  radius: number;
  // Lower chooses first.
  rank: number;
  // Drawn even with no room (the place being pointed at or held), after the
  // rest, so it reads on top.
  force?: boolean;
};

export type PlacedLabel = { id: string; text: string; box: Box; force: boolean };

export type LabelLayoutOptions = {
  // Width of a text, in the same units as everything else.
  measure: (text: string) => number;
  // Height of a line of text.
  height: number;
  // Between a dot's edge and its name.
  gap: number;
  // Kept clear around every name.
  pad: number;
  // Everything a name may not cover besides other names: dots, the party
  // marker, the words the DM wrote on the map. A dot names its place as its
  // owner, and a name never shies from its own dot (its spots clear it).
  obstacles: Array<Box & { owner?: string }>;
  // Where names may go (the map's own extent), or anywhere.
  bounds?: Box | null;
  // A name longer than this many characters may be shortened to fit.
  shortenAt?: number;
};

export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return (
    a.x < b.x + b.width + pad &&
    a.x + a.width + pad > b.x &&
    a.y < b.y + b.height + pad &&
    a.y + a.height + pad > b.y
  );
}

// "Second Hollowroot Waystone Woodland Flank" at 16 characters is "Second
// Hollowroot…": whole words while any fit, else the first word cut.
export function shortenLabel(text: string, limit: number): string {
  const words = text.trim().split(/\s+/);
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > limit - 1) {
      break;
    }
    out = next;
  }
  if (!out) {
    out = text.trim().slice(0, Math.max(1, limit - 1));
  }
  return out.length < text.trim().length ? `${out}…` : out;
}

// The eight spots around a dot, in the order a map reader looks: beside it
// to the right, then its corners, then the left, then above and below.
function spots(request: LabelRequest, width: number, height: number, gap: number): Box[] {
  const { x, y, radius } = request;
  const corner = radius * 0.7 + gap * 0.6;
  return [
    { x: x + radius + gap, y: y - height / 2 },
    { x: x + corner, y: y - corner - height },
    { x: x + corner, y: y + corner },
    { x: x - radius - gap - width, y: y - height / 2 },
    { x: x - corner - width, y: y - corner - height },
    { x: x - corner - width, y: y + corner },
    { x: x - width / 2, y: y - radius - gap - height },
    { x: x - width / 2, y: y + radius + gap },
  ].map((at) => ({ ...at, width, height }));
}

function inside(box: Box, bounds: Box | null | undefined): boolean {
  return (
    !bounds ||
    (box.x >= bounds.x &&
      box.y >= bounds.y &&
      box.x + box.width <= bounds.x + bounds.width &&
      box.y + box.height <= bounds.y + bounds.height)
  );
}

export function layoutLabels(
  requests: LabelRequest[],
  options: LabelLayoutOptions,
): { placed: PlacedLabel[]; hidden: string[] } {
  const { measure, height, gap, pad, obstacles, bounds } = options;
  const shortenAt = options.shortenAt ?? 18;
  const order = requests
    .map((request, index) => ({ request, index }))
    .sort(
      (a, b) =>
        Number(Boolean(b.request.force)) - Number(Boolean(a.request.force)) ||
        a.request.rank - b.request.rank ||
        a.request.text.length - b.request.text.length ||
        a.index - b.index,
    )
    .map((entry) => entry.request);
  const taken: Box[] = [];
  const placed: PlacedLabel[] = [];
  const hidden: string[] = [];
  const free = (box: Box, self: LabelRequest) =>
    inside(box, bounds) &&
    !taken.some((other) => boxesOverlap(box, other, pad)) &&
    !obstacles.some((obstacle) => obstacle.owner !== self.id && boxesOverlap(box, obstacle, pad / 2));
  for (const request of order) {
    const text = request.text.trim();
    if (!text) {
      continue;
    }
    const forms = text.length > shortenAt ? [text, shortenLabel(text, shortenAt)] : [text];
    let chosen: { text: string; box: Box } | null = null;
    for (const form of forms) {
      const box = spots(request, measure(form), height, gap).find((spot) => free(spot, request));
      if (box) {
        chosen = { text: form, box };
        break;
      }
    }
    if (!chosen && request.force) {
      chosen = { text, box: spots(request, measure(text), height, gap)[0] };
    }
    if (!chosen) {
      hidden.push(request.id);
      continue;
    }
    taken.push(chosen.box);
    placed.push({ id: request.id, text: chosen.text, box: chosen.box, force: Boolean(request.force) });
  }
  return { placed, hidden };
}
