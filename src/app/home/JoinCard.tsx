"use client";

import { type FormEvent, type RefObject, useState } from "react";
import { cn } from "@/lib/cn";
import { navigateTo } from "@/lib/navigation";

// Joining someone else's table by its invite code: "join by sigil". The
// menu line above scrolls here and drops the cursor into the field through
// inputRef, so the panel stays where a friend's "type it in at the bottom"
// points.
export function JoinCard({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  // Bumped on each refusal so the row shakes again for a second wrong code.
  const [shakeKey, setShakeKey] = useState(0);

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
        setShakeKey((n) => n + 1);
        return;
      }
      navigateTo(`/campaigns/${data.campaign.id}`);
    } finally {
      setJoining(false);
    }
  }

  return (
    <section id="join" className="ts-join ts-panel scroll-mt-6" aria-label="Join with a room code">
      <span className="ts-bracket ts-bracket-tl" aria-hidden="true" />
      <span className="ts-bracket ts-bracket-br" aria-hidden="true" />
      <h2 className="ts-below-eyebrow">Join by sigil</h2>
      <p className="ts-below-lede">A friend running a table gives you an eight-letter sigil.</p>
      <form onSubmit={join} className="ts-join-form">
        {/* One real field does the typing, the pasting and the submitting; the
            boxes over it are only how the sigil is shown, so a keyboard, a
            paste and a password manager all behave as they always did. */}
        <label
          key={joinError ? `refused-${shakeKey}` : "calm"}
          className={cn("ts-sigil", joinError && "motion-shake")}
          aria-label="Room code"
        >
          <input
            ref={inputRef}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.replace(/\s+/g, ""))}
            required
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="peer absolute inset-0 z-10 w-full cursor-text opacity-0"
          />
          {Array.from({ length: Math.max(8, joinCode.length) }, (_, i) => {
            const ch = joinCode[i]?.toUpperCase();
            const next = i === joinCode.length;
            return (
              <span
                key={i}
                aria-hidden="true"
                className={cn("ts-sigil-box", ch && "ts-sigil-box-lit", next && "ts-sigil-box-next")}
              >
                {ch ? <span className="motion-pop">{ch}</span> : null}
              </span>
            );
          })}
        </label>
        <button type="submit" disabled={joining} className="ts-ghost motion-press">
          {joining ? "Joining..." : "Join"}
        </button>
        {joinCode.length >= 8 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/assets/ui/wax-seal.webp" alt="" className="motion-pop ts-seal" />
        ) : null}
      </form>
      {joinError ? <p className="motion-shake ts-error">{joinError}</p> : null}
    </section>
  );
}
