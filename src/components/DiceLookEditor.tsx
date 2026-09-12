"use client";

import { Dices, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import {
  DEFAULT_DICE_LOOK,
  DICE_LOOK_PRESETS,
  DICE_MATERIALS,
  DICE_TEXTURES,
  diceLookKey,
  diceLookTheme,
  sameDiceLook,
  type DiceLook,
  type DiceMaterial,
  type DiceTexture,
} from "@/lib/dice/dice-look";
import { hydrateDiceLook, useDiceLook, writeDiceLook } from "@/lib/dice/dice-look-store";

// The player's own dice: a live 3D tray showing the current look, presets
// to start from, and the colours, outline, texture and finish to tweak.
// Every change writes the account setting at once (dice-look-store), so
// the table behind the dialog, and every other device, follows along.

const LABEL = "text-xs text-stone-400";
const SELECT = cn(
  "w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs",
  "text-stone-200 outline-none focus:border-amber-500",
);

type PreviewBox = {
  initialize: () => Promise<void>;
  roll: (notation: string) => Promise<unknown>;
  clearDice: () => void;
  updateConfig: (config: Record<string, unknown>) => Promise<void>;
  renderer?: { dispose: () => void; forceContextLoss: () => void; domElement: HTMLCanvasElement };
};

// The preview throws the same dice every time so the eye compares looks,
// not outcomes.
const PREVIEW_ROLLS = ["1d20@20", "1d6@6", "1d8@8"];

let previewCounter = 0;

// A small tray of its own, re-themed and re-thrown whenever the look
// changes. One WebGL context for the dialog's lifetime, torn down on close
// (Firefox caps live contexts, see DiceOverlay).
function DiceLookPreview({ look }: { look: DiceLook }) {
  const [id] = useState(() => `dice-look-preview-${++previewCounter}`);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<PreviewBox | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  // The look most recently asked for; a change that lands while a throw is
  // in flight is applied after it, and only the newest one.
  const wantedRef = useRef<DiceLook>(look);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
        if (cancelled) return;
        const box = new DiceBox(`#${id}`, {
          assetPath: "/dice-box/",
          sounds: false,
          shadows: true,
          light_intensity: 0.9,
          baseScale: 70,
          gravity_multiplier: 300,
          ...diceLookTheme(look),
        }) as unknown as PreviewBox;
        await box.initialize();
        if (cancelled) {
          dispose(box);
          return;
        }
        boxRef.current = box;
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    };
    void run();
    return () => {
      cancelled = true;
      dispose(boxRef.current);
      boxRef.current = null;
    };
    // The box is themed from the first look and re-themed by the effect
    // below; recreating it per change would leak contexts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    wantedRef.current = look;
    if (state !== "ready" || busyRef.current) return;
    busyRef.current = true;
    const apply = async () => {
      try {
        let applied = "";
        while (boxRef.current && applied !== diceLookKey(wantedRef.current)) {
          const wanted = wantedRef.current;
          applied = diceLookKey(wanted);
          const box = boxRef.current;
          box.clearDice();
          await box.updateConfig(diceLookTheme(wanted));
          for (const notation of PREVIEW_ROLLS) {
            if (!boxRef.current || applied !== diceLookKey(wantedRef.current)) break;
            await box.roll(notation);
          }
        }
      } catch {
        // A wedged preview must not break the editor; the swatches still
        // show the colours.
      } finally {
        busyRef.current = false;
      }
    };
    void apply();
  }, [look, state]);

  return (
    <div className="relative h-52 overflow-hidden rounded-lg border border-stone-700/70 bg-[radial-gradient(ellipse_at_center,rgba(120,90,40,0.25),rgba(12,10,20,0.9))]">
      <div
        id={id}
        ref={hostRef}
        aria-hidden
        className="absolute inset-0 [&_canvas]:!bg-transparent"
      />
      {state === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center text-stone-500">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : null}
      {state === "failed" ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-stone-500">
          The 3D preview needs WebGL. Your choices still apply at the table.
        </div>
      ) : null}
    </div>
  );
}

function dispose(box: PreviewBox | null) {
  if (!box) return;
  try {
    box.clearDice();
  } catch {
    // Never throw on teardown.
  }
  try {
    box.renderer?.dispose();
    box.renderer?.forceContextLoss();
    box.renderer?.domElement.remove();
  } catch {
    // Same.
  }
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className={LABEL}>{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-stone-500">{value.toUpperCase()}</span>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label={label}
          className="h-8 w-12 cursor-pointer rounded-md border border-stone-700 bg-stone-900 p-0.5"
        />
      </span>
    </label>
  );
}

// Two-tone swatch: the face colour with the number colour as a dot, and the
// outline as a ring when there is one.
function Swatch({ look, className }: { look: DiceLook; className?: string }) {
  return (
    <span
      className={cn("relative inline-flex size-7 items-center justify-center rounded-full", className)}
      style={{
        backgroundColor: look.face,
        boxShadow: look.outline ? `0 0 0 2px ${look.outline} inset` : undefined,
      }}
    >
      <span className="size-2.5 rounded-full" style={{ backgroundColor: look.numbers }} />
    </span>
  );
}

// The editor proper. Mounted on the account settings page and inside the
// table's dice dialog; both draw the preview.
export function DiceLookEditor({ className }: { className?: string }) {
  const look = useDiceLook();
  useEffect(() => {
    hydrateDiceLook();
  }, []);

  const set = (patch: Partial<DiceLook>) => writeDiceLook({ ...look, ...patch });
  const isDefault = sameDiceLook(look, DEFAULT_DICE_LOOK);
  // Outline off remembers nothing; turning it on starts from black.
  const outlined = look.outline !== "";

  return (
    <div className={cn("space-y-4 text-sm", className)}>
      <DiceLookPreview look={look} />

      <div>
        <span className={cn(LABEL, "mb-2 block font-medium uppercase tracking-wide")}>
          Start from
        </span>
        <div className="flex flex-wrap gap-1.5">
          {DICE_LOOK_PRESETS.map((preset) => {
            const active = sameDiceLook(preset.look, look);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => writeDiceLook(preset.look)}
                title={preset.label}
                aria-label={`${preset.label} dice`}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition-colors",
                  active
                    ? "border-amber-500/70 bg-amber-950/40 text-amber-100"
                    : "border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200",
                )}
              >
                <Swatch look={preset.look} className="size-6" />
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <ColorField label="Die colour" value={look.face} onChange={(face) => set({ face })} />
          <ColorField
            label="Number colour"
            value={look.numbers}
            onChange={(numbers) => set({ numbers })}
          />
          <div className="flex items-center justify-between gap-3">
            <span className={LABEL}>Number outline</span>
            <span className="flex items-center gap-2">
              {outlined ? (
                <input
                  type="color"
                  value={look.outline}
                  onChange={(event) => set({ outline: event.target.value.toUpperCase() })}
                  aria-label="Outline colour"
                  className="h-8 w-12 cursor-pointer rounded-md border border-stone-700 bg-stone-900 p-0.5"
                />
              ) : null}
              <button
                type="button"
                role="switch"
                aria-checked={outlined}
                onClick={() => set({ outline: outlined ? "" : "#000000" })}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  outlined
                    ? "border-amber-700 bg-amber-950/40 text-amber-200"
                    : "border-stone-700 text-stone-400 hover:bg-stone-900",
                )}
              >
                {outlined ? "On" : "Off"}
              </button>
            </span>
          </div>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className={cn(LABEL, "mb-1 block")}>Pattern</span>
            <select
              value={look.texture}
              onChange={(event) => set({ texture: event.target.value as DiceTexture })}
              aria-label="Pattern"
              className={SELECT}
            >
              {DICE_TEXTURES.map((texture) => (
                <option key={texture.id} value={texture.id}>
                  {texture.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={cn(LABEL, "mb-1 block")}>Finish</span>
            <select
              value={look.material}
              onChange={(event) => set({ material: event.target.value as DiceMaterial })}
              aria-label="Finish"
              className={SELECT}
            >
              {DICE_MATERIALS.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-stone-500">
          Your dice follow your account: every table and every device shows them.
        </p>
        <button
          type="button"
          onClick={() => writeDiceLook(DEFAULT_DICE_LOOK)}
          disabled={isDefault}
          className="flex shrink-0 items-center gap-1 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40"
        >
          <RotateCcw className="size-3" /> Reset
        </button>
      </div>
    </div>
  );
}

// The editor in a dialog, for the table and the apps' settings screen.
export function DiceLookDialog({
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
      title="Your dice"
      icon={<Dices className="size-5 text-amber-300" />}
      width="w-[min(92vw,38rem)]"
    >
      {open ? <DiceLookEditor /> : null}
    </Dialog>
  );
}

// A small button that opens the dialog; the party panel and the device
// settings panel use it.
export function DiceLookButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const look = useDiceLook();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Choose the colours, pattern and finish of your virtual dice."
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded border border-stone-700 py-1 text-xs text-stone-400 hover:bg-stone-900",
          className,
        )}
      >
        <Swatch look={look} className="size-4" />
        Customise my dice
      </button>
      <DiceLookDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
