"use client";

// A device's own speech recognizer, offered by an app shell. The Android app
// installs one at window.odmDictation (the phone's SpeechRecognizer, on the
// device where the phone supports it), so a DM can dictate even when the
// server they play on has no speech-to-text at all. The browser never has
// one: the dictation button falls back to it only when the server cannot
// listen, and hides when neither can.

export type NativeDictationHandlers = {
  // 0 to 1, as the voice gets louder.
  onLevel?: (level: number) => void;
  // Everything heard so far in this take, refined as the speaker goes on.
  onPartial?: (text: string) => void;
  // The recognizer gave up mid-take (no network for a cloud recognizer,
  // the microphone taken by a call). What was heard so far still arrives
  // from stop().
  onError?: (message: string) => void;
};

export type NativeDictation = {
  // Resolves once the recognizer is listening; rejects with a sentence to
  // show when it cannot (no permission, no recognizer on this device).
  start(handlers: NativeDictationHandlers): Promise<void>;
  // Ends the take and resolves with everything that was said.
  stop(): Promise<string>;
  // Ends the take and throws it away.
  cancel(): Promise<void>;
};

declare global {
  interface Window {
    odmDictation?: NativeDictation;
  }
}

// Fired on window when a shell installs (or replaces) window.odmDictation,
// which it may do after the page has drawn: the check for a recognizer
// runs in native code and answers asynchronously.
export const NATIVE_DICTATION_EVENT = "odm-dictation";

export function subscribeNativeDictation(listener: () => void): () => void {
  window.addEventListener(NATIVE_DICTATION_EVENT, listener);
  return () => window.removeEventListener(NATIVE_DICTATION_EVENT, listener);
}

export function nativeDictation(): NativeDictation | null {
  if (typeof window === "undefined") {
    return null;
  }
  const bridge = window.odmDictation;
  return bridge && typeof bridge.start === "function" ? bridge : null;
}
