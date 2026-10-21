"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, Check, Coffee } from "lucide-react";
import { memo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { HeaderGlyph } from "@/app/campaigns/[campaignId]/SessionGlyph";
import { GameIcon } from "@/components/ui/GameIcon";
import { Slider } from "@/components/ui/Slider";
import { AccountMenu, AppHomeButton, type AccountMenuUser } from "@/components/AccountMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { VoiceDock } from "@/app/campaigns/[campaignId]/VoiceDock";
import { useCapabilities } from "@/lib/use-capabilities";
import { RulebookDialog } from "@/components/rulebook/RulebookDialog";
import type { NarrationAudio } from "@/app/campaigns/[campaignId]/useNarrationAudio";
import type { AmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";
import { SoundControl, type SoundSteering } from "@/app/campaigns/[campaignId]/SoundPanel";
import { LayoutMenu } from "@/app/campaigns/[campaignId]/TableLayoutParts";
import { HeaderPhoneMenu } from "@/app/campaigns/[campaignId]/HeaderPhoneMenu";
import type { LayoutSeat } from "@/app/campaigns/[campaignId]/table-layout-store";
import type { TableBreakControl } from "@/app/campaigns/[campaignId]/TableBreakBanner";

// The narration group in the header from sm up: the familiar icon button
// with an inline slider. Below sm the header has no spare width, and the same
// mute toggle and slider live in the phone's table menu (HeaderPhoneMenu.tsx).
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
  held = 0,
}: {
  onLabel: string;
  offLabel: string;
  enableLabel: string;
  volumeLabel: string;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  // `enabling` is true when the press began on the "enable" state: by the
  // time the click lands, the page's pointerdown has already unlocked audio
  // and re-rendered, so the state at the press is captured here.
  onToggle: (enabling: boolean) => void;
  onVolume: (value: number) => void;
  // The painting for this audio group; muted strikes it through.
  glyph: string;
  // Clips the browser is holding until a gesture on this page, counted on
  // the icon as well as said above the composer (AudioWaitingBanner.tsx).
  held?: number;
}) {
  const quiet = muted || !unlocked;
  const waiting = !muted && held > 0;
  const toggleLabel = waiting ? `${enableLabel} (${held} waiting)` : !unlocked ? enableLabel : muted ? offLabel : onLabel;
  const buttonClass = headerButtonClass(!quiet);
  const enablingRef = useRef(false);
  const notePress = () => {
    enablingRef.current = !unlocked && !muted;
  };
  const icon = <HeaderGlyph glyph={glyph} off={quiet} />;
  // Beside the button, not in it: the button's press effect clips what it
  // holds (.motion-press is overflow: hidden), and the table's are round.
  // Placed from the row's left edge, where the button starts, so the button
  // and its volume slider stay siblings for the header's hover reveal
  // (.session-hbtn ~ .session-volume in world.css).
  const badge = waiting ? (
    <span
      key={held}
      aria-hidden
      className="count-pop pointer-events-none absolute -top-1 left-6 z-10 min-w-4 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-center text-[10px] font-semibold leading-4 text-amber-950 shadow-glow-gold"
    >
      {held}
    </span>
  ) : null;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <div className="relative hidden items-center sm:flex">
      <Tooltip content={toggleLabel} side="bottom">
        <button
          type="button"
          onPointerDown={notePress}
          onKeyDown={notePress}
          onClick={() => {
            onToggle(enablingRef.current);
            enablingRef.current = false;
          }}
          aria-label={toggleLabel}
          className={buttonClass}
        >
          {icon}
        </button>
      </Tooltip>
      {badge}
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
  onRollDice,
  shake,
  ttsEnabled,
  narration,
  ambienceEnabled,
  ambience,
  sound,
  onHelp,
  ribbon,
  stage,
  layoutSeat,
  tableBreak,
}: {
  title: string;
  scene: string;
  user: AccountMenuUser;
  voice: ComponentProps<typeof VoiceDock>;
  dice3d: boolean;
  onToggleDice3d: () => void;
  // Opens the editor for the player's own dice colours.
  onCustomizeDice: () => void;
  // Opens the dice tray: loose dice, rolled for the table or in secret.
  onRollDice: () => void;
  // Shake to roll, offered only where the device can be shaken.
  shake: { supported: boolean; on: boolean; onToggle: () => void };
  // Narration audio only exists on a table with TTS on; the control is
  // withheld, not disabled, when it is off.
  ttsEnabled: boolean;
  narration: NarrationAudio;
  // Likewise ambience: on in settings. The library may still be empty; the
  // sound panel says so rather than hiding, because "where is the sound"
  // had no answer when the button simply was not there.
  ambienceEnabled: boolean;
  ambience: AmbienceAudio;
  // Who may change what plays, and where to send it (SoundPanel.tsx).
  sound: SoundSteering;
  onHelp: () => void;
  // The initiative ribbon during a fight (CinematicParts.tsx), laid along
  // the middle of the bar from md up; the phone keeps the banner above the
  // composer instead.
  ribbon?: ReactNode;
  // The fight stage switch, shown while a board is on the table: the board
  // in the main column or the story there, with the board in its tab.
  stage?: { on: boolean; onToggle: () => void };
  // Whose arrangement the layout menu edits (TableLayoutParts.tsx): the
  // DM seat keeps one, every player seat another.
  layoutSeat?: LayoutSeat;
  // Pause the table for a break (TableBreakBanner.tsx): any person in a
  // seat, from sm up here and in the phone's table menu below it.
  tableBreak?: TableBreakControl;
}) {
  // Narration switched off server-wide: no passage is read aloud, so the
  // narration volume would steer nothing (issue 275; the lobby's own row
  // reads Off for the same reason).
  const capabilities = useCapabilities();
  const narrates = ttsEnabled && capabilities?.tts?.provider !== "off";
  const diceItem = "session-menu-row";
  return (
    <header className="glass session-header cine-header z-10 flex items-center gap-2 border-b border-stone-700/40 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:gap-3 sm:px-4">
      {/* The way out on a phone. From sm up the All campaigns button below
          is it; under sm that button has no room, and a door behind the
          avatar menu is not one a newcomer, or an installed app with no
          browser back button, finds. The title gives up the width. */}
      <Link
        href="/"
        aria-label="All campaigns"
        className="-ml-1.5 flex size-10 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:text-amber-200 sm:hidden"
      >
        <ArrowLeft className="size-5" />
      </Link>
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
        {/* The dice menu: the dice tray (open or secret rolls) first, then
            the 3D animation switch, the player's own dice, and shake to
            roll on a phone. */}
        <DropdownMenu.Root>
          <Tooltip content="Dice" side="bottom">
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Dice"
                data-tour="header-dice"
                className={headerButtonClass(dice3d)}
              >
                <HeaderGlyph glyph="tab-dice" />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="panel z-50 min-w-52 rounded-lg p-1">
              <DropdownMenu.Item className={diceItem} onSelect={onRollDice}>
                <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-6" />
                <span>
                  Roll dice
                  <span className="session-menu-hint">For the table, or in secret</span>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-stone-700/60" />
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
        {narrates ? (
          <HeaderAudioControl
            onLabel="Mute narration"
            offLabel="Unmute narration"
            enableLabel="Enable narration audio"
            volumeLabel="Narration volume"
            unlocked={narration.unlocked}
            muted={narration.muted}
            volume={narration.volume}
            held={narration.held}
            onToggle={(enabling) => {
              // "Enable narration audio" must not also mute: toggling here
              // used to switch narration off on that first press and drop
              // every passage that had been waiting for it.
              narration.unlock();
              if (!enabling) {
                narration.setMuted(!narration.muted);
              }
            }}
            onVolume={(value) => narration.setVolume(value)}
            glyph="ui-speech"
          />
        ) : null}
        {ambienceEnabled ? (
          <div className="hidden sm:flex">
            <SoundControl ambience={ambience} steering={sound} />
          </div>
        ) : null}
        {stage ? (
          <Tooltip content={stage.on ? "Show the story here, with the board in its tab" : "Show the board here, with the story beside it"} side="bottom">
            <button
              type="button"
              onClick={stage.onToggle}
              aria-label={stage.on ? "Show the story" : "Show the board"}
              aria-pressed={stage.on}
              data-tour="header-stage"
              className={headerButtonClass(stage.on)}
            >
              <HeaderGlyph glyph={stage.on ? "tab-story" : "tab-battle"} />
            </button>
          </Tooltip>
        ) : null}
        {layoutSeat ? <LayoutMenu seat={layoutSeat} /> : null}
        {tableBreak ? (
          <div className="hidden sm:flex">
            <TableBreakButton control={tableBreak} />
          </div>
        ) : null}
        <div className="hidden sm:flex">
          <RulebookButton />
        </div>
        <div className="hidden sm:flex">
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
        <HeaderPhoneMenu
          narrates={narrates}
          narration={narration}
          ambienceEnabled={ambienceEnabled}
          ambience={ambience}
          sound={sound}
          onHelp={onHelp}
          tableBreak={tableBreak}
        />
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

// Pause for a break, or, while one is on, Resume for those who may lift it.
// Lit while the table is paused; for anyone else it only says so.
function TableBreakButton({ control }: { control: TableBreakControl }) {
  const label = !control.paused
    ? "Pause the table for a break"
    : control.mayResume
      ? "Resume the table"
      : "The table is paused";
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        onClick={control.paused ? control.onResume : control.onPause}
        disabled={control.paused && !control.mayResume}
        aria-label={label}
        aria-pressed={control.paused}
        data-tour="header-pause"
        className={headerButtonClass(control.paused)}
      >
        <Coffee aria-hidden="true" className="size-5 text-amber-200" />
      </button>
    </Tooltip>
  );
}

// The rulebook, laid open over the table so a rule can be checked without
// leaving the session.
function RulebookButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip content="The rulebook: every rule, spell and monster" side="bottom">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Rulebook"
          data-tour="header-rulebook"
          className={headerButtonClass(open)}
        >
          <HeaderGlyph glyph="system-rules" />
        </button>
      </Tooltip>
      <RulebookDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
