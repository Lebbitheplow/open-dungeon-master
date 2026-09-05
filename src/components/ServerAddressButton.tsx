"use client";

import { Check, Copy, QrCode, X } from "lucide-react";
import { usePathname } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { shareableAddresses } from "@/lib/server-address";
import { ui } from "@/lib/ui";

// The little button in the corner of every page: tap it and the server's
// address comes up as a QR code and as text with a copy button. The client
// apps' "Add a server" screen scans the code; a phone camera opens the same
// address in a browser. Nothing here is campaign-specific, which is what
// separates it from the invite dialog: this is how someone adds the SERVER,
// the room code is how they join a table on it.
//
// The address on offer is the server's public URL when one is configured, a
// local-network address when the host is on 127.0.0.1, and otherwise the
// address this tab is on (src/lib/server-address.ts). More than one and the
// host picks.
//
// Not shown inside a campaign: the table's composer and dice live in that
// corner, and the lobby's room-code card already carries a QR that names
// this server along with the room.
export function ServerAddressButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [picked, setPicked] = useState("");
  // The rendered code remembers which address it is for, so a stale one is
  // never shown beside a newly picked address.
  const [qr, setQr] = useState<{ address: string; dataUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverName, setServerName] = useState("");

  // Fetched on open, not on mount: most page views never touch this.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const current = window.location.origin;
    fetch("/api/server/addresses")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { serverName?: string; publicUrl?: string; lanUrls?: string[] } | null) => {
        if (cancelled) {
          return;
        }
        const list = shareableAddresses({
          publicUrl: data?.publicUrl,
          lanUrls: data?.lanUrls,
          current,
        });
        setAddresses(list);
        setPicked((previous) => (list.includes(previous) ? previous : (list[0] ?? "")));
        setServerName(data?.serverName ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setAddresses([current]);
          setPicked(current);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!picked) {
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(picked, {
      margin: 1,
      width: 224,
      color: { dark: "#1c1917", light: "#fef3c7" },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQr({ address: picked, dataUrl });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const qrDataUrl = qr && qr.address === picked ? qr.dataUrl : "";

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function copy() {
    if (await copyText(picked)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (pathname?.startsWith("/campaigns/")) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end px-4 pb-4"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {open ? (
          <div
            role="dialog"
            aria-label="This server's address"
            className={cn(ui.card, "ornate w-72 border-amber-400/30 p-4 shadow-glow-gold")}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={ui.sectionEyebrow}>This server</p>
                <p className="truncate font-display text-sm tracking-wide text-amber-50">
                  {serverName || "Open Dungeon Master"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-stone-400 hover:bg-stone-900"
              >
                <X className="size-4" />
              </button>
            </div>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={`QR code for ${picked}`}
                className="mx-auto size-56 rounded-lg border border-amber-400/20"
              />
            ) : (
              <div className="mx-auto flex size-56 items-center justify-center rounded-lg border border-dashed border-stone-700 text-xs text-stone-500">
                Preparing the code...
              </div>
            )}
            {addresses.length > 1 ? (
              <select
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                aria-label="Which address to share"
                className="mt-3 w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200"
              >
                {addresses.map((address) => (
                  <option key={address} value={address}>
                    {address}
                  </option>
                ))}
              </select>
            ) : null}
            <p className="mt-3 break-all font-mono text-xs text-amber-100">{picked}</p>
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!picked}
              className={cn(ui.btnSmall, "mt-2 w-full justify-center")}
            >
              {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <p className="mt-2 text-[11px] leading-4 text-stone-500">
              Scan with the Open Dungeon Master app to add this server, or with a phone camera
              to open it in a browser.
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "Hide this server's address" : "Show this server's address"}
          title="This server's address and QR code"
          className="flex size-10 items-center justify-center rounded-full border border-amber-500/30 bg-stone-950/90 text-amber-200 shadow-glow-gold backdrop-blur transition-colors hover:border-amber-400/60 hover:text-amber-100"
        >
          <QrCode className="size-5" />
        </button>
      </div>
    </div>
  );
}
