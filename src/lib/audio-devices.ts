"use client";

// The machine's side of the table's sound: which output it plays through,
// and how hot this player's microphone goes out. Both belong to the device
// in front of the player, like the microphone id in useVoicePrefs.ts, so
// they live in localStorage and never sync to the account.

import { useSyncExternalStore } from "react";

const OUTPUT_KEY = "odm.audio.outputId";
const MIC_GAIN_KEY = "odm.voice.micGain";
const EVENT = "odm-audio-devices";

// A microphone can be turned down to silence or doubled; past that the
// gain stage only adds distortion.
export const MIC_GAIN_MAX = 2;

function readPref(key: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing and similar: the change still reaches this tab's
    // subscribers through the event, it just does not survive a reload.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeAudioDevices(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

// ---------- playback device ----------

export function readOutputId(): string {
  return readPref(OUTPUT_KEY);
}

export function useOutputId(): string {
  return useSyncExternalStore(subscribeAudioDevices, readOutputId, () => "");
}

// Chromium desktops can route a media element to a chosen output; Android
// WebView, Firefox and Safari play through whatever the system picked.
export function supportsOutputSelection(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

type Routable = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

// Every element that plays the table's sound registers here, so a change
// of output device reaches the ones already playing.
const outputs = new Set<Routable>();

function route(element: Routable, id: string) {
  if (typeof element.setSinkId !== "function") {
    return;
  }
  // An output that has since been unplugged: the element keeps playing
  // through the default rather than failing the caller.
  element.setSinkId(id).catch(() => {});
}

export function registerOutput<T extends HTMLMediaElement>(element: T): T {
  outputs.add(element);
  const id = readOutputId();
  if (id) {
    route(element, id);
  }
  return element;
}

export function releaseOutput(element: HTMLMediaElement) {
  outputs.delete(element);
}

export function writeOutputId(id: string) {
  writePref(OUTPUT_KEY, id);
  for (const element of outputs) {
    route(element, id);
  }
}

// ---------- microphone level ----------

export function readMicGain(): number {
  const raw = readPref(MIC_GAIN_KEY);
  if (!raw) {
    return 1;
  }
  const stored = Number(raw);
  return Number.isFinite(stored) && stored >= 0 ? Math.min(MIC_GAIN_MAX, stored) : 1;
}

export function useMicGain(): number {
  return useSyncExternalStore(subscribeAudioDevices, readMicGain, () => 1);
}

// The gain stages of every microphone currently open, so a slider moved
// mid-call is heard at once.
const gainNodes = new Set<GainNode>();

export function writeMicGain(gain: number) {
  const level = Number.isFinite(gain) ? Math.min(MIC_GAIN_MAX, Math.max(0, gain)) : 1;
  writePref(MIC_GAIN_KEY, String(level));
  for (const node of gainNodes) {
    node.gain.value = level;
  }
}

// The microphone through its level: the returned stream carries the
// adjusted track and behaves like the capture itself (stopping the track
// stops the microphone, disabling it silences it), so callers hold on to
// this stream in place of the raw one. Without Web Audio the raw stream
// comes back unchanged and the level setting has no effect.
export function withMicGain(raw: MediaStream): MediaStream {
  const Context = window.AudioContext;
  if (!Context) {
    return raw;
  }
  let context: AudioContext;
  try {
    context = new Context();
  } catch {
    return raw;
  }
  const gain = context.createGain();
  gain.gain.value = readMicGain();
  const destination = context.createMediaStreamDestination();
  context.createMediaStreamSource(raw).connect(gain);
  gain.connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    void context.close().catch(() => {});
    return raw;
  }
  gainNodes.add(gain);
  // Created from a click on Join, but resumed explicitly in case the
  // gesture has already been spent by then.
  void context.resume().catch(() => {});
  const stop = track.stop.bind(track);
  track.stop = () => {
    stop();
    for (const rawTrack of raw.getTracks()) {
      rawTrack.stop();
    }
    gainNodes.delete(gain);
    void context.close().catch(() => {});
  };
  // The device unplugged mid-call ends the raw track; the adjusted one
  // follows so the call sees the same thing it would without the stage.
  raw.getAudioTracks()[0]?.addEventListener("ended", () => track.stop());
  return destination.stream;
}
