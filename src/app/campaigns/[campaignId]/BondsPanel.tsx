"use client";

import { EmptyState } from "@/components/EmptyState";
import { Heart, HeartCrack } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { PanelLoading } from "./PanelKit";
import type { FriendshipTier, RomanceStage } from "@/lib/dm/relationship-logic";

// Where each character stands with the people they have dealt with. The
// server sends a tier WORD rather than the raw meter (the party lead also
// gets the number), so the table can see that the smith has warmed to them
// without turning the campaign into approval farming.

type RelationshipView = {
  id: string;
  characterId: string;
  characterName: string;
  subjectName: string;
  subjectKind: "npc" | "companion";
  tier: FriendshipTier;
  tierLabel: string;
  romance: RomanceStage;
  status: "active" | "parted" | "ended";
  apartChapters: number;
  history: string[];
  approval?: number;
};

// Warm for regard, cold for its absence; mirrors how the tiers read.
const TIER_STYLES: Record<FriendshipTier, string> = {
  hostile: "border-red-900/60 bg-red-950/30 text-red-300",
  disliked: "border-red-900/40 bg-red-950/20 text-red-400/90",
  wary: "border-stone-700 bg-stone-900/40 text-stone-400",
  neutral: "border-stone-800 bg-stone-950/40 text-stone-500",
  cordial: "border-amber-900/40 bg-amber-950/20 text-amber-200/80",
  friendly: "border-amber-800/60 bg-amber-950/30 text-amber-200",
  close: "border-emerald-800/60 bg-emerald-950/30 text-emerald-200",
  devoted: "border-emerald-700 bg-emerald-950/40 text-emerald-100",
};

// Eight tiers, five painted faces: each tier borrows the nearest one.
const TIER_GLYPH: Record<FriendshipTier, string> = {
  hostile: "attitude-hostile",
  disliked: "attitude-hostile",
  wary: "attitude-wary",
  neutral: "attitude-neutral",
  cordial: "attitude-friendly",
  friendly: "attitude-friendly",
  close: "attitude-allied",
  devoted: "attitude-allied",
};

const TIER_WORD: Record<FriendshipTier, string> = {
  hostile: "Hostile",
  disliked: "Dislikes",
  wary: "Wary",
  neutral: "Neutral",
  cordial: "Cordial",
  friendly: "Friendly",
  close: "Close",
  devoted: "Devoted",
};

const ROMANCE_WORD: Record<RomanceStage, string> = {
  none: "",
  interested: "Interested",
  courting: "Courting",
  together: "Together",
  betrothed: "Betrothed",
  married: "Married",
};

function BondRow({ bond }: { bond: RelationshipView }) {
  return (
    <li className="panel rounded-lg px-2.5 py-2">
      <div className="flex items-center gap-2">
        <GameIcon icon={{ kind: "glyph", key: TIER_GLYPH[bond.tier] }} size="size-6" className="shrink-0" />
        <span className="min-w-0 flex-1 text-sm text-stone-200">
          {bond.subjectName}
          <span className="eyebrow ml-1.5 text-[10px] text-amber-400/70">
            {bond.subjectKind === "companion" ? "companion" : "npc"}
          </span>
          {bond.status === "parted" ? (
            <span className="ml-1.5 text-[11px] text-stone-500">
              away{bond.apartChapters > 0 ? ` ${bond.apartChapters}ch` : ""}
            </span>
          ) : null}
          {bond.status === "ended" ? (
            <span className="ml-1.5 text-[11px] text-stone-500">ended</span>
          ) : null}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
            TIER_STYLES[bond.tier],
          )}
          title={bond.tierLabel}
        >
          {TIER_WORD[bond.tier]}
          {bond.approval === undefined ? "" : ` ${bond.approval > 0 ? "+" : ""}${bond.approval}`}
        </span>
        {bond.romance !== "none" ? (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full border border-rose-900/60 bg-rose-950/30 px-2 py-0.5 text-[11px] text-rose-200"
            title={`Romance: ${ROMANCE_WORD[bond.romance]}`}
          >
            {bond.status === "ended" ? (
              <HeartCrack className="size-2.5" />
            ) : (
              <Heart className="size-2.5" />
            )}
            {ROMANCE_WORD[bond.romance]}
          </span>
        ) : null}
      </div>
      {bond.history.length ? (
        <p className="reveal mt-1 text-xs leading-5 text-stone-400">
          {bond.history[bond.history.length - 1]}
        </p>
      ) : null}
    </li>
  );
}

export function BondsPanel({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const [bonds, setBonds] = useState<RelationshipView[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/relationships`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      setEnabled(data.enabled !== false);
      setBonds(Array.isArray(data.relationships) ? data.relationships : []);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  // Refetches on mount and whenever the stream reports a change, exactly
  // like the facts panel.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading) {
    return <PanelLoading label="Reading the room..." />;
  }
  if (!enabled) {
    return (
      <EmptyState size="sm" art="board" title="Relationship tracking is off for this campaign. The party lead can turn it on in Setup." />
    );
  }
  if (!bonds.length) {
    return (
      <EmptyState size="sm" art="board" title="Nobody has an opinion yet. How NPCs and companions feel about each character builds as you deal with them, and shows up here." />
    );
  }

  // Grouped by character, so each player reads their own standing first.
  const byCharacter = new Map<string, RelationshipView[]>();
  for (const bond of bonds) {
    byCharacter.set(bond.characterId, [...(byCharacter.get(bond.characterId) ?? []), bond]);
  }

  return (
    <div className="stagger space-y-3">
      {[...byCharacter.values()].map((group) => (
        <section key={group[0].characterId}>
          <SectionHead title={group[0].characterName} glyph="tab-bonds" aside={group.length} />
          <ul className="stagger space-y-1">
            {group.map((bond) => (
              <BondRow key={bond.id} bond={bond} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
