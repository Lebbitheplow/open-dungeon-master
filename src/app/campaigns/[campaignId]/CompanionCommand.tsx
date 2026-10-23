"use client";

import { useState, type CSSProperties } from "react";
import type { CampaignMember } from "@/lib/campaign-types";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Who takes an AI companion's turns in a fight (src/lib/dm/companion-command.ts),
// on the companion's own card: the DM, or a player at the table. Out of fights
// the DM always plays them. Whoever runs the story picks; everyone else reads
// who it is. A sliding pill marks the pick (src/lib/motion/pill.ts), as the
// board's move modes do.
export function CompanionCommand({
  campaignId,
  sheet,
  sheets,
  members,
  meUserId,
  canChoose,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  sheets: CharacterSheet[];
  members: CampaignMember[];
  meUserId: string;
  // Whoever runs the story: the party lead at a table the AI runs, the DM
  // where a person does.
  canChoose: boolean;
}) {
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The players who could command: everyone at the table with a character of
  // their own (the DM seats hold none).
  const players = members.filter((member) => sheets.some((entry) => !entry.isCompanion && entry.userId === member.userId));
  const commander = players.some((member) => member.userId === sheet.commandedBy) ? sheet.commandedBy ?? null : null;
  const nameOf = (userId: string) => (userId === meUserId ? "You" : members.find((member) => member.userId === userId)?.username ?? "A player");
  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: "The DM" },
    ...players.map((member) => ({ id: member.userId, label: nameOf(member.userId) })),
  ];
  const hint = commander
    ? `${commander === meUserId ? "You take" : `${nameOf(commander)} takes`} ${sheet.name}'s turns in fights. Out of fights the DM plays ${sheet.name}.`
    : `The DM plays ${sheet.name}'s turns in fights, as everywhere else.`;

  async function choose(next: string | null) {
    if (next === commander || sending !== null) {
      return;
    }
    setSending(next ?? "");
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/companions/${sheet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandedBy: next }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not change who commands them.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="reveal mt-2 space-y-1" data-companion-command={sheet.id}>
      {canChoose ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="radiogroup"
          aria-label={`Who takes ${sheet.name}'s turns in fights`}
          data-pill-group=""
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-stone-500">In fights</span>
          {options.map((option, index) => {
            const on = option.id === commander;
            return (
              <button
                key={option.id ?? "dm"}
                type="button"
                role="radio"
                aria-checked={on}
                data-on={on ? "" : undefined}
                disabled={sending !== null}
                style={{ "--i": index } as CSSProperties}
                onClick={() => void choose(option.id)}
                className={cn(
                  "hand-option motion-press motion-pop inline-flex min-h-10 items-center rounded-full border px-2.5 text-[11px] disabled:opacity-60 sm:min-h-8",
                  on ? "border-amber-400/70 bg-amber-500/20 text-amber-100" : "border-stone-700 text-stone-400 hover:border-amber-500/60",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <p key={commander ?? "dm"} className="animate-fade-up text-[11px] leading-4 text-stone-400">
        {hint}
      </p>
      {error ? (
        <p role="alert" className="motion-shake text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
