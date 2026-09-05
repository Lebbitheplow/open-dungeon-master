import type { MonsterDraft, MonsterReadout } from "@/lib/bestiary/monster-draft";

// What /api/campaigns/:id/dm/bestiary hands the client. Shared by the
// bestiary panel and the workshop's rows so a row and the editor behind it
// agree on what a built monster is.

export type Monster = {
  id: string;
  slug: string;
  draft: MonsterDraft;
  desc: string;
  readout: MonsterReadout;
  summary: string;
};

// A content-pack monster the search turned up, to start from.
export type Found = { slug: string; name: string; source: string; cr: number };

export const CR_CHOICES = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 17, 20, 24, 30];

export const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";
