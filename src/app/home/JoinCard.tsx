"use client";

import { type FormEvent, type RefObject, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { navigateTo } from "@/lib/navigation";

// Joining someone else's table by its invite code. The quick tile above
// scrolls here and drops the cursor into the field through inputRef, so
// the card stays where a friend's "type it in at the bottom" points.
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
    <section id="join" className={cn(ui.card, "ornate scroll-mt-6 p-5")}>
      <h2 className="eyebrow mb-1 text-sm text-amber-200/90">Join with a room code</h2>
      <p className="mb-3 text-sm text-stone-500">
        A friend running a table gives you an eight-letter sigil.
      </p>
      <form onSubmit={join} className="flex flex-wrap items-center gap-3">
        {/* One real field does the typing, the pasting and the submitting; the
            boxes over it are only how the sigil is shown, so a keyboard, a
            paste and a password manager all behave as they always did. */}
        <label
          key={joinError ? `refused-${shakeKey}` : "calm"}
          className={cn("relative flex cursor-text gap-1.5", joinError && "motion-shake")}
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
                className={cn(
                  "flex h-11 w-8 items-center justify-center rounded-md border font-mono text-lg uppercase transition-[border-color,box-shadow,transform] duration-200 ease-snap sm:w-9",
                  ch
                    ? "border-amber-500/50 bg-amber-400/10 text-amber-100 shadow-[0_0_12px_rgba(212,171,58,0.15)]"
                    : "border-stone-700/70 bg-stone-950/80 text-stone-600",
                  next && "peer-focus:border-amber-400/80 peer-focus:shadow-[0_0_0_3px_rgba(212,171,58,0.18)]",
                )}
              >
                {ch ? <span className="motion-pop">{ch}</span> : null}
              </span>
            );
          })}
        </label>
        <button type="submit" disabled={joining} className={ui.btnSecondary}>
          {joining ? "Joining..." : "Join"}
        </button>
        {joinCode.length >= 8 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/assets/ui/wax-seal.webp" alt="" className="motion-pop size-10 object-contain drop-shadow-[0_3px_8px_rgba(4,2,12,0.6)]" />
        ) : null}
      </form>
      {joinError ? <p className="motion-shake mt-2 text-sm text-red-400">{joinError}</p> : null}
    </section>
  );
}
