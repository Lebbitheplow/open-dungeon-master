// The operating system this server is running on, asked at run time.
//
// Never read process.platform for this in server code. The bundler knows the
// machine it is building on and compiles `process.platform === "win32"` away
// as a constant, and the desktop apps ship one server payload built on Linux
// to Windows and macOS alike: every Windows branch written that way was gone
// from the Windows app (client issue 14: the agent search never tried
// claude.exe, so an installed Claude Code read as "not found"). A call into
// node:os is opaque to the bundler and answers for the real host.

import os from "node:os";

export function hostPlatform(): NodeJS.Platform {
  return os.platform();
}

export function onWindows(): boolean {
  return hostPlatform() === "win32";
}
