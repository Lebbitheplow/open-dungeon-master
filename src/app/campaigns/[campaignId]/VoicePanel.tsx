"use client";

import {
  DoorOpen,
  HeadphoneOff,
  Hand,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Settings2,
  ShieldBan,
  Users,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useVoiceRoom } from "@/app/campaigns/[campaignId]/useVoiceRoom";
import { VoicePeerRow } from "@/app/campaigns/[campaignId]/VoicePeerRow";
import { MASTER_VOLUME_MAX, VOLUME_STEP } from "@/lib/voice/volume";
import {
  FLOOR_VOICE_LABELS,
  TRANSMIT_BLOCK_LABELS,
  mayTransmit,
  type TurnEnforcement,
  type VoiceFloorMode,
} from "@/lib/voice/turn-logic";
import type { VoiceChannelView, VoiceRosterEntry } from "@/lib/voice/types";

// The voice menu. Shown in the lobby while people pick characters and in the
// session side panel during play, from the same component, because "who is on
// the call" is the same question in both places.
export function VoicePanel({
  campaignId,
  meUserId,
  roster,
  speaking,
  floorMode = "open",
  floorUserIds = [],
  turnEnforcement = "soft",
  adjudicates = false,
  sayRangeRule = false,
  audibilityVersion = 0,
  compact = false,
}: {
  campaignId: string;
  meUserId: string;
  // From the campaign SSE stream; null until the first roster event.
  roster: VoiceRosterEntry[] | null;
  speaking?: { userId: string; at: number } | null;
  floorMode?: VoiceFloorMode;
  floorUserIds?: string[];
  turnEnforcement?: TurnEnforcement;
  adjudicates?: boolean;
  // Whether the say-range rule is on, which is the only thing that makes the
  // whisper/shout selector meaningful.
  sayRangeRule?: boolean;
  audibilityVersion?: number;
  compact?: boolean;
}) {
  const voice = useVoiceRoom(campaignId, roster, meUserId, audibilityVersion);
  const [channels, setChannels] = useState<VoiceChannelView[]>([]);
  const [newRoom, setNewRoom] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  // Whose volume slider is open. One at a time, so a busy table does not turn
  // the roster into a mixing desk.
  const [volumeFor, setVolumeFor] = useState<string | null>(null);

  // Breakout rooms are in-memory and change only when the DM acts, so the
  // roster event is a good enough trigger to refetch the list. Written as a
  // promise chain rather than an awaited helper so the state update plainly
  // happens in a callback rather than in the effect body.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/voice/channels`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setChannels(data.channels ?? []);
        }
      })
      .catch(() => {
        // transient; the next roster change retries
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, roster]);

  const channelAction = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/campaigns/${campaignId}/voice/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const data = await response.json();
        setChannels(data.channels ?? []);
      }
    },
    [campaignId],
  );

  if (!voice.available) {
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-950/60 px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-stone-400">
          <Headphones className="size-4 shrink-0" />
          Voice chat is off
        </p>
        <p className="mt-1 text-xs text-stone-500">
          {voice.unavailableReason === "server"
            ? "This server has voice chat switched off."
            : "Turn it on in campaign settings to talk at this table."}
        </p>
      </div>
    );
  }

  // The server draws both edges of this (src/lib/voice/room.ts): it sends a
  // userId when somebody starts and an empty one when they stop, so there is
  // no clock to run here.
  const isSpeaking = (userId: string) => speaking?.userId === userId;

  // The same rule the server enforces, asked here only to label the UI. The
  // server is what actually pauses a producer; this never gates anything on
  // its own (src/lib/voice/turn-logic.ts).
  const myVerdict = mayTransmit(
    floorMode,
    floorUserIds,
    { userId: meUserId, adjudicates },
    turnEnforcement,
  );
  const floorNote =
    turnEnforcement === "off" || floorMode === "open" ? "" : FLOOR_VOICE_LABELS[floorMode];

  return (
    <div className={cn("rounded-lg border border-stone-800 bg-stone-950/60", compact ? "p-3" : "p-4")}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-serif text-sm text-stone-200">
          <Headphones className="size-4 text-amber-300" />
          Voice
          {voice.peers.length ? (
            <span className="text-xs text-stone-500">{voice.peers.length} on the call</span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          {voice.connected ? (
            <>
              {/* Asking for the floor without talking over whoever holds it.
                  Hidden for the DM, who never has to queue for their own
                  floor. */}
              {!adjudicates && !myVerdict.mayTransmit ? (
                <button
                  type="button"
                  onClick={() => void voice.toggleHand()}
                  aria-label={voice.handRaised ? "Lower your hand" : "Ask to speak"}
                  title={voice.handRaised ? "Lower your hand" : "Ask to speak"}
                  className={cn(
                    "rounded-md border p-2 transition-colors",
                    voice.handRaised
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  <Hand className="size-4" />
                </button>
              ) : null}
              {/* How far your voice carries. Only meaningful while the rule
                  is on, so it is hidden otherwise rather than being a control
                  that does nothing. */}
              {sayRangeRule ? (
                <select
                  value={voice.sayRange}
                  onChange={(event) =>
                    void voice.setSayRange(event.target.value as "whisper" | "normal" | "shout")
                  }
                  aria-label="How far your voice carries"
                  title="How far your voice carries"
                  className="rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-xs text-stone-300"
                >
                  <option value="whisper">Whisper</option>
                  <option value="normal">Normal</option>
                  <option value="shout">Shout</option>
                </select>
              ) : null}
              {/* Deafen. Sits next to mute because that is the pair every
                  voice app puts together, but it only silences what arrives:
                  your microphone keeps transmitting, which is why the icon
                  and the label both say headphones rather than mic. */}
              <button
                type="button"
                onClick={voice.toggleDeafen}
                aria-label={voice.deafened ? "Turn the call back on" : "Silence the call"}
                title={
                  voice.deafened
                    ? "Turn the call back on"
                    : "Silence everyone (you keep transmitting)"
                }
                className={cn(
                  "rounded-md border p-2 transition-colors",
                  voice.deafened
                    ? "border-red-800 bg-red-950/60 text-red-300"
                    : "border-stone-700 text-stone-300 hover:bg-stone-900",
                )}
              >
                {voice.deafened ? (
                  <HeadphoneOff className="size-4" />
                ) : (
                  <Headphones className="size-4" />
                )}
              </button>
              {/* In push-to-talk the same slot becomes a hold control, so
                  there is never both a mute button and a talk button arguing
                  about who owns the microphone. */}
              {voice.micMode === "ptt" ? (
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    voice.setTalking(true);
                  }}
                  onPointerUp={() => voice.setTalking(false)}
                  onPointerLeave={() => voice.setTalking(false)}
                  onContextMenu={(event) => event.preventDefault()}
                  title="Hold to talk (or hold the ` key)"
                  className={cn(
                    "select-none touch-none rounded-md border px-3 py-2 text-xs transition-colors",
                    voice.talking
                      ? "border-emerald-700 bg-emerald-950/60 text-emerald-200"
                      : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  <Radio className={cn("mr-1 inline size-3.5", voice.talking && "animate-pulse")} />
                  {voice.talking ? "Talking" : "Hold"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void voice.toggleMute()}
                  aria-label={voice.muted ? "Unmute" : "Mute"}
                  title={voice.muted ? "Unmute" : "Mute"}
                  className={cn(
                    "rounded-md border p-2 transition-colors",
                    voice.muted
                      ? "border-red-800 bg-red-950/60 text-red-300"
                      : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  {voice.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSettings((open) => !open)}
                aria-label="Microphone settings"
                title="Microphone settings"
                className={cn(
                  "rounded-md border p-2 transition-colors",
                  showSettings
                    ? "border-amber-700 bg-amber-950/50 text-amber-200"
                    : "border-stone-700 text-stone-300 hover:bg-stone-900",
                )}
              >
                <Settings2 className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => void voice.leave()}
                aria-label="Leave voice"
                title="Leave voice"
                className="rounded-md border border-stone-700 p-2 text-stone-300 hover:bg-stone-900"
              >
                <PhoneOff className="size-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={voice.status === "connecting"}
              onClick={() => void voice.join()}
              className="flex items-center gap-2 rounded-lg bg-amber-200 px-3 py-1.5 text-sm font-medium text-stone-950 hover:bg-amber-100 disabled:opacity-50"
            >
              {voice.status === "connecting" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mic className="size-4" />
              )}
              Join
            </button>
          )}
        </div>
      </div>

      {/* Whose turn it is. Shown under soft enforcement too, because saying so
          is the entire point of soft: the table is told, not policed. */}
      {floorNote ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-200/80">
          <ShieldBan className="size-3.5 shrink-0" />
          {floorNote}
          {voice.connected && !myVerdict.mayTransmit && myVerdict.block ? (
            <span className="text-stone-500">
              · {turnEnforcement === "strict" ? "you are muted" : TRANSMIT_BLOCK_LABELS[myVerdict.block]}
            </span>
          ) : null}
        </p>
      ) : null}

      {/* A dropped candidate pair is recovered by an ICE restart rather than
          by rejoining, so this is a passing state and not a failure. */}
      {voice.reconnecting ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
          <WifiOff className="size-3.5 shrink-0" />
          Connection dropped, reconnecting
        </p>
      ) : null}

      {voice.error ? <p className="mt-2 text-xs text-red-400">{voice.error}</p> : null}

      {showSettings && voice.connected ? (
        <div className="mt-2 space-y-2 rounded border border-stone-800 bg-stone-950 p-2">
          {/* Everyone at once. Lives in here rather than in the header
              because the dock is 320px wide and the header has no room, and
              because this block already says these settings are per browser.
              Per-player sliders are on each row below. */}
          <label className="block">
            <span className="mb-1 block text-[11px] text-stone-500">
              Everyone{"\u2019"}s volume
            </span>
            <input
              type="range"
              min={0}
              max={MASTER_VOLUME_MAX}
              step={VOLUME_STEP}
              value={voice.masterVolume}
              disabled={voice.deafened}
              onChange={(event) => voice.setMasterVolume(Number(event.target.value))}
              aria-label="How loud the whole call is"
              className="w-full accent-amber-600 disabled:opacity-40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-stone-500">Microphone</span>
            <select
              value={voice.micId}
              onChange={(event) => void voice.selectMic(event.target.value)}
              className="w-full rounded border border-stone-800 bg-stone-950 px-2 py-1 text-xs text-stone-200"
            >
              <option value="">System default</option>
              {voice.micDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-stone-500">
              Mode {voice.micMode === "ptt" ? "(hold ` or the button)" : ""}
            </span>
            <select
              value={voice.micMode}
              onChange={(event) => voice.selectMicMode(event.target.value as "open" | "ptt")}
              className="w-full rounded border border-stone-800 bg-stone-950 px-2 py-1 text-xs text-stone-200"
            >
              <option value="open">Open mic</option>
              <option value="ptt">Push to talk</option>
            </select>
          </label>
          <p className="text-[11px] text-stone-600">
            Saved in this browser.
          </p>
        </div>
      ) : null}

      {/* Breakout rooms. Everyone can see the list and who is in each: a side
          room nobody can see reads as a bug rather than a secret. Only story
          authority can open one or move anybody. */}
      {channels.length > 1 || adjudicates ? (
        <div className="mt-3 space-y-1.5 border-t border-stone-800 pt-2">
          {channels.map((channel) => {
            const occupants = voice.peers.filter((peer) => peer.channelId === channel.id);
            return (
              <div key={channel.id} className="flex items-center gap-2 text-xs">
                <Users className="size-3.5 shrink-0 text-stone-600" />
                <span className="truncate text-stone-400">{channel.name}</span>
                <span className="text-stone-600">{occupants.length}</span>
                {adjudicates && channel.id !== "table" ? (
                  <button
                    type="button"
                    onClick={() => void channelAction({ action: "close", channelId: channel.id })}
                    aria-label={`Close ${channel.name} and send everyone back to the table`}
                    title="Close this room and send everyone back to the table"
                    className="ml-auto text-stone-600 hover:text-red-400"
                  >
                    <DoorOpen className="size-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
          {adjudicates ? (
            <div className="flex gap-1.5 pt-1">
              <input
                value={newRoom}
                onChange={(event) => setNewRoom(event.target.value)}
                placeholder="New side room"
                className="min-w-0 flex-1 rounded border border-stone-800 bg-stone-950 px-2 py-1 text-xs text-stone-200"
              />
              <button
                type="button"
                disabled={!newRoom.trim()}
                onClick={() => {
                  void channelAction({ action: "open", name: newRoom.trim() });
                  setNewRoom("");
                }}
                className="rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
              >
                Open
              </button>
              {channels.length > 1 ? (
                <button
                  type="button"
                  onClick={() => void channelAction({ action: "recall" })}
                  title="Bring everyone back to the table"
                  className="rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
                >
                  Recall
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {voice.peers.length ? (
        <ul className="mt-3 space-y-1.5">
          {voice.peers.map((peer) => (
            <VoicePeerRow
              key={peer.userId}
              peer={peer}
              isMe={peer.userId === meUserId}
              speaking={isSpeaking(peer.userId)}
              volume={voice.peerVolume(peer.userId)}
              expanded={volumeFor === peer.userId}
              channels={channels}
              adjudicates={adjudicates}
              onToggleVolume={() =>
                setVolumeFor((open) => (open === peer.userId ? null : peer.userId))
              }
              onVolume={(value) => voice.setPeerVolume(peer.userId, value)}
              onToggleMute={() => voice.togglePeerMute(peer.userId)}
              onReset={() => voice.resetPeerVolume(peer.userId)}
              onMove={(channelId) =>
                void channelAction({ action: "move", userId: peer.userId, channelId })
              }
            />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-stone-500">Nobody is on the call yet.</p>
      )}
    </div>
  );
}
