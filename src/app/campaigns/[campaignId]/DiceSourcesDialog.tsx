"use client";

import { Bluetooth, Dices, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import {
  DIE_SIDES,
  type DieSides,
  pixelSource,
  pixelSystemId,
  useDiceSources,
} from "@/lib/dice/dice-sources";
import {
  type ConnectedPixel,
  connectNewPixel,
  disconnectPixel,
  getConnectedPixels,
  getConnectedPixelsServer,
  identifyPixel,
  isWebBluetoothAvailable,
  onPixelsChanged,
  reconnectPixel,
} from "@/lib/dice/pixels-dice";

// Lets a player say, per die shape, where its number comes from during a
// physical roll: a tabletop die they type, a digital roll, or a specific
// Pixels Bluetooth die. Opens from the party panel's physical-dice controls.
export function DiceSourcesButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Choose where each of your dice is rolled: typed, digital, or a Pixels Bluetooth die."
        className={cn(
          "flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-xs text-stone-400 hover:bg-stone-900",
          className,
        )}
      >
        <Bluetooth className="size-3" />
        Dice sources
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Your dice sources"
        icon={<Dices className="size-5 text-amber-300" />}
      >
        <DiceSourcesPanel />
      </Dialog>
    </>
  );
}

const SOURCE_MANUAL = "manual";
const SOURCE_DIGITAL = "digital";

function DiceSourcesPanel() {
  const [sources, setSource] = useDiceSources();
  const pixels = useSyncExternalStore(
    onPixelsChanged,
    getConnectedPixels,
    getConnectedPixelsServer,
  );
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const supported = isWebBluetoothAvailable();

  // Try to bring back dice this device previously assigned, so a returning
  // player's Pixels reconnect without re-picking them. Best-effort and silent.
  useEffect(() => {
    if (!supported) {
      return;
    }
    const assigned = new Set(
      Object.values(sources)
        .map((source) => pixelSystemId(source))
        .filter((id): id is string => !!id),
    );
    const live = new Set(getConnectedPixels().map((pixel) => pixel.systemId));
    for (const systemId of assigned) {
      if (!live.has(systemId)) {
        reconnectPixel(systemId).catch(() => {});
      }
    }
    // Runs once on open; assignments rarely change mid-dialog and each attempt
    // is guarded against duplicates by the live check above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      await connectNewPixel();
    } catch (err) {
      // A user cancelling the chooser throws too; only surface real failures.
      const message = err instanceof Error ? err.message : "";
      if (message && !/cancel|user gesture|no devices/i.test(message)) {
        setError(message);
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  return (
    <div className="space-y-4 text-sm">
      {!supported ? (
        <p className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
          Bluetooth dice need a Chromium browser (Chrome, Edge, or Opera). You
          can still choose typed or digital sources below. On Linux, enable
          <span className="font-mono"> chrome://flags/#enable-web-bluetooth</span>.
        </p>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Bluetooth dice
            </span>
            <button
              type="button"
              onClick={connect}
              disabled={connecting}
              className="flex items-center gap-1.5 rounded-md border border-sky-800 bg-sky-950/40 px-2.5 py-1 text-xs text-sky-200 hover:bg-sky-950/70 disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Bluetooth className="size-3.5" />
              )}
              Connect a Pixels die
            </button>
          </div>
          {pixels.length ? (
            <ul className="space-y-1.5">
              {pixels.map((pixel) => (
                <li
                  key={pixel.systemId}
                  className="flex items-center justify-between rounded-md border border-stone-700/70 bg-stone-900/50 px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-2">
                    <span className="inline-flex size-6 items-center justify-center rounded bg-sky-950/60 font-mono text-[10px] text-sky-300">
                      d{pixel.faceCount}
                    </span>
                    <span className="text-stone-200">{pixel.name}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => identifyPixel(pixel.systemId)}
                      aria-label={`Blink ${pixel.name} so you can spot it`}
                      title="Blink this die so you can spot it"
                      className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-amber-200"
                    >
                      <Sparkles className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => disconnectPixel(pixel.systemId)}
                      aria-label={`Forget ${pixel.name}`}
                      title="Forget this die"
                      className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-red-300"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-stone-500">
              No dice connected. Connect one to assign it below.
            </p>
          )}
          {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
        </div>
      )}

      <div>
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-400">
          Roll each die with
        </span>
        <div className="space-y-1.5">
          {DIE_SIDES.map((sides) => (
            <SourceRow
              key={sides}
              sides={sides}
              value={sources[sides] ?? SOURCE_MANUAL}
              pixels={pixels.filter((pixel) => pixel.faceCount === sides)}
              onChange={(source) => setSource(sides, source)}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Assigned dice only apply while your physical-dice toggle is on. An
          assigned Bluetooth die that is offline falls back to typing.
        </p>
      </div>
    </div>
  );
}

function SourceRow({
  sides,
  value,
  pixels,
  onChange,
}: {
  sides: DieSides;
  value: string;
  pixels: ConnectedPixel[];
  onChange: (source: string) => void;
}) {
  const assignedId = pixelSystemId(value);
  const assignedOffline = assignedId
    ? !pixels.some((pixel) => pixel.systemId === assignedId)
    : false;
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="w-10 font-mono text-xs text-amber-200/90">d{sides}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex-1 rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-amber-500"
      >
        <option value={SOURCE_MANUAL}>Type it (tabletop die)</option>
        <option value={SOURCE_DIGITAL}>Digital roll</option>
        {pixels.map((pixel) => (
          <option key={pixel.systemId} value={pixelSource(pixel.systemId)}>
            {pixel.name}
          </option>
        ))}
        {assignedOffline ? (
          <option value={value}>Assigned Pixels die (offline)</option>
        ) : null}
      </select>
    </label>
  );
}
