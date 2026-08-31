"use client";

import { Hand, Mic, MicOff, ShieldBan, Volume1, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PEER_VOLUME_MAX,
  VOLUME_STEP,
  isDefaultPeer,
  type PeerVolume,
} from "@/lib/voice/volume";
import type { VoiceChannelView, VoiceRosterEntry } from "@/lib/voice/types";

// One person on the call. Lifted out of VoicePanel once the row grew a volume
// control: it now carries three microphone states, the name, a raised hand,
// the breakout select and a disclosure holding this listener's slider for
// them, which is more than belongs inline in a map.
//
// The slider is folded away rather than always shown because the panel is
// 320px wide in the header dock, where five inline sliders would be a wall. A
// disclosure also beats a dropdown here: Radix DropdownMenu is the only
// popover in this project and SessionView already had to work around it
// closing on a slider drag.
export function VoicePeerRow({
  peer,
  isMe,
  speaking,
  volume,
  expanded,
  channels,
  adjudicates,
  onToggleVolume,
  onVolume,
  onToggleMute,
  onReset,
  onMove,
}: {
  peer: VoiceRosterEntry;
  isMe: boolean;
  speaking: boolean;
  volume: PeerVolume;
  expanded: boolean;
  channels: VoiceChannelView[];
  adjudicates: boolean;
  onToggleVolume: () => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
  onReset: () => void;
  onMove: (channelId: string) => void;
}) {
  // You have no consumer for yourself, so there is nothing to turn down.
  const adjustable = !isMe;
  const untouched = isDefaultPeer(volume);
  const VolumeIcon = volume.muted || volume.volume === 0 ? VolumeX : volume.volume < 0.5 ? Volume1 : Volume2;
  const percent = Math.round(volume.volume * 100);

  return (
    <li className="text-sm">
      <div className="flex items-center gap-2">
        {/* Three distinct states, because they mean different things: a
            force-mute is the floor, a self-mute is a choice, and speaking is
            neither. All three are about their microphone, not about the
            volume control below, which is only ever yours. */}
        {peer.forceMuted ? (
          <ShieldBan className="size-3.5 shrink-0 text-amber-700" />
        ) : peer.muted || !peer.producing ? (
          <MicOff className="size-3.5 shrink-0 text-stone-600" />
        ) : (
          <Mic
            className={cn("size-3.5 shrink-0", speaking ? "text-emerald-300" : "text-emerald-700")}
          />
        )}
        <span
          className={cn(
            "truncate",
            speaking && "text-stone-100",
            isMe ? "text-amber-200" : "text-stone-300",
          )}
        >
          {peer.username}
          {isMe ? " (you)" : ""}
        </span>
        {peer.handRaisedAt ? (
          <Hand className="size-3.5 shrink-0 text-amber-300" aria-label="Wants to speak" />
        ) : null}
        {/* Joined but not yet publishing: their browser is still asking for the
            microphone, which is worth saying so the silence does not read as a
            fault. */}
        {!peer.producing ? <span className="text-xs text-stone-600">connecting</span> : null}
        {adjustable ? (
          <button
            type="button"
            onClick={onToggleVolume}
            aria-label={`How loud ${peer.username} is for you`}
            title={
              volume.muted
                ? `${peer.username} is muted for you`
                : `${peer.username} plays at ${percent}% for you`
            }
            aria-expanded={expanded}
            className={cn(
              "ml-auto shrink-0 rounded p-0.5 transition-colors",
              // Coloured when it is not at its default, so a row somebody
              // turned down is legible without opening anything.
              untouched ? "text-stone-600 hover:text-stone-300" : "text-amber-400",
            )}
          >
            <VolumeIcon className="size-3.5" />
          </button>
        ) : null}
        {/* Moving somebody is a field change, so it takes effect on the next
            recompute with no renegotiation and no gap in audio. */}
        {adjudicates && channels.length > 1 ? (
          <select
            value={peer.channelId}
            onChange={(event) => onMove(event.target.value)}
            aria-label={`Move ${peer.username} to another room`}
            title={`Move ${peer.username}`}
            className={cn(
              "rounded border border-stone-800 bg-stone-950 px-1 py-0.5 text-[11px] text-stone-400",
              !adjustable && "ml-auto",
            )}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {expanded && adjustable ? (
        <div className="mt-1 flex items-center gap-2 pl-5">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={volume.muted ? `Unmute ${peer.username}` : `Mute ${peer.username} for you`}
            title={volume.muted ? `Unmute ${peer.username}` : `Mute ${peer.username} for you`}
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors",
              volume.muted ? "text-red-400" : "text-stone-500 hover:text-stone-300",
            )}
          >
            {volume.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={PEER_VOLUME_MAX}
            step={VOLUME_STEP}
            value={volume.volume}
            disabled={volume.muted}
            onChange={(event) => onVolume(Number(event.target.value))}
            aria-label={`How loud ${peer.username} is for you`}
            className="min-w-0 flex-1 accent-amber-600 disabled:opacity-40"
          />
          {/* Doubles as the way back to default, because a slider is hard to
              land exactly on 100% by hand. */}
          <button
            type="button"
            onClick={onReset}
            disabled={untouched}
            title="Back to normal"
            className="w-9 shrink-0 text-right text-[11px] tabular-nums text-stone-500 enabled:hover:text-stone-300 disabled:cursor-default"
          >
            {volume.muted ? "off" : `${percent}%`}
          </button>
        </div>
      ) : null}
    </li>
  );
}
