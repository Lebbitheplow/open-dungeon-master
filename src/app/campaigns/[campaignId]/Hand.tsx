"use client";

import { selectedCharacter, initiativeCharacter } from "@/lib/player-characters";

import { ChevronDown, CircleHelp, SlidersHorizontal } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { askConcentrationSwap, isConcentrationQuestion } from "@/components/concentration-prompt";
import type { ConcentrationSwap } from "@/lib/dm/concentration-confirm-logic";
import { HandAimBar, type HandTargetChip } from "@/app/campaigns/[campaignId]/HandAimBar";
import { HandCardFace, HandPlayedCard } from "@/app/campaigns/[campaignId]/HandCardFace";
import { HandArrange } from "@/app/campaigns/[campaignId]/HandArrange";
import { HandMoreSheet } from "@/app/campaigns/[campaignId]/HandMoreSheet";
import { HandGroupFace, HandGroupView, fanStep } from "@/app/campaigns/[campaignId]/HandGroups";
import { useHandLayout } from "@/app/campaigns/[campaignId]/useHandLayout";
import { HAND_TUTORIAL_ID, HandTutorial } from "@/app/campaigns/[campaignId]/HandTutorial";
import { useHandSpells } from "@/app/campaigns/[campaignId]/HandSpells";
import { HandReactPrompt } from "@/app/campaigns/[campaignId]/HandReactPrompt";
import { HandPips } from "@/app/campaigns/[campaignId]/HandPips";
import { handTargets } from "@/app/campaigns/[campaignId]/handTargets";
import { holdPendingCards, useHandChoices, useHandPending } from "@/app/campaigns/[campaignId]/useHandChoices";
import { deriveHand, waitingHand, type HandCard, type HandGearContext } from "@/lib/battlemap/hand";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import { HAND_FAN_CAP, arrangeHand, isUrgentCard, seatPicked, startingLayout } from "@/lib/battlemap/hand-layout";
import { groupHand, isGroup, type HandGroup } from "@/lib/battlemap/hand-groups";
import {
  HAND_TARGET_EVENT,
  HAND_BOARD_ACTION_EVENT,
  HAND_BOARD_STATUS_EVENT,
  HAND_BOARD_CONTROL_EVENT,
  HAND_BOARD_SURFACE_EVENT,
  handReady,
  type HandBoardActionDetail,
  type HandBoardControlDetail,
  composeSentence,
  intentBody,
  previewRows,
  shareList,
  targetFromComposedText,
  type HandAim,
  type HandTargetDetail,
} from "@/lib/battlemap/hand-play";
import type { HandShare } from "@/lib/battlemap/hand-intent";
import { offeredBoardControl, type BoardControl, type BoardPanel } from "@/lib/addons/board-bridge";
import { describePick, hasPick, pickHint } from "@/lib/battlemap/hand-area";
import { reactionAim, reactionCards, withReactions } from "@/lib/battlemap/hand-react";
import { liveNotice, turnCharacterId, turnFromEncounter, turnPips, turnSignature, type HandNotice } from "@/lib/battlemap/hand-table";

import type { TargetEdge } from "@/lib/battlemap/view-tactics";
import { replayAnimation } from "@/lib/motion/replay";
import { finishTour, useTourFinished } from "@/lib/tours/tour-store";
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

// The board-native panel's mirror of the aim bar's share row (HandShares):
// one more or one fewer dart, ray or beam on a creature, or a creature taken
// or let go, as "id:+" and "id:-".
function shareControl(card: HandCard, aim: HandAim, offered: HandTargetChip[], shares: HandShare[]): BoardControl {
  const rule = card.shares!;
  const list = shareList(card, aim, { shares });
  const count = (id: string) => list.find((share) => share.id === id)?.count ?? 0;
  const left = rule.stack ? count(aim.id) - 1 : rule.count - list.length;
  const others = offered.filter((target) => target.id !== aim.id);
  const options = rule.stack
    ? others.flatMap((target) => [
        { value: `${target.id}:+`, label: `One more ${rule.unit} on ${target.name} (${count(target.id)})`, disabled: left > 0 ? null : `Every ${rule.unit} is placed.` },
        { value: `${target.id}:-`, label: `One fewer ${rule.unit} on ${target.name}`, disabled: count(target.id) ? null : `${target.name} has none.` },
      ])
    : others.map((target) => {
        const taken = count(target.id) > 0;
        return { value: `${target.id}:${taken ? "-" : "+"}`, label: `${taken ? "✓ " : ""}${target.name}`, disabled: taken || left > 0 ? null : "Every place is taken." };
      });
  return { id: "hand-share", label: rule.stack ? `Share out the ${rule.unit}s` : `Who else it takes (up to ${rule.count})`, disabled: null, options };
}

function HandInner({
  campaignId,
  sheets,
  meUserId,
  activeSheetId,
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
  edges,
  drops,
  mounts,
  genre,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  meUserId: string;
  activeSheetId?: string;
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
  // The board's verdict from this character to each enemy (cover, flanking),
  // keyed by enemy id; absent off the map.
  edges?: Record<string, TargetEdge>;
  // What lies on the board, and who rides what (issue #424): the gear cards'
  // Pick up and Dismount.
  drops?: PlayerMapView["drops"];
  mounts?: PlayerMapView["mounts"];
  genre?: string | null;
}) {
  const turnId = turnCharacterId(encounter);
  const sheet = useMemo(
    () => initiativeCharacter(sheets, meUserId, turnId) ?? selectedCharacter(sheets, meUserId, activeSheetId),
    [sheets, meUserId, activeSheetId, turnId],
  );
  const floorTurn = floor.mode === "initiative" ? floor.userIds.includes(meUserId) : !inputBlocked;
  const floorName = floor.mode === "initiative" ? floor.currentName : undefined;

  // The engine's count, and nothing else: the Hand keeps no ledger of its own
  // (src/lib/battlemap/hand-table.ts).
  const turn = useMemo(
    () => (sheet ? turnFromEncounter(encounter, sheet, { myTurn: floorTurn, currentName: floorName }) : null),
    [encounter, sheet, floorTurn, floorName],
  );
  const myTurn = turn?.myTurn ?? floorTurn;
  const currentName = turn?.currentName ?? floorName;
  const signature = turn ? turnSignature(turn) : "";

  const spells = useHandSpells(sheet);
  // A card sent and not yet resolved holds the cards of its cost (useHandChoices.ts).
  const { waiting, setPending } = useHandPending(signature);

  const hits = encounter.lastHits;
  const reactions = useMemo(
    () => (sheet && turn ? reactionCards(sheet, turn, hits ?? [], sheets) : []),
    [sheet, turn, hits, sheets],
  );
  const gear = useMemo<HandGearContext | undefined>(
    () =>
      sheet
        ? {
            drops,
            mount: mounts?.[sheet.id] ?? null,
            allies: sheets.filter((entry) => entry.id !== sheet.id).length,
            dying: sheets
              .filter((entry) => entry.currentHp <= 0 && !entry.deathSaves?.dead && !entry.deathSaves?.stable)
              .map((entry) => ({ id: entry.id, name: entry.name })),
          }
        : undefined,
    [sheet, sheets, drops, mounts],
  );
  // A host too old to catch the creatures in a laid blast keeps its blasts
  // aimed at one enemy (src/lib/capabilities.ts handBlasts).
  const capabilities = useCapabilities();
  const blasts = hostOffers(capabilities, "handBlasts");
  // Sharing a casting out among creatures (issue 570): a host that does not
  // read the shares takes the aimed creature alone, so the split stays shut.
  const splits = hostOffers(capabilities, "handShares");
  const cards = useMemo(() => {
    if (!sheet || !turn) return [];
    return holdPendingCards(withReactions(reactions, deriveHand(sheet, turn, { spells, trackAmmo, gear, blasts })), waiting);
  }, [sheet, turn, reactions, spells, trackAmmo, gear, blasts, waiting]);

  // Cards that spend one thing (spell slots, ki, superiority dice, gear, the
  // basic actions) gather under one card each (issue 528, hand-groups.ts).
  const { units, groups } = useMemo(() => groupHand(cards, sheet), [cards, sheet]);
  // Where each card or group sits, the fan or "more": the player's own
  // arrangement for this character when they have made one (issue 231). A
  // card inside a group may still be seated on its own as a favourite.
  const { layout, save: saveLayout } = useHandLayout(campaignId, sheet);
  const arrangement = useMemo(() => arrangeHand(units, layout, HAND_FAN_CAP, cards), [units, layout, cards]);
  const freshIds = useMemo(() => new Set(arrangement.freshIds), [arrangement.freshIds]);
  const [arranging, setArranging] = useState(false);
  // The group opened as a hand of its own; it closes itself if the group
  // no longer folds (a spell unprepared below the fold).
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const openGroup = groups.find((group) => group.id === openGroupId) ?? null;
  const sectionRef = useRef<HTMLElement>(null);

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [riderIds, setRiderIds] = useState<string[]>([]);
  const [played, setPlayed] = useState<{ card: HandCard; seq: number } | null>(null);
  const playedTimer = useRef<number | undefined>(undefined);
  const [folding, setFolding] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const commitBusy = useRef(false);
  const [boardChoices, setBoardChoices] = useState<"attack" | "cast" | null>(null);
  const [boardNative, setBoardNative] = useState(false);
  const [boardSwap, setBoardSwap] = useState<ConcentrationSwap | null>(null);
  const swapReply = useRef<((value: ConcentrationSwap | null) => void) | null>(null);
  const swapTurn = useRef("");
  const boardTarget = useRef<string | null>(null);
  const boardRequest = useRef(false);
  const [boardCommit, setBoardCommit] = useState<{ id: string; signature: string; campaignId: string; characterId: string } | null>(null);
  // A notice holds only for the turn it was raised on (liveNotice, issue 668).
  const [noticeEntry, setNoticeEntry] = useState<HandNotice | null>(null);
  const noticeKey = `${sheet?.id ?? ""}|${signature}`;
  const notice = liveNotice(noticeEntry, noticeKey);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  const collapsed = useSyncExternalStore(subscribeStore, () => readFlag(COLLAPSED_KEY), () => false);
  // Once per account, like the tours (issue #306): only a definite "not
  // finished" from the account shows it unasked.
  const tutorialFinished = useTourFinished(HAND_TUTORIAL_ID);
  const [tutorialAsked, setTutorialAsked] = useState(false);
  const showTutorial = !boardNative && !collapsed && (tutorialAsked || (tutorialFinished === false && myTurn));

  // A card that stopped being playable (the turn moved on) drops out of aim.
  const picked = cards.find((card) => card.id === pickedId && !card.disabled) ?? null;
  const riders = useMemo(
    () => cards.filter((card) => riderIds.includes(card.id) && !card.disabled),
    [cards, riderIds],
  );

  const targets = useMemo<HandTargetChip[]>(
    () => handTargets(encounter.enemies, sheets, sheet?.id, edges),
    [encounter.enemies, sheets, sheet?.id, edges],
  );
  const enemyTargets = useMemo(() => targets.filter((target) => target.kind === "enemy"), [targets]);
  const partyTargets = useMemo(() => targets.filter((target) => target.kind !== "enemy"), [targets]);

  // A tap on the board while a card is raised arrives as the HUD's own
  // sentence in the message box; it is read here rather than stored, so the
  // board needs to know nothing about the Hand.
  const boardName = !boardNative && picked?.target === "enemy" ? targetFromComposedText(input, enemyTargets.map((target) => target.name)) : null;
  // A reaction answers one recorded attack: its target is fixed by it (the
  // attacker for Hellish Rebuke, the ally for Cutting Words), not picked.
  const fixed = picked?.intent.card === "reaction" && sheet ? reactionAim(picked, hits ?? [], sheet.id, sheets) : null;
  const fixedChip = useMemo(() => fixed ? targets.find((target) => target.id === fixed.id) ?? { ...fixed, note: "" } : null, [fixed, targets]);
  const offered = useMemo(() => fixedChip
    ? [fixedChip]
    : picked?.target === "enemy"
      ? enemyTargets
      : picked?.target === "ally"
        ? partyTargets
        : [], [fixedChip, picked?.target, enemyTargets, partyTargets]);
  const self = partyTargets.find((target) => target.kind === "self") ?? null;
  const aim =
    picked?.target === "self"
      ? self
      : fixedChip ??
        (boardName ? offered.find((target) => target.name === boardName) : null) ??
        offered.find((target) => target.id === targetId) ??
        null;
  // What the hover previews are worked against until something is aimed at.
  const defaultAim = aim?.kind === "enemy" ? aim : enemyTargets[0] ?? null;
  const conditions = sheet?.conditions ?? EMPTY;

  const attachedRiders = picked?.intent.card === "attack" && !picked.intent.offHand ? riders : EMPTY_CARDS;
  // The options, trigger, choice and area the card carries; the board hears
  // of the raised card from here too (useHandChoices.ts).
  const { choices, resetChoices, barProps } = useHandChoices(picked, aim);
  const sentence = picked ? composeSentence(picked, aim, attachedRiders, choices) : "";
  const rows = useMemo(
    () => (picked ? previewRows(picked, aim ?? (picked.target === "enemy" ? defaultAim : null), conditions, choices) : []),
    [picked, aim, defaultAim, conditions, choices],
  );

  // Where there is no room for both (a phone, a fight on the stage) the aim
  // bar takes the fan's place, and the card that was pressed goes with it:
  // the keyboard follows into the aim bar rather than falling out of the
  // hand, so its targets are a Tab away and Escape still lets the card go.
  useEffect(() => {
    if (!pickedId) return;
    const frame = window.requestAnimationFrame(() => {
      const section = sectionRef.current;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!section || (active && section.contains(active) && active.offsetParent !== null)) return;
      if (active && active !== document.body && !section.contains(active)) return;
      section.querySelector<HTMLElement>(".hand-aim button:not([disabled])")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pickedId]);

  const clearAim = useCallback(() => {
    setPickedId(null);
    setTargetId(null);
    resetChoices();
  }, [resetChoices]);

  // A card let go (Escape, or the aim bar's Back) hands the keyboard back to
  // the card itself, which the fan shows again where the aim bar stood.
  const releaseAim = useCallback(() => {
    const id = pickedId;
    clearAim();
    if (!id) return;
    window.requestAnimationFrame(() => {
      const card = [...(sectionRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [])].find(
        (element) => element.dataset.cardId === id,
      );
      card?.focus({ preventScroll: true });
    });
  }, [pickedId, clearAim]);

  useEffect(() => {
    const onTarget = (event: Event) => {
      const detail = (event as CustomEvent<HandTargetDetail>).detail ?? {};
      const found = targets.find((target) => target.id === detail.id || target.name === detail.name);
      if (found) setTargetId(found.id);
    };
    window.addEventListener(HAND_TARGET_EVENT, onTarget);
    return () => window.removeEventListener(HAND_TARGET_EVENT, onTarget);
  }, [targets]);

  // The key is the one of the moment the card was pressed: a refusal that
  // comes back after the turn has moved on belongs to the turn it answered.
  const say = useCallback((text: string) => {
    setNoticeEntry({ text, key: noticeKey });
    replayAnimation(noticeRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
  }, [noticeKey]);
  // The notice line sits at the Hand's foot. On a short phone the Hand
  // scrolls in what the message box leaves it (hand.css), and a refusal
  // (out of reach, nothing left to spend) landed below the fold, so the
  // press seemed to do nothing. A new notice is brought into view.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);

  const pick = useCallback(
    (card: HandCard, native = false) => {
      if (card.disabled) {
        say(card.disabled);
        return;
      }
      setNoticeEntry(null);
      setBoardNative(native);
      setMoreOpen(false);
      if (card.type === "rider") {
        setRiderIds((current) => (current.includes(card.id) ? current.filter((id) => id !== card.id) : [...current, card.id]));
        // A maneuver rides the next attack card, which is in the main hand.
        setOpenGroupId(null);
        return;
      }
      setTargetId(boardTarget.current);
      boardTarget.current = null;
      setBoardChoices(null);
      resetChoices();
      setPickedId((current) => (!native && current === card.id ? null : card.id));
    },
    [say, resetChoices],
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
    if (!picked || !sheet || sending || commitBusy.current) return;
    if (inputBlocked && picked.cost !== "reaction") { say(blockedReason); return; }
    if (!handReady(picked, aim, choices)) { say(picked.asks === "trigger" && !choices.trigger?.trim() ? "Name the trigger first." : "Pick a target or an area first."); return; }
    if (picked.compose) {
      toComposer(sentence);
      return;
    }
    commitBusy.current = true;
    setSending(true);
    setNoticeEntry(null);
    try {
      const ending = picked.intent.card === "basic" && picked.intent.action === "end-turn";
      // End turn is the floor banner's own route; everything else is the
      // composer's POST with the card riding along as an optional field.
      const post = (concentrationAck?: ConcentrationSwap) =>
        ending
          ? fetch(`/api/campaigns/${campaignId}/encounter/end-turn`, { method: "POST" })
          : fetch(`/api/campaigns/${campaignId}/actions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: sentence,
                kind: "do",
                characterId: sheet?.id,
                intent: intentBody(picked, aim, attachedRiders, choices),
                ...(concentrationAck ? { concentrationAck } : {}),
              }),
            });
      let response = await post();
      if (!response.ok) {
        // The engine's own reason (the actions route asks canAct and the
        // cast guard before anything is posted); the card stays playable.
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        // A cast that ends the spell held now is asked about first (issue
        // 252); a no keeps it, spending nothing.
        if (isConcentrationQuestion(response.status, data)) {
          const swap = (data as { confirmConcentration?: ConcentrationSwap }).confirmConcentration;
          const ack = boardNative && swap?.characterId && swap.current && swap.next
            ? await new Promise<ConcentrationSwap | null>(resolve => { swapReply.current = resolve; swapTurn.current = `${campaignId}:${sheet.id}:${signature}`; setBoardSwap(swap); })
            : await askConcentrationSwap(data);
          if (!ack) {
            say(`Kept ${(data as { confirmConcentration?: { current?: string } }).confirmConcentration?.current ?? "your spell"}; nothing was spent.`);
            return;
          }
          response = await post(ack);
          if (!response.ok) {
            const again = (await response.json().catch(() => ({}))) as { error?: string };
            say(again.error || "Could not send your action.");
            return;
          }
        } else {
          say(data.error || "Could not send your action.");
          return;
        }
      }
      // Nothing is marked spent: the engine's count arrives with the
      // encounter. Until it moves, the same cost waits on this card.
      if (!ending) {
        setPending({
          cost: picked.cost,
          attack: picked.intent.card === "attack" || picked.intent.card === "rider",
          name: picked.name,
          signature,
          interaction: picked.interaction === true,
        });
      }
      setPlayed((current) => ({ card: picked, seq: (current?.seq ?? 0) + 1 }));
      setRiderIds([]);
      // The board's sentence has done its work as the pick; it is not sent twice.
      if (boardName) setInput("");
      window.setTimeout(() => {
        clearAim();
        // A card played from a group goes home with it: End turn and the
        // attacks are in the main hand.
        setOpenGroupId(null);
      }, LEFT_MS);
      // A second card played inside the first one's beat takes the stage over.
      window.clearTimeout(playedTimer.current);
      playedTimer.current = window.setTimeout(() => setPlayed(null), PLAYED_MS);
    } catch {
      say("Could not reach the server.");
    } finally {
      commitBusy.current = false;
      setSending(false);
    }
  }, [picked, sheet, sending, sentence, campaignId, aim, attachedRiders, choices, signature, setPending, boardName, setInput, clearAim, say, toComposer, inputBlocked, blockedReason, boardNative]);

  const nativePanel = useMemo<BoardPanel | null>(() => {
    if (!boardNative) return null;
    const close = { id: "panel-close" as const, label: "Close", disabled: null };
    if (boardSwap) return { title: `Replace ${boardSwap.current}?`, lines: [`Casting ${boardSwap.next} ends concentration on ${boardSwap.current} and its effects. Keep it to spend nothing.`], controls: [{ id: "hand-confirm", label: `Cast ${boardSwap.next}`, disabled: null }, { id: "hand-keep", label: `Keep ${boardSwap.current}`, disabled: null }, close] };
    if (boardChoices) {
      const matches = cards.filter(card => card.intent.card === (boardChoices === "attack" ? "attack" : "spell"));
      return { title: boardChoices === "attack" ? "Choose a weapon" : "Choose a spell", lines: ["Choose the action, then its target and options. Nothing is sent until you play it.", ...(!matches.length ? ["No matching cards are available yet; spell details may still be loading."] : []), ...(notice ? [notice] : [])], controls: [{ id: "hand-card", label: boardChoices === "attack" ? "Weapon" : "Spell", disabled: null, options: matches.map(card => ({ value: card.id, label: `${card.name} · ${card.cost}${card.resource ? ` · ${card.resource}` : ""}${card.dice ? ` · ${card.dice}` : ""}`, disabled: card.disabled })) }, close] };
    }
    if (!picked) return null;
    const option = (value: string, label: string, disabled: string | null = null) => ({ value, label, disabled });
    return { title: picked.name, boardInput: true, lines: [picked.description ?? picked.rules, ...rows.map(row => `${row.key}: ${row.value}`), ...(picked.area ? [pickHint(picked.area, barProps.areaPick), ...(hasPick(picked.area, barProps.areaPick) ? [describePick(picked.area, barProps.areaPick)] : [])] : []), `Sends: ${sentence}`, ...(notice ? [notice] : [])], controls: [
      ...(offered.length ? [{ id: "hand-target" as const, label: "Target", value: aim?.id, disabled: null, options: offered.map(target => option(target.id, `${target.name}${target.note ? ` · ${target.note}` : ""}`)) }] : []),
      ...(barProps.options.length ? [{ id: "hand-option" as const, label: "Attack options (choose to toggle)", disabled: null, options: barProps.options.map(entry => option(entry.id, `${barProps.chosen.includes(entry.id) ? "✓ " : ""}${entry.label}`, entry.disabled ?? null)) }] : []),
      ...(picked.intent.card === "attack" && cards.some(card => card.type === "rider") ? [{ id: "hand-rider" as const, label: "Riders (choose to toggle)", disabled: null, options: cards.filter(card => card.type === "rider").map(card => option(card.id, `${attachedRiders.some(rider => rider.id === card.id) ? "✓ " : ""}${card.name}`, card.disabled)) }] : []),
      ...(picked.choice ? [{ id: "hand-choice" as const, label: picked.choice.label, value: barProps.choice ?? picked.choice.fallback ?? picked.choice.options[0]?.value, disabled: null, options: picked.choice.options.map(entry => option(entry.value, entry.label)) }] : []),
      ...(splits && picked.shares && aim && offered.some(target => target.id !== aim.id) ? [shareControl(picked, aim, offered, barProps.shares)] : []),
      ...(barProps.trigger !== null ? [{ id: "hand-trigger" as const, label: "Trigger", disabled: null, input: { value: barProps.trigger } }] : []),
      ...(picked.area && hasPick(picked.area, barProps.areaPick) ? [{ id: "hand-area-clear" as const, label: "Clear area", disabled: null }] : []),
      { id: "hand-play", label: picked.compose ? "Write in chat" : `Play ${picked.name}`, disabled: inputBlocked && picked.cost !== "reaction" ? blockedReason : handReady(picked, aim, { trigger: barProps.trigger ?? "", area: barProps.areaPick }) ? null : "Choose a target, area or trigger first." },
      { id: "hand-edit", label: "Edit in chat", disabled: null }, { id: "hand-back", label: "Back", disabled: null }, close,
    ] };
  }, [boardNative, boardSwap, boardChoices, cards, picked, rows, sentence, offered, aim, attachedRiders, barProps.options, barProps.chosen, barProps.choice, barProps.trigger, barProps.areaPick, barProps.shares, splits, notice, inputBlocked, blockedReason]);
  const nativeSignature = JSON.stringify([campaignId, sheet?.id, signature, nativePanel, sending && !boardSwap]);
  useEffect(() => {
    if (swapReply.current && swapTurn.current !== `${campaignId}:${sheet?.id}:${signature}`) {
      swapReply.current(null); swapReply.current = null; setBoardSwap(null);
    }
  }, [campaignId, sheet?.id, signature]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(HAND_BOARD_STATUS_EVENT, { detail: { campaignId, sending: sending && !boardSwap, notice: notice || (waiting ? `Waiting for the DM to resolve ${waiting.name}.` : ""), panel: nativePanel, signature: nativeSignature } }));
  }, [campaignId, sending, boardSwap, notice, waiting, nativePanel, nativeSignature]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<HandBoardControlDetail>).detail;
      if (!detail || detail.campaignId !== campaignId || detail.signature !== nativeSignature || !nativePanel || !offeredBoardControl({ panel: nativePanel, controls: [], pending: sending && !boardSwap }, detail.actionId, detail.value)) return;
      const value = detail.value ?? "";
      if (detail.actionId === "hand-confirm" || detail.actionId === "hand-keep" || (boardSwap && detail.actionId === "panel-close")) {
        const resolve = swapReply.current; swapReply.current = null; setBoardSwap(null);
        resolve?.(detail.actionId === "hand-confirm" ? boardSwap : null); return;
      }
      switch (detail.actionId) {
        case "hand-card": { const card = cards.find(entry => entry.id === value); if (card) pick(card, true); break; }
        case "hand-target": setTargetId(value); break;
        case "hand-option": { const option = barProps.options.find(entry => entry.id === value); if (option && !option.disabled) barProps.onToggleOption(option.id); break; }
        case "hand-rider": { const card = cards.find(entry => entry.id === value && entry.type === "rider"); if (card) pick(card, true); break; }
        case "hand-choice": barProps.onChoice(value); break;
        case "hand-trigger": barProps.onTrigger(value); break;
        case "hand-share": {
          const [id, step] = value.split(":");
          const target = offered.find(entry => entry.id === id);
          if (target) barProps.onShare(target, step === "-" ? -1 : 1);
          break;
        }
        case "hand-area-clear": barProps.onClearArea(); break;
        case "hand-play": void commit(); break;
        case "hand-edit": toComposer(sentence); setBoardNative(false); break;
        case "hand-back": {
          boardTarget.current = aim?.id ?? null;
          setBoardChoices(picked?.intent.card === "attack" ? "attack" : picked?.intent.card === "spell" ? "cast" : null);
          clearAim(); break;
        }
        case "panel-close": setMoreOpen(false); setBoardChoices(null); if (!boardChoices) clearAim(); setBoardNative(false); break;
      }
    };
    window.addEventListener(HAND_BOARD_CONTROL_EVENT, receive);
    return () => window.removeEventListener(HAND_BOARD_CONTROL_EVENT, receive);
  }, [campaignId, nativeSignature, nativePanel, sending, boardSwap, cards, pick, barProps, commit, toComposer, sentence, aim, picked, clearAim, boardChoices, offered]);

  useEffect(() => {
    const leave = (event: Event) => {
      const detail = (event as CustomEvent<{ campaignId: string; active: boolean }>).detail;
      if (detail?.campaignId === campaignId && !detail.active) { setBoardNative(false); swapReply.current?.(null); swapReply.current = null; setBoardSwap(null); }
    };
    window.addEventListener(HAND_BOARD_SURFACE_EVENT, leave);
    return () => { window.removeEventListener(HAND_BOARD_SURFACE_EVENT, leave); swapReply.current?.(null); swapReply.current = null; };
  }, [campaignId]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<HandBoardActionDetail>).detail;
      if (!detail || detail.campaignId !== campaignId) return;
      if (sending || commitBusy.current || boardRequest.current) { say("Please wait for the current action."); return; }
      if (inputBlocked) { say(blockedReason); return; }
      setBoardNative(detail.nativeChoices === true);
      boardTarget.current = targets.some(target => target.id === detail.targetId) ? detail.targetId! : null;
      writeFlag(COLLAPSED_KEY, false);
      setArranging(false);
      setNoticeEntry(null);
      if (detail.action === "attack" || detail.action === "cast") {
        if (!detail.nativeChoices && !cards.some(card => card.intent.card === (detail.action === "attack" ? "attack" : "spell"))) { say("No matching cards are available in your hand."); return; }
        setBoardChoices(detail.action);
        setMoreOpen(true);
        return;
      }
      const card = cards.find(card => card.intent.card === "basic" && card.intent.action === detail.action && card.cost === "action");
      if (!card) { say("That action is not available in your hand."); return; }
      if (card.disabled) { say(card.disabled); return; }
      setRiderIds([]);
      resetChoices();
      setPickedId(card.id);
      setTargetId(boardTarget.current);
      boardTarget.current = null;
      if (detail.action !== "help") {
        boardRequest.current = true;
        setBoardCommit({ id: card.id, signature, campaignId, characterId: sheet?.id ?? "" });
      }
    };
    window.addEventListener(HAND_BOARD_ACTION_EVENT, receive);
    return () => window.removeEventListener(HAND_BOARD_ACTION_EVENT, receive);
  }, [campaignId, sending, inputBlocked, blockedReason, targets, cards, signature, resetChoices, say, sheet?.id]);

  useEffect(() => {
    if (!boardCommit) return;
    // Submit through the existing handler after the card and choices have rendered.
    const timer = window.setTimeout(() => {
      setBoardCommit(null);
      if (boardCommit.campaignId !== campaignId || boardCommit.characterId !== sheet?.id || boardCommit.signature !== signature || picked?.id !== boardCommit.id) { boardRequest.current = false; return; }
      void commit().finally(() => { boardRequest.current = false; });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [boardCommit, picked, signature, commit, campaignId, sheet?.id]);

  if (!sheet || !turn) return null;

  // Off this character's turn (or while initiative is rolled) the whole
  // hand is held for one reason, the engine's own. The header already says
  // to look the cards over, so a card held only by that stays readable
  // (issue 96): its preview still opens, and the reason is said once.
  const waitingOn = waitingHand(sheet, turn);
  const isWaiting = (card: HandCard) => card.disabled !== null && Boolean(waitingOn?.sentences.has(card.disabled));

  const { fan, more, displaced, fresh } = arrangement;
  const urgent = fan.filter((unit): unit is HandCard => !isGroup(unit) && isUrgentCard(unit));
  // A card chosen from behind the spine, or raised inside a group, takes a
  // seat for the moment: a free one, else the last before End turn. The
  // arrangement is not changed by it.
  const shown = seatPicked(fan, picked && !fan.includes(picked) ? picked : null);
  const middle = (shown.length - 1) / 2;
  // The mockup's 4.4 degrees between neighbours, eased off as the hand fills
  // so nine cards lean no further than five did.
  const step = fanStep(shown.length);
  // A group held only by the turn reads like a waiting card: at full strength.
  const groupWaiting = (group: HandGroup) => Boolean(group.disabled) && group.cards.every((card) => !card.disabled || isWaiting(card));
  const openGroupCard = (group: HandGroup) => {
    if (collapsed) writeFlag(COLLAPSED_KEY, false);
    clearAim();
    setNoticeEntry(null);
    setOpenGroupId(group.id);
  };
  // Back to the main hand, the keyboard landing on the group's own card.
  const backToHand = () => {
    const id = openGroupId;
    setOpenGroupId(null);
    window.requestAnimationFrame(() => {
      sectionRef.current?.querySelector<HTMLElement>(`[data-group-id="${id}"]`)?.focus({ preventScroll: true });
    });
  };
  // The engine's count, the same one the cards read.
  const pips = turnPips(turn);

  return (
    <section
      ref={sectionRef}
      className="hand"
      data-tour="battle-hand"
      data-tutorial={showTutorial ? "true" : undefined}
      data-group-open={openGroup ? "true" : undefined}
      aria-label="Your hand"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Escape in a group's search box clears the words first.
        const typed = event.target instanceof HTMLInputElement && event.target.value !== "";
        if (typed) return;
        if (picked) {
          event.stopPropagation();
          releaseAim();
        } else if (openGroup) {
          event.stopPropagation();
          backToHand();
        }
      }}
    >
      {/* The label keeps its whole words: on a phone the pips wrap under it
          rather than squeeze it to "YOUR HAN...". */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          key={myTurn ? "mine" : (currentName ?? "other")}
          className="hand-label min-w-0 break-words font-display text-[11px] uppercase tracking-[0.22em] text-amber-200/90"
        >
          {myTurn ? "Your hand" : `${currentName ?? "Another hero"}'s turn`}
        </span>
        <span className="hidden text-[11px] text-stone-500 sm:inline">
          {myTurn ? "Play a card, or type your move below." : "Look your cards over while you wait."}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <HandPips pips={pips} flurryStrikes={turn.flurryStrikes} />
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
          <Tooltip content="Customize your hand: choose which cards stay in it">
            <button
              type="button"
              onClick={() => {
                if (collapsed) writeFlag(COLLAPSED_KEY, false);
                clearAim();
                setArranging(true);
                setMoreOpen(true);
              }}
              aria-label="Customize your hand"
              className="flex size-9 items-center justify-center rounded-lg text-stone-500 hover:text-amber-200 sm:size-7"
            >
              <SlidersHorizontal className="size-4" />
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
          onDismiss={(how) => {
            finishTour(HAND_TUTORIAL_ID, how);
            setTutorialAsked(false);
          }}
        />
      ) : null}

      {/* A reaction the moment offers (an attack just hit you or an ally):
          above the fan, even while the hand is put away, because it is gone
          once the turn moves on. */}
      <HandReactPrompt
        cards={reactions}
        pickedId={picked?.id ?? null}
        onPick={(card) => {
          // The aim bar that sends it lives in the fan's space: a put-away
          // hand comes back out for it.
          if (collapsed) writeFlag(COLLAPSED_KEY, false);
          pick(card);
        }}
      />

      {collapsed ? null : (
        <>
          {openGroup ? (
            <HandGroupView
              genre={genre}
              key={openGroup.id}
              group={openGroup}
              pickedId={picked?.id ?? null}
              riderIds={riderIds}
              playedId={played?.card.id ?? null}
              aim={defaultAim}
              conditions={conditions}
              isWaiting={isWaiting}
              freshIds={freshIds}
              aiming={Boolean(picked)}
              folding={folding || Boolean(leaving)}
              onPick={pick}
              onBack={backToHand}
            />
          ) : (
          <div
            className="hand-fan"
            data-aiming={picked ? "true" : undefined}
            data-more={more.length ? "true" : undefined}
            data-folding={folding || leaving ? "true" : undefined}
            role="group"
            aria-label="Cards"
          >
            {shown.map((unit, index) =>
              isGroup(unit) ? (
                <HandGroupFace
                  genre={genre}
                  key={unit.id}
                  group={unit}
                  index={index}
                  offset={index - middle}
                  step={step}
                  waiting={groupWaiting(unit)}
                  fresh={unit.cards.some((card) => freshIds.has(card.id))}
                  onOpen={openGroupCard}
                />
              ) : (
                <HandCardFace
                  genre={genre}
                  key={unit.id}
                  card={unit}
                  index={index}
                  offset={index - middle}
                  step={step}
                  picked={picked?.id === unit.id}
                  attached={riderIds.includes(unit.id)}
                  played={played?.card.id === unit.id}
                  aim={unit.intent.card === "reaction" ? null : defaultAim}
                  conditions={conditions}
                  waiting={isWaiting(unit)}
                  onPick={pick}
                />
              ),
            )}
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
          )}
          {played ? <HandPlayedCard key={played.seq} card={played.card} /> : null}
          {picked && !boardNative ? (
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
              {...barProps}
              onShare={splits ? barProps.onShare : undefined}
              onRefused={say}
              // A reaction is taken on anyone's turn: the initiative floor
              // does not hold it (the engine's canAct judges it instead).
              blocked={inputBlocked && picked.cost !== "reaction" ? blockedReason : null}
              onBack={releaseAim}
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
      {/* Inset past the shake (5px each way, say() above): on a phone the hand
          scrolls, so it clips sideways, and the shake carried the first
          letters off its edge ("Dren Vale has...", issue 668). */}
      <p ref={noticeRef} role="status" className={cn("mt-1 px-1.5 text-xs text-amber-300", notice ? "" : "hidden")}>
        {notice}
      </p>
      <HandMoreSheet
        genre={genre}
        open={moreOpen && !boardNative}
        onOpenChange={(open) => {
          setMoreOpen(open);
          if (!open) { setArranging(false); setBoardChoices(null); boardTarget.current = null; }
        }}
        arranging={arranging}
        onArrange={setArranging}
        displaced={displaced}
        urgent={urgent}
        fresh={fresh}
        freshIds={freshIds}
        arrange={
          arranging ? (
            <HandArrange
              genre={genre}
              units={units}
              cards={cards}
              working={startingLayout(units, layout, cards)}
              arranged={arrangement.arranged}
              urgent={urgent}
              displaced={displaced}
              freshIds={freshIds}
              onChange={saveLayout}
              onReset={() => saveLayout(null)}
              onDone={() => {
                setArranging(false);
                if (!more.length) setMoreOpen(false);
              }}
            />
          ) : null
        }
        units={boardChoices ? cards.filter(card => card.intent.card === (boardChoices === "attack" ? "attack" : "spell")) : more}
        onPick={pick}
        waitingNote={waitingOn?.note ?? null}
        isWaiting={isWaiting}
        aim={defaultAim}
        conditions={conditions}
      />
    </section>
  );
}

const EMPTY: string[] = [];
const EMPTY_CARDS: HandCard[] = [];

// Memoized like the composer it sits in: unchanged props while the DM streams.
export const Hand = memo(HandInner);
