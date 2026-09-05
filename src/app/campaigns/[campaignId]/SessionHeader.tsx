"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CircleHelp,
  Dices,
  DoorOpen,
  Music,
  Music2,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
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
  OnIcon,
  OffIcon,
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
  OnIcon: LucideIcon;
  OffIcon: LucideIcon;
}) {
  const quiet = muted || !unlocked;
  const toggleLabel = !unlocked ? enableLabel : muted ? offLabel : onLabel;
  const buttonClass = headerButtonClass(!quiet);
  const icon = quiet ? <OffIcon className="size-4" /> : <OnIcon className="size-4" />;
  return (
    <>
      <div className="hidden items-center gap-1.5 sm:flex">
        <Tooltip content={toggleLabel} side="bottom">
          <button type="button" onClick={onToggle} aria-label={toggleLabel} className={buttonClass}>
            {icon}
          </button>
        </Tooltip>
        {unlocked && !muted ? (
          <Tooltip content={volumeLabel} side="bottom">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => onVolume(Number(event.target.value))}
              className="w-16 accent-amber-600"
              aria-label={volumeLabel}
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
              <DropdownMenu.Item
                className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800"
                onSelect={onToggle}
              >
                {toggleLabel}
              </DropdownMenu.Item>
              {unlocked && !muted ? (
                // A plain row rather than an Item so dragging the slider does
                // not close the menu.
                <div className="px-2 py-1.5">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(event) => onVolume(Number(event.target.value))}
                    className="w-full accent-amber-600"
                    aria-label={volumeLabel}
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
// switches (see VoiceDock).
export function SessionHeader({
  title,
  scene,
  voice,
  dice3d,
  onToggleDice3d,
  ttsEnabled,
  narration,
  ambienceEnabled,
  ambience,
  onHelp,
}: {
  title: string;
  scene: string;
  voice: ComponentProps<typeof VoiceDock>;
  dice3d: boolean;
  onToggleDice3d: () => void;
  // Narration audio only exists on a table with TTS on; the control is
  // withheld, not disabled, when it is off.
  ttsEnabled: boolean;
  narration: NarrationAudio;
  // Likewise ambience: on in settings and the pack installed on this server.
  ambienceEnabled: boolean;
  ambience: AmbienceAudio;
  onHelp: () => void;
}) {
  const diceLabel = dice3d ? "Turn off 3D dice animation" : "Turn on 3D dice animation";
  return (
    <header className="glass z-10 flex items-center gap-3 border-b border-stone-700/40 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-base leading-tight tracking-wide text-amber-50 sm:text-lg">
          {title}
        </h1>
        <p className="truncate text-xs text-stone-500">{scene || "The adventure unfolds"}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        <VoiceDock {...voice} />
        <Tooltip content={diceLabel} side="bottom">
          <button
            type="button"
            onClick={onToggleDice3d}
            aria-label={diceLabel}
            className={headerButtonClass(dice3d)}
          >
            <Dices className="size-4" />
          </button>
        </Tooltip>
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
            OnIcon={Volume2}
            OffIcon={VolumeX}
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
            OnIcon={Music}
            OffIcon={Music2}
          />
        ) : null}
        <Tooltip content="How everything works" side="bottom">
          <button
            type="button"
            onClick={onHelp}
            aria-label="Help"
            className={headerButtonClass(false)}
          >
            <CircleHelp className="size-4" />
          </button>
        </Tooltip>
        <Tooltip content="All campaigns" side="bottom">
          <Link
            href="/"
            aria-label="All campaigns"
            className="flex items-center gap-1.5 rounded-lg border border-transparent p-2.5 text-sm text-stone-500 transition-colors hover:text-amber-200 sm:p-1.5 md:border-stone-700/70 md:px-2.5"
          >
            <DoorOpen className="size-4" />
            <span className="hidden md:inline">All campaigns</span>
          </Link>
        </Tooltip>
      </div>
    </header>
  );
}
