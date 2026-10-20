"use client";

import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { offersImages, offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import {
  CREATE_CHOICES,
  ENABLE_DRAFTING,
  GROUP_LABELS,
  WAY_LABELS,
  missingModels,
  offeredWays,
  stepUnavailable,
  type CreateGroup,
  type CreateStep,
} from "@/lib/workshop/create-choices";

// The workshop's Create chooser (audit finding WF-08): what to make first,
// then the way in, each with the tool it lands in. Every way opens the
// tool that already makes that thing (src/lib/workshop/create-choices.ts);
// nothing is made here.

const GROUPS: CreateGroup[] = ["world", "playable", "picture"];

export function CreateButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn(ui.btnSmall, className)} data-testid="create-open" data-tour="workshop-create">
      <Plus className="size-4" /> Create
    </button>
  );
}

// The hub's task row asks for one thing straight away ("Prepare a fight"):
// the chooser opens on that choice, with the way back to everything else.
export const HUB_TASKS: ReadonlyArray<{ id: string; label: string; glyph: string }> = [
  { id: "encounter", label: "Prepare a fight", glyph: "system-encounters" },
  { id: "map", label: "Make a map", glyph: "system-maps" },
  { id: "npc", label: "Create an NPC", glyph: "system-cast" },
  { id: "outline", label: "Build a world", glyph: "system-world" },
];

export function CreateChooser({
  open,
  onOpenChange,
  onGo,
  startAt = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGo: (step: CreateStep) => void;
  // A choice to open on (HUB_TASKS); the chooser is keyed on it.
  startAt?: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(startAt);
  const capabilities = useCapabilities();
  const models = { story: offersStoryModel(capabilities), images: offersImages(capabilities) };
  const choice = CREATE_CHOICES.find((entry) => entry.id === picked) ?? null;

  function close(next: boolean) {
    if (!next) setPicked(null);
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={close} title={choice ? `Create: ${choice.label}` : "Create"} className="lg:w-[min(96vw,44rem)]">
      {choice ? (
        <div className="flex flex-col gap-3" data-testid="create-steps">
          <button type="button" onClick={() => setPicked(null)} className={cn(ui.btnSmall, "w-fit border-transparent bg-transparent px-1 text-stone-400 shadow-none")}>
            <ArrowLeft className="size-4" /> Everything you can make
          </button>
          <p className="text-sm text-stone-300">{choice.blurb}</p>
          <p className="text-xs text-stone-500">
            Lands in <span className="text-amber-200" data-testid="create-lands">{choice.lands}</span>
          </p>
          {missingModels(choice, models)
            .filter((model) => choice.steps.some((step) => !stepUnavailable(step, models) && step.drafts === model))
            .map((model) => (
              <p key={model} className="text-[11px] text-stone-500" data-testid="create-enable">
                Draft with AI needs {ENABLE_DRAFTING[model]}, and this server has none set up, so it is not offered here. The rest works the same.
              </p>
            ))}
          {choice.steps.map((step) => {
            const ways = offeredWays(step, models);
            const off = stepUnavailable(step, models);
            return (
              <button
                key={step.label}
                type="button"
                disabled={off}
                onClick={() => {
                  close(false);
                  onGo(step);
                }}
                className="panel flex flex-col gap-1.5 rounded-lg p-3 text-left motion-press disabled:opacity-50"
                data-testid="create-step"
              >
                <span className="flex items-center gap-2 text-sm text-amber-100">
                  {step.label} <ArrowRight className="ml-auto size-4 text-stone-500" />
                </span>
                <span className="text-xs text-stone-400">{off ? `This needs ${ENABLE_DRAFTING[step.needs ?? step.drafts ?? "story"]}, and this server has none set up. The other ways in here work without it.` : step.detail}</span>
                <span className="flex flex-wrap gap-1">
                  {ways.map((way) => (
                    <span key={way} className="rounded-md border border-stone-700/70 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-stone-400">
                      {WAY_LABELS[way]}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="create-choices">
          <p className="text-sm text-stone-400">Pick what you want to end up with. Each opens in the tool that makes it, so it is checked and stored the way that tool&apos;s own are.</p>
          {!models.story ? (
            <p className="text-xs text-stone-500" data-testid="create-no-ai">
              This server has no text model, so nothing here is drafted with AI: everything can still be made by hand or copied from one that exists. An admin switches drafting on under Admin &gt; Text model defaults.
            </p>
          ) : null}
          {GROUPS.map((group) => (
            <section key={group} className="flex flex-col gap-1.5">
              <h3 className="eyebrow text-[10px] text-stone-500">{GROUP_LABELS[group]}</h3>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {CREATE_CHOICES.filter((entry) => entry.group === group).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setPicked(entry.id)}
                    className="flex flex-col rounded-lg border border-stone-700/60 px-2.5 py-2 text-left motion-press hover:border-amber-600/50"
                    data-testid={`create-choice-${entry.id}`}
                  >
                    <span className="text-sm text-stone-100">{entry.label}</span>
                    <span className="text-xs text-stone-500">{entry.lands}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
