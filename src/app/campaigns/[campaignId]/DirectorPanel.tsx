"use client";

import { Clapperboard, Megaphone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  MAX_ABSOLUTE_COMMAND_LENGTH,
  ONE_SHOT_EVENT_IDS,
  oneShotLabel,
  oneShotBlurb,
  type OneShotEventId,
} from "@/lib/dm/director-logic";

// Director controls above the composer: the party lead arms one steer for the
// next turn and the whole table sees that something is armed. Deliberately
// shows WHAT is armed rather than just that something is, because a directive
// nobody can inspect is indistinguishable from the DM behaving strangely.

type ArmState = {
  armed: boolean;
  oneShot: OneShotEventId | null;
  absoluteCommand: string;
};

const EMPTY: ArmState = { armed: false, oneShot: null, absoluteCommand: "" };

export function DirectorPanel({
  campaignId,
  isLead,
  armed,
}: {
  campaignId: string;
  isLead: boolean;
  // Pushed by the campaign stream so every client stays in sync; undefined
  // until the first event, which is why we also fetch once on mount.
  armed?: ArmState | null;
}) {
  // Two sources for the same fact: the stream (authoritative once it speaks)
  // and a one-off fetch that covers the window before the first event. Local
  // state holds only what this client last learned directly, and the stream
  // value wins when present, so nothing has to sync one into the other.
  const [local, setLocal] = useState<ArmState | null>(null);
  const [oneShotOpen, setOneShotOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const state = armed ?? local ?? EMPTY;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/director`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setLocal(data as ArmState);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const send = useCallback(
    async (method: "POST" | "DELETE", body?: unknown) => {
      setBusy(true);
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/director`, {
          method,
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (response.ok) {
          const data = (await response.json()) as ArmState;
          setLocal({
            armed: data.armed,
            oneShot: data.oneShot,
            absoluteCommand: data.absoluteCommand,
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [campaignId],
  );

  const armOneShot = async (id: OneShotEventId) => {
    await send("POST", { oneShot: id, absoluteCommand: "" });
    setOneShotOpen(false);
  };

  const armCommand = async () => {
    if (!command.trim()) {
      return;
    }
    await send("POST", { oneShot: null, absoluteCommand: command });
    setCommand("");
    setCommandOpen(false);
  };

  if (!isLead && !state.armed) {
    return null;
  }

  return (
    <>
      {state.armed ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {state.absoluteCommand
              ? `Direction armed: "${state.absoluteCommand}"`
              : `${state.oneShot ? oneShotLabel(state.oneShot) : "Event"} armed for the next turn`}
          </span>
          {isLead ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send("DELETE")}
              className="shrink-0 rounded p-0.5 text-amber-300/80 hover:text-amber-100 disabled:opacity-50"
              aria-label="Disarm"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {isLead ? (
        <div className="mb-2 flex gap-1.5">
          <Tooltip content="Nudge one specific kind of event into the next turn. It has to grow out of the current scene.">
            <button
              type="button"
              onClick={() => setOneShotOpen(true)}
              className="flex items-center gap-1 rounded-md border border-stone-700/60 px-2 py-1 text-[11px] text-stone-400 hover:border-stone-500 hover:text-stone-200"
            >
              <Clapperboard className="h-3 w-3" /> Event
            </button>
          </Tooltip>
          <Tooltip content="Speak to the DM directly for one turn. No character hears it and it never enters the transcript.">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="flex items-center gap-1 rounded-md border border-stone-700/60 px-2 py-1 text-[11px] text-stone-400 hover:border-stone-500 hover:text-stone-200"
            >
              <Megaphone className="h-3 w-3" /> Direct
            </button>
          </Tooltip>
        </div>
      ) : null}

      <Dialog open={oneShotOpen} onOpenChange={setOneShotOpen} title="Bring something into the scene">
        <p className="mb-3 text-xs text-stone-400">
          Applies to the next turn only. The DM brings it in through the scene the party is
          already standing in, and the party can still ignore it.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ONE_SHOT_EVENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => void armOneShot(id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                state.oneShot === id
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-200"
                  : "border-stone-700/60 text-stone-300 hover:border-stone-500 hover:text-stone-100",
              )}
            >
              <span className="block">{oneShotLabel(id)}</span>
              <span className="mt-0.5 block text-[11px] font-normal leading-snug text-stone-500">
                {oneShotBlurb(id)}
              </span>
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog open={commandOpen} onOpenChange={setCommandOpen} title="Direct the DM">
        <p className="mb-2 text-xs text-stone-400">
          One turn only. This outranks every other steer, is never spoken aloud in the story,
          and never appears in the transcript. It cannot change dice, sheets, or the story arc.
        </p>
        <textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          maxLength={MAX_ABSOLUTE_COMMAND_LENGTH}
          rows={4}
          autoFocus
          placeholder="Slow down and let the party breathe. No new threats this turn."
          className="w-full resize-none rounded-lg border border-stone-700/60 bg-stone-900/60 px-3 py-2 text-sm text-stone-200 outline-none focus:border-stone-500"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-stone-500">
            {command.length} / {MAX_ABSOLUTE_COMMAND_LENGTH}
          </span>
          <button
            type="button"
            disabled={busy || !command.trim()}
            onClick={() => void armCommand()}
            className="rounded-md bg-amber-600/80 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-40"
          >
            Arm for next turn
          </button>
        </div>
      </Dialog>
    </>
  );
}
