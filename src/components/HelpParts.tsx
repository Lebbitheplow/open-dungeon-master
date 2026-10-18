"use client";

import { Search, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { textKey } from "@/lib/language/text-logic";

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
  "Live voice chat": "ui-voice",
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


// Everyday words for what a section covers that its title does not say, so
// "volume" finds the narration and ambience sections and "mic" finds voice
// chat. The search also reads each section's own text (below), so this list
// only needs the words the text itself never uses.
const SECTION_WORDS: Record<string, string> = {
  "Guided tours": "tour walkthrough replay spotlight",
  "Getting started": "start begin new campaign join invite code character build first",
  "The lobby": "ready begin start invite room code settings waiting",
  "Talking to the DM": "message type action speak ooc direct ask question composer",
  "Your hand in a fight": "combat battle attack cards spells turn initiative",
  "When the DM gets it wrong": "undo mistake reroll edit retry wrong fix",
  "What the DM remembers": "memory pin remember canon facts forget",
  "The side panel": "tabs inventory sheet hp party story notes chat settings layout arrange",
  Dice: "roll rolls secret physical real pixels bluetooth",
  "Voice and narration": "volume mute unmute sound speaker read aloud tts microphone mic dictation push to talk",
  "Live voice chat": "microphone mic headphones call talk mute proximity side rooms",
  "Ambience and music": "volume sound music audio mute soundtrack",
  "Playing with a human DM": "human dm console beats assisted",
  "Party lead": "lead owner rewind permissions",
  "Campaign plugins": "world pack plugin setting install",
  "New to D&D?": "rules beginner learn reference rulebook glossary",
  About: "license credits version",
};

export function helpSectionId(title: string): string {
  return sectionId(title);
}

// Whether a section answers the search: every word in its title, its
// everyday words or its own text on the page.
export function helpMatches(title: string, query: string, text = ""): boolean {
  const words = textKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = textKey(`${title} ${SECTION_WORDS[title] ?? ""} ${text}`);
  return words.every((word) => haystack.includes(word));
}

function jumpToSection(title: string) {
  const target = document.getElementById(sectionId(title));
  if (!target) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  target.removeAttribute("data-flash");
  void target.offsetWidth;
  target.setAttribute("data-flash", "");
}

// Contents: every section one tap away, narrowed by the field. A search
// reads the sections' own words as well as their titles, so the question a
// person actually has ("volume", "mic", "inventory") finds the place that
// answers it.
export function HelpContents({ withTours, initialSection }: { withTours: boolean; initialSection?: string }) {
  const [find, setFind] = useState("");
  const needle = textKey(find);
  // Opened from a control that has a section of its own: brought into view
  // once the dialog has drawn it.
  useEffect(() => {
    if (!initialSection) return;
    const timer = window.setTimeout(() => jumpToSection(initialSection), 120);
    return () => window.clearTimeout(timer);
  }, [initialSection]);
  const contents = Object.keys(SECTION_GLYPHS).filter((title) => {
    if (title === "Guided tours" && !withTours) return false;
    if (!needle) return true;
    const text = typeof document === "undefined" ? "" : document.getElementById(sectionId(title))?.textContent ?? "";
    return helpMatches(title, needle, text);
  });
  return (
    <nav aria-label="Help contents" className="mb-5">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-amber-300/70" />
        <input
          value={find}
          onChange={(event) => setFind(event.target.value)}
          onKeyDown={(event) => {
            // Enter goes to the first section that answers.
            if (event.key === "Enter" && contents[0]) {
              event.preventDefault();
              jumpToSection(contents[0]);
            }
          }}
          placeholder="Find a topic, a button or a word"
          aria-label="Find a help topic"
          className={cn(ui.input, "h-10 pl-9")}
        />
      </div>
      <div className="stagger-pop flex flex-wrap gap-1.5" aria-live="polite">
        {contents.map((title) => (
          <button
            key={title}
            type="button"
            onClick={() => jumpToSection(title)}
            className="motion-press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-stone-700/70 py-0.5 pl-1 pr-3 text-xs text-stone-300 hover:border-amber-500/40 hover:text-amber-100"
          >
            <GameIcon icon={{ kind: "glyph", key: SECTION_GLYPHS[title] }} size="size-6" />
            {title}
          </button>
        ))}
        {!contents.length ? <p className="text-xs text-stone-500">Nothing in Help mentions that. Try another word.</p> : null}
      </div>
    </nav>
  );
}
