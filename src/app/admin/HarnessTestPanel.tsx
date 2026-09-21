"use client";

import { Check, ImageIcon, Loader2, Minus, PlayCircle, X } from "lucide-react";
import { useState } from "react";
import { ui } from "@/lib/ui";

type Stage = { id: string; ok: boolean | null; detail?: string };

const STAGE_LABELS: Record<string, string> = {
  found: "Found on this machine",
  signedIn: "Signed in",
  handshake: "Connected to the table's engine",
  toolCall: "Called a rule and used its answer",
  lockdown: "Kept to the table's tools only",
  streaming: "Streamed its reply",
};

const STAGE_ORDER = ["found", "signedIn", "handshake", "toolCall", "lockdown", "streaming"];

// The live check: one real, tiny turn through the path every DM turn takes,
// with each stage ticked only when its real result comes back, and, for a
// program with its own image tool, one real test picture.
export function HarnessTestPanel({
  saved,
  paints,
  picturesVerified,
  onVerified,
}: {
  // The program being tested is the saved one; testing an unsaved choice
  // would test something the tables will not use.
  saved: boolean;
  paints: boolean;
  picturesVerified: boolean;
  onVerified: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [error, setError] = useState("");
  const [painting, setPainting] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState("");

  async function test() {
    setTesting(true);
    setError("");
    setStages(STAGE_ORDER.map((id) => ({ id, ok: null })));
    try {
      const response = await fetch("/api/admin/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = (await response.json().catch(() => ({}))) as { stages?: Stage[]; error?: string };
      if (!response.ok || !data.stages) {
        setError(data.error ?? "The test could not run.");
        setStages(null);
        return;
      }
      setStages(data.stages);
    } catch {
      setError("Could not reach the server.");
      setStages(null);
    } finally {
      setTesting(false);
    }
  }

  async function paint() {
    setPainting(true);
    setPictureError("");
    setPicture(null);
    try {
      const response = await fetch("/api/admin/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "picture" }),
      });
      const data = (await response.json().catch(() => ({}))) as { image?: { url: string }; error?: string };
      if (!response.ok || !data.image) {
        setPictureError(data.error ?? "No picture came back.");
        return;
      }
      setPicture(data.image.url);
      onVerified();
    } catch {
      setPictureError("Could not reach the server.");
    } finally {
      setPainting(false);
    }
  }

  const failed = stages?.find((stage) => stage.ok === false);
  const passed = stages && stages.every((stage) => stage.ok === true);

  return (
    <div className="mt-4 space-y-3 border-t border-stone-800 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={ui.btnSmall}
          onClick={test}
          disabled={!saved || testing}
          aria-busy={testing}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
          Test the table
        </button>
        <span className="text-xs text-stone-500">
          {saved
            ? "Runs one tiny real turn: start, connect, call a rule, answer. Uses a little of the plan."
            : "Save the choice first; the test runs the program the tables will use."}
        </span>
      </div>

      {stages ? (
        <ol className="hx-stages" aria-live="polite">
          {stages.map((stage, index) => {
            const state = stage.ok === null ? (testing ? "wait" : "skip") : stage.ok ? "ok" : "bad";
            return (
              <li
                key={stage.id}
                className="hx-stage live-in"
                data-state={state}
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <span className="hx-stage-mark mt-0.5">
                  {state === "ok" ? (
                    <Check key="ok" className="tick-in size-4 text-emerald-400" />
                  ) : state === "bad" ? (
                    <X key="bad" className="tick-in size-4 text-red-400" />
                  ) : state === "wait" ? (
                    <Loader2 className="size-4 animate-spin text-stone-500" />
                  ) : (
                    <Minus className="size-4 text-stone-600" />
                  )}
                </span>
                <span>
                  <span className={state === "bad" ? "text-red-300" : state === "ok" ? "text-stone-200" : "text-stone-500"}>
                    {STAGE_LABELS[stage.id] ?? stage.id}
                  </span>
                  {stage.detail ? (
                    <span className="block text-xs text-stone-500">{stage.detail}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {passed ? (
        <p role="status" className="inline-flex items-center gap-1 text-sm text-emerald-400">
          <Check className="tick-in size-4" /> Ready to run a table.
        </p>
      ) : failed && !testing ? (
        <p role="alert" className="motion-shake text-sm text-red-400">
          {failed.detail ?? "The test stopped at the step marked above."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="motion-shake text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {paints ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={ui.btnSmall}
              onClick={paint}
              disabled={!saved || painting}
              aria-busy={painting}
            >
              {painting ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              {picturesVerified ? "Paint another test picture" : "Paint a test picture"}
            </button>
            <span className="text-xs text-stone-500">
              {picturesVerified
                ? "Pictures from this program are cleared for the tables."
                : "Its own image tool is offered to the tables only after one real picture comes back here."}
            </span>
          </div>
          {painting ? (
            <div className="hx-picture breathe bg-stone-900" aria-label="Painting" />
          ) : picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={picture} src={picture} alt="The test picture" className="hx-picture" />
          ) : null}
          {pictureError ? (
            <p role="alert" className="motion-shake text-sm text-red-400">
              {pictureError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
