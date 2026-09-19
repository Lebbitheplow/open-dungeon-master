"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DiceSourcesPanel } from "@/app/campaigns/[campaignId]/DiceSourcesDialog";
import {
  PTT_KEY,
  readMicId,
  readMicMode,
  setMasterVolume,
  subscribeMicPrefs,
  useVolumePrefs,
  writeMicId,
  writeMicMode,
  type MicMode,
} from "@/app/campaigns/[campaignId]/useVoicePrefs";
import {
  MIC_GAIN_MAX,
  registerOutput,
  releaseOutput,
  supportsOutputSelection,
  useMicGain,
  useOutputId,
  writeMicGain,
  writeOutputId,
} from "@/lib/audio-devices";
import { AUDIO_PREF_FIELDS, writeAudioPref, type AudioPrefField } from "@/lib/audio-prefs";
import { cn } from "@/lib/cn";
import { DiceLookButton } from "@/components/DiceLookEditor";
import {
  requestMotionAccess,
  supportsShake,
  useShakeToRoll,
  writeShakeToRoll,
} from "@/lib/dice/shake-to-roll";
import {
  isEffectsAuto,
  useEffectsMode,
  useTurnChime,
  writeEffectsMode,
  writeTurnChime,
} from "@/lib/effects-mode";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Slider as KitSlider } from "@/components/ui/Slider";
import { Switch as KitSwitch } from "@/components/ui/Switch";
import { ui } from "@/lib/ui";
import { paintedMapsOn, writePaintedMaps } from "@/lib/painted-maps";
import { MASTER_VOLUME_MAX, VOLUME_STEP } from "@/lib/voice/volume";

// Everything about the machine in front of the player: which microphone
// and how hot, which output and how loud, and the dice on the table. The
// apps mount this on their own Settings screen, reachable from every page
// including mid-call and mid-table, so a preference changed here has to
// reach whatever is already playing: every control writes the same store
// the table's hooks read (useVoicePrefs, audio-devices, audio-prefs,
// dice-sources), and those hooks apply the change live.

const BUTTON = cn(ui.btnSmall, "shrink-0 px-2.5 py-1 text-xs");
// The kit Select needs a non-empty value to show a choice; the stores keep ""
// for "whatever the system uses", so that one option is translated both ways.
const SYSTEM_DEFAULT = "__default";
const MIC_MODES: SelectOption<MicMode>[] = [
  { value: "open", label: "Open mic" },
  { value: "ptt", label: "Push to talk" },
];

function deviceOptions(devices: Device[]): SelectOption<string>[] {
  return [
    { value: SYSTEM_DEFAULT, label: "System default" },
    // A browser without permission reports every device with an empty id.
    ...devices.filter((device) => device.deviceId).map((device) => ({ value: device.deviceId, label: device.label })),
  ];
}

const ROW = "flex items-center justify-between gap-3";
const LABEL = "text-xs text-stone-400";

type Device = { deviceId: string; label: string };

// The microphones and outputs the browser knows. Labels are only readable
// once microphone permission has been granted; `allow` asks for it with a
// capture that is stopped the moment it starts.
function useDevices() {
  const [inputs, setInputs] = useState<Device[]>([]);
  const [outputs, setOutputs] = useState<Device[]>([]);
  const [labelled, setLabelled] = useState(false);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const named = (kind: MediaDeviceKind, noun: string): Device[] =>
        devices
          .filter((device) => device.kind === kind)
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `${noun} ${index + 1}`,
          }));
      setInputs(named("audioinput", "Microphone"));
      setOutputs(named("audiooutput", "Output"));
      setLabelled(devices.some((device) => device.label));
    } catch {
      // No device access at all; the selects stay on the system default.
    }
  }, []);

  useEffect(() => {
    // Deferred a tick: the list arrives asynchronously anyway, and the
    // first render is not held for it.
    void Promise.resolve().then(refresh);
    const media = navigator.mediaDevices;
    media?.addEventListener?.("devicechange", refresh);
    return () => media?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  const allow = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
    } catch {
      // Denied: the list keeps its numbered placeholders.
    }
    await refresh();
  }, [refresh]);

  return { inputs, outputs, labelled, allow };
}

// A live level from the chosen microphone while the player tests it, with
// the level setting applied so the bar shows what the call would send.
function useMicMeter(deviceId: string, gain: number) {
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const gainRef = useRef(gain);
  useEffect(() => {
    gainRef.current = gain;
  }, [gain]);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    stopRef.current?.();
    stopRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        const rms = Math.sqrt(sum / samples.length);
        setLevel(Math.min(1, rms * 3 * gainRef.current));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      stopRef.current = () => {
        cancelAnimationFrame(frame);
        for (const track of stream.getTracks()) {
          track.stop();
        }
        void context.close().catch(() => {});
      };
      setTesting(true);
    } catch {
      setTesting(false);
    }
  }, [deviceId]);

  // A different microphone picked mid-test moves the meter to it.
  useEffect(() => {
    if (stopRef.current) {
      void start();
    }
  }, [start]);

  useEffect(() => () => stopRef.current?.(), []);

  return { level, testing, start, stop };
}

// A short tone through the chosen output, so "which one is the headset"
// can be answered without joining a call.
async function playTestTone() {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  oscillator.frequency.value = 440;
  const gain = context.createGain();
  gain.gain.value = 0.2;
  oscillator.connect(gain);
  gain.connect(destination);
  const audio = registerOutput(new Audio());
  audio.srcObject = destination.stream;
  oscillator.start();
  await audio.play().catch(() => {});
  setTimeout(() => {
    oscillator.stop();
    audio.pause();
    audio.srcObject = null;
    releaseOutput(audio);
    void context.close().catch(() => {});
  }, 700);
}

// Narration and ambience keep their own keys and events (audio-prefs.ts);
// read the same way their hooks do, so this panel and the table agree.
function useAudioFlag(field: AudioPrefField, fallback: boolean): boolean {
  const { key, event } = AUDIO_PREF_FIELDS[field];
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(event, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(event, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === "1";
    },
    () => fallback,
  );
}

function useAudioLevel(field: AudioPrefField, fallback: number): number {
  const { key, event } = AUDIO_PREF_FIELDS[field];
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(event, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(event, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => {
      const stored = Number(window.localStorage.getItem(key));
      return Number.isFinite(stored) && stored > 0 ? Math.min(1, stored) : fallback;
    },
    () => fallback,
  );
}

const DICE3D_KEY = "odm:dice3d";
const DICE3D_EVENT = "odm-dice3d-pref";

function subscribeDice3d(listener: () => void) {
  window.addEventListener(DICE3D_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(DICE3D_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Slider({
  label,
  value,
  max,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <span className={cn(ROW, "mb-1")}>
        <span className={LABEL}>{label}</span>
        <span className="font-mono text-xs text-stone-300">{percent(value)}</span>
      </span>
      <KitSlider
        min={min}
        max={max}
        step={VOLUME_STEP}
        value={value}
        onChange={onChange}
        label={label}
        bubble={percent}
        className="w-full"
      />
    </div>
  );
}

function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={ROW}>
      <span className={LABEL}>{label}</span>
      <KitSwitch on={on} onChange={onChange} label={label} />
    </div>
  );
}

function MicrophoneSection({ devices }: { devices: ReturnType<typeof useDevices> }) {
  const micId = useSyncExternalStore(subscribeMicPrefs, readMicId, () => "");
  const micMode = useSyncExternalStore(subscribeMicPrefs, readMicMode, () => "open" as MicMode);
  const gain = useMicGain();
  const meter = useMicMeter(micId, gain);
  return (
    <section>
      <SectionHead title="Microphone" glyph="cue-horn" />
      <div className="space-y-3">
        <div>
          <span className={cn(LABEL, "mb-1 block")}>Recording device</span>
          <Select
            value={micId || SYSTEM_DEFAULT}
            onChange={(value) => writeMicId(value === SYSTEM_DEFAULT ? "" : value)}
            options={deviceOptions(devices.inputs)}
            label="Recording device"
            size="sm"
            className="w-full"
          />
          {!devices.labelled ? (
            <button type="button" onClick={() => void devices.allow()} className={cn(BUTTON, "mt-1.5")}>
              Allow microphone access to see device names
            </button>
          ) : null}
        </div>
        <Slider label="Recording level" value={gain} max={MIC_GAIN_MAX} onChange={writeMicGain} />
        <div className={ROW}>
          <div className="h-2 flex-1 overflow-hidden rounded-full border border-amber-500/15 bg-stone-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-[width] duration-75"
              style={{ width: percent(meter.level) }}
            />
          </div>
          <button
            type="button"
            onClick={() => (meter.testing ? meter.stop() : void meter.start())}
            className={BUTTON}
          >
            {meter.testing ? "Stop test" : "Test microphone"}
          </button>
        </div>
        <div className={ROW}>
          <span className={LABEL}>
            Mode{micMode === "ptt" ? ` (hold ${PTT_KEY === "Backquote" ? "`" : PTT_KEY} or the talk button)` : ""}
          </span>
          <Select
            value={micMode}
            onChange={writeMicMode}
            options={MIC_MODES}
            label="Microphone mode"
            size="sm"
            align="end"
          />
        </div>
      </div>
    </section>
  );
}

function PlaybackSection({ devices }: { devices: ReturnType<typeof useDevices> }) {
  const outputId = useOutputId();
  const volumes = useVolumePrefs();
  const narrationMuted = useAudioFlag("narrationMuted", false);
  const narrationVolume = useAudioLevel("narrationVolume", 0.8);
  const ambienceMuted = useAudioFlag("ambienceMuted", false);
  const ambienceVolume = useAudioLevel("ambienceVolume", 0.6);
  const selectable = supportsOutputSelection();
  return (
    <section>
      <SectionHead title="Playback" glyph="tab-ambience" />
      <div className="space-y-3">
        <div>
          <span className={cn(LABEL, "mb-1 block")}>Playback device</span>
          {selectable ? (
            <div className="reveal flex items-center gap-2">
              <Select
                value={outputId || SYSTEM_DEFAULT}
                onChange={(value) => writeOutputId(value === SYSTEM_DEFAULT ? "" : value)}
                options={deviceOptions(devices.outputs)}
                label="Playback device"
                size="sm"
                className="min-w-0 flex-1"
              />
              <button type="button" onClick={() => void playTestTone()} className={BUTTON}>
                Test
              </button>
            </div>
          ) : (
            <p className="text-xs text-stone-500">
              Sound plays through the output this device has selected; change it in the system
              settings.
            </p>
          )}
        </div>
        <Slider
          label="Voice chat"
          value={volumes.master}
          max={MASTER_VOLUME_MAX}
          onChange={setMasterVolume}
        />
        <Slider
          label="Narration"
          value={narrationVolume}
          max={1}
          min={VOLUME_STEP}
          onChange={(value) => writeAudioPref("narrationVolume", value)}
        />
        <Switch
          label="Narration read aloud"
          on={!narrationMuted}
          onChange={(on) => writeAudioPref("narrationMuted", !on)}
        />
        <Slider
          label="Ambience"
          value={ambienceVolume}
          max={1}
          min={VOLUME_STEP}
          onChange={(value) => writeAudioPref("ambienceVolume", value)}
        />
        <Switch
          label="Ambience"
          on={!ambienceMuted}
          onChange={(on) => writeAudioPref("ambienceMuted", !on)}
        />
      </div>
    </section>
  );
}

function DiceSection() {
  const dice3d = useSyncExternalStore(
    subscribeDice3d,
    () => window.localStorage.getItem(DICE3D_KEY) !== "off",
    () => true,
  );
  const shake = useShakeToRoll();
  // Sampled once: the sensor and the pointer type do not change mid-visit.
  const [canShake] = useState(() => supportsShake());
  return (
    <section>
      <SectionHead title="Dice" glyph="die-d20" />
      <div className="space-y-3">
        <Switch
          label="Roll 3D dice on the table"
          on={dice3d}
          onChange={(on) => {
            window.localStorage.setItem(DICE3D_KEY, on ? "on" : "off");
            window.dispatchEvent(new Event(DICE3D_EVENT));
          }}
        />
        <DiceLookButton />
        {canShake ? (
          <div>
            <Switch
              label="Shake to roll"
              on={shake}
              onChange={(on) => {
                if (on) {
                  void requestMotionAccess().then((granted) => writeShakeToRoll(granted));
                } else {
                  writeShakeToRoll(false);
                }
              }}
            />
            <p className="mt-1 text-xs text-stone-500">
              Your rolls wait for you at the table; shake this device to roll them. A tap
              works too.
            </p>
          </div>
        ) : null}
        <SectionHead title="Physical dice" glyph="tab-dice" level="h4" className="mb-0" />
        <DiceSourcesPanel />
      </div>
    </section>
  );
}

// The decorative half of the board (particles, breathing auras, weather,
// the drift on scene art). Facts always play; this is what a slow phone
// turns off. "Auto" follows the device's reported memory and the app
// shell's device class (src/lib/effects-mode.ts).
function EffectsSection() {
  const mode = useEffectsMode();
  const chime = useTurnChime();
  const [auto, setAuto] = useState(() => isEffectsAuto());
  const [painted, setPainted] = useState(() => paintedMapsOn());
  return (
    <section>
      <SectionHead title="Effects" glyph="cue-arcane" />
      <div className="space-y-3">
        <Switch
          label="Full effects on the board and scene"
          on={mode === "full"}
          onChange={(on) => {
            writeEffectsMode(on ? "full" : "low");
            setAuto(false);
          }}
        />
        <p className="text-xs text-stone-500">
          {auto
            ? mode === "low"
              ? "Set to low automatically for this device. Hits, numbers and rings still play."
              : "Chosen automatically for this device."
            : "Chosen by you."}
          {!auto ? (
            <button
              type="button"
              onClick={() => {
                writeEffectsMode("auto");
                setAuto(true);
              }}
              className={cn(ui.btnSmall, "ml-2 px-2 py-0.5 text-[11px]")}
            >
              Let the device decide
            </button>
          ) : null}
        </p>
        <Switch
          label="Painted battle maps"
          on={painted}
          onChange={(on) => {
            writePaintedMaps(on);
            setPainted(on);
          }}
        />
        <p className="text-xs text-stone-500">
          Paints each board from its terrain on this device. Off keeps the drawn board, which is lighter on an old phone.
        </p>
        <Switch label="Chime when it is your turn" on={chime} onChange={writeTurnChime} />
      </div>
    </section>
  );
}

export function DeviceSettings() {
  const devices = useDevices();
  return (
    <div className="space-y-6 text-sm text-stone-200">
      <MicrophoneSection devices={devices} />
      <PlaybackSection devices={devices} />
      <EffectsSection />
      <DiceSection />
    </div>
  );
}
