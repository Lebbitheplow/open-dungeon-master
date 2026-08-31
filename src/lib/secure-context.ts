// Why the microphone is unavailable, in words that point at the actual fix.
//
// Browsers only expose navigator.mediaDevices in a secure context: HTTPS, or
// localhost. On a plain http LAN address it is simply undefined, so calling
// getUserMedia throws a TypeError that looks nothing like a permissions
// problem. Push-to-talk used to report that case as "Microphone unavailable.
// Check browser permissions", which sends the player to a permission the
// browser never asked for and cannot be granted.
//
// Shared by PushToTalk (speech-to-text) and VoiceBar (live voice), because
// both want a microphone and both hit this the same way.

export type MicBlockReason = "insecure" | "unsupported" | "";

export function micBlockReason(): MicBlockReason {
  if (typeof window === "undefined") {
    return "";
  }
  // The secure-context check comes first: an insecure page has no
  // mediaDevices at all, so testing for the API would report the wrong cause.
  if (!window.isSecureContext) {
    return "insecure";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }
  return "";
}

export function micBlockMessage(reason: MicBlockReason): string {
  if (reason === "insecure") {
    return "Microphone access needs HTTPS. This page is plain http, so the browser blocks the mic before asking permission. Reach the app over https, or on localhost.";
  }
  if (reason === "unsupported") {
    return "This browser does not support microphone capture.";
  }
  return "";
}

export function micBlocked(): boolean {
  return micBlockReason() !== "";
}
