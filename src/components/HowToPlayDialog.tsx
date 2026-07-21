"use client";

import {
  CircleHelp,
  Compass,
  Dices,
  Hourglass,
  MessageSquareText,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 flex items-center gap-2 font-display text-sm tracking-wide text-amber-200/90">
        <Icon className="size-4 text-amber-500/80" />
        {title}
      </h3>
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">{children}</div>
    </section>
  );
}

function ModeRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 w-14 shrink-0 rounded-full bg-gradient-to-b from-amber-100 to-amber-400 px-2 py-0.5 text-center text-xs font-medium text-amber-950">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

// Onboarding read for newcomers: what the app is, how to get a table running,
// who does the maths, and the table etiquette that follows from coalesced DM
// turns. HelpDialog stays the button-by-button reference.
export function HowToPlayDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="How to play"
      icon={<ScrollText className="size-5 text-amber-500/80" />}
      width="w-[min(94vw,44rem)]"
    >
      <Section icon={Sparkles} title="What this is">
        <p>
          Open Dungeon Master is a Dungeons &amp; Dragons 5e table where an AI sits in the Dungeon
          Master&apos;s chair. You and your friends play the adventurers. The app is the rulebook
          and the dice.
        </p>
      </Section>

      <Section icon={Compass} title="Getting started">
        <p>
          <span className="text-stone-300">New campaign</span> creates the world: pick a genre,
          difficulty and starting level, and optionally give the DM a secret story setup only it
          will know. You get an eight-letter invite code to share with your friends.
        </p>
        <p>
          <span className="text-stone-300">Solo adventure</span> is the same thing for one player.
          To join someone else&apos;s table, paste their code into &quot;Join with a room code&quot;
          or open the invite link they send you.
        </p>
        <p>
          Then build a character in the creation wizard, or reuse one saved under Characters in the
          account menu. Everyone readies up in the lobby, and the campaign owner starts the
          adventure.
        </p>
      </Section>

      <Section icon={Dices} title="How the game is run">
        <p>
          The app does all the calculation and gives the result to the DM, who weaves it into the
          story. Attack rolls, damage, saving throws, death saves, conditions, spell slots, rests,
          XP and level-ups are all resolved by the server against the 5e rules and written straight
          to your character sheet.
        </p>
        <p>
          The DM narrates what those results mean. It cannot invent a roll or quietly hand you a
          bonus, so play the story rather than arguing the numbers. Every roll and stat change is
          recorded in the Log tab if you want to check the maths.
        </p>
      </Section>

      <Section icon={MessageSquareText} title="Taking your turn">
        <p>The buttons above the message box change what your message means:</p>
        <ModeRow label="Do">
          Describe what your character does. The DM narrates the outcome and asks for a roll when
          the rules call for one.
        </ModeRow>
        <ModeRow label="Say">Speak in character. Your text is sent as spoken dialogue.</ModeRow>
        <ModeRow label="OOC">
          Out-of-character table talk. The DM does not read it or respond to it.
        </ModeRow>
      </Section>

      <Section icon={Hourglass} title="One turn at a time">
        <p>
          When the DM starts thinking, it reads everything sent up to that moment and writes one
          reply for the whole table. Anything you send while it is still thinking will not change
          that reply. It is picked up on the next turn, together with whatever everyone else sent.
        </p>
        <p>
          So if you are playing with others,{" "}
          <span className="text-stone-300">
            talk your options over before someone sends, then send one clear action each
          </span>
          . Piling on more messages mid-narration does not speed the DM up or steer the reply
          already in progress.
        </p>
        <p>
          OOC is the safe channel for that discussion: it never wakes the DM, and it still works
          while the floor is locked during narration. Sometimes the DM puts one player in the
          spotlight and waits for them, and a banner will tell you when that is why you cannot act.
        </p>
      </Section>

      <Section icon={CircleHelp} title="If you get stuck">
        <p>
          The Help entry, in the account menu here and in the header during a session, walks through
          every button and panel: the side panel tabs, dice options, narration voice, notes,
          whispers and the party lead&apos;s powers. If a spotlight leaves the table stuck, the
          party lead can release it.
        </p>
      </Section>
    </Dialog>
  );
}
