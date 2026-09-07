"use client";

import { Check, Copy, Link as LinkIcon, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { buildShareLinks } from "@/lib/share-link";
import { InviteShareDialog } from "@/components/InviteShareDialog";
import { ui } from "@/lib/ui";

// The room code card: the code itself, copy code, copy link, and the share
// dialog with the QR. Hidden by the lobby for solo campaigns, which have
// nobody to invite.
export function LobbyRoomCode({
  campaignId,
  campaignTitle,
  inviteCode,
  canRegenerate,
  shareUrl,
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
    <section className={cn(ui.card, "ornate mb-6 border-amber-400/30 px-5 py-4 shadow-glow-gold")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={ui.sectionEyebrow}>Room code</p>
          <p className="font-mono text-xl tracking-[0.3em] text-amber-100">{inviteCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copyInvite} className={ui.btnSmall}>
            {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Code"}
          </button>
          <button type="button" onClick={copyLink} className={ui.btnSmall}>
            {linkCopied ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            {linkCopied ? "Copied" : "Link"}
          </button>
          <button type="button" onClick={() => setSharing(true)} className={ui.btnSmall}>
            <QrCode className="size-4" /> Share
          </button>
        </div>
      </div>
      <p className="mt-1.5 break-all font-mono text-xs text-stone-500">{shareLinks.joinUrl}</p>
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
