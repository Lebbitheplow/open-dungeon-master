"use client";

import { Check, Copy, Link as LinkIcon, QrCode, RefreshCw, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { buildShareLinks } from "@/lib/share-link";
import { ui } from "@/lib/ui";
import { Dialog } from "@/components/ui/Dialog";

// One place to hand an invite to someone: QR for a phone camera, the link
// for chat apps, the bare code for typing, and the OS share sheet where the
// browser has one (that covers "share to social media" on every phone).
// The QR, the copy button, and the share sheet all carry the /j
// interstitial link (buildShareLinks), which knows both the server and the
// campaign and works whether or not the recipient has the app. The direct
// /join link stays visible as text so people can read where it leads.
export function InviteShareDialog({
  open,
  onOpenChange,
  campaignId,
  campaignTitle,
  inviteCode,
  canRegenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  campaignTitle?: string;
  inviteCode: string;
  canRegenerate: boolean;
}) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");

  // A host sharing their world through a tunnel plays on 127.0.0.1, an
  // address guests cannot reach. The server's publicUrl (set by the desktop
  // app while a tunnel runs, or by an admin behind a reverse proxy) is the
  // one that belongs in links and QR codes.
  useEffect(() => {
    if (!open) {
      return;
    }
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
  }, [open]);

  const { joinUrl, appUrl } = buildShareLinks({ publicOrigin, inviteCode });

  useEffect(() => {
    if (!open || !appUrl) {
      return;
    }
    // Dark-on-light keeps the code scannable; a stone border comes from the
    // wrapper, not the image. The QR carries the /j interstitial so a phone
    // camera lands on a page that can open the app or fall back to the
    // browser.
    QRCode.toDataURL(appUrl, { width: 480, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [open, appUrl]);

  async function copy(kind: "link" | "code") {
    const worked = await copyText(kind === "link" ? appUrl : inviteCode);
    setError(worked ? "" : "Copying failed. Select the text and copy it by hand.");
    if (worked) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    }
  }

  async function share() {
    const title = campaignTitle || "my campaign";
    try {
      await navigator.share({
        title: `Join ${title}`,
        text: `Join ${campaignTitle ? `"${campaignTitle}"` : "my campaign"} on Open Dungeon Master`,
        url: appUrl,
      });
    } catch {
      // Dismissed the sheet; nothing to do.
    }
  }

  async function regenerate() {
    if (
      !window.confirm(
        "Generate a new invite code? Every link and QR shared so far stops working.",
      )
    ) {
      return;
    }
    setRegenerating(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/invite`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not regenerate the invite code.");
      }
      // The campaign_updated stream event delivers the new code; the
      // inviteCode prop re-renders this dialog with it.
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRegenerating(false);
    }
  }

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite players"
      icon={<QrCode className="size-4 text-amber-300" />}
      width="w-[min(92vw,26rem)]"
    >
      <div className="flex flex-col items-center gap-4">
        {qrDataUrl ? (
          <div className="rounded-xl border border-stone-700/60 bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={`QR code for invite link ${appUrl}`} className="size-48" />
          </div>
        ) : null}
        <div className="w-full text-center">
          <p className="eyebrow text-[10px] text-amber-200/70">Room code</p>
          <p className="font-mono text-2xl tracking-[0.3em] text-amber-100">{inviteCode}</p>
          <p className="mt-1 break-all font-mono text-xs text-stone-500">{joinUrl}</p>
        </div>
        <div className="flex w-full flex-wrap justify-center gap-2">
          <button type="button" onClick={() => copy("link")} className={ui.btnSmall}>
            {copied === "link" ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
          <button type="button" onClick={() => copy("code")} className={ui.btnSmall}>
            {copied === "code" ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied === "code" ? "Copied" : "Copy code"}
          </button>
          {canNativeShare ? (
            <button type="button" onClick={share} className={ui.btnSmall}>
              <Share2 className="size-4" /> Share
            </button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {canRegenerate ? (
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-red-400 disabled:opacity-50",
            )}
            title="Invalidate every shared link and QR by rotating the code"
          >
            <RefreshCw className={cn("size-3.5", regenerating && "animate-spin")} />
            New code (kills old links)
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
