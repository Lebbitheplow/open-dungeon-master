// Whether the server's pages are cross-origin isolated. They are once the
// admin has accepted an addon's threads permission: a board view gets shared
// memory between its threads only inside an isolated page, and its frame only
// when its own addon asked (AddonBoardView.tsx). A server without such an
// addon sends none of this and its pages are exactly as before.
//
// The addon store sets the flag whenever addon state is written, and the
// server at start (src/instrumentation.ts); src/proxy.ts reads it for every
// page. No "@/" imports: the proxy and the store both read it.

declare global {
  var __odmIsolatePages: boolean | undefined;
}

// same-origin: the pages open no window they talk to. credentialless, not
// require-corp: a picture from another host still loads, only without its
// cookies. A frame inside must send the policy too: an addon's pages always
// do (src/lib/addons/static-files.ts) and our own PDFs get it here.
export const ISOLATION_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Embedder-Policy", "credentialless"],
];

export function setPageIsolation(on: boolean): void {
  globalThis.__odmIsolatePages = on;
}

export function pagesIsolated(): boolean {
  return globalThis.__odmIsolatePages === true;
}
