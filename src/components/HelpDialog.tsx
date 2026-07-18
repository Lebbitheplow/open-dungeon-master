"use client";

import Link from "next/link";
import {
  BookOpen,
  CircleHelp,
  Compass,
  Crown,
  Dices,
  DoorOpen,
  MessageSquareText,
  PanelRight,
  Volume2,
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

function ModeRow({ label, lead, children }: { label: string; lead?: boolean; children: ReactNode }) {
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

// One walkthrough of the whole app: menus, side-panel tabs, composer modes,
// dice, voice, and lead powers. Opened from the home account menu and the
// in-session header.
export function HelpDialog({
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
      title="Help"
      icon={<CircleHelp className="size-5 text-amber-500/80" />}
      width="w-[min(94vw,44rem)]"
    >
      <Section icon={Compass} title="Getting started">
        <p>
          Create a campaign from the home page, or join a friend&apos;s with their invite code or a{" "}
          <span className="text-stone-300">/join</span> link. Build a character in the creation
          wizard, or reuse one saved to your library under Characters in the account menu. When
          everyone in the lobby is ready, the owner starts the adventure.
        </p>
      </Section>

      <Section icon={DoorOpen} title="The lobby">
        <p>
          Before the game begins, each player readies up and the campaign owner can adjust the game
          settings: genre, an optional secret story setup for the DM, dice policy, narration voice,
          and maps. Share the invite code or copy the invite link to bring in more players.
        </p>
      </Section>

      <Section icon={MessageSquareText} title="Talking to the DM">
        <p>The buttons above the message box change what your message means:</p>
        <ModeRow label="Do">
          Describe what your character does. The DM narrates the outcome and asks for dice rolls
          when the rules call for them.
        </ModeRow>
        <ModeRow label="Say">
          Speak in character. Your text is sent as spoken dialogue, in quotes.
        </ModeRow>
        <ModeRow label="OOC">
          Out-of-character table talk. The DM does not respond to it, and it stays available even
          when the floor is locked during narration or a spotlight.
        </ModeRow>
        <ModeRow label="Direct" lead>
          Party lead only. Send the DM an authoritative story direction it must weave into the
          tale.
        </ModeRow>
        <p>
          Sometimes the DM puts one player in the spotlight and waits for them to act. While the
          floor is locked for you, a banner explains why, and OOC still works.
        </p>
      </Section>

      <Section icon={PanelRight} title="The side panel">
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-stone-300">Party:</span> character sheets, HP and conditions for
            the whole party, plus the invite code.
          </li>
          <li>
            <span className="text-stone-300">Map:</span> the scene map and discovered locations,
            when maps are enabled.
          </li>
          <li>
            <span className="text-stone-300">Story:</span> chapters and the tale so far.
          </li>
          <li>
            <span className="text-stone-300">Notes:</span> suggest campaign notes for the story; the
            party lead approves them.
          </li>
          <li>
            <span className="text-stone-300">Chat:</span> private side chat between players. The DM
            and the campaign transcript never see it.
          </li>
          <li>
            <span className="text-stone-300">Log:</span> an audited record of dice rolls and every
            stat change the DM makes.
          </li>
          <li>
            <span className="text-stone-300">Setup:</span> campaign settings, invites and game
            toggles.
          </li>
        </ul>
      </Section>

      <Section icon={Dices} title="Dice">
        <p>
          Every check, save, and attack is rolled by the server, never invented by the AI. The dice
          button in the header toggles the 3D dice animation. If you opt into real dice in the game
          settings, the DM waits for you to enter your physical roll, with a digital fallback
          button if you would rather let the server roll.
        </p>
      </Section>

      <Section icon={Volume2} title="Voice and narration">
        <p>
          When narration is enabled, the DM reads its replies aloud. Use the speaker button in the
          header to unmute (browsers require one click before audio can play) and the slider to set
          the volume. Hover a DM message to replay its narration. Push-to-talk, when configured,
          lets you hold the microphone button to dictate your message.
        </p>
      </Section>

      <Section icon={Crown} title="Party lead">
        <p>
          The campaign owner starts as party lead and can pass the role from a party member&apos;s
          menu. The lead steers the table: the Direct message mode, approving suggested notes,
          releasing a stuck spotlight, reviewing held responses, letting new players join mid-game,
          and editing campaign settings.
        </p>
      </Section>

      <Section icon={BookOpen} title="About">
        <p>
          Open Dungeon Master is a self-hosted, multiplayer Dungeons &amp; Dragons 5e platform run
          by an AI Dungeon Master. Server admins manage users, models, images and voice from the
          Admin panel. Game content comes from the SRD 5.1 and Open5e; see{" "}
          <Link href="/licenses" className="text-amber-300 underline-offset-2 hover:underline">
            licenses and attribution
          </Link>
          .
        </p>
      </Section>
    </Dialog>
  );
}
