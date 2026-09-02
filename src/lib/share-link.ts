// Canonical invite links. Every surface that shares a campaign room code
// (share dialog, lobby copy button, QR) builds its links here so they all
// agree on which address and which shape to hand out.
//
// Two shapes exist on purpose:
//   joinUrl: `${origin}/join/CODE`. Human readable, opens this server
//     directly in a browser. Shown as text so people can see where a link
//     leads before they follow it.
//   appUrl: the /j interstitial on the app's one registered deep-link
//     domain (workers/j-redirector, /j?s=<origin>&c=<CODE>). It carries
//     both the server origin and the code, so a phone with the app
//     installed gets an odm:// button while one without still gets a
//     working browser join. Copy buttons and QR codes use this one.
//
// publicOrigin is the server's configured publicUrl ("" when unset); the
// fallback is the address the current visitor used. A host playing on
// 127.0.0.1 behind a tunnel must never hand out 127.0.0.1.

const SHARE_DOMAIN = "https://opendungeonmaster.com";

export type ShareLinks = {
  origin: string;
  joinUrl: string;
  appUrl: string;
};

export function buildShareLinks({
  publicOrigin,
  inviteCode,
  fallbackOrigin,
}: {
  publicOrigin: string;
  inviteCode: string;
  fallbackOrigin?: string;
}): ShareLinks {
  const fallback =
    fallbackOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const origin = (publicOrigin || fallback).replace(/\/+$/, "");
  const code = inviteCode.trim().toUpperCase();
  if (!origin || !code) {
    return { origin, joinUrl: "", appUrl: "" };
  }
  return {
    origin,
    joinUrl: `${origin}/join/${code}`,
    appUrl: `${SHARE_DOMAIN}/j?s=${encodeURIComponent(origin)}&c=${code}`,
  };
}
