"use client";

import { Loader2, Scale } from "lucide-react";
import { useState } from "react";
import { ui } from "@/lib/ui";
import { Dialog } from "@/components/ui/Dialog";
import { DISPUTE_REASON_MAX } from "@/lib/dm/dispute-logic";

// A player objects to a passage the AI narrated: a line on why, then
// whoever steers the story upholds it, overrules it or puts it to the
// table (RulingBar.tsx). The passage itself is not changed here; undo and
// revert-turn are the steerer's.
export function DisputeDialog({
  campaignId,
  messageId,
  onClose,
}: {
  campaignId: string;
  messageId: string | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setReason("");
    setError("");
    onClose();
  }

  async function submit() {
    if (!messageId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/disputes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, reason }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not raise the dispute.");
        return;
      }
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(messageId)}
      onOpenChange={(open) => !open && close()}
      title="Dispute this ruling"
      icon={<Scale className="size-4 text-amber-300" />}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-stone-400">
          Say what the narrator got wrong: a hit that should have missed, a rule misread, the
          wrong target. Whoever steers the story will uphold it, overrule it, or put it to the
          table. The fix comes after the ruling.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">Why</span>
          <textarea
            className={ui.input}
            rows={3}
            maxLength={DISPUTE_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="The goblin rolled a 7 against AC 16 and still hit."
          />
        </label>
        {error ? <p className="motion-shake text-sm text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={ui.btnSmall} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={submit} className={ui.btnPrimary} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}
            Dispute
          </button>
        </div>
      </div>
    </Dialog>
  );
}
