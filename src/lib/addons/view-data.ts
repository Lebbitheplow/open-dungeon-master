// The cap on a map's board view data (docs/addons/extension-points.md), and
// the sentence every door that takes such data from outside refuses with: the
// map generator contract (contracts.ts), the workshop bundle schema
// (src/lib/workshop/bundle-schema.ts) and the stored view's normalizer
// (map-view.ts). Imports nothing, so the workshop pages that read bundles do
// not carry the addon manifest schema in with it.

export const MAX_VIEW_DATA_CHARS = 256 * 1024;

// Why a board view's data cannot be kept, as a sentence its author can act
// on, or null when it can: over the cap as JSON, or not JSON at all. Refused
// where the addon hears it (issue 414), instead of stored as null for its
// view to find empty later.
export function viewDataProblem(data: unknown): string | null {
  let json: string | undefined;
  try {
    json = JSON.stringify(data ?? null);
  } catch {
    json = undefined;
  }
  if (json === undefined) return "A board view's data must be plain JSON.";
  if (json.length > MAX_VIEW_DATA_CHARS) {
    return `A board view's data may be ${MAX_VIEW_DATA_CHARS / 1024} KB as JSON, and this is ${Math.ceil(json.length / 1024)} KB; put anything larger in a file.`;
  }
  return null;
}
