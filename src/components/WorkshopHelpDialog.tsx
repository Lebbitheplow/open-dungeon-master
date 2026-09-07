"use client";

import {
  BookOpen,
  CircleHelp,
  Copy,
  Footprints,
  Hammer,
  Share2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { WORKSHOP_GUIDES } from "@/lib/tours/workshop-guide";
import { Dialog } from "@/components/ui/Dialog";
import { Section } from "@/components/HelpDialog";

// The workshop's own help. The main HelpDialog is written for a table
// mid-session; a workshop has no table, no transcript and no AI turns, so
// its help is its own read: the tours it can replay, a guide per tool (the
// open tool first and unfolded), and the short version of what a workshop
// is and how prep reaches a campaign. Opened from the shelf, the hub and
// every tool.

export type HelpTour = { label: string; detail: string; onStart: () => void };

export function WorkshopHelpDialog({
  open,
  onOpenChange,
  tours,
  system,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The tours this page can start; each closes the dialog first.
  tours?: HelpTour[];
  // The tool open right now, whose guide leads and starts unfolded.
  system?: string | null;
}) {
  const guides = [
    ...WORKSHOP_GUIDES.filter((guide) => guide.id === system),
    ...WORKSHOP_GUIDES.filter((guide) => guide.id !== system),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Workshop help"
      icon={<CircleHelp className="size-5 text-amber-500/80" />}
      width="w-[min(94vw,44rem)]"
    >
      {tours && tours.length ? (
        <Section icon={Footprints} title="Guided tours">
          <p>
            A spotlight walk through the controls, one at a time. Each tour ran once when you
            first opened its page; take it again whenever you like.
          </p>
          <div className="flex flex-wrap gap-2">
            {tours.map((tour) => (
              <button
                key={tour.label}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  tour.onStart();
                }}
                className={ui.btnSmall}
                title={tour.detail}
              >
                <Footprints className="size-4" /> {tour.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}
      <Section icon={Wrench} title="The tools, one by one">
        <p>
          What each tool is for, how a first session with it goes, and the things people miss.
          {system ? " The tool you have open comes first." : ""}
        </p>
        <div className="space-y-1.5">
          {guides.map((guide) => (
            <details
              key={guide.id}
              open={guide.id === system}
              className="group rounded-lg border border-stone-800 bg-stone-950/50"
            >
              <summary
                className={cn(
                  "cursor-pointer list-none px-3 py-2 font-display text-sm tracking-wide text-amber-100 marker:content-none",
                  "flex items-baseline gap-2",
                )}
              >
                <span>{guide.title}</span>
                <span className="text-xs font-normal normal-case tracking-normal text-stone-500">
                  {guide.purpose}
                </span>
              </summary>
              <div className="space-y-2 border-t border-stone-800/70 px-3 py-2">
                <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-300">
                  {guide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {guide.tips.length ? (
                  <ul className="space-y-1 text-xs text-stone-500">
                    {guide.tips.map((tip) => (
                      <li key={tip} className="flex gap-1.5">
                        <span className="text-amber-500/70">&#8226;</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </Section>
      <Section icon={Hammer} title="What a workshop is">
        <p>
          A prep space: everything a campaign holds, with no players, no transcript and no AI
          narrator. Build the material on your own time, then bring it into a real campaign when
          the table sits down. Nothing you do here can start a fight or move a story, because
          there is no story running. The stand-in party bar at the top sets the party size and
          level your prep is measured against, so encounter difficulty readouts mean something
          before real characters exist.
        </p>
      </Section>
      <Section icon={Share2} title="Into a campaign, and back out">
        <p>
          Creating a campaign offers a <span className="text-stone-300">Bring in prep</span> step:
          pick a workshop (or another campaign you can see) and choose what to copy in. A campaign
          lobby can import the same way after creation. Copies are copies: the workshop keeps its
          version, the campaign owns its own from then on, and name collisions get numbered
          instead of overwritten. The Share tool exports the whole workshop as a bundle file
          another server can import, and can compile a draft world pack from it.
        </p>
      </Section>
      <Section icon={Copy} title="Copying things">
        <p>
          A whole workshop can be cloned from the shelf or the hub, and individual pieces (maps,
          NPCs, monsters, encounters, tables, lore) each have a duplicate action, for the
          version-two-of-this-boss workflow. Homebrew monsters, items, spells and options belong
          to your account rather than to any one workshop, so they follow you everywhere but do
          not travel inside bundles sent to other people.
        </p>
      </Section>
      <Section icon={BookOpen} title="Where the rules live">
        <p>
          Everything here is still 5e underneath: attack expressions have to roll, challenge
          ratings show their working, and imported material behaves in a campaign exactly like
          material made there. When you want the numbers themselves, the rules reference and its
          calculators are one click away in the account menu.
        </p>
      </Section>
    </Dialog>
  );
}
