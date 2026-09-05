"use client";

import { Flag, Loader2, ShieldBan } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Dialog } from "@/components/ui/Dialog";

export type ReportTarget = {
  // The message being flagged, or nothing when a player is reported as such.
  messageId?: string;
  // The author, when there is one to block. DM passages have no user.
  userId?: string;
  authorType: "player" | "dm";
  // What the dialog calls the thing: a character name, or "the Dungeon Master".
  label: string;
  // Open straight on the block confirmation, no report.
  mode?: "report" | "block";
};

const REASONS: Array<{ value: string; label: string }> = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "sexual", label: "Sexual content" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "violence", label: "Graphic violence or threats" },
  { value: "spam", label: "Spam or off topic" },
  { value: "other", label: "Something else" },
];

// Flags a passage, a message or a player to this server's admins, with the
// option to block the player at the same time. There is no central service,
// so the operator of the server the player chose is who reads the report.
export function ReportDialog({
  campaignId,
  target,
  onClose,
  onBlocked,
}: {
  campaignId: string;
  target: ReportTarget | null;
  onClose: () => void;
  // The block landed; the caller hides that player's messages at once.
  onBlocked?: (userId: string) => void;
}) {
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const blockOnly = target?.mode === "block";

  function close() {
    setReason("harassment");
    setDetails("");
    setBlock(false);
    setError("");
    setDone("");
    onClose();
  }

  async function blockUser(userId: string): Promise<boolean> {
    const response = await fetch("/api/profile/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Could not block that player.");
      return false;
    }
    onBlocked?.(userId);
    return true;
  }

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      if (blockOnly) {
        if (target.userId && (await blockUser(target.userId))) {
          setDone(`${target.label} is blocked. Their messages are hidden from you, and neither of you can message or friend the other.`);
        }
        return;
      }
      const response = await fetch(`/api/campaigns/${campaignId}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: target.messageId,
          userId: target.userId,
          reason,
          details,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not send the report.");
        return;
      }
      if (block && target.userId && !(await blockUser(target.userId))) {
        return;
      }
      setDone(
        block && target.userId
          ? `Reported, and ${target.label} is blocked. The admins of this server will review it.`
          : "Reported. The admins of this server will review it.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => !open && close()}
      title={blockOnly ? `Block ${target?.label ?? ""}` : `Report ${target?.label ?? ""}`}
      icon={blockOnly ? <ShieldBan className="size-4 text-red-300" /> : <Flag className="size-4 text-amber-300" />}
    >
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-stone-300">{done}</p>
          <div className="flex justify-end">
            <button type="button" onClick={close} className={ui.btnPrimary}>
              Done
            </button>
          </div>
        </div>
      ) : blockOnly ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-stone-400">
            Blocking hides {target?.label}&apos;s table messages from you on this server, and
            stops either of you from opening a private chat or sending a friend request.
            You can undo it any time from Account settings.
          </p>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={ui.btnSmall} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className={cn(ui.btnPrimary, "from-red-200 via-red-300 to-red-500 text-red-950")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldBan className="size-4" />}
              Block
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-stone-400">
            {target?.authorType === "dm"
              ? "This flags the passage to the admins of this server. Generated narration is only as good as the model behind it, and this is how the operator finds out when it crosses a line."
              : "This flags the message to the admins of this server, who can act on it. The player is not told who reported them."}
          </p>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs uppercase tracking-wide text-stone-500">Reason</legend>
            {REASONS.map((entry) => (
              <label
                key={entry.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-stone-300"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={entry.value}
                  checked={reason === entry.value}
                  onChange={() => setReason(entry.value)}
                  className="accent-amber-400"
                />
                {entry.label}
              </label>
            ))}
          </fieldset>
          <label className="block text-xs text-stone-400">
            Anything the admins should know (optional)
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={3}
              maxLength={2000}
              className={cn(ui.input, "mt-1 resize-y")}
            />
          </label>
          {target?.userId ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={block}
                onChange={(event) => setBlock(event.target.checked)}
                className="accent-amber-400"
              />
              Also block {target.label}
            </label>
          ) : null}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={ui.btnSmall} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />}
              Send report
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
