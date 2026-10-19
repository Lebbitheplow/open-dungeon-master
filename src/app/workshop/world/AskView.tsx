"use client";

import { MessageCircleQuestion } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { mentionSegments, type Named } from "@/lib/worldforge/text";
import { canonMeaning } from "@/lib/worldforge/canon";
import { CITATION, citationNumbers, omittedLine, partWords, type AskOmitted } from "@/lib/worldforge/ask-words";
import type { AskPassage } from "@/lib/worldforge/ask";
import type { WorldApi, WorldState } from "./useWorld";

// Ask the world, after WorldForge's grounded chat: a question about the
// world answered from the world, hidden truths included (it is the DM who
// asks). The server searches the world's passages the way search_lore does
// in play and the answer cites the ones it used (src/lib/worldforge/ask.ts,
// audit WF-15): each citation opens its source below the answer, and each
// source names its entry (a link), where in the entry it is, its canon
// state and whether it is the DM's alone. When matches were left out for
// space, the answer says so. When the world does not say, the answer says
// so and suggests what could be decided. The answers stay on this screen
// only: nothing is written.

type Answer = { key: number; question: string; answer: string; sources: AskPassage[]; read: AskPassage[]; omitted: AskOmitted };

const NO_OMITTED: AskOmitted = { count: 0, names: [], others: 0 };

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
      const list = (value: unknown) => (Array.isArray(value) ? (value as AskPassage[]) : []);
      const omitted = payload.omitted && typeof payload.omitted === "object" ? (payload.omitted as AskOmitted) : NO_OMITTED;
      setAnswers((current) =>
        [{ key: Date.now(), question: asked, answer: payload.answer as string, sources: list(payload.sources), read: list(payload.read), omitted }, ...current].slice(0, 12),
      );
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
      <p className="text-[11px] text-stone-500">Answered from this world only, hidden truths included. Each source under an answer is a passage it rests on.</p>
      {api.error ? <PanelError>{api.error}</PanelError> : null}
      <ul className="flex flex-col gap-2">
        {answers.map((entry) => (
          <AnswerCard key={entry.key} entry={entry} named={named} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}

function AnswerCard({ entry, named, onOpen }: { entry: Answer; named: Named[]; onOpen: (ref: string) => void }) {
  const cited = useMemo(() => new Set(entry.sources.map((source) => source.n)), [entry.sources]);
  const sourceId = (n: number) => `ask-${entry.key}-source-${n}`;
  const goTo = (n: number) => {
    const target = document.getElementById(sourceId(n));
    if (!target) return;
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    target.focus({ preventScroll: true });
  };
  const words = (text: string, at: number): ReactNode[] =>
    mentionSegments(text, named).map((segment, index) =>
      segment.ref ? (
        <button key={`${at}-${index}`} type="button" onClick={() => onOpen(segment.ref!)} className="text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100">
          {segment.text}
        </button>
      ) : (
        <span key={`${at}-${index}`}>{segment.text}</span>
      ),
    );
  // The answer's words with its names linked, and each citation a button to
  // its source. A number the answer made up is left out.
  const body: ReactNode[] = [];
  let from = 0;
  for (const match of entry.answer.matchAll(CITATION)) {
    body.push(...words(entry.answer.slice(from, match.index), from));
    for (const n of citationNumbers(match[1])) {
      if (!cited.has(n)) continue;
      body.push(
        <button key={`cite-${match.index}-${n}`} type="button" onClick={() => goTo(n)} aria-label={`Source ${n}`} className="mx-0.5 inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-amber-500/40 px-1 align-baseline text-[11px] leading-none text-amber-200 hover:bg-amber-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
          {n}
        </button>,
      );
    }
    from = match.index + match[0].length;
  }
  body.push(...words(entry.answer.slice(from), from));
  const uncited = entry.read.filter((passage) => !cited.has(passage.n));

  return (
    <li className="panel motion-pop rounded-lg p-3">
      <p className="text-xs text-amber-200/90">{entry.question}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-stone-200">{body}</p>
      <section aria-label="Sources" className="mt-2.5 border-t border-stone-800/80 pt-2">
        <h4 className="text-[11px] uppercase tracking-[0.12em] text-stone-500">Sources</h4>
        {entry.sources.length ? (
          <ol className="mt-1.5 flex flex-col gap-2">
            {entry.sources.map((source) => (
              <li key={source.n} id={sourceId(source.n)} tabIndex={-1} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60">
                <PassageCard passage={source} onOpen={onOpen} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-xs text-stone-400">The answer cites no passage. Check it against the world before you use it.</p>
        )}
        {entry.omitted.count ? (
          <p className="mt-2 text-xs text-stone-400">{omittedLine(entry.omitted)} Ask about one of them by name to read it.</p>
        ) : null}
        {uncited.length ? (
          <details className="mt-2 text-xs text-stone-400">
            <summary className="flex min-h-10 cursor-pointer items-center rounded-md px-1 hover:text-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
              {uncited.length} other passage{uncited.length === 1 ? "" : "s"} read, not cited
            </summary>
            <ol className="mt-1 flex flex-col gap-2">
              {uncited.map((passage) => (
                <li key={passage.n}>
                  <PassageCard passage={passage} onOpen={onOpen} />
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </section>
    </li>
  );
}

function PassageCard({ passage, onOpen }: { passage: AskPassage; onOpen: (ref: string) => void }) {
  const meaning = canonMeaning(passage.canon);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-mono text-[11px] text-amber-200/80">[{passage.n}]</span>
        {passage.ref ? (
          <button type="button" onClick={() => onOpen(passage.ref)} className="min-h-6 text-left text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100">
            {passage.name}
          </button>
        ) : (
          <span className="text-stone-200">{passage.name}</span>
        )}
        <span className="text-stone-500">{partWords(passage.part, passage.at, passage.of)}</span>
        {passage.canon !== "canon" ? (
          <span title={meaning} className="rounded-md border border-stone-600 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-stone-400">
            {passage.canon}
            <span className="sr-only">: {meaning.slice(passage.canon.length + 2)}</span>
          </span>
        ) : null}
        {passage.dmOnly ? <span className="rounded-md border border-rose-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-rose-300">DM only</span> : null}
      </div>
      <blockquote className="border-l-2 border-stone-700 pl-2 text-xs leading-5 text-stone-300">{passage.text}</blockquote>
    </div>
  );
}
