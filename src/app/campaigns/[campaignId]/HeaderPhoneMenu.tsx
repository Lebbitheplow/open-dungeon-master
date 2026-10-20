"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Coffee } from "lucide-react";
import { useState } from "react";
import { HeaderGlyph } from "@/app/campaigns/[campaignId]/SessionGlyph";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { SoundDialog, soundSummary, type SoundSteering } from "@/app/campaigns/[campaignId]/SoundPanel";
import type { AmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";
import type { NarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { TableBreakControl } from "@/app/campaigns/[campaignId]/TableBreakBanner";
import { RulebookDialog } from "@/components/rulebook/RulebookDialog";
import { Slider } from "@/components/ui/Slider";

// The table menu on a phone. Below sm the header has room for the way out,
// the title and four buttons; the rest of the table-wide controls (a break,
// narration, sound, the rulebook, help) share this one menu, each row saying in words
// what it does, which also gives a touch screen the explanations a tooltip
// only gives a mouse. Voice chat and the dice keep their own buttons beside
// it: one is a live call, the other the most used control at the table.
export function HeaderPhoneMenu({
  narrates,
  narration,
  ambienceEnabled,
  ambience,
  sound,
  onHelp,
  tableBreak,
}: {
  narrates: boolean;
  narration: NarrationAudio;
  ambienceEnabled: boolean;
  ambience: AmbienceAudio;
  sound: SoundSteering;
  onHelp: () => void;
  tableBreak?: TableBreakControl;
}) {
  const [soundOpen, setSoundOpen] = useState(false);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const row = "session-menu-row";
  const hint = (text: string) => <span className="session-menu-hint">{text}</span>;
  const narrationQuiet = narration.muted || !narration.unlocked;
  const narrationState = !narration.unlocked ? "Narration: tap to hear it" : narration.muted ? "Narration: muted" : "Narration: on";
  const soundState = ambienceEnabled ? soundSummary(ambience) : null;
  return (
    <div className="sm:hidden">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label="Table menu" data-tour="header-menu" className={headerButtonClass(false)}>
            <span className="tab-more-diamonds" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="panel z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-lg p-1">
            {tableBreak && (!tableBreak.paused || tableBreak.mayResume) ? (
              <>
                <DropdownMenu.Item className={row} onSelect={tableBreak.paused ? tableBreak.onResume : tableBreak.onPause}>
                  <span className="flex size-7 items-center justify-center">
                    <Coffee aria-hidden="true" className="size-5 text-amber-200" />
                  </span>
                  <span>
                    {tableBreak.paused ? "Resume the table" : "Pause the table"}
                    {hint(tableBreak.paused ? "End the break; play picks up where it stopped" : "A break for everyone: the story waits, table talk goes on")}
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-stone-700/60" />
              </>
            ) : null}
            {narrates ? (
              <>
                <DropdownMenu.Item
                  className={row}
                  onSelect={(event) => {
                    // The menu stays open so the volume below can be set.
                    event.preventDefault();
                    narration.unlock();
                    narration.setMuted(!narration.muted);
                  }}
                >
                  <HeaderGlyph glyph="ui-speech" off={narrationQuiet} />
                  <span>
                    {narrationState}
                    {hint("The DM's words read aloud, on this device only")}
                  </span>
                </DropdownMenu.Item>
                {narration.unlocked && !narration.muted ? (
                  // A plain row rather than an Item so dragging the slider
                  // does not close the menu.
                  <div className="px-2 pb-2 pt-1">
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={narration.volume}
                      onChange={(value) => narration.setVolume(value)}
                      label="Narration volume"
                      bubble={(value) => `${Math.round(value * 100)}%`}
                      className="w-full"
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            {soundState ? (
              <DropdownMenu.Item className={row} onSelect={() => setSoundOpen(true)}>
                <HeaderGlyph glyph="tab-ambience" off={soundState.quiet} />
                <span>
                  {soundState.tip}
                  {hint("Ambience and music, and how loud they play for you")}
                </span>
              </DropdownMenu.Item>
            ) : null}
            {narrates || soundState ? <DropdownMenu.Separator className="my-1 h-px bg-stone-700/60" /> : null}
            <DropdownMenu.Item className={row} onSelect={() => setRulebookOpen(true)}>
              <HeaderGlyph glyph="system-rules" />
              <span>
                Rulebook
                {hint("Every rule, spell and monster")}
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={row} onSelect={onHelp}>
              <HeaderGlyph glyph="tab-reference" />
              <span>
                Help
                {hint("How everything works, and the guided tours")}
              </span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {ambienceEnabled ? <SoundDialog open={soundOpen} onOpenChange={setSoundOpen} ambience={ambience} steering={sound} /> : null}
      <RulebookDialog open={rulebookOpen} onOpenChange={setRulebookOpen} />
    </div>
  );
}
