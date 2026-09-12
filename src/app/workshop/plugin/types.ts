import type { WorldPackDraft } from "@/lib/worlds/draft";

// The Plugin system's own vocabulary: its tabs, the dense field style its
// rows share with the other editors, and the one callback every section
// takes. A section receives the whole draft and hands back the whole
// draft; the panel owns saving.

export const PLUGIN_SECTIONS = [
  { id: "identity", label: "Identity" },
  { id: "people", label: "People" },
  { id: "magic", label: "Magic & gear" },
  { id: "bestiary", label: "Bestiary" },
  { id: "setting", label: "Setting" },
  { id: "art", label: "Pictures" },
  { id: "publish", label: "Publish" },
] as const;

export type SectionId = (typeof PLUGIN_SECTIONS)[number]["id"];

export const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

export type OnDraft = (next: WorldPackDraft) => void;

export type SectionProps = { draft: WorldPackDraft; onDraft: OnDraft };

export function replaceAt<T>(list: T[], index: number, entry: T): T[] {
  return list.map((current, at) => (at === index ? entry : current));
}

export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, at) => at !== index);
}
