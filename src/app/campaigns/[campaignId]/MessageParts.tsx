"use client";

import { Copy, EyeOff, Flag } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { SectionHead } from "@/components/ui/SectionHead";
import { PortraitMedallion } from "@/components/sheet/SheetParts";
import { cn } from "@/lib/cn";
import { avatarPlaceholder, characterPlaceholder } from "@/lib/placeholders";
import { JOIN_NOTE_PREFIX, LEAD_NOTE_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import type { CampaignMessage } from "@/lib/db/messages";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import {
  MessageActions,
  toContextItems,
  type MessageAction,
} from "@/app/campaigns/[campaignId]/MessageActions";
import { systemLineGlyph } from "@/app/campaigns/[campaignId]/sessionGlyphs";

// The transcript's smaller voices: the table's own notices and what the
// players say. The DM's passage, the hero of the screen, is MessageItem.tsx.

export function copyAction(message: CampaignMessage): MessageAction {
  return {
    id: "copy",
    name: "Copy text",
    label: "Copy this message's text",
    hint: "Copy: put this message's words on the clipboard",
    glyph: "tab-notes",
    icon: <Copy className="size-3.5" />,
    onSelect: () => {
      void navigator.clipboard?.writeText(message.content).catch(() => {});
    },
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
// a joiner, or a plain line with the painting its words call for.
export function SystemMessage({ content }: { content: string }) {
  if (content.startsWith(LEAD_NOTE_PREFIX)) {
    return (
      <div data-tone="ember" className="panel session-banner-card rounded-xl border-ember-500/40">
        <SectionHead title="Party Lead" glyph="tab-lead" level="h4" className="mb-1" />
        <p className="text-sm text-amber-100/90">{content.slice(LEAD_NOTE_PREFIX.length)}</p>
      </div>
    );
  }
  const join = content.startsWith(JOIN_NOTE_PREFIX);
  const text = join ? content.slice(JOIN_NOTE_PREFIX.length) : content;
  return (
    <p className="session-sysline">
      <GameIcon icon={{ kind: "glyph", key: join ? "system-party" : systemLineGlyph(text) }} size="size-6" />
      <span className="min-w-0">{text}</span>
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
  // Character portrait first, then the player's own avatar, then a stand-in:
  // the plate for the character's class or race, or the sigil the player's
  // id hashes to when there is no sheet to draw from.
  const portraitUrl =
    sheet?.portrait?.url ??
    (message.userId ? membersById.get(message.userId)?.avatar?.url : undefined) ??
    (sheet
      ? characterPlaceholder({ race: sheet.race, class: sheet.class, gender: sheet.gender })
      : message.userId
        ? avatarPlaceholder(message.userId)
        : undefined);
  const actions: MessageAction[] = [copyAction(message)];
  if (onReport && !mine && message.userId) {
    actions.push(reportAction(message, onReport, false));
  }
  // eslint-disable-next-line @next/next/no-img-element
  const face = portraitUrl ? <img src={portraitUrl} alt="" /> : null;
  const ooc = message.content.startsWith("(ooc)");
  return (
    <ContextMenu
      items={toContextItems(actions)}
      label={sheet?.name ?? "Player"}
      className="session-player group ml-auto max-w-[92%] animate-fade-up sm:max-w-2xl"
    >
      {face ? (
        sheet ? (
          <PortraitMedallion classId={sheet.class} className="session-medallion">
            {face}
          </PortraitMedallion>
        ) : (
          <div className="sheet-medallion session-medallion">
            <div className="sheet-medallion-face">{face}</div>
          </div>
        )
      ) : null}
      <div className="min-w-0">
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
