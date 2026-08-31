"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ONE_SHOT_EVENT_IDS,
  oneShotLabel,
  oneShotBlurb,
  type OneShotEventId,
} from "@/lib/dm/director-logic";

// The director's two surfaces, both reached through the composer's Direct
// pill rather than through controls of their own.
//
// There used to be an Event and a Direct button in a row above the composer,
// which meant the party lead had two ways to direct the DM sitting inches
// apart under the same word. The pill was already the lead's way to steer, so
// the controls folded into it and only the mechanism survived: a preset arms a
// canned event, and the pill's Private toggle arms free text. Both are the
// same one-turn steer underneath (src/lib/dm/director-logic.ts).

type ArmState = {
  armed: boolean;
  oneShot: OneShotEventId | null;
  absoluteCommand: string;
};

const EMPTY: ArmState = { armed: false, oneShot: null, absoluteCommand: "" };

// Shown to the whole table whenever something is armed. The table knowing the
// lead nudged the DM is honest; the text itself is a spoiler, so the server
// only sends the wording to the lead and everyone else gets the light alone.
export function DirectorArmedBanner({
  campaignId,
  steersStory,
  armed,
}: {
  campaignId: string;
  steersStory: boolean;
  // Pushed by the campaign stream so every client stays in sync; undefined
  // until the first event, which is why we also fetch once on mount.
  armed?: ArmState | null;
}) {
  // Two sources, and they carry different things. The stream says only
  // WHETHER something is armed, because that event reaches every player and
  // the directive's text is a spoiler. The directive itself comes from this
  // client's own request, which the server answers in full only for the lead.
  // So: armed from the stream when it has spoken, content from local always.
  const [local, setLocal] = useState<ArmState | null>(null);
  const [busy, setBusy] = useState(false);
  const isArmedNow = armed?.armed ?? local?.armed ?? false;
  const detail = local ?? EMPTY;
  const state: ArmState = {
    armed: isArmedNow,
    // Cleared the moment nothing is armed, so a spent directive's text cannot
    // linger in a stale local copy.
    oneShot: isArmedNow ? detail.oneShot : null,
    absoluteCommand: isArmedNow ? detail.absoluteCommand : "",
  };

  // Refetched whenever the armed flag flips, not just on mount: the stream
  // event is contentless, so this is how a lead's second tab (or a tab open
  // since before the arm) learns what the directive actually says.
  const armedFlag = armed?.armed;
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
  }, [campaignId, armedFlag]);

  if (!state.armed) {
    return null;
  }

  return (
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
      {steersStory ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void fetch(`/api/campaigns/${campaignId}/director`, { method: "DELETE" })
              .then((response) => (response.ok ? response.json() : null))
              .then((data) => {
                if (data) {
                  setLocal(data as ArmState);
                }
              })
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
          className={cn(ui.iconAction, "-my-1 shrink-0 disabled:opacity-50")}
          aria-label="Disarm"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// The seven canned events, shown only while the lead has Direct selected.
//
// These are presets rather than something the lead could type, because
// buildOneShotDirective wraps the choice in the introduction and scope rules
// that stop an injected event from cutting away from the scene or quietly
// advancing the arc. Two of them also tell the DM to decide something
// privately and keep it hidden, which is why arming never enters the
// transcript.
export function DirectorPresets({ campaignId }: { campaignId: string }) {
  const [busy, setBusy] = useState(false);

  const arm = useCallback(
    async (id: OneShotEventId) => {
      setBusy(true);
      try {
        await fetch(`/api/campaigns/${campaignId}/director`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ oneShot: id, absoluteCommand: "" }),
        });
      } catch {
        // The armed banner is the confirmation, and it is driven by the
        // stream. A failed arm simply leaves nothing armed.
      } finally {
        setBusy(false);
      }
    },
    [campaignId],
  );

  return (
    <>
      {ONE_SHOT_EVENT_IDS.map((id) => (
        <Tooltip key={id} content={oneShotBlurb(id)}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void arm(id)}
            className={cn(ui.btnSmall, "px-2 py-1 text-[11px] disabled:opacity-50")}
          >
            {oneShotLabel(id)}
          </button>
        </Tooltip>
      ))}
    </>
  );
}
