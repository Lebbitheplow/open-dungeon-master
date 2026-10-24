"use client";

import { EmptyState } from "@/components/EmptyState";
import { Heart, HeartCrack, VenetianMask } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { PanelLoading } from "./PanelKit";
import { ADVANCES_CONSENT, ConsentSwitch, PACTS_CONSENT } from "./ConsentSwitch";
import { OwnPacts } from "./PactPanel";
import { ConscienceLadder, type ConscienceView } from "./ConscienceLadder";
import { ROMANCE_STAGES, type FriendshipTier, type RomanceStage } from "@/lib/dm/relationship-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Where each character stands with the people they have dealt with. The
// server sends a tier WORD rather than the raw meter (the party lead also
// gets the number), so the table can see that the smith has warmed to them
// without turning the campaign into approval farming.
//
// The player's own characters also carry "Open to advances from NPCs"
// (issue 501): the one place a player says an NPC may make the first move;
// and "Pacts may approach me" (issue 503), the one place a player says a
// pact may ask them to join it (ConsentSwitch.tsx). Theirs alone, shown
// only where each can happen, and never shown to anyone else. A player in a
// pact reads it, and acts in secret for it, at the top (PactPanel.tsx).
//
// A lasting companion's row also carries its conscience (issue 503): the
// ladder from content to the breaking point and any ultimatum, which every
// seat sees, since the companion says them aloud.
// An NPC's act (issue 501, src/lib/dm/scheme-logic.ts) reads as the warmth
// it shows until the server says otherwise: an Insight that beat it, told to
// that player alone ("Seen through"), or the truth out to everyone
// ("Unmasked"). Then the row's standing turns to the truth where the player
// can see it happen. Whoever runs the story reads the act on every row.

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
  // A lasting companion's conscience rung and any ultimatum (issue 503).
  conscience?: ConscienceView;
  // This viewer's character saw through an NPC's act: the row is the truth.
  seenThrough?: boolean;
  // The act came out to everyone.
  unmasked?: boolean;
  // The storyteller's own view of an act (never sent to a player).
  act?: { motive: string; shown: number; shownTier: FriendshipTier; seenThroughBy: string[]; revealed: boolean };
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

// The moment a row turns to the truth: once, when the server's answer
// changes it while the row is on screen (never on the model's words, and
// not again on a later look). The number, where the viewer reads one,
// counts from the act's warmth to the truth; reduced motion shows the truth
// at once, its colour and words included.
function useUnmasking(bond: RelationshipView): { unmasking: boolean; shownApproval: number | undefined } {
  const exposed = Boolean(bond.seenThrough || bond.unmasked);
  const before = useRef<{ exposed: boolean; approval: number | undefined }>({ exposed, approval: bond.approval });
  const [unmasking, setUnmasking] = useState(false);
  const [counted, setCounted] = useState<number | undefined>(undefined);
  useEffect(() => {
    const was = before.current;
    before.current = { exposed, approval: bond.approval };
    if (!exposed || was.exposed) {
      return;
    }
    setUnmasking(true);
    const done = window.setTimeout(() => setUnmasking(false), 900);
    const from = was.approval;
    const to = bond.approval;
    let frame = 0;
    if (from !== undefined && to !== undefined && from !== to && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 600);
        const eased = 1 - Math.pow(1 - t, 3);
        setCounted(t >= 1 ? undefined : Math.round(from + (to - from) * eased));
        if (t < 1) {
          frame = window.requestAnimationFrame(step);
        }
      };
      frame = window.requestAnimationFrame(step);
    }
    return () => {
      window.clearTimeout(done);
      window.cancelAnimationFrame(frame);
      setUnmasking(false);
      setCounted(undefined);
    };
  }, [exposed, bond.approval]);
  return { unmasking, shownApproval: counted ?? bond.approval };
}

function BondRow({ bond }: { bond: RelationshipView }) {
  const { unmasking, shownApproval } = useUnmasking(bond);
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
            "bond-truth shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
            TIER_STYLES[bond.tier],
          )}
          data-unmasking={unmasking || undefined}
          title={bond.tierLabel}
        >
          {TIER_WORD[bond.tier]}
          {shownApproval === undefined ? "" : ` ${shownApproval > 0 ? "+" : ""}${shownApproval}`}
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
      {bond.conscience ? <ConscienceLadder name={bond.subjectName} conscience={bond.conscience} /> : null}
      {bond.seenThrough || bond.unmasked ? (
        <p
          className="bond-unmask-chip mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-violet-300"
          data-bond-unmasked={bond.unmasked ? "all" : "you"}
        >
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-800/60 bg-violet-950/30 px-2 py-0.5 text-[11px] text-violet-200">
            <VenetianMask className="size-3" aria-hidden />
            {bond.unmasked ? "Unmasked" : "Seen through"}
          </span>
          <span>
            {bond.unmasked
              ? `The truth came out: ${bond.subjectName}'s warmth was an act.`
              : `Only you know: ${bond.subjectName}'s warmth toward ${bond.characterName} is an act. This is where they really stand.`}
          </span>
        </p>
      ) : null}
      {bond.act ? <ActLine bond={bond} act={bond.act} /> : null}
      {bond.history.length ? (
        <p className="reveal mt-1 text-xs leading-5 text-stone-400">
          {bond.history[bond.history.length - 1]}
        </p>
      ) : null}
    </li>
  );
}

// What whoever runs the story reads on a row with an act: the warmth the
// table sees, the motive, and who has seen through it. Visible text, not a
// tooltip, so it reads the same by touch and to a screen reader.
function ActLine({ bond, act }: { bond: RelationshipView; act: NonNullable<RelationshipView["act"]> }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-violet-300" data-bond-act={bond.subjectName}>
      <VenetianMask className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>
        {act.revealed ? "Was an act" : `An act: the table sees ${TIER_WORD[act.shownTier]} ${act.shown > 0 ? "+" : ""}${act.shown}`}
        {act.motive ? `. Wants ${act.motive}` : ""}
        {act.seenThroughBy.length && !act.revealed ? `. Seen through by ${act.seenThroughBy.join(", ")}` : ""}.
        <span className="sr-only"> Only you see this.</span>
      </span>
    </p>
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
  const [pacts, setPacts] = useState(false);
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
      setPacts(data.pacts === true);
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
  const mine = advances || pacts ? sheets.filter((sheet) => sheet.userId === meUserId && !sheet.isCompanion && !sheet.summon) : [];
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
      {pacts ? <OwnPacts campaignId={campaignId} refreshKey={refreshKey} sheets={sheets} meUserId={meUserId} /> : null}
      {[...byCharacter.entries()].map(([characterId, group]) => {
        const own = mine.find((sheet) => sheet.id === characterId);
        return (
          <section key={characterId}>
            <SectionHead title={group.name} glyph="tab-bonds" aside={group.bonds.length} />
            {own && advances ? <ConsentSwitch campaignId={campaignId} sheet={own} consent={ADVANCES_CONSENT} /> : null}
            {own && pacts ? <ConsentSwitch campaignId={campaignId} sheet={own} consent={PACTS_CONSENT} /> : null}
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
