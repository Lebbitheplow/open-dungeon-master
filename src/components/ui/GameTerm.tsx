"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { InfoDialog } from "@/components/ui/InfoDialog";
import { glossaryTerm } from "@/lib/help";

// An inline rules word a new player can tap: "Armor Class", "Saving throws",
// "Concentration". Renders as the label with a dotted underline, so the page
// stays readable and the help is there when it is wanted.
//
// An unknown id renders as plain text rather than throwing, so a typo
// degrades to the label it was already showing. scripts/test-help-coverage.mjs
// checks the ids this app actually uses exist.
export function GameTerm({
  id,
  children,
  className,
}: {
  id: string;
  // Defaults to the glossary's own name for the term.
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const entry = glossaryTerm(id);
  if (!entry) {
    return <>{children}</>;
  }
  const body = [entry.short, entry.long].filter(Boolean).join("\n\n");
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "cursor-help underline decoration-stone-600 decoration-dotted underline-offset-2 transition-colors hover:text-amber-200 hover:decoration-amber-500/60",
          className,
        )}
      >
        {children ?? entry.term}
      </button>
      <InfoDialog open={open} onOpenChange={setOpen} title={entry.term} text={body} />
    </>
  );
}
