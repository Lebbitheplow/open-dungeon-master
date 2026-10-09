"use client";

import { Check, ImageIcon, Loader2, Minus, Wand2, X } from "lucide-react";
import { useState } from "react";
import { ui } from "@/lib/ui";

// The agent program's picture test, painted the way the tables paint
// (src/lib/harness/picture-test.ts): the tables' own picture door and queue,
// a landscape location map, the saved file, then the campaigns themselves.
// A pass offers the one step that makes it paint for them: on, the default,
// and the campaigns stranded on a backend that cannot paint moved onto it.

type Stage = { id: string; ok: boolean | null; detail?: string };
type CampaignRow = { id: string; title: string; kind: string; backend: string; picturesOn: boolean; canPaint: boolean };
type Result = { image?: { url: string }; stages?: Stage[]; campaigns?: CampaignRow[]; wouldMove?: number; error?: string };
type Moved = { id: string; title: string; from: string; mapsTurnedOn: boolean };

const STAGE_LABELS: Record<string, string> = {
  painted: "Painted a location map through the tables' picture queue",
  saved: "Saved where the table is sent it",
  shape: "Came back in the map's landscape shape",
};
const STAGE_ORDER = ["painted", "saved", "shape"];

const BACKEND_NAMES: Record<string, string> = {
  comfyui: "ComfyUI",
  openai: "OpenAI",
  "mflux-hs": "the FLUX worker",
  "sdnq-hs": "the FLUX worker",
  harness: "the agent",
};

function names(rows: Array<{ title: string }>): string {
  const titles = rows.map((row) => row.title);
  return titles.length > 3 ? `${titles.slice(0, 3).join(", ")} and ${titles.length - 3} more` : titles.join(", ");
}

export function HarnessPictureTest({
  saved,
  picturesVerified,
  picturesForTables,
  offerAdopt = true,
  onVerified,
  onAdopted,
}: {
  saved: boolean;
  picturesVerified: boolean;
  // Already the tables' picture backend, switched on.
  picturesForTables: boolean;
  // The guided setup saves the choice on its own Continue instead.
  offerAdopt?: boolean;
  onVerified: () => void;
  onAdopted?: () => void;
}) {
  const [painting, setPainting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [moved, setMoved] = useState<Moved[] | null>(null);
  const [adoptError, setAdoptError] = useState("");

  async function paint() {
    setPainting(true);
    setResult(null);
    setMoved(null);
    try {
      const response = await fetch("/api/admin/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "picture" }),
      });
      const data = (await response.json().catch(() => ({}))) as Result;
      setResult(response.ok && data.image ? data : { ...data, error: data.error ?? "No picture came back." });
      if (response.ok && data.image) {
        onVerified();
      }
    } catch {
      setResult({ error: "Could not reach the server." });
    } finally {
      setPainting(false);
    }
  }

  async function adopt() {
    setAdopting(true);
    setAdoptError("");
    try {
      const response = await fetch("/api/admin/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adopt" }),
      });
      const data = (await response.json().catch(() => ({}))) as { moved?: Moved[]; error?: string };
      if (!response.ok) {
        setAdoptError(data.error ?? "Could not switch the tables over.");
        return;
      }
      setMoved(data.moved ?? []);
      onAdopted?.();
    } catch {
      setAdoptError("Could not reach the server.");
    } finally {
      setAdopting(false);
    }
  }

  const stages: Stage[] = painting
    ? STAGE_ORDER.map((id) => ({ id, ok: null }))
    : (result?.stages ?? []);
  const passed = Boolean(result?.image);
  const campaigns = (result?.campaigns ?? []).filter((row) => row.kind === "campaign" && row.picturesOn);
  const onAgent = campaigns.filter((row) => row.backend === "harness");
  const stranded = campaigns.filter((row) => row.backend !== "harness" && !row.canPaint);
  const keeping = campaigns.filter((row) => row.backend !== "harness" && row.canPaint);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={ui.btnSmall} onClick={paint} disabled={!saved || painting} aria-busy={painting}>
          {painting ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
          {picturesVerified ? "Paint another test picture" : "Paint a test picture"}
        </button>
        <span className="text-xs text-stone-500">
          Paints one location map exactly the way a table asks for one, then checks which campaigns will use it. About a minute.
        </span>
      </div>

      {stages.length ? (
        <ol className="hx-stages" aria-live="polite">
          {stages.map((stage, index) => {
            const state = stage.ok === null ? (painting ? "wait" : "skip") : stage.ok ? "ok" : "bad";
            return (
              <li key={stage.id} className="hx-stage live-in" data-state={state} style={{ animationDelay: `${index * 60}ms` }}>
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
                  {stage.detail ? <span className="block text-xs text-stone-500">{stage.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {painting ? (
        <div className="hx-picture breathe aspect-[3/2] bg-stone-900" aria-label="Painting" />
      ) : result?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={result.image.url} src={result.image.url} alt="The test map" className="hx-picture aspect-[3/2]" />
      ) : null}

      {result && !passed && result.error ? (
        <p role="alert" className="motion-shake text-sm text-red-400">
          {result.error}
        </p>
      ) : null}

      {passed ? (
        <div className="live-in space-y-2 text-sm">
          {moved ? (
            <p role="status" className="flex items-start gap-1.5 text-emerald-400">
              <Check className="tick-in mt-0.5 size-4 shrink-0" />
              <span>
                Painting for the tables now.
                {moved.length
                  ? ` Moved ${moved.length} ${moved.length === 1 ? "campaign" : "campaigns"} off a backend that could not paint: ${names(moved)}${moved.some((row) => row.mapsTurnedOn) ? ", with their area maps switched back on" : ""}.`
                  : ""}
              </span>
            </p>
          ) : !offerAdopt ? (
            <p className="text-stone-300">
              It paints the way the tables ask.
              {stranded.length
                ? ` Continue, and ${stranded.length === 1 ? "the campaign" : `the ${stranded.length} campaigns`} on a backend that cannot paint right now (${names(stranded)}) move${stranded.length === 1 ? "s" : ""} to it too.`
                : " Continue to use it for the tables' pictures."}
            </p>
          ) : picturesForTables ? (
            <p className="text-stone-300">
              The tables already paint with it{onAgent.length ? `: ${onAgent.length} ${onAgent.length === 1 ? "campaign" : "campaigns"}` : ""}.
            </p>
          ) : (
            <div className="su-note space-y-2">
              <p>
                It paints, but no table uses it yet.
                {stranded.length
                  ? ` ${stranded.length} ${stranded.length === 1 ? "campaign is" : "campaigns are"} on a backend that cannot paint right now (${names(stranded)}); ${stranded.length === 1 ? "it moves" : "they move"} to the agent too.`
                  : ""}
              </p>
              <button type="button" className={ui.btnSecondary} onClick={adopt} disabled={adopting} aria-busy={adopting}>
                {adopting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Paint the tables&apos; pictures with it
              </button>
            </div>
          )}
          {keeping.length ? (
            <p className="text-xs text-stone-500">
              {keeping.length === 1 ? "1 campaign keeps its own working backend" : `${keeping.length} campaigns keep their own working backends`} (
              {[...new Set(keeping.map((row) => BACKEND_NAMES[row.backend] ?? row.backend))].join(", ")}); a lead can switch in the campaign&apos;s Setup tab.
            </p>
          ) : null}
          {adoptError ? (
            <p role="alert" className="motion-shake text-sm text-red-400">
              {adoptError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
