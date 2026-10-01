"use client";

import { Check, Loader2 } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { replayAnimation } from "@/lib/motion/replay";
import { featureChoices } from "@/lib/battlemap/hand-subclass";
import { otherSpeedsLine } from "@/components/sheet/sheet-state";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Flying and swimming speeds a subclass grants (SheetDerived.speeds), as
// chips under the vitals; nothing when the character has none.
export function OtherSpeeds({ speeds }: { speeds: { fly?: number; swim?: number } | undefined }) {
  const lines = otherSpeedsLine(speeds);
  if (!lines.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 stagger-pop">
      {lines.map((line, index) => (
        <span
          key={line}
          style={{ "--i": index } as CSSProperties}
          className="rounded-full border border-sky-700/50 bg-sky-950/40 px-2 py-0.5 text-[11px] text-sky-200"
        >
          {line}
        </span>
      ))}
    </div>
  );
}

const titleCase = (value: string) => value.replace(/\b\w/g, (c) => c.toUpperCase());

// The once-chosen options of the subclass features the character holds
// (Totem Spirit, Aspect of the Beast, Totemic Attunement, Transmuter's Stone,
// Elemental Gift, Armor Model). The engine takes the choice through
// use_resource with the option as the variant, outside a fight
// (src/lib/srd/authored-effects.ts); the player's pick is posted as their
// action with that card, and the route's refusal is shown as it is written.
export function FeatureChoicePicker({
  sheet,
  mine,
  inCombat,
}: {
  sheet: CharacterSheet;
  mine: boolean;
  inCombat: boolean;
}) {
  const choices = featureChoices(sheet);
  const campaignId = sheet.campaignId;
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalRef = useRef<HTMLParagraphElement>(null);
  if (!choices.length) return null;

  async function choose(spend: string, option: string) {
    setBusy(`${spend}:${option}`);
    setRefusal(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `I choose ${titleCase(option)} for ${spend}.`,
          kind: "do",
          intent: { card: "feature", resourceId: spend, variant: option },
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setRefusal(data.error || "The choice was refused.");
        replayAnimation(refusalRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
        return;
      }
      setSent((current) => ({ ...current, [spend]: option }));
    } catch {
      setRefusal("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="reveal mt-3 space-y-2">
      {choices.map((choice) => {
        const waiting = sent[choice.spend];
        const open = mine && !choice.chosen && !inCombat;
        return (
          <div key={choice.spend} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="w-36 shrink-0 text-stone-400">{choice.feature}</span>
            {choice.chosen ? (
              <span className="motion-pop inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-amber-100">
                <Check className="size-3" /> {titleCase(choice.chosen)}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={choice.feature} data-pill-group>
                {choice.options.map((option, index) => {
                  const on = waiting === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-on={on ? "" : undefined}
                      disabled={!open || busy !== null || Boolean(waiting)}
                      style={{ "--i": index } as CSSProperties}
                      onClick={() => void choose(choice.spend, option)}
                      title={
                        !mine
                          ? "The character's own player chooses."
                          : inCombat
                            ? "Chosen outside a fight."
                            : waiting
                              ? "Sent. The DM resolves it."
                              : `Choose ${titleCase(option)}`
                      }
                      className={cn(
                        "hand-option motion-press inline-flex min-h-9 items-center gap-1 rounded-full border px-3 sm:min-h-8",
                        on ? "border-amber-400/70 bg-amber-500/20 text-amber-100" : "border-stone-600 text-stone-300",
                        open && !waiting && "hover:border-amber-500/60",
                        "disabled:cursor-default disabled:opacity-60",
                      )}
                    >
                      {busy === `${choice.spend}:${option}` ? <Loader2 className="size-3 animate-spin" /> : null}
                      {titleCase(option)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {refusal ? (
        <p ref={refusalRef} role="alert" className="animate-fade-up text-[11px] text-amber-300">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
