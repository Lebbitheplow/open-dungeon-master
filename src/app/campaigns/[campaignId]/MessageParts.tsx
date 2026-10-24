"use client";

import { Copy, EyeOff, Flag, Scale, VenetianMask } from "lucide-react";
import { useId } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { SectionHead } from "@/components/ui/SectionHead";
import { PortraitMedallion } from "@/components/sheet/SheetParts";
import { useFaceChain } from "@/app/campaigns/[campaignId]/useFaceChain";
import { useFaceSize } from "@/app/campaigns/[campaignId]/useFaceSize";
import { cn } from "@/lib/cn";
import { playerFaces } from "@/lib/speaker-faces";
import { JOIN_NOTE_PREFIX, LEAD_NOTE_PREFIX, systemNoteWords, type CampaignMember } from "@/lib/campaign-types";
import type { CampaignMessage } from "@/lib/db/messages";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import {
  MessageActions,
  toContextItems,
  type MessageAction,
} from "@/app/campaigns/[campaignId]/MessageActions";
import type { SystemGlyph } from "@/lib/system-glyphs";
import { PACT_REVEAL_PREFIX } from "@/lib/dm/pact-logic";
import { kitButtonClass } from "@/app/campaigns/[campaignId]/PanelKit";

// The transcript's smaller voices: the table's own notices and what the
// players say. The DM's passage, the hero of the screen, is MessageItem.tsx.

export function copyAction(message: CampaignMessage): MessageAction {
  return {
    id: "copy",
    name: "Copy text",
    label: "Copy this message's text",
    hint: "Copy: put this message's words on the clipboard",
    glyph: "ui-duplicate",
    icon: <Copy className="size-3.5" />,
    onSelect: () => {
      void navigator.clipboard?.writeText(message.content).catch(() => {});
    },
  };
}

// A player's objection to a narrated ruling (DisputeDialog.tsx): the
// steerer upholds or overrules it, or the table votes.
export function disputeAction(message: CampaignMessage, onDispute: (message: CampaignMessage) => void): MessageAction {
  return {
    id: "dispute",
    name: "Dispute",
    label: "Dispute this ruling",
    hint: "Dispute: object to what the narrator ruled here; whoever steers the story settles it, or the table votes",
    glyph: "system-rules",
    icon: <Scale className="size-3.5" />,
    onSelect: () => onDispute(message),
  };
}

export function reportAction(message: CampaignMessage, onReport: (message: CampaignMessage) => void, dm: boolean): MessageAction {
  return {
    id: "report",
    name: "Report",
    label: dm ? "Report this passage" : "Report this message",
    hint: dm
      ? "Report: flag this passage to the admins of this server"
      : "Report: flag this message to the admins of this server, or block the player",
    glyph: "system-rules",
    icon: <Flag className="size-3.5" />,
    tone: "danger",
    onSelect: () => onReport(message),
  };
}

// A notice that is not a halted turn: the lead's public direction as a card,
// a joiner, or a plain line with the painting its writer stored (a line
// written before the icon was stored draws the neutral bell).
export function SystemMessage({ content, glyph }: { content: string; glyph?: SystemGlyph }) {
  if (content.startsWith(LEAD_NOTE_PREFIX)) {
    return (
      <div data-tone="ember" className="panel session-banner-card rounded-xl border-ember-500/40">
        <SectionHead title="Party Lead" glyph="tab-lead" level="h4" className="mb-1" />
        <p className="text-sm text-amber-100/90">{content.slice(LEAD_NOTE_PREFIX.length)}</p>
      </div>
    );
  }
  // A pact or a secret action come out (issue 503): the server's word, drawn
  // as a card that unmasks itself (motion-app.css .pact-reveal).
  if (content.startsWith(PACT_REVEAL_PREFIX)) {
    return (
      <div className="pact-reveal panel rounded-xl border-violet-500/45 px-3 py-2" data-pact-reveal="">
        <p className="eyebrow flex items-center gap-1.5 text-[10px] text-violet-300">
          <VenetianMask className="size-3.5" aria-hidden="true" />
          Revealed
        </p>
        <p className="mt-0.5 text-sm leading-snug text-violet-50">{content.slice(PACT_REVEAL_PREFIX.length)}</p>
      </div>
    );
  }
  const join = content.startsWith(JOIN_NOTE_PREFIX);
  // The markers the DM reads (a joiner, a settled offer) come off.
  const text = systemNoteWords(content);
  return (
    <p className="session-sysline">
      <GameIcon icon={{ kind: "glyph", key: join ? "system-party" : (glyph ?? "cue-bell") }} size="size-6" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

// "<shop> is open", the line a shop opening where the party stands writes
// (src/lib/dm/shop-tools.ts announceShop), with the way to its shelf: the
// prices live in the Market, never in the narration. Every seat sees it.
export function ShopOpenLine({ content, onBrowse }: { content: string; onBrowse?: () => void }) {
  const lineId = useId();
  return (
    <p className="session-sysline">
      <GameIcon icon={{ kind: "glyph", key: "cue-coin" }} size="size-6" />
      <span id={lineId} className="min-w-0">{content}</span>
      {onBrowse ? (
        <button type="button" onClick={onBrowse} aria-describedby={lineId} data-browse-wares="" className={kitButtonClass("small", "shrink-0 not-italic text-amber-100")}>
          <GameIcon icon={{ kind: "glyph", key: "tab-market" }} size="size-5" />
          Browse wares
        </button>
      ) : null}
    </p>
  );
}

export function BlockedMessage() {
  return (
    <p className="ml-auto flex max-w-[92%] items-center justify-end gap-1.5 text-right text-xs italic text-stone-600 sm:max-w-2xl">
      <EyeOff className="size-3.5 shrink-0" />
      A message from a player you blocked
    </p>
  );
}

export function PlayerMessage({
  message,
  mine,
  sheets,
  sheetsById,
  membersById,
  onReport,
}: {
  message: CampaignMessage;
  mine: boolean;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  membersById: Map<string, CampaignMember>;
  onReport?: (message: CampaignMessage) => void;
}) {
  // Older messages predate characterId, so fall back to the author's
  // sheet in this campaign before giving up on a character identity.
  const sheet =
    (message.characterId ? sheetsById.get(message.characterId) : undefined) ??
    (message.userId ? sheets.find((candidate) => candidate.userId === message.userId) : undefined);
  // Character portrait first, then the player's own avatar, then a stand-in
  // (playerFaces); one that fails to load gives way to the next.
  const [portraitUrl, onFaceError] = useFaceChain(
    playerFaces({ sheet, avatarUrl: message.userId ? membersById.get(message.userId)?.avatar?.url : undefined, userId: message.userId }),
  );
  const actions: MessageAction[] = [copyAction(message)];
  if (onReport && !mine && message.userId) {
    actions.push(reportAction(message, onReport, false));
  }
  // eslint-disable-next-line @next/next/no-img-element
  const face = portraitUrl ? <img src={portraitUrl} alt="" onError={onFaceError} /> : null;
  const ooc = message.content.startsWith("(ooc)");
  // The portrait as tall as the name and bubble beside it (useFaceSize).
  const [faceStyle, textColumn] = useFaceSize<HTMLDivElement>();
  return (
    <ContextMenu
      items={toContextItems(actions)}
      label={sheet?.name ?? "Player"}
      className="session-player group ml-auto max-w-[92%] animate-fade-up sm:max-w-2xl"
    >
      {face ? (
        sheet ? (
          <PortraitMedallion classId={sheet.class} className="session-medallion" style={faceStyle}>
            {face}
          </PortraitMedallion>
        ) : (
          <div className="sheet-medallion session-medallion" style={faceStyle}>
            <div className="sheet-medallion-face">{face}</div>
          </div>
        )
      ) : null}
      <div ref={textColumn} className="min-w-0">
        <p className="mb-1 flex items-center justify-end gap-1.5 text-right">
          <MessageActions actions={actions} menuLabel={`${sheet?.name ?? "Player"}: message actions`} quiet />
          <span className="session-speaker truncate">{sheet?.name ?? "Player"}</span>
        </p>
        <div className={cn("session-bubble", ooc && "session-bubble-ooc")}>
          <p className="whitespace-pre-wrap text-pretty">{message.content}</p>
        </div>
      </div>
    </ContextMenu>
  );
}
