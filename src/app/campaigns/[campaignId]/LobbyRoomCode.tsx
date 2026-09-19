"use client";

import { Copy, Link as LinkIcon, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { buildShareLinks } from "@/lib/share-link";
import { CopyTick, InviteQr, InviteShareDialog, RoomCodeSigils } from "@/components/InviteShareDialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { ui } from "@/lib/ui";

// The room code card: the QR on the card itself (scanning is the fastest way
// in, so it is not one click away), the code in sigil lettering, copy code,
// copy link, and the share dialog with the tunnel row and the new-code act.
// Hidden by the lobby for solo campaigns, which have nobody to invite.
export function LobbyRoomCode({
  campaignId,
  campaignTitle,
  inviteCode,
  canRegenerate,
  shareUrl,
  className,
  style,
}: {
  campaignId: string;
  campaignTitle: string;
  inviteCode: string;
  // Only the lead may mint a new code (InviteShareDialog).
  canRegenerate: boolean;
  // The shell tunnel's public address, or "" when there is none. Only its
  // changes matter here: they are the moment the server's publicUrl may
  // have changed too.
  shareUrl: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [publicOrigin, setPublicOrigin] = useState("");

  // Same reason as InviteShareDialog: a host sharing their world through a
  // tunnel plays on 127.0.0.1, an address guests cannot reach, so links
  // prefer the server's publicUrl, re-read whenever the tunnel comes or goes.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => response.json())
      .then((data: { publicUrl?: string }) => {
        if (!cancelled && typeof data.publicUrl === "string") {
          setPublicOrigin(data.publicUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  // The copied link is the /j interstitial: it works whether the recipient
  // has the app or only a browser. The readable /join form stays on screen.
  const shareLinks = buildShareLinks({ publicOrigin, inviteCode });

  async function copyInvite() {
    if (await copyText(inviteCode)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function copyLink() {
    if (await copyText(shareLinks.appUrl)) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    }
  }

  return (
    <section
      className={cn(ui.card, "lobby-code ornate mb-6 p-4 shadow-glow-gold sm:p-5", className)}
      style={style}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/ui/wax-seal-gold.webp" alt="" className="lobby-code-seal" />
      <div className="lobby-head mb-3 pr-12">
        <GameIcon icon={{ kind: "glyph", key: "tab-friends" }} size="size-7" />
        <h2 className="lobby-head-title">Room code</h2>
        <span className="lobby-head-rule motion-rule" aria-hidden="true" />
      </div>
      <div className="flex flex-col items-center gap-4 min-[420px]:flex-row min-[420px]:items-start">
        <div className="flex flex-col items-center gap-1">
          <InviteQr url={shareLinks.appUrl} />
          <p className="eyebrow text-[9px] text-stone-500">Scan to join</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 min-[420px]:items-start">
          <RoomCodeSigils code={inviteCode} />
          <div className="flex flex-wrap items-center justify-center gap-2 min-[420px]:justify-start">
            <button
              type="button"
              onClick={copyInvite}
              data-copied={copied ? "" : undefined}
              className={cn(ui.btnSmall, "lobby-copy")}
            >
              {copied ? <CopyTick /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Code"}
            </button>
            <button
              type="button"
              onClick={copyLink}
              data-copied={linkCopied ? "" : undefined}
              className={cn(ui.btnSmall, "lobby-copy")}
            >
              {linkCopied ? <CopyTick /> : <LinkIcon className="size-4" />}
              {linkCopied ? "Copied" : "Link"}
            </button>
            <button type="button" onClick={() => setSharing(true)} className={ui.btnSmall}>
              <QrCode className="size-4" /> Share
            </button>
          </div>
          <p className="break-all text-center font-mono text-xs text-stone-500 min-[420px]:text-left">
            {shareLinks.joinUrl}
          </p>
        </div>
      </div>
      <p role="status" className="sr-only">
        {copied ? "Room code copied." : linkCopied ? "Invite link copied." : ""}
      </p>
      <InviteShareDialog
        open={sharing}
        onOpenChange={setSharing}
        campaignId={campaignId}
        campaignTitle={campaignTitle}
        inviteCode={inviteCode}
        canRegenerate={canRegenerate}
      />
    </section>
  );
}
