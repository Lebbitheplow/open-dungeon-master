"use client";

import { Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { CopyLine } from "@/components/CopyLine";
import { ui } from "@/lib/ui";

// Shown with a new connection that can play one campaign, on a server whose
// admin turned poll links on: the other way to wake an agent, for one that
// nothing can send requests to (a hosted assistant whose hooks can only check
// a URL). One click makes the link; like the token, it is shown once
// (docs/player-webhooks.md).
export function PlayerPollLinkSetup({ grantId, characterName }: { grantId: string; characterName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");

  async function make() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/profile/agents/${encodeURIComponent(grantId)}/poll-link`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not make a poll link.");
        return;
      }
      setLink(String(data.url ?? ""));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-stone-800 p-3">
      <p className="text-sm text-stone-200">Or: a poll link, for an agent nothing can send requests to</p>
      <p className="text-xs text-stone-500">
        If {characterName}&apos;s agent cannot take incoming requests (a hosted assistant whose hooks can only check a
        URL), give its hook this link to check every minute or so. It answers whether {characterName} has something to do
        now. Wake the agent when <code>wake</code> is true and <code>fingerprint</code> differs from the one it last woke the
        agent for. Use this or a receiver, not both.
      </p>
      {link ? (
        <div className="space-y-1">
          <CopyLine text={link} label="the poll link" />
          <p className="text-xs text-amber-200">
            Shown once. The link is the secret: keep it in the hook&apos;s settings, not in a chat. If your hero falls and you
            bring in another, it wakes the agent for the new one. Revoking this connection stops it; a new one from Poll link
            on the connection&apos;s row replaces it, and the row says if it ever stops on its own.
          </p>
        </div>
      ) : (
        <button type="button" className={ui.btnSmall} onClick={() => void make()} disabled={busy} aria-busy={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Make a poll link
        </button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
