"use client";

import { appConfirm } from "@/components/ui/ConfirmDialog";

import {
  Check,
  Copy,
  Globe,
  Link as LinkIcon,
  Loader2,
  QrCode,
  RefreshCw,
  Share2,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { buildShareLinks } from "@/lib/share-link";
import { shareSheet } from "@/lib/shell-host";
import { ui } from "@/lib/ui";
import { useShellShare } from "@/lib/use-shell-share";
import { Dialog } from "@/components/ui/Dialog";

// The QR for an invite link in a box that exists before the code does: the
// slot is a fixed square with the skeleton shimmer, so neither the dialog nor
// the lobby card moves when the picture lands. Dark ink on a clear ground; the
// parchment tile behind it comes from .lobby-qr (src/app/styles/lobby.css).
// The QR carries the /j interstitial so a phone camera lands on a page that
// can open the app or fall back to the browser.
export function InviteQr({
  url,
  size = "8.5rem",
  className,
}: {
  url: string;
  // A CSS length; the dialog asks for 12rem (192 px), the lobby card less.
  size?: string;
  className?: string;
}) {
  const [made, setMade] = useState<{ url: string; data: string } | null>(null);
  useEffect(() => {
    if (!url) {
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { width: 480, margin: 2, color: { dark: "#1b1208ff", light: "#00000000" } })
      .then((data) => {
        if (!cancelled) setMade({ url, data });
      })
      .catch(() => {
        if (!cancelled) setMade(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  // A picture made for an older link (the code was rotated, the tunnel came
  // up) is not shown for the new one.
  const data = made && made.url === url ? made.data : "";
  return (
    <div
      className={cn("lobby-qr", className)}
      style={{ "--qr": size } as React.CSSProperties}
      data-ready={data ? "" : undefined}
    >
      {data ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data} alt={`QR code for invite link ${url}`} />
      ) : (
        <div className="skeleton-block" role="status" aria-label="Drawing the QR code" />
      )}
    </div>
  );
}

// The room code in sigil lettering: one plate a character, arriving in turn.
// The whole code is still one selectable, readable string for a screen reader.
export function RoomCodeSigils({ code, size = "md" }: { code: string; size?: "md" | "lg" }) {
  return (
    <p className="lobby-sigils" data-size={size} aria-label={`Room code ${code.split("").join(" ")}`}>
      {code.split("").map((char, index) => (
        <span
          // The index is the identity here: a rotated code replays the plates.
          key={`${code}-${index}`}
          aria-hidden="true"
          className="lobby-sigil"
          style={{ "--i": index } as React.CSSProperties}
        >
          {char}
        </span>
      ))}
    </p>
  );
}

// The tick a copy button swaps to: it pops and lets go of a gold ring.
export function CopyTick() {
  return (
    <span className="lobby-tick">
      <Check className="size-4" />
    </span>
  );
}

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
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");
  // Inside the desktop or Android app, on the app's own world: the tunnel
  // that lets friends anywhere join. Nothing here starts it. The row below
  // is the switch, and the host decides when to be online.
  const hosting = useShellShare(false);
  const shareState = hosting.status?.state ?? "stopped";
  const shareUrl = hosting.status?.url ?? "";

  // A host sharing their world through a tunnel plays on 127.0.0.1, an
  // address guests cannot reach. The server's publicUrl (set by the apps
  // while a tunnel runs, or by an admin behind a reverse proxy) is the one
  // that belongs in links and QR codes; it is re-read whenever the tunnel
  // comes or goes.
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
  }, [open, shareState, shareUrl]);

  const { joinUrl, appUrl } = buildShareLinks({ publicOrigin, inviteCode });

  async function copy(kind: "link" | "code") {
    const worked = await copyText(kind === "link" ? appUrl : inviteCode);
    setError(worked ? "" : "Copying failed. Select the text and copy it by hand.");
    if (worked) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    }
  }

  // The browser's share sheet where it has one; inside the Android app,
  // the app's (its webview has no Web Share API). Nothing on desktop.
  const sheet = shareSheet();

  async function share() {
    if (!sheet) return;
    const title = campaignTitle || "my campaign";
    await sheet({
      title: `Join ${title}`,
      text: `Join ${campaignTitle ? `"${campaignTitle}"` : "my campaign"} on Open Dungeon Master`,
      url: appUrl,
    });
  }

  async function regenerate() {
    if (
      !await appConfirm(
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


  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite players"
      icon={<QrCode className="size-4 text-amber-300" />}
      width="w-[min(92vw,26rem)]"
    >
      {/* Scan this first, the words second, the ways to send it third, and
          the one destructive act last and quiet. */}
      <div className="flex flex-col items-center gap-4">
        {hosting.supported && hosting.status ? (
          <ShareOnlineRow status={hosting.status} onStart={hosting.start} onStop={hosting.stop} />
        ) : null}
        <div className="flex flex-col items-center gap-1.5">
          <InviteQr url={open ? appUrl : ""} size="12rem" />
          <p className="eyebrow text-[10px] text-stone-400">Scan to join</p>
        </div>
        <div className="flex w-full flex-col items-center text-center">
          <p className="eyebrow mb-1.5 text-[10px] text-amber-200/70">Room code</p>
          <RoomCodeSigils code={inviteCode} size="lg" />
          <p className="mt-2 text-xs text-stone-400">
            While you are sharing, a friend can type this code into the app and land here.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-stone-500">{joinUrl}</p>
        </div>
        <span className="h-px w-full bg-gradient-to-r from-transparent via-amber-400/40 to-transparent motion-rule" aria-hidden="true" />
        <div className="flex w-full flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => copy("link")}
            data-copied={copied === "link" ? "" : undefined}
            className={cn(ui.btnSmall, "lobby-copy")}
          >
            {copied === "link" ? <CopyTick /> : <LinkIcon className="size-4" />}
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={() => copy("code")}
            data-copied={copied === "code" ? "" : undefined}
            className={cn(ui.btnSmall, "lobby-copy")}
          >
            {copied === "code" ? <CopyTick /> : <Copy className="size-4" />}
            {copied === "code" ? "Copied" : "Copy code"}
          </button>
          {sheet ? (
            <button type="button" onClick={() => void share()} className={ui.btnSmall}>
              <Share2 className="size-4" /> Share
            </button>
          ) : null}
        </div>
        {/* A polite region, so the confirmation is heard as well as seen. */}
        <p role="status" className="sr-only">
          {copied === "link" ? "Invite link copied." : copied === "code" ? "Room code copied." : ""}
        </p>
        {error ? <p className="motion-shake text-sm text-red-400">{error}</p> : null}
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

// The app's tunnel, as seen from the invite dialog: opening, open at an
// address, failed, or off. Links and the QR above follow the address.
function ShareOnlineRow({
  status,
  onStart,
  onStop,
}: {
  status: { state: "stopped" | "starting" | "running" | "error"; url: string; error: string; lanUrl: string };
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  if (status.state === "starting") {
    return (
      <div className="flex w-full animate-fade-up items-center gap-2 rounded-lg border border-stone-700/60 bg-stone-900/60 px-3 py-2 text-sm text-stone-300">
        <Loader2 className="size-4 shrink-0 animate-spin text-amber-300" />
        <span>Opening a public address so friends anywhere can join...</span>
      </div>
    );
  }
  if (status.state === "running") {
    return (
      <div className="flex w-full flex-col gap-1.5 rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-emerald-200">
          <Globe className="size-4 shrink-0" />
          <span className="font-medium">Shared online</span>
          <button
            type="button"
            onClick={() => void onStop()}
            className="ml-auto text-xs text-stone-400 transition-colors hover:text-red-400"
          >
            Stop sharing
          </button>
        </div>
        <p className="break-all font-mono text-xs text-stone-300">{status.url}</p>
        <p className="text-xs text-stone-500">
          Friends anywhere can join with the link below while the app runs.
        </p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-stone-700/60 bg-stone-900/60 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-stone-300">
        <Globe className="size-4 shrink-0 text-stone-500" />
        <span>{status.state === "error" ? "Sharing online failed" : "Not shared online"}</span>
        <button type="button" onClick={() => void onStart()} className={cn(ui.btnSmall, "ml-auto")}>
          {status.state === "error" ? "Try again" : "Share online"}
        </button>
      </div>
      <p className="text-xs text-stone-500">
        {status.state === "error"
          ? status.error
          : status.lanUrl
            ? `Only friends on your Wi-Fi can reach ${status.lanUrl} until you share online.`
            : "Share online and friends anywhere can join with the link below."}
      </p>
    </div>
  );
}
