"use client";

import Link from "next/link";
import {
  BookOpen,
  Brain,
  CircleHelp,
  Compass,
  Crown,
  Dices,
  DoorOpen,
  MessageSquareText,
  PanelRight,
  Puzzle,
  RefreshCw,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";

// Exported for HowToPlayDialog, which is the short orientation read to this
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

// One walkthrough of the whole app: menus, side-panel tabs, composer modes,
// asking the DM, fixing a bad narration, what the DM remembers, dice, voice,
// lead powers and world packs. Opened from the home account menu and the
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
        <p>
          If the server has campaign plugins installed, the create form also offers a{" "}
          <span className="text-stone-300">pre-built world</span> to run the campaign in. See
          Campaign plugins below for what that changes.
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
          tale, or arm one of the seven canned events: Combat, Place, Social, Romance, Mystery,
          Weird or Windfall. Turn on <span className="text-stone-300">Private</span> and the
          direction goes to the DM alone: no character hears it, it never enters the transcript,
          and it steers the next turn instead of this one. The table still sees that something is
          armed, just never what.
        </ModeRow>
        <p>
          Questions are not one of these buttons. Open the{" "}
          <span className="text-stone-300">Ask the DM</span> strip just above the message box and
          use its own question box. Set <span className="text-stone-300">About</span> to Auto,
          Story, Rules or My sheet to say where the answer should come from, and{" "}
          <span className="text-stone-300">Seen by</span> to Just me or The table to say who reads
          it. Answers quote what the campaign has on record under{" "}
          <span className="text-stone-300">From the record</span>.
        </p>
        <p>
          Asking writes nothing to the transcript and never moves the story on, so it works during
          narration, during someone else&apos;s spotlight, and while the floor is locked. Collapsing
          the strip keeps a half-typed question and your place in the thread.
        </p>
        <p>
          Sometimes the DM puts one player in the spotlight and waits for them to act. While the
          floor is locked for you, a banner explains why, and OOC and the Ask strip still work.
          Small chips above the message box name the background work the engine is doing between
          turns, such as compacting history, sealing a chapter, running the world tick or answering
          an Ask, with how long it has been going.
        </p>
      </Section>

      <Section icon={RefreshCw} title="When the DM gets it wrong">
        <p>
          Hover a DM message and a row of actions appears above it. None of them advance the story
          or change a single number the rules produced. Rewriting the narration belongs to the
          party lead, since everyone reads the same transcript:
        </p>
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-stone-300">Reroll:</span> lead only. Have the DM write that
            moment again with the same dice and the same outcome, optionally with a note on what to
            do differently. Only the prose changes.
          </li>
          <li>
            <span className="text-stone-300">Takes:</span> lead only. Once a second version exists,
            arrows and a counter appear in the message header. Paging between takes swaps the
            message for the whole table.
          </li>
          <li>
            <span className="text-stone-300">Continue:</span> lead only. Have the DM keep writing
            from where a reply stopped short, without moving the story on.
          </li>
          <li>
            <span className="text-stone-300">Edit:</span> lead only. Fix what the DM said by hand.
            Mechanics are untouched and every dice marker in the passage has to survive the edit.
          </li>
          <li>
            <span className="text-stone-300">Lore check:</span> anyone. Flag the passage, or just
            the text you selected, against the campaign record and see whether it contradicts
            anything already established.
          </li>
        </ul>
        <p>
          If a DM turn fails outright, a banner offers to send it back in from where it stopped. It
          resumes the turn that was already running, so nobody has to retype an action and nothing
          lands in the transcript twice.
        </p>
      </Section>

      <Section icon={Brain} title="What the DM remembers">
        <p>
          Recent turns are in front of the DM word for word. Older ones are compacted into a
          rolling summary, and closed chapters become chapter summaries it can search and re-read
          when the table brings up something from long ago.
        </p>
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-stone-300">Remember:</span> any player can select text in a DM
            message and press the bookmark icon, or press it with nothing selected to keep the
            whole message. Pinned memories ride in every prompt from then on. There is a size
            budget, and the Pinned memories list under Story, Facts shows how much of it the table
            has spent.
          </li>
          <li>
            <span className="text-stone-300">Pin as canon:</span> party lead only, because it
            writes to the campaign record. Keeps a passage in front of the DM permanently as
            established fact.
          </li>
          <li>
            <span className="text-stone-300">Facts and lore:</span> Story, Facts also holds DM
            secrets the DM must never contradict and the lore entries the table has written up.
          </li>
          <li>
            <span className="text-stone-300">Bonds:</span> under Party, where each character stands
            with the people they have dealt with.
          </li>
        </ul>
        <p>
          NPCs the party stops mentioning are archived so they do not crowd out the ones in play,
          and the party lead can see exactly what the DM was sent on the last turn, plus anything
          the budget cut, in the Context tab.
        </p>
      </Section>

      <Section icon={PanelRight} title="The side panel">
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-stone-300">Party:</span> the roster, with character sheets, HP and
            conditions for the whole party, the invite code, and the active encounter during
            combat. A Bonds sub-tab appears when relationships are on.
          </li>
          <li>
            <span className="text-stone-300">Battle:</span> the tactical battle map, while a fight
            with a map is running. Move your token on your turn.
          </li>
          <li>
            <span className="text-stone-300">Map:</span> the scene map, the overworld and
            discovered locations, when maps are enabled.
          </li>
          <li>
            <span className="text-stone-300">Story:</span> three sub-tabs. Chapters is the tale so
            far and the arc in play, and it is where you export the story. Facts holds pinned
            memories, DM secrets and lore. Log is the audited record of every dice roll and every
            stat change the DM makes.
          </li>
          <li>
            <span className="text-stone-300">Notes:</span> suggest campaign notes for the story; the
            party lead approves them.
          </li>
          <li>
            <span className="text-stone-300">Chat:</span> private whispers between you and the DM,
            and side chat between players that the DM and the campaign transcript never see.
          </li>
          <li>
            <span className="text-stone-300">Context:</span> party lead only. What the DM was
            actually sent last turn, and anything the token budget dropped.
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
          menu. The lead steers the table: the Direct message mode with its event presets and
          private directions, approving suggested notes, releasing a stuck spotlight, retrying a
          halted turn, rerolling or editing a narration, letting new players join mid-game, and
          editing campaign settings and house rules.
        </p>
        <p>
          The lead also owns the story spine, under Story, Chapters. A single beat can be reworded,
          skipped or promoted to the one in play without regenerating the whole arc, a chapter can
          be sealed early, and the whole campaign can be rewound to the start of a chapter. A
          rewind is destructive: it asks for confirmation and lists what it will undo first, then
          puts sheets, NPCs, locations, maps and quest state back the way they were.
        </p>
        <p>
          Where the engine spots two NPC names that might be the same person but refuses to merge
          them on a guess, the lead is the one who settles it.
        </p>
      </Section>

      <Section icon={Puzzle} title="Campaign plugins">
        <p>
          A campaign can run in a <span className="text-stone-300">world pack</span>: a pre-built
          setting with its own races, classes, spells, gear, monsters, factions and lore, and a
          brief telling the DM how that world should sound. Picking one at creation also sets the
          campaign&apos;s genre and can fill in its theme and premise.
        </p>
        <p>
          A pack renames things, it never changes a rule. Everything underneath is still 5e, your
          sheet still stores the canonical names, and a character built in a pack campaign can be
          brought into a plain one and simply reads under its ordinary names again.
        </p>
        <p>
          Server admins install and remove packs under Admin, Campaign plugins, from a registry or
          from a file. A pack built on somebody else&apos;s setting carries an unofficial-work
          notice wherever it appears: it is fan-made and is not affiliated with, sponsored by or
          endorsed by the rights holder.
        </p>
      </Section>

      <Section icon={BookOpen} title="New to D&amp;D?">
        <p>
          You do not need to know the rules to play; the DM and the server handle them. When a term
          comes up that you do not recognize, look for the small info button next to it: every
          feature, spell and stat on your sheet explains itself.
        </p>
        <p>
          The{" "}
          <Link href="/reference" className="text-amber-300 underline-offset-2 hover:underline">
            rules reference
          </Link>{" "}
          collects the basics in plain language and lets you search every spell, feat, item and
          condition the app knows about.
        </p>
      </Section>

      <Section icon={BookOpen} title="About">
        <p>
          Open Dungeon Master is a self-hosted, multiplayer Dungeons &amp; Dragons 5e platform run
          by an AI Dungeon Master. Server admins manage users, models, images, voice and campaign
          plugins from the Admin panel. Game content comes from the SRD 5.1 and Open5e; see{" "}
          <Link href="/licenses" className="text-amber-300 underline-offset-2 hover:underline">
            licenses and attribution
          </Link>
          .
        </p>
      </Section>
    </Dialog>
  );
}
