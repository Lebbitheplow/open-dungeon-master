import type { VerifiedRow } from "./curate.ts";

// How the admin panel and the setup wizard put a measurement into words.

// The fields of a catalog model as one ComfyUI reported it (ComfyModelReport
// in src/lib/comfyui.ts) that the wording needs.
export type ReportLike = {
  verified: VerifiedRow | null;
  needGb: number | null;
  fits: boolean | null;
};

export function seconds(value: number): string {
  if (value < 90) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value - minutes * 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// One line for a picker hint: what this hardware made of the model.
export function measuredLine(report: ReportLike, hardware: string | null): string {
  const row = report.verified;
  if (row?.verdict === "fails") return `Did not run on ${hardware ?? "this hardware"}.`;
  if (row?.verdict === "poor") return `Runs on ${hardware ?? row.device}, but its pictures were poor there.`;
  if (row) {
    const verdict = row.verdict === "recommended" ? "Recommended. " : "";
    return `${verdict}${seconds(row.seconds.square)} a picture, peaks ${row.peakGb} GB on ${hardware ?? row.device}.`;
  }
  if (report.fits === false) return `Peaked at ${report.needGb} GB elsewhere, more than this GPU has.`;
  return hardware ? `Not measured on ${hardware} yet.` : "Not measured on this hardware yet.";
}

// "a, b and c"
export function listWords(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
