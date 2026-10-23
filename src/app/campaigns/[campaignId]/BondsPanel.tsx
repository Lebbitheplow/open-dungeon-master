"use client";

import { EmptyState } from "@/components/EmptyState";
import { Heart, HeartCrack } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { InfoButton } from "@/components/ui/InfoDialog";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { PanelError, PanelLoading, SettingToggle } from "./PanelKit";
import { ROMANCE_STAGES, type FriendshipTier, type RomanceStage } from "@/lib/dm/relationship-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Where each character stands with the people they have dealt with. The
// server sends a tier WORD rather than the raw meter (the party lead also
// gets the number), so the table can see that the smith has warmed to them
// without turning the campaign into approval farming.
//
// The player's own characters also carry "Open to advances from NPCs"
// (issue 501): the one place a player says an NPC may make the first move.
// Theirs alone, shown only where advances can happen, and never shown to
// anyone else.

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

// The romance ladder as a thin rung under the row: it fills to the stage
// reached, easing when the server moves it (an answered advance, a step
// taken), never on the model's words.
function RomanceRung({ stage, ended }: { stage: RomanceStage; ended: boolean }) {
  const reached = ROMANCE_STAGES.indexOf(stage);
  const steps = ROMANCE_STAGES.length - 1;
  return (
    <span
      className="mt-1.5 block h-1 overflow-hidden rounded-full bg-rose-950/50"
      role="img"
      aria-label={`Romance: ${ROMANCE_WORD[stage]}, step ${reached} of ${steps}`}
    >
      <span
        className={cn("romance-rung-fill block h-full rounded-full", ended ? "bg-stone-600" : "bg-rose-400/80")}
        style={{ width: `${(Math.max(0, reached) / steps) * 100}%` }}
      />
    </span>
  );
}

function BondRow({ bond }: { bond: RelationshipView }) {
  return (
    <li className="panel rounded-lg px-2.5 py-2" data-bond-row={bond.subjectName}>
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
      {bond.romance !== "none" ? <RomanceRung stage={bond.romance} ended={bond.status === "ended"} /> : null}
      {bond.history.length ? (
        <p className="reveal mt-1 text-xs leading-5 text-stone-400">
          {bond.history[bond.history.length - 1]}
        </p>
      ) : null}
    </li>
  );
}

// The player's own switch for one of their characters.
function AdvancesSwitch({ campaignId, sheet }: { campaignId: string; sheet: CharacterSheet }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Shown at once while it saves, until the sheet the stream sends back
  // moves off the value it was pressed from.
  const stored = Boolean(sheet.openToAdvances);
  const [pending, setPending] = useState<{ value: boolean; from: boolean } | null>(null);
  const open = pending && pending.from === stored ? pending.value : stored;

  // Never disabled while it saves: a disabled switch drops the keyboard's
  // focus. A second press while the first saves simply sends its own
  // answer, and the sheet the stream sends back settles it.
  async function toggle() {
    const next = !open;
    setBusy(true);
    setError("");
    setPending({ value: next, from: stored });
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet/romance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: sheet.id, open: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(String(data.error ?? "Could not save that."));
        setPending(null);
      }
    } catch {
      setError("Could not reach the server.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-1.5" data-advances-switch={sheet.id}>
      <span className="flex flex-wrap items-center gap-1">
        <SettingToggle on={open} onToggle={() => void toggle()} aria-busy={busy || undefined} label={`Open to advances from NPCs, for ${sheet.name}`}>
          Open to advances from NPCs
        </SettingToggle>
        <InfoButton
          label="Open to advances from NPCs"
          text={`NPCs who already like ${sheet.name} may make the first move. You always answer, and switching this off stops it at once. Only you see this setting.`}
        />
      </span>
      {error ? <PanelError>{error}</PanelError> : null}
    </div>
  );
}

export function BondsPanel({
  campaignId,
  refreshKey,
  sheets = [],
  meUserId = "",
}: {
  campaignId: string;
  refreshKey: number;
  // The player's own characters carry the advances switch.
  sheets?: CharacterSheet[];
  meUserId?: string;
}) {
  const [bonds, setBonds] = useState<RelationshipView[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [advances, setAdvances] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/relationships`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      setEnabled(data.enabled !== false);
      setAdvances(data.advances === true);
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
      <EmptyState size="sm" art="board" title="Relationship tracking is off for this campaign. Whoever runs the story can turn it on in Settings, under Bonds and romance." />
    );
  }
  // The player's own characters, never a companion: no player answers for one.
  const mine = advances ? sheets.filter((sheet) => sheet.userId === meUserId && !sheet.isCompanion && !sheet.summon) : [];
  if (!bonds.length && !mine.length) {
    return (
      <EmptyState size="sm" art="board" title="Nobody has an opinion yet. How NPCs and companions feel about each character builds as you deal with them, and shows up here." />
    );
  }

  // Grouped by character, so each player reads their own standing first.
  const byCharacter = new Map<string, { name: string; bonds: RelationshipView[] }>();
  for (const sheet of mine) {
    byCharacter.set(sheet.id, { name: sheet.name, bonds: [] });
  }
  for (const bond of bonds) {
    const group = byCharacter.get(bond.characterId) ?? { name: bond.characterName, bonds: [] };
    group.bonds.push(bond);
    byCharacter.set(bond.characterId, group);
  }

  return (
    <div className="stagger space-y-3">
      {[...byCharacter.entries()].map(([characterId, group]) => {
        const own = mine.find((sheet) => sheet.id === characterId);
        return (
          <section key={characterId}>
            <SectionHead title={group.name} glyph="tab-bonds" aside={group.bonds.length} />
            {own ? <AdvancesSwitch campaignId={campaignId} sheet={own} /> : null}
            {group.bonds.length ? (
              <ul className="stagger space-y-1">
                {group.bonds.map((bond) => (
                  <BondRow key={bond.id} bond={bond} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-stone-500">Nobody has an opinion of {group.name} yet.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
