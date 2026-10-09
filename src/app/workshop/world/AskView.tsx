"use client";

import { MessageCircleQuestion } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { mentionSegments } from "@/lib/worldforge/text";
import type { WorldApi, WorldState } from "./useWorld";

// Ask the world, after WorldForge's grounded chat: a question about the
// world answered from the world, hidden truths included (it is the DM who
// asks), with every entry the answer names linked. When the world does not
// say, the answer says so and suggests what could be decided. The answers
// stay on this screen only: nothing is written.

type Answer = { question: string; answer: string };

export function AskView({ api, world, onOpen }: { api: WorldApi; world: WorldState; onOpen: (ref: string) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const named = useMemo(() => world.entities.map((entity) => ({ ref: entity.ref, name: entity.name, aliases: entity.aliases })), [world.entities]);

  async function ask() {
    const asked = question.trim();
    if (!asked) return;
    setBusy(true);
    const payload = await api.ai("ask", { question: asked });
    setBusy(false);
    if (payload && typeof payload.answer === "string") {
      setAnswers((current) => [{ question: asked, answer: payload.answer as string }, ...current].slice(0, 12));
      setQuestion("");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <input className={cn(ui.input, "min-w-0 flex-1")} placeholder="Who in Gullhaven could have sold the sluice codes?" aria-label="A question about the world" maxLength={1_000} value={question} onChange={(event) => setQuestion(event.target.value)} />
        <KitButton tone="primary" type="submit" busy={busy} disabled={busy || !question.trim()} data-tour="world-ask">
          {busy ? null : <MessageCircleQuestion className="size-3.5" />} Ask
        </KitButton>
      </form>
      <p className="text-[11px] text-stone-500">Answered from this world only, hidden truths included. Names in the answer open their entries.</p>
      {api.error ? <PanelError>{api.error}</PanelError> : null}
      <ul className="flex flex-col gap-2">
        {answers.map((entry, index) => (
          <li key={`${answers.length - index}`} className="panel motion-pop rounded-lg p-3">
            <p className="text-xs text-amber-200/90">{entry.question}</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-stone-200">
              {mentionSegments(entry.answer, named).map((segment, at) =>
                segment.ref ? (
                  <button key={at} type="button" onClick={() => onOpen(segment.ref!)} className="text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100">
                    {segment.text}
                  </button>
                ) : (
                  <span key={at}>{segment.text}</span>
                ),
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
