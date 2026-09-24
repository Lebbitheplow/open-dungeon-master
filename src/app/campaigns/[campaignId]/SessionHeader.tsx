"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { memo, type ComponentProps, type ReactNode } from "react";
import { HeaderGlyph } from "@/app/campaigns/[campaignId]/SessionGlyph";
import { GameIcon } from "@/components/ui/GameIcon";
import { Slider } from "@/components/ui/Slider";
import { AccountMenu, AppHomeButton, type AccountMenuUser } from "@/components/AccountMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { VoiceDock } from "@/app/campaigns/[campaignId]/VoiceDock";
import type { NarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { AmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";

// One audio group in the header: narration or ambience. On sm+ it is the
// familiar icon button with an inline slider. Below sm the header has no
// spare width at all (the 320px budget in SessionTabs.tsx is already spent),
// so the same icon becomes a menu holding the mute toggle and the slider:
// the phone gets a reachable volume control without the header growing a
// pixel, in the menu surface the rest of the app already uses.
function HeaderAudioControl({
  onLabel,
  offLabel,
  enableLabel,
  volumeLabel,
  unlocked,
  muted,
  volume,
  onToggle,
  onVolume,
  glyph,
}: {
  onLabel: string;
  offLabel: string;
  enableLabel: string;
  volumeLabel: string;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  onToggle: () => void;
  onVolume: (value: number) => void;
  // The painting for this audio group; muted strikes it through.
  glyph: string;
}) {
  const quiet = muted || !unlocked;
  const toggleLabel = !unlocked ? enableLabel : muted ? offLabel : onLabel;
  const buttonClass = headerButtonClass(!quiet);
  const icon = <HeaderGlyph glyph={glyph} off={quiet} />;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <>
      <div className="hidden items-center sm:flex">
        <Tooltip content={toggleLabel} side="bottom">
          <button type="button" onClick={onToggle} aria-label={toggleLabel} className={buttonClass}>
            {icon}
          </button>
        </Tooltip>
        {unlocked && !muted ? (
          <Tooltip content={volumeLabel} side="bottom">
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={onVolume}
              label={volumeLabel}
              bubble={percent}
              className="session-volume"
            />
          </Tooltip>
        ) : null}
      </div>
      <div className="sm:hidden">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label={volumeLabel} className={buttonClass}>
              {icon}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="panel z-50 min-w-44 rounded-lg p-1">
              <DropdownMenu.Item className="session-menu-row" onSelect={onToggle}>
                {icon}
                {toggleLabel}
              </DropdownMenu.Item>
              {unlocked && !muted ? (
                // A plain row rather than an Item so dragging the slider does
                // not close the menu.
                <div className="px-2 pb-2 pt-3">
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={onVolume}
                    label={volumeLabel}
                    bubble={percent}
                    className="w-full"
                  />
                </div>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </>
  );
}

// The table's header: the campaign title in the display face with the scene
// line under it, and every table-wide control right-aligned after it. Voice
// lives here rather than in a panel tab because the call must survive tab
// switches (see VoiceDock). The account menu is the same one every other
// page carries, so settings, characters, log out and the app's home screen
// are one tap away from the table too.
//
// Memoized: the table re-renders on every stream event, and the header
// changes on almost none of them. SessionView hands it stable callbacks and
// memoized voice, shake, narration and ambience objects so the memo holds.
export const SessionHeader = memo(function SessionHeader({
  title,
  scene,
  user,
  voice,
  dice3d,
  onToggleDice3d,
  onCustomizeDice,
  shake,
  ttsEnabled,
  narration,
  ambienceEnabled,
  ambience,
  onHelp,
  ribbon,
}: {
  title: string;
  scene: string;
  user: AccountMenuUser;
  voice: ComponentProps<typeof VoiceDock>;
  dice3d: boolean;
  onToggleDice3d: () => void;
  // Opens the editor for the player's own dice colours.
  onCustomizeDice: () => void;
  // Shake to roll, offered only where the device can be shaken.
  shake: { supported: boolean; on: boolean; onToggle: () => void };
  // Narration audio only exists on a table with TTS on; the control is
  // withheld, not disabled, when it is off.
  ttsEnabled: boolean;
  narration: NarrationAudio;
  // Likewise ambience: on in settings and the pack installed on this server.
  ambienceEnabled: boolean;
  ambience: AmbienceAudio;
  onHelp: () => void;
  // The initiative ribbon during a fight (CinematicParts.tsx), laid along
  // the middle of the bar from md up; the phone keeps the banner above the
  // composer instead.
  ribbon?: ReactNode;
}) {
  const diceItem = "session-menu-row";
  return (
    <header className="glass session-header cine-header z-10 flex items-center gap-2 border-b border-stone-700/40 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:gap-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <h1 className="gold-title session-title font-display">{title}</h1>
        <p key={scene} className="live-in truncate font-serif text-xs italic text-stone-400">
          {scene || "The adventure unfolds"}
        </p>
      </div>
      {ribbon ? <div className="cine-ribbon-slot hidden lg:flex">{ribbon}</div> : null}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        {/* Every table-wide control on one brass plate; the way out and the
            account menu stay beside it as the app's own furniture. */}
        <div className="session-cluster">
        <VoiceDock {...voice} />
        {/* The dice menu: the 3D animation switch, the player's own dice,
            and shake to roll on a phone. The toggle used to be the button
            itself; the menu keeps it one tap away as its first item. */}
        <DropdownMenu.Root>
          <Tooltip content="Dice" side="bottom">
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Dice settings"
                data-tour="header-dice"
                className={headerButtonClass(dice3d)}
              >
                <HeaderGlyph glyph="tab-dice" />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="panel z-50 min-w-52 rounded-lg p-1">
              <DropdownMenu.CheckboxItem
                checked={dice3d}
                onCheckedChange={onToggleDice3d}
                className={diceItem}
              >
                <span className="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-3.5 text-amber-300" />
                  </DropdownMenu.ItemIndicator>
                </span>
                3D dice animation
              </DropdownMenu.CheckboxItem>
              {shake.supported ? (
                <DropdownMenu.CheckboxItem
                  checked={shake.on}
                  onCheckedChange={shake.onToggle}
                  className={diceItem}
                >
                  <span className="flex size-4 items-center justify-center">
                    <DropdownMenu.ItemIndicator>
                      <Check className="size-3.5 text-amber-300" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  Shake to roll
                </DropdownMenu.CheckboxItem>
              ) : null}
              <DropdownMenu.Separator className="my-1 h-px bg-stone-700/60" />
              <DropdownMenu.Item className={diceItem} onSelect={onCustomizeDice}>
                <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-6" />
                Customise my dice
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {ttsEnabled ? (
          <HeaderAudioControl
            onLabel="Mute narration"
            offLabel="Unmute narration"
            enableLabel="Enable narration audio"
            volumeLabel="Narration volume"
            unlocked={narration.unlocked}
            muted={narration.muted}
            volume={narration.volume}
            onToggle={() => {
              narration.unlock();
              narration.setMuted(!narration.muted);
            }}
            onVolume={(value) => narration.setVolume(value)}
            glyph="cue-horn"
          />
        ) : null}
        {ambienceEnabled && ambience.installed ? (
          <HeaderAudioControl
            onLabel="Mute ambience and music"
            offLabel="Unmute ambience and music"
            enableLabel="Enable ambience"
            volumeLabel="Ambience and music volume"
            unlocked={ambience.unlocked}
            muted={ambience.muted}
            volume={ambience.volume}
            onToggle={() => {
              ambience.unlock();
              ambience.setMuted(!ambience.muted);
            }}
            onVolume={(value) => ambience.setVolume(value)}
            glyph="tab-ambience"
          />
        ) : null}
        <Tooltip content="How everything works, and the guided tours" side="bottom">
          <button
            type="button"
            onClick={onHelp}
            aria-label="Help"
            data-tour="header-help"
            className={headerButtonClass(false)}
          >
            <HeaderGlyph glyph="tab-reference" />
          </button>
        </Tooltip>
        </div>
        <Tooltip content="All campaigns" side="bottom">
          <Link
            href="/"
            aria-label="All campaigns"
            className={cn(ui.btnSmall, "hidden h-9 gap-1.5 py-0 pl-1 sm:inline-flex")}
          >
            <HeaderGlyph glyph="tab-campaigns" />
            <span className="hidden md:inline">All campaigns</span>
          </Link>
        </Tooltip>
        <AppHomeButton className="hidden sm:block" />
        <AccountMenu user={user} onHelp={onHelp} />
      </div>
    </header>
  );
});
