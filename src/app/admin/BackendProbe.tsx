"use client";

import { Check, Loader2, X, Zap } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { RECOMMENDED_WINDOW, STORY_WINDOW_NEEDS, aWindow, storyWindowVerdict, windowFlag, windowLabel } from "@/lib/story-window";
import { ui } from "@/lib/ui";

// The three things the DM loop needs from a backend, in the order the probe
// tries them (scripts/lib/provider-capability-probe.mjs). A model that fails
// one of these will fail mid-story, so the admin can run the same probe the
// CLI runs before assigning a backend to a campaign.
const STAGES = [
  { key: "streaming", label: "Streams tokens" },
  { key: "toolCall", label: "Makes structured tool calls" },
  { key: "toolContinuation", label: "Continues after a tool result" },
] as const;

type ProbeStage = { ok?: boolean; sample?: string; name?: string | null };
type ProbeResult = {
  ok: boolean;
  endpoint?: string;
  model?: string;
  error?: string;
  // How the model's tools ran (scripts/lib/openai-tool-route.mjs): plain
  // Chat Completions, Chat Completions with reasoning off, or OpenAI's
  // Responses API. Worth a word when it is not the plain one, because a
  // campaign on this model runs the same way.
  route?: "chat" | "chat-no-reasoning" | "responses";
  stages?: Record<string, ProbeStage>;
  // The story window a campaign on it packs against; `reported` is false
  // when the server named no size.
  window?: { tokens: number; reported: boolean };
};

const ROUTE_NOTES: Record<string, string> = {
  "chat-no-reasoning": "with its reasoning off, the only way its tools run on Chat Completions",
  responses: "through OpenAI's Responses API, the only place its tools run",
};

// baseUrl/model/apiKey are the field values as typed; blanks fall back to the
// saved settings and env server-side, mirroring how a real turn resolves
// them. Pass the API key field only when it holds a freshly typed key.
export function BackendProbe({
  which,
  baseUrl,
  model,
  apiKey = "",
}: {
  which: "story" | "utility";
  baseUrl: string;
  model: string;
  apiKey?: string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  async function run() {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/backend-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ which, baseUrl, model, apiKey }),
      });
      const data = await response.json().catch(() => null);
      setResult(
        data ?? { ok: false, error: "The probe request failed without an answer." },
      );
    } catch {
      setResult({ ok: false, error: "Could not reach the server." });
    } finally {
      setTesting(false);
    }
  }

  const failed = result && !result.ok;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={testing}
          aria-busy={testing}
          className={ui.btnSmall}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
          Test backend
        </button>
        <span className="text-xs text-stone-500">
          {which === "story"
            ? "Checks streaming, tool calls and the context window, the way a campaign uses them. Takes a few seconds."
            : "Checks streaming and tool calls, the way a campaign uses them. Takes a few seconds."}
        </span>
      </div>
      {testing ? (
        <p role="status" className="live-in mt-2 text-sm text-stone-400">
          Asking the backend for a streamed reply, a tool call, and a continuation…
        </p>
      ) : null}
      {result ? (
        <div className="live-in mt-2 space-y-1 text-sm">
          {STAGES.map((stage) => {
            const state = result.stages?.[stage.key];
            if (!state) return null;
            return (
              <p key={stage.key} className="flex items-center gap-2">
                {state.ok ? (
                  <Check className="size-4 shrink-0 text-emerald-400" />
                ) : (
                  <X className="size-4 shrink-0 text-red-400" />
                )}
                <span className={state.ok ? "text-stone-300" : "text-red-400"}>{stage.label}</span>
              </p>
            );
          })}
          {result.ok ? (
            <p role="status" className="inline-flex items-center gap-1 text-emerald-400">
              <Check className="size-4" /> {result.model} can run the storyteller loop
              {result.route && ROUTE_NOTES[result.route] ? ` (${ROUTE_NOTES[result.route]})` : ""}.
            </p>
          ) : null}
          {result.ok && result.window ? <WindowLine size={result.window} /> : null}
          {result.ok ? null : (
            <p role="alert" className="motion-shake text-red-400">
              {result.error
                ? result.error
                : `${result.model || "This model"} cannot run the storyteller loop`}
              {!result.error && result.stages?.streaming?.ok
                ? " — see the failed checks above."
                : "."}
            </p>
          )}
        </div>
      ) : null}
      {failed && result?.endpoint ? (
        <p className={cn("mt-1 break-all text-xs text-stone-500")} title={result.endpoint}>
          Probed {result.endpoint}
        </p>
      ) : null}
    </div>
  );
}

// Whether the window is big enough to narrate and to fight, and what to
// change when it is not.
function WindowLine({ size }: { size: { tokens: number; reported: boolean } }) {
  const raise = `Give it a larger window (llama-server -c ${windowFlag(RECOMMENDED_WINDOW)}, Ollama's num_ctx, LM Studio's context length) or choose a model with one.`;
  if (!size.reported) {
    return (
      <p className="text-xs leading-5 text-amber-200">
        This server does not report its context window, so tables plan for {windowLabel(size.tokens)}. {STORY_WINDOW_NEEDS} Run
        it with at least that, and set OPENAI_COMPAT_CONTEXT to the size it runs so tables use all of it.
      </p>
    );
  }
  const verdict = storyWindowVerdict(size.tokens);
  if (verdict.level === "ok") {
    return (
      <p className="flex items-center gap-1 text-emerald-400">
        <Check className="size-4 shrink-0" /> {aWindow(size.tokens)} context window: room to narrate, fight and remember the story.
      </p>
    );
  }
  return (
    <p role="alert" className="text-xs leading-5 text-amber-200">
      {verdict.text} {raise}
    </p>
  );
}
