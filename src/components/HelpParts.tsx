"use client";

import { Search, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// The painted glyph each section of this dialog leads with, by title. The
// other help dialogs pass titles that are not here and keep their line icon.
const SECTION_GLYPHS: Record<string, string> = {
  "Guided tours": "pace-normal",
  "Getting started": "tab-context",
  "The lobby": "tab-party",
  "Talking to the DM": "tab-chat",
  "Your hand in a fight": "tab-battle",
  "When the DM gets it wrong": "rest-concentration-break",
  "What the DM remembers": "tab-facts",
  "The side panel": "tab-session",
  Dice: "die-d20",
  "Voice and narration": "tab-story",
  "Live voice chat": "cue-horn",
  "Ambience and music": "tab-ambience",
  "Playing with a human DM": "tab-dm",
  "Party lead": "tab-lead",
  "Campaign plugins": "system-plugin",
  "New to D&D?": "tab-story",
  About: "system-lore",
};

function sectionId(title: string): string {
  return `help-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

// Exported (through HelpDialog) for HowToPlayDialog, which is the short orientation read to this
// dialog's full reference. Both used to carry byte-identical private copies,
// so a styling change had to be made twice or the two drifted apart.
export function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  const glyph = SECTION_GLYPHS[title];
  return (
    <section id={sectionId(title)} className="mb-6 scroll-mt-4 last:mb-0">
      {/* The kit heading's classes with either a painted glyph or, for the
          dialogs that have none, the line icon they always passed. */}
      <header className="section-head">
        {glyph ? (
          <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-7" className="shrink-0" />
        ) : (
          <Icon className="size-4 shrink-0 text-amber-500/80" />
        )}
        <h3 className="section-head-title">{title}</h3>
        <span className="section-head-rule motion-rule" aria-hidden="true" />
      </header>
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">{children}</div>
    </section>
  );
}

export function ModeRow({
  label,
  lead,
  children,
}: {
  label: string;
  lead?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={
          lead
            ? "mt-0.5 w-14 shrink-0 rounded-full bg-gradient-to-b from-ember-400 to-ember-600 px-2 py-0.5 text-center text-xs font-medium text-stone-950"
            : "mt-0.5 w-14 shrink-0 rounded-full bg-gradient-to-b from-amber-100 to-amber-400 px-2 py-0.5 text-center text-xs font-medium text-amber-950"
        }
      >
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}


// Contents: every section one tap away, narrowed by the field.
export function HelpContents({ withTours }: { withTours: boolean }) {
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const contents = Object.keys(SECTION_GLYPHS).filter(
    (title) => (title !== "Guided tours" || withTours) && (!needle || title.toLowerCase().includes(needle)),
  );
  return (
    <nav aria-label="Help contents" className="mb-5">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-amber-300/70" />
        <input
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="Find a topic"
          aria-label="Find a help topic"
          className={cn(ui.input, "h-10 pl-9")}
        />
      </div>
      <div className="stagger-pop flex flex-wrap gap-1.5">
        {contents.map((title) => (
          <button
            key={title}
            type="button"
            onClick={() => {
              const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              document.getElementById(sectionId(title))?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
            }}
            className="motion-press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-stone-700/70 py-0.5 pl-1 pr-3 text-xs text-stone-300 hover:border-amber-500/40 hover:text-amber-100"
          >
            <GameIcon icon={{ kind: "glyph", key: SECTION_GLYPHS[title] }} size="size-6" />
            {title}
          </button>
        ))}
        {!contents.length ? <p className="text-xs text-stone-500">No topic by that name.</p> : null}
      </div>
    </nav>
  );
}
