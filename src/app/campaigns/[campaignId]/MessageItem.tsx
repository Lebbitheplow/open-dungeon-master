"use client";

import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  FastForward,
  ImagePlus,
  Pencil,
  Pin,
  RefreshCw,
  ShieldQuestion,
  Volume2,
  VolumeX,
} from "lucide-react";
import { memo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { appNotice } from "@/components/ui/ConfirmDialog";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { encodeImageForUpload } from "@/lib/image-encode";
import { ui } from "@/lib/ui";
import { DM_HALTED_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import { isOocAnswer } from "@/lib/dm/ooc-question";
import type { CastMember } from "@/lib/dm/cast";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { HaltedTurnBanner } from "@/app/campaigns/[campaignId]/HaltedTurnBanner";
import { InlineMessageEditor } from "@/app/campaigns/[campaignId]/InlineMessageEditor";
import { DmContent, MediaPlaceholder } from "@/app/campaigns/[campaignId]/MessageContent";
import {
  MessageActions,
  toContextItems,
  type MessageAction,
} from "@/app/campaigns/[campaignId]/MessageActions";
import {
  BlockedMessage,
  PlayerMessage,
  ShopOpenLine,
  SystemMessage,
  copyAction,
  reportAction, disputeAction } from "@/app/campaigns/[campaignId]/MessageParts";
import type { CampaignLocation, MediaStatus } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { locationMapSlot, scenePictureSlot } from "@/app/campaigns/[campaignId]/mediaSlot";

// A right-click on the prose opens the passage's menu, but a long press must
// stay the phone's way to select text: pinning and lore checks act on the
// selection. So the prose sits outside the ContextMenu host and only a mouse
// (or a desktop browser that does not say) is forwarded to it.
function isMouseContextMenu(event: ReactMouseEvent): boolean {
  const pointerType = (event.nativeEvent as PointerEvent).pointerType;
  if (pointerType) {
    return pointerType === "mouse";
  }
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// One chat entry. Memoized so the per-token dm_delta re-renders of the list
// (dmDraft grows on every streamed token) skip the whole back-catalog; only
// props that actually changed re-render their row.
export const MessageItem = memo(function MessageItem({
  message,
  campaignId,
  canRetryTurn,
  canIllustrate,
  rollsById,
  sheetsById,
  membersById,
  locationsById,
  sheets,
  mediaStatus,
  narrationFailure,
  onReplayAudio,
  onPinCanon,
  onPinMemory,
  onEditSave,
  onLoreCheck,
  onRenarrate,
  onContinueScene,
  onSelectVariant,
  onBrowseShop,
  mine,
  blocked,
  onReport,
  onDispute,
  cast,
}: {
  message: CampaignMessage;
  campaignId: string;
  cast: CastMember[];
  canRetryTurn: boolean;
  // This row is the viewer's own message: nothing to report.
  mine: boolean;
  // The viewer blocked this message's author: the row folds away.
  blocked: boolean;
  // Flag a DM passage or another player's message to this server's admins.
  onReport?: (message: CampaignMessage) => void;
  // Object to a narrated ruling; whoever steers the story settles it.
  onDispute?: (message: CampaignMessage) => void;
  // Whoever runs the story may put a picture of their own under a passage.
  canIllustrate: boolean;
  rollsById: Map<string, StoredRoll>;
  sheetsById: Map<string, CharacterSheet>;
  membersById: Map<string, CampaignMember>;
  locationsById: Map<string, CampaignLocation>;
  sheets: CharacterSheet[];
  mediaStatus: Record<string, MediaStatus>;
  // Why this passage was not read aloud, when its narration failed.
  narrationFailure?: string;
  // Plays the stored narration, rendering it first when this passage has
  // never been voiced. Resolves to an error string on failure, null on success.
  onReplayAudio?: (messageId: string) => Promise<string | null>;
  onPinCanon?: (message: CampaignMessage) => void;
  // Pin the current selection (or the whole message) into every future prompt.
  onPinMemory?: (message: CampaignMessage) => void;
  // Lead-only correction of this narration's text. Resolves to an error
  // string when the server refuses (a dropped roll marker), or null on save.
  onEditSave?: (message: CampaignMessage, content: string) => Promise<string | null>;
  onLoreCheck?: (message: CampaignMessage) => void;
  // Reroll this narration's prose (lead only, latest DM message only).
  onRenarrate?: (message: CampaignMessage) => void;
  onContinueScene?: (message: CampaignMessage) => void;
  // Browse the rerolled takes; the picked one is what the table reads.
  onSelectVariant?: (message: CampaignMessage, index: number) => void;
  // A shop's "is open" line opens the Market on that shop.
  onBrowseShop?: (shopId: string) => void;
}) {
  // Local to the row: only one narration is ever being corrected at a time,
  // and the draft should not survive the row unmounting.
  const [editing, setEditing] = useState(false);
  // Stays true until the audio lands, at which point the replay button takes
  // this one's place; cleared early only when the render actually failed.
  const [narrating, setNarrating] = useState(false);
  // An uploaded picture on its way to this passage. The image itself arrives
  // through image_ready like a rendered one, so this only drives the spinner.
  const [attaching, setAttaching] = useState(false);
  const pictureRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Pinning and lore checks act on the reader's selected text, and the press
  // that picks a menu row is what clears it. So the selection is noted on the
  // press that opens a menu and put back just before a row's action runs.
  const heldSelection = useRef<Range | null>(null);
  const holdSelection = () => {
    const selection = window.getSelection();
    heldSelection.current =
      selection && selection.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
  };
  const restoreSelection = () => {
    const held = heldSelection.current;
    heldSelection.current = null;
    const selection = window.getSelection();
    if (held && selection && selection.isCollapsed) {
      selection.removeAllRanges();
      selection.addRange(held);
    }
  };

  async function attachPicture(file: File) {
    setAttaching(true);
    try {
      const { dataUrl, type } = await encodeImageForUpload(file);
      const upload = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type }),
      });
      const uploaded = await upload.json().catch(() => ({}));
      if (!upload.ok) {
        void appNotice(uploaded.error || "That image would not upload.");
        return;
      }
      const response = await fetch(
        `/api/campaigns/${campaignId}/dm/messages/${message.id}/image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: uploaded.url }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        void appNotice(data.error || "Could not put that picture under the passage.");
      }
    } catch {
      void appNotice("That image would not upload.");
    } finally {
      setAttaching(false);
    }
  }

  if (message.authorType === "system") {
    // A halted turn whose dm_turns row is still retryable. Both halves of the
    // test matter: the link is cleared once a retry is claimed, and the
    // prefix keeps any other turn-linked message out of this branch.
    if (message.dmTurnId && message.content.startsWith(DM_HALTED_PREFIX)) {
      return (
        <HaltedTurnBanner
          campaignId={campaignId}
          turnId={message.dmTurnId}
          content={message.content}
          canRetry={canRetryTurn}
        />
      );
    }
    // A shop opened where the party stands: its line, and the way to its
    // shelf in the Market.
    if (message.shopId) {
      const shopId = message.shopId;
      return <ShopOpenLine content={message.content} onBrowse={onBrowseShop ? () => onBrowseShop(shopId) : undefined} />;
    }
    return <SystemMessage content={message.content} glyph={message.glyph} />;
  }
  if (message.authorType === "dm" && isOocAnswer(message.content)) {
    // The DM's out-of-character answer to table talk put to it
    // (src/lib/dm/ooc-question.ts): an aside, not a passage, so none of a
    // passage's actions and none of its type.
    const asideActions: MessageAction[] = [copyAction(message)];
    if (onReport) {
      asideActions.push(reportAction(message, onReport, true));
    }
    return (
      <ContextMenu items={toContextItems(asideActions)} label="Dungeon Master" className="session-dm-aside group max-w-[92%] animate-fade-up sm:max-w-2xl">
        <p className="mb-1 flex items-center gap-1.5">
          <span className="session-speaker truncate">Dungeon Master, out of character</span>
          <MessageActions actions={asideActions} menuLabel="Dungeon Master: message actions" quiet />
        </p>
        <div className="session-bubble session-bubble-ooc session-bubble-dm">
          <p className="whitespace-pre-wrap text-pretty">{message.content}</p>
        </div>
      </ContextMenu>
    );
  }
  if (message.authorType === "dm") {
    const actions: MessageAction[] = [];
    if (onRenarrate) {
      actions.push({
        id: "reroll",
        name: "Reroll",
        label: "Reroll this narration",
        hint: "Reroll: have the DM write this moment again, with the same dice and outcome",
        glyph: "die-d20",
        icon: <RefreshCw className="size-3.5" />,
        onSelect: () => onRenarrate(message),
      });
    }
    if (onContinueScene) {
      actions.push({
        id: "continue",
        name: "Continue the scene",
        label: "Continue this scene",
        hint: "Continue: have the DM keep writing from where this stopped, without moving the story on",
        glyph: "ui-skip",
        icon: <FastForward className="size-3.5" />,
        onSelect: () => onContinueScene(message),
      });
    }
    if (onEditSave) {
      actions.push({
        id: "edit",
        name: "Edit",
        label: "Edit this narration",
        hint: "Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive",
        glyph: "tab-log",
        icon: <Pencil className="size-3.5" />,
        onSelect: () => setEditing(true),
      });
    }
    if (onPinMemory) {
      actions.push({
        id: "remember",
        name: "Remember",
        label: "Pin this to the DM's memory",
        hint: "Remember: keep your selected text (or this whole message) in front of the DM every turn",
        glyph: "ui-pin",
        icon: <Bookmark className="size-3.5" />,
        onSelect: () => onPinMemory(message),
      });
    }
    if (onLoreCheck) {
      actions.push({
        id: "lore",
        name: "Lore check",
        label: "Lore check this passage",
        hint: "Lore check: flag this passage (or your selected text) against the campaign record",
        glyph: "system-lore",
        icon: <ShieldQuestion className="size-3.5" />,
        onSelect: () => onLoreCheck(message),
      });
    }
    if (onPinCanon) {
      actions.push({
        id: "canon",
        name: "Pin as canon",
        label: "Pin this passage as canon",
        hint: "Pin as canon: keep this passage (or your selected text) in front of the DM permanently",
        glyph: "tab-facts",
        icon: <Pin className="size-3.5" />,
        onSelect: () => onPinCanon(message),
      });
    }
    if (canIllustrate) {
      actions.push({
        id: "picture",
        name: message.generatedImage ? "Replace the picture" : "Add a picture",
        label: message.generatedImage ? "Replace the picture" : "Add a picture",
        hint: message.generatedImage
          ? "Replace picture: put an image of your own under this passage"
          : "Add a picture: put an image of your own under this passage",
        glyph: "tab-handout",
        icon: <ImagePlus className="size-3.5" />,
        busy: attaching,
        onSelect: () => pictureRef.current?.click(),
      });
    }
    if (onReplayAudio) {
      actions.push({
        id: "read",
        name: "Read aloud",
        label: "Read this passage aloud",
        hint: "Read aloud",
        glyph: "cue-horn",
        icon: <Volume2 className="size-3.5" />,
        busy: narrating,
        primary: true,
        onSelect: async () => {
          setNarrating(true);
          const error = await onReplayAudio(message.id);
          setNarrating(false);
          if (error) {
            void appNotice(error);
          }
        },
      });
    }
    actions.push(copyAction(message));
    if (onDispute) {
      actions.push(disputeAction(message, onDispute));
    }
    if (onReport) {
      actions.push(reportAction(message, onReport, true));
    }
    const menuActions = actions.map((action) => ({
      ...action,
      onSelect: () => {
        restoreSelection();
        action.onSelect();
      },
    }));
    // The picture on its way, or the reason it never came.
    const pictureSlot = scenePictureSlot(message, mediaStatus[message.id]);
    // Reroll takes: the counter only appears once a second one exists.
    const variants = message.variants ?? [];
    const variantIndex = message.variantIndex ?? 0;
    const title = message.speaker ? `${message.speaker.name}, through the DM` : "Dungeon Master";
    return (
      <div
        className="session-dm group animate-fade-up"
        onPointerDownCapture={(event) => {
          // React events cross portals: a press on a row of the open menu
          // arrives here too, after the selection is already gone.
          if (event.currentTarget.contains(event.target as Node)) {
            holdSelection();
          }
        }}
        onContextMenuCapture={(event) => {
          // The menu key has no press before it; a right-click was noted on
          // its press, before the browser cleared the selection.
          if (event.nativeEvent.button !== 2) {
            holdSelection();
          }
        }}
      >
        <ContextMenu items={toContextItems(menuActions)} label={title} className="session-dm-head">
          <SectionHead
            title={title}
            glyph="tab-dm"
            level="h4"
            aside={
              <>
                {variants.length >= 2 && onSelectVariant ? (
                  <span className="flex items-center gap-0.5 font-mono text-[10px] text-stone-500">
                    <button
                      type="button"
                      onClick={() => onSelectVariant(message, variantIndex - 1)}
                      disabled={variantIndex <= 0}
                      aria-label="Previous take"
                      className={cn(ui.iconAction, "-my-1.5 p-1 opacity-100 disabled:opacity-30")}
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    {variantIndex + 1} / {variants.length}
                    <button
                      type="button"
                      onClick={() => onSelectVariant(message, variantIndex + 1)}
                      disabled={variantIndex >= variants.length - 1}
                      aria-label="Next take"
                      className={cn(ui.iconAction, "-my-1.5 p-1 opacity-100 disabled:opacity-30")}
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                  </span>
                ) : null}
                <MessageActions actions={actions} menuActions={menuActions} menuLabel="Passage actions" />
              </>
            }
          />
        </ContextMenu>
        {canIllustrate ? (
          <input
            ref={pictureRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void attachPicture(file);
              }
              event.target.value = "";
            }}
          />
        ) : null}
        <div
          ref={bodyRef}
          className="session-dm-body"
          onContextMenu={(event) => {
            // Shift keeps the browser's own menu, as it does on the host.
            if (editing || event.shiftKey || !isMouseContextMenu(event)) {
              return;
            }
            // The menu lives on the heading's host; hand it the same event
            // at the same point, from inside the host so it counts as its own.
            const target = bodyRef.current?.parentElement?.querySelector(".session-dm-head > *");
            if (!target) {
              return;
            }
            event.preventDefault();
            target.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                button: 2,
                clientX: event.clientX,
                clientY: event.clientY,
              }),
            );
          }}
        >
          {editing && onEditSave ? (
            <InlineMessageEditor
              initial={message.content}
              onCancel={() => setEditing(false)}
              onSave={async (content) => {
                const failure = await onEditSave(message, content);
                if (!failure) {
                  setEditing(false);
                }
                return failure;
              }}
            />
          ) : (
            <DmContent content={message.content} rollsById={rollsById} sheetsById={sheetsById} cast={cast} lines={message.speech} speaker={message.speaker} />
          )}
          {message.generatedImage ? (
            <ImageLightbox
              src={message.generatedImage.url}
              alt={message.imageRequest?.prompt || "Scene"}
              className="ken-burns max-h-96 rounded-xl border border-stone-800"
              frameClassName="mt-3 overflow-hidden rounded-xl"
            />
          ) : pictureSlot ? (
            <MediaPlaceholder
              label="Illustrating the scene..."
              status={pictureSlot.status}
              fallbackStartedAt={message.createdAt}
            />
          ) : null}
          {narrationFailure ? (
            // The story carries on without the voice, but not silently
            // (issue 88): what went wrong, and a way to ask again.
            <p role="status" className="live-in mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-400/90">
              <VolumeX className="size-3.5 shrink-0" />
              <span className="min-w-0">This passage was not read aloud. {narrationFailure}</span>
              {onReplayAudio ? (
                <button
                  type="button"
                  disabled={narrating}
                  aria-busy={narrating}
                  onClick={async () => {
                    setNarrating(true);
                    const error = await onReplayAudio(message.id);
                    setNarrating(false);
                    if (error) {
                      void appNotice(error);
                    }
                  }}
                  className="motion-press rounded-md border border-amber-800/60 px-1.5 py-0.5 text-amber-200 hover:border-amber-600 disabled:opacity-60"
                >
                  {narrating ? "Trying…" : "Try again"}
                </button>
              ) : null}
            </p>
          ) : null}
          {(() => {
            // The message that introduced an area shows its map inline.
            // The map lives on the location row, so lead redraws and
            // layout revisions refresh here automatically.
            const location = message.locationId
              ? locationsById.get(message.locationId)
              : undefined;
            if (!location) {
              return null;
            }
            if (location.mapImage) {
              return (
                <figure className="mt-3 max-w-md">
                  <ImageLightbox
                    src={location.mapImage.url}
                    alt={`Map of ${location.name}`}
                    caption={location.name}
                    className="max-h-96 rounded-xl border border-stone-800"
                  />
                  <figcaption className="mt-1 text-xs text-stone-500">
                    {location.name}
                  </figcaption>
                </figure>
              );
            }
            // Still charting, or why it could not be (kept on the place, so
            // a reload does not wait for a map that is not coming).
            const slot = locationMapSlot(location, message.createdAt, mediaStatus[location.id]);
            return slot ? (
              <MediaPlaceholder
                label="Charting the area..."
                status={slot.status}
                fallbackStartedAt={message.createdAt}
              />
            ) : null;
          })()}
        </div>
      </div>
    );
  }
  if (blocked) {
    return <BlockedMessage />;
  }
  return (
    <PlayerMessage
      message={message}
      mine={mine}
      sheets={sheets}
      sheetsById={sheetsById}
      membersById={membersById}
      onReport={onReport}
    />
  );
});
