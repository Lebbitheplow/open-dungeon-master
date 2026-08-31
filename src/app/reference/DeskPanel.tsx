"use client";

import { Loader2, Quote, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { DESK_QUESTION_MAX, type DeskAnswer } from "@/lib/reference/desk-logic";

// The fact-checking desk: a rules question, answered from what the server
// actually has, with the sources shown BEFORE the answer is asked for.
//
// Showing the retrieval first is the honest part of the interface. A DM can
// see that a question found three spell rows and one of their own house
// rules, or that it found nothing, and decide whether an answer built on
// that is worth waiting for. Citations come back checked: anything the model
// cited that was never supplied has already been dropped server side.

type PreviewSource = { kind: string; ref: string; name: string; origin: string };

const KIND_LABELS: Record<string, string> = {
  spell: "spell",
  monster: "monster",
  item: "item",
  condition: "condition",
  feat: "feat",
  glossary: "basics",
  ruling: "your house rule",
  variant: "your variant rule",
};

export function DeskPanel() {
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<PreviewSource[]>([]);
  const [answer, setAnswer] = useState<DeskAnswer | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);

  // The preview is a search, not a model call, so it can follow typing the
  // same way the browse tab's search does.
  useEffect(() => {
    const trimmed = question.trim();
    let cancelled = false;
    // Every setState lives inside the timeout, never in the effect body: the
    // lint rule bans a synchronous one there, and the browse tab debounces
    // its own search the same way.
    const timer = setTimeout(async () => {
      if (!trimmed) {
        setSources([]);
        return;
      }
      try {
        const response = await fetch(`/api/reference/ask?q=${encodeURIComponent(trimmed)}`);
        if (!response.ok || cancelled) {
          return;
        }
        const data = await response.json();
        if (!cancelled) {
          setSources(data.sources ?? []);
        }
      } catch {
        // A failed preview is not worth telling anyone about; the ask itself
        // reports properly.
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [question]);

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || asking) {
      return;
    }
    setAsking(true);
    setError("");
    setAnswer(null);
    try {
      const response = await fetch("/api/reference/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "The desk could not answer that.");
        return;
      }
      setAnswer(data.result);
    } catch {
      setError("The desk could not answer that.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-stone-400">
        A rules question, answered from the content pack, the rules basics and your own house
        rules. Every citation is checked against what the desk actually supplied, so a source
        listed here is one that exists.
      </p>

      <div className="mb-3 flex gap-2">
        <input
          value={question}
          maxLength={DESK_QUESTION_MAX}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void ask();
            }
          }}
          placeholder="Does a readied spell need concentration?"
          className="flex-1 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={asking || !question.trim()}
          className={ui.btnSecondary}
        >
          {asking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Ask
        </button>
      </div>

      {question.trim() ? (
        <div className="mb-4 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-stone-500">
            {sources.length
              ? `${sources.length} source${sources.length === 1 ? "" : "s"} the desk would read`
              : "Nothing on file bears on this yet"}
          </p>
          {sources.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {sources.map((source) => (
                <li
                  key={source.ref}
                  className="rounded-full border border-stone-700 px-2.5 py-0.5 text-xs text-stone-400"
                  title={source.origin}
                >
                  <span className="text-stone-300">{source.name}</span>
                  <span className="ml-1.5 text-stone-600">
                    {KIND_LABELS[source.kind] ?? source.kind}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-stone-500">
              The desk will still answer, from general rules knowledge, and will say that it did.
            </p>
          )}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {answer ? (
        <div className="rounded-xl border border-stone-800 bg-stone-950/60 p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-200">
            {answer.answer}
          </p>
          {answer.citations.length ? (
            <ul className="mt-4 space-y-2 border-t border-stone-800 pt-3">
              {answer.citations.map((citation) => (
                <li key={citation.ref} className="text-xs">
                  <span className="flex items-center gap-1.5 text-stone-400">
                    <Quote className="size-3 shrink-0 text-amber-600/70" />
                    {citation.name}
                    <span className="text-stone-600">{citation.origin}</span>
                  </span>
                  <span className="mt-0.5 block border-l border-stone-800 pl-3 text-stone-500">
                    {citation.quote}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 border-t border-stone-800 pt-3 text-xs text-amber-200/80">
              This answer cites nothing on file. Treat it as a starting point and check it against
              a book before it settles anything at the table.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
