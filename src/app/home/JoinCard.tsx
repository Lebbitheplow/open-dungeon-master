"use client";

import { type FormEvent, type RefObject, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// Joining someone else's table by its invite code. The quick tile above
// scrolls here and drops the cursor into the field through inputRef, so
// the card stays where a friend's "type it in at the bottom" points.
export function JoinCard({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault();
    setJoining(true);
    setJoinError("");
    try {
      const response = await fetch("/api/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: joinCode.trim().toUpperCase() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setJoinError(data.error || "Could not join.");
        return;
      }
      window.location.href = `/campaigns/${data.campaign.id}`;
    } finally {
      setJoining(false);
    }
  }

  return (
    <section id="join" className={cn(ui.card, "ornate scroll-mt-6 p-5")}>
      <h2 className="eyebrow mb-1 text-sm text-amber-200/90">Join with a room code</h2>
      <p className="mb-3 text-sm text-stone-500">
        A friend running a table gives you an eight-letter sigil.
      </p>
      <form onSubmit={join} className="flex gap-2">
        <input
          ref={inputRef}
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value)}
          placeholder="K7WQ2MNP"
          required
          maxLength={12}
          className={cn(ui.input, "w-52 font-mono uppercase tracking-[0.25em]")}
        />
        <button type="submit" disabled={joining} className={ui.btnSecondary}>
          {joining ? "Joining..." : "Join"}
        </button>
      </form>
      {joinError ? <p className="mt-2 text-sm text-red-400">{joinError}</p> : null}
    </section>
  );
}
