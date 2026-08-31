"use client";

import {
  BookOpen,
  CircleHelp,
  Copy,
  Hammer,
  Map,
  Share2,
  StickyNote,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Section } from "@/components/HelpDialog";

// The workshop's own walkthrough. The main HelpDialog is written for a table
// mid-session; a workshop has no table, no transcript and no AI turns, so its
// help is a separate short read rather than three confusing paragraphs of
// exceptions inside the session one. Opened from the workshop shelf and the
// workshop shell header.
export function WorkshopHelpDialog({
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
      title="About workshops"
      icon={<CircleHelp className="size-5 text-amber-500/80" />}
      width="w-[min(94vw,44rem)]"
    >
      <Section icon={Hammer} title="What a workshop is">
        <p>
          A workshop is a prep space: everything a campaign holds, with no players, no transcript
          and no AI narrator. Build the material on your own time, then bring it into a real
          campaign when the table sits down. Nothing you do here can start a fight or move a
          story, because there is no story running.
        </p>
        <p>
          The stand-in party bar at the top sets the party size and level your prep is measured
          against, so encounter difficulty readouts mean something before real characters exist.
        </p>
      </Section>

      <Section icon={Map} title="The authoring tools">
        <p>
          The tabs are the same tools a human DM has mid-session, pointed at prep instead of play.
          Battle maps has a drawing surface: paint terrain with a brush, stamp props, generate a
          layout from a seed and theme, import a UVTT file, or hang a backdrop image behind the
          grid. Region is the overworld: paint the land, add and anchor places, name them. Cast
          builds NPCs with personalities, goals and relationships; Bestiary builds full stat
          blocks with the challenge rating derived for you, and its kit assembles a monster from
          ancestry, class and gear picks. Encounters puts rosters together against the stand-in
          party, and can name which prepared map the fight starts on. Tables rolls up random
          tables, Lore holds the setting notes, and Rules carries the house rules and any saved
          ruleset.
        </p>
      </Section>

      <Section icon={StickyNote} title="The storyboard">
        <p>
          The storyboard is the plan of the adventure: cards for scenes, fights, places, people
          and payoffs, linked to the material in the other tabs by picking from dropdowns rather
          than typing names. The compile preview shows what each card becomes when the board is
          imported into a campaign, so a hole in the plan shows up here and not at the table.
        </p>
      </Section>

      <Section icon={Share2} title="Into a campaign, and back out">
        <p>
          Creating a campaign offers a <span className="text-stone-300">Bring in prep</span> step:
          pick a workshop (or another campaign you can see) and choose what to copy in. A campaign
          lobby can import the same way after creation. Copies are copies: the workshop keeps its
          version, the campaign owns its own from then on, and name collisions get numbered
          instead of overwritten.
        </p>
        <p>
          The Share tab exports the whole workshop as a bundle file another server can import, and
          can compile a draft world pack from it.
        </p>
      </Section>

      <Section icon={Copy} title="Copying things">
        <p>
          A whole workshop can be cloned from the shelf, and individual pieces (maps, NPCs,
          monsters, encounters, tables, lore) each have a duplicate action in their list, for the
          version-two-of-this-boss workflow. Homebrew monsters belong to your account rather than
          to any one workshop, so they follow you everywhere but do not travel inside bundles sent
          to other people.
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
