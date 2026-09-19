"use client";

import { ChevronDown, CircleHelp } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { HandAimBar, type HandTargetChip } from "@/app/campaigns/[campaignId]/HandAimBar";
import { HandCardFace, HandPlayedCard } from "@/app/campaigns/[campaignId]/HandCardFace";
import { HandMoreSheet } from "@/app/campaigns/[campaignId]/HandMoreSheet";
import { HAND_TUTORIAL_ID, HandTutorial } from "@/app/campaigns/[campaignId]/HandTutorial";
import { useHandSpells } from "@/app/campaigns/[campaignId]/HandSpells";
import { FRESH_TURN, attacksAllowed, deriveHand, splitHand, type HandCard, type HandTurn } from "@/lib/battlemap/hand";
import {
  HAND_AIM_EVENT,
  HAND_TARGET_EVENT,
  afterCommit,
  composeSentence,
  intentBody,
  previewRows,
  targetFromComposedText,
  type HandAimDetail,
  type HandTargetDetail,
} from "@/lib/battlemap/hand-play";
import { replayAnimation } from "@/lib/motion/replay";
import { markTourSeen, tourSeen } from "@/lib/tours/logic";
import type { InputKind } from "@/lib/campaign-types";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The Hand: on your turn in a fight, your options as cards above the message
// box (docs/visual-overhaul-plan.md 5.2, 5.3, 5.7). It adds to the composer
// and replaces nothing: every card ends as the same POST the box makes, and
// the box is always there to type in instead.

const COLLAPSED_KEY = "odm:hand-collapsed";
const STORE_EVENT = "odm-hand-store";
// The committed card's beats, in step with hand.css and hand-motion.css: the
// card has left the fan by LEFT_MS, and its face-up copy has played, waited
// out the die and spent itself by PLAYED_MS. FOLD_MS is the fan folding away.
const LEFT_MS = 420;
const PLAYED_MS = 1240;
const FOLD_MS = 420;

function subscribeStore(callback: () => void) {
  window.addEventListener(STORE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(STORE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Storage can be denied; the choice then lasts as long as the page.
  }
  window.dispatchEvent(new Event(STORE_EVENT));
}

// The turn as the Hand has seen it, kept per turn of the tracker so a reload
// mid-turn does not hand the action back.
function readTurn(key: string): HandTurn {
  try {
    const raw = window.sessionStorage.getItem(`odm:hand-turn:${key}`);
    return raw ? { ...FRESH_TURN, ...(JSON.parse(raw) as Partial<HandTurn>) } : FRESH_TURN;
  } catch {
    return FRESH_TURN;
  }
}

function HandInner({
  campaignId,
  sheets,
  meUserId,
  encounter,
  floor,
  inputBlocked,
  blockedReason,
  input,
  setInput,
  onKindChange,
  composerRef,
  trackAmmo,
  leaving,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  meUserId: string;
  encounter: PublicEncounter;
  floor: Floor;
  inputBlocked: boolean;
  blockedReason: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  onKindChange: (kind: InputKind) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  // The table's ammunition variant rule: on, an empty quiver stops the card.
  trackAmmo?: boolean;
  // The fight is over and the mount is about to go: the fan folds away (FOLD_MS).
  leaving?: boolean;
}) {
  const sheet = useMemo(
    () => sheets.find((entry) => entry.userId === meUserId && !entry.isCompanion) ?? null,
    [sheets, meUserId],
  );
  const myTurn = floor.mode === "initiative" ? floor.userIds.includes(meUserId) : !inputBlocked;
  const currentName = floor.mode === "initiative" ? floor.currentName : undefined;
  const turnKey = `${encounter.id}:${encounter.round}:${encounter.turnIndex}`;

  const [stored, setStored] = useState<{ key: string; turn: HandTurn }>(() => ({ key: turnKey, turn: readTurn(turnKey) }));
  const spent = stored.key === turnKey ? stored.turn : FRESH_TURN;
  // The engine's own count for this character's turn, when the table sent it:
  // it also sees what was typed rather than played from the Hand. Either
  // record saying a thing is spent is enough.
  const engine = sheet && encounter.turn?.ownerId === sheet.id ? encounter.turn : null;
  const turn = useMemo<HandTurn>(
    () => ({
      ...spent,
      ...(engine
        ? {
            actionUsed: spent.actionUsed || engine.actionUsed,
            bonusUsed: spent.bonusUsed || engine.bonusUsed,
            reactionUsed: spent.reactionUsed || engine.reactionUsed,
            attacksMade: Math.max(spent.attacksMade, engine.attacksMade),
            extraActions: engine.extraActions ?? spent.extraActions,
          }
        : {}),
      myTurn,
      currentName,
    }),
    [spent, engine, myTurn, currentName],
  );

  const spells = useHandSpells(sheet);
  const cards = useMemo(() => (sheet ? deriveHand(sheet, turn, { spells, trackAmmo }) : []), [sheet, turn, spells, trackAmmo]);

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [riderIds, setRiderIds] = useState<string[]>([]);
  const [played, setPlayed] = useState<{ card: HandCard; seq: number } | null>(null);
  const playedTimer = useRef<number | undefined>(undefined);
  const [folding, setFolding] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null);

  const collapsed = useSyncExternalStore(subscribeStore, () => readFlag(COLLAPSED_KEY), () => false);
  const tutorialSeen = useSyncExternalStore(subscribeStore, () => tourSeen(window.localStorage, HAND_TUTORIAL_ID), () => true);
  const [tutorialAsked, setTutorialAsked] = useState(false);
  const showTutorial = !collapsed && (tutorialAsked || (!tutorialSeen && myTurn));

  // A card that stopped being playable (the turn moved on) drops out of aim.
  const picked = cards.find((card) => card.id === pickedId && !card.disabled) ?? null;
  const riders = useMemo(
    () => cards.filter((card) => riderIds.includes(card.id) && !card.disabled),
    [cards, riderIds],
  );

  const targets = useMemo<HandTargetChip[]>(() => {
    const enemies: HandTargetChip[] = encounter.enemies
      .filter((enemy) => enemy.status === "alive")
      .map((enemy) => ({
        id: enemy.id,
        name: enemy.name,
        kind: "enemy",
        ac: enemy.ac,
        cr: enemy.cr,
        conditions: enemy.conditions,
        note: [enemy.health, ...enemy.conditions.slice(0, 2)].join(" · "),
      }));
    const party: HandTargetChip[] = sheets
      .filter((entry) => !entry.deathSaves?.dead)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.id === sheet?.id ? "self" : "ally",
        conditions: entry.conditions,
        note: `${entry.currentHp}/${entry.maxHp} hp`,
      }));
    return [...enemies, ...party];
  }, [encounter.enemies, sheets, sheet?.id]);
  const enemyTargets = useMemo(() => targets.filter((target) => target.kind === "enemy"), [targets]);
  const partyTargets = useMemo(() => targets.filter((target) => target.kind !== "enemy"), [targets]);

  // A tap on the board while a card is raised arrives as the HUD's own
  // sentence in the message box; it is read here rather than stored, so the
  // board needs to know nothing about the Hand.
  const boardName = picked?.target === "enemy" ? targetFromComposedText(input, enemyTargets.map((target) => target.name)) : null;
  const offered = picked?.target === "enemy" ? enemyTargets : picked?.target === "ally" ? partyTargets : [];
  const self = partyTargets.find((target) => target.kind === "self") ?? null;
  const aim =
    picked?.target === "self"
      ? self
      : (boardName ? offered.find((target) => target.name === boardName) : null) ??
        offered.find((target) => target.id === targetId) ??
        null;
  // What the hover previews are worked against until something is aimed at.
  const defaultAim = aim?.kind === "enemy" ? aim : enemyTargets[0] ?? null;
  const conditions = sheet?.conditions ?? EMPTY;

  const attachedRiders = picked?.intent.card === "attack" && !picked.intent.offHand ? riders : EMPTY_CARDS;
  const sentence = picked ? composeSentence(picked, aim, attachedRiders) : "";
  const rows = useMemo(() => (picked ? previewRows(picked, aim ?? (picked.target === "enemy" ? defaultAim : null), conditions) : []), [picked, aim, defaultAim, conditions]);

  const clearAim = useCallback(() => {
    setPickedId(null);
    setTargetId(null);
  }, []);

  // Tell a board that wants to know, and take a pick from one that sends it.
  const aimingId = picked?.id ?? null;
  const aimingAt = picked?.target ?? null;
  useEffect(() => {
    const detail: HandAimDetail = { active: aimingId !== null, cardId: aimingId, target: aimingAt };
    window.dispatchEvent(new CustomEvent(HAND_AIM_EVENT, { detail }));
  }, [aimingId, aimingAt]);
  useEffect(() => {
    const onTarget = (event: Event) => {
      const detail = (event as CustomEvent<HandTargetDetail>).detail ?? {};
      const found = targets.find((target) => target.id === detail.id || target.name === detail.name);
      if (found) setTargetId(found.id);
    };
    window.addEventListener(HAND_TARGET_EVENT, onTarget);
    return () => window.removeEventListener(HAND_TARGET_EVENT, onTarget);
  }, [targets]);

  const say = useCallback((text: string) => {
    setNotice(text);
    replayAnimation(noticeRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
  }, []);

  const pick = useCallback(
    (card: HandCard) => {
      if (card.disabled) {
        say(card.disabled);
        return;
      }
      setNotice("");
      setMoreOpen(false);
      if (card.type === "rider") {
        setRiderIds((current) => (current.includes(card.id) ? current.filter((id) => id !== card.id) : [...current, card.id]));
        return;
      }
      setTargetId(null);
      setPickedId((current) => (current === card.id ? null : card.id));
    },
    [say],
  );

  const toComposer = useCallback(
    (text: string) => {
      onKindChange("do");
      setInput(text);
      clearAim();
      // After the box has the text, put the caret where the blank is.
      window.setTimeout(() => {
        const area = composerRef.current;
        if (!area) return;
        area.focus();
        const gap = text.indexOf("  ");
        const at = gap >= 0 ? gap + 1 : text.length;
        area.setSelectionRange(at, at);
      }, 50);
    },
    [onKindChange, setInput, clearAim, composerRef],
  );

  const commit = useCallback(async () => {
    if (!picked || !sheet || sending) return;
    if (picked.compose) {
      toComposer(sentence);
      return;
    }
    setSending(true);
    setNotice("");
    try {
      const ending = picked.intent.card === "basic" && picked.intent.action === "end-turn";
      // End turn is the floor banner's own route; everything else is the
      // composer's POST with the card riding along as an optional field.
      const response = ending
        ? await fetch(`/api/campaigns/${campaignId}/encounter/end-turn`, { method: "POST" })
        : await fetch(`/api/campaigns/${campaignId}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: sentence, kind: "do", intent: intentBody(picked, aim, attachedRiders) }),
          });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        say(data.error || "Could not send your action.");
        return;
      }
      const next = afterCommit(spent, picked, attacksAllowed(sheet));
      try {
        window.sessionStorage.setItem(`odm:hand-turn:${turnKey}`, JSON.stringify(next));
      } catch {
        // Without storage the turn is simply remembered for this page only.
      }
      setStored({ key: turnKey, turn: next });
      setPlayed((current) => ({ card: picked, seq: (current?.seq ?? 0) + 1 }));
      setRiderIds([]);
      // The board's sentence has done its work as the pick; it is not sent twice.
      if (boardName) setInput("");
      window.setTimeout(clearAim, LEFT_MS);
      // A second card played inside the first one's beat takes the stage over.
      window.clearTimeout(playedTimer.current);
      playedTimer.current = window.setTimeout(() => setPlayed(null), PLAYED_MS);
    } catch {
      say("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }, [picked, sheet, sending, sentence, campaignId, aim, attachedRiders, spent, turnKey, boardName, setInput, clearAim, say, toComposer]);

  if (!sheet) return null;

  const { fan, more } = splitHand(cards);
  // A card chosen from behind the spine takes the last seat before End turn.
  const shown = picked && more.includes(picked) ? [...fan.slice(0, -2), picked, fan[fan.length - 1]] : fan;
  const middle = (shown.length - 1) / 2;
  // The mockup's 4.4 degrees between neighbours, eased off as the hand fills
  // so nine cards lean no further than five did.
  const step = shown.length > 1 ? Math.min(4.4, 13 / (shown.length - 1)) : 0;
  const pips: Array<{ label: string; used: boolean }> = [
    { label: "Action", used: spent.actionUsed && (spent.extraActions ?? 0) <= 0 },
    { label: "Bonus", used: spent.bonusUsed },
    { label: "Reaction", used: spent.reactionUsed },
  ];

  return (
    <section
      className="hand"
      data-tour="battle-hand"
      data-tutorial={showTutorial ? "true" : undefined}
      aria-label="Your hand"
      onKeyDown={(event) => {
        if (event.key === "Escape" && picked) {
          event.stopPropagation();
          clearAim();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span
          key={myTurn ? "mine" : (currentName ?? "other")}
          className="hand-label min-w-0 truncate font-display text-[11px] uppercase tracking-[0.22em] text-amber-200/90"
        >
          {myTurn ? "Your hand" : `${currentName ?? "Another hero"}'s turn`}
        </span>
        <span className="hidden text-[11px] text-stone-500 sm:inline">
          {myTurn ? "Play a card, or type your move below." : "Look your cards over while you wait."}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {pips.map((pip) => (
            <span
              key={pip.label}
              data-used={pip.used ? "true" : undefined}
              // The strike through a spent pip is drawn by hand-motion.css, which eases it in.
              className={cn(
                "hand-pip rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider",
                pip.used ? "border-stone-700/60 text-stone-600" : "border-amber-500/45 bg-amber-500/10 text-amber-200",
              )}
              aria-label={`${pip.label} ${pip.used ? "spent" : "available"}`}
            >
              {pip.label}
            </span>
          ))}
          <Tooltip content="How the hand works">
            <button
              type="button"
              onClick={() => {
                if (collapsed) writeFlag(COLLAPSED_KEY, false);
                setTutorialAsked(true);
              }}
              aria-label="How the hand works"
              className="flex size-9 items-center justify-center rounded-lg text-stone-500 hover:text-amber-200 sm:size-7"
            >
              <CircleHelp className="size-4" />
            </button>
          </Tooltip>
          <Tooltip content={collapsed ? "Show your hand" : "Put your hand away. The message box stays."}>
            <button
              type="button"
              onClick={() => {
                clearAim();
                const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                if (collapsed || still) {
                  writeFlag(COLLAPSED_KEY, !collapsed);
                  return;
                }
                if (folding) return;
                // The fan folds away first; the flag follows once it has.
                setFolding(true);
                window.setTimeout(() => {
                  writeFlag(COLLAPSED_KEY, true);
                  setFolding(false);
                }, FOLD_MS);
              }}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Show your hand" : "Hide your hand"}
              className="flex size-9 items-center justify-center rounded-lg text-stone-500 hover:text-amber-200 sm:size-7"
            >
              <ChevronDown className={cn("chevron-turn size-4", collapsed && "rotate-180")} />
            </button>
          </Tooltip>
        </span>
      </div>

      {showTutorial ? (
        <HandTutorial
          onDismiss={() => {
            markTourSeen(window.localStorage, HAND_TUTORIAL_ID);
            window.dispatchEvent(new Event(STORE_EVENT));
            setTutorialAsked(false);
          }}
        />
      ) : null}

      {collapsed ? null : (
        <>
          <div
            className="hand-fan"
            data-aiming={picked ? "true" : undefined}
            data-more={more.length ? "true" : undefined}
            data-folding={folding || leaving ? "true" : undefined}
            role="group"
            aria-label="Cards"
          >
            {shown.map((card, index) => (
              <HandCardFace
                key={card.id}
                card={card}
                index={index}
                offset={index - middle}
                step={step}
                picked={picked?.id === card.id}
                attached={riderIds.includes(card.id)}
                played={played?.card.id === card.id}
                aim={defaultAim}
                conditions={conditions}
                onPick={pick}
              />
            ))}
            {more.length ? (
              <button
                type="button"
                className="hand-more"
                style={{ "--i": shown.length } as CSSProperties}
                onClick={() => setMoreOpen(true)}
                aria-label={`${more.length} more cards`}
              >
                +{more.length} more
              </button>
            ) : null}
          </div>
          {played ? <HandPlayedCard key={played.seq} card={played.card} /> : null}
          {picked ? (
            <HandAimBar
              card={picked}
              targets={offered}
              aim={aim}
              onAim={(target) => {
                setTargetId(target.id);
                // A chip outranks a tap made on the board earlier, whose
                // sentence is still in the box; it goes so the chip can win.
                if (boardName) setInput("");
              }}
              riders={attachedRiders}
              onDropRider={(rider) => setRiderIds((current) => current.filter((id) => id !== rider.id))}
              rows={rows}
              sentence={sentence}
              sending={sending}
              blocked={inputBlocked ? blockedReason : null}
              onBack={clearAim}
              onEdit={() => toComposer(sentence)}
              onCommit={() => void commit()}
            />
          ) : riders.length ? (
            <p className="mt-1 animate-fade-up text-xs text-amber-200/80">
              {riders.map((rider) => rider.name).join(", ")} will ride your next attack card. Press it again to take it off.
            </p>
          ) : null}
        </>
      )}
      <p ref={noticeRef} role="status" className={cn("mt-1 text-xs text-amber-300", notice ? "" : "hidden")}>
        {notice}
      </p>
      <HandMoreSheet open={moreOpen} onOpenChange={setMoreOpen} cards={more} onPick={pick} />
    </section>
  );
}

const EMPTY: string[] = [];
const EMPTY_CARDS: HandCard[] = [];

// Memoized like the composer it sits in: unchanged props while the DM streams.
export const Hand = memo(HandInner);
