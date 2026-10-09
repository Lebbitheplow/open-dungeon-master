// Pure string work on a backend address, shared by the model client, the
// picture and speech backends and the shared-host policy
// (src/lib/shared-host.ts), which is why it lives apart from them.

// Whether a backend address is on this machine or the local network, where
// a key guards the door rather than bills for the call: loopback, the
// private IPv4 ranges, link-local, ULA IPv6, and names that never leave a
// LAN (localhost, a bare hostname, .local, .lan, .internal, .home.arpa).
export function isPrivateBackendHost(url: string): boolean {
  let host = "";
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) {
    return false;
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "localhost" || bare === "::1" || bare === "0.0.0.0" || bare === "::") {
    return true;
  }
  if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(bare)) {
    return true;
  }
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(bare) || /^fe80:/i.test(bare)) {
    return true;
  }
  if (!bare.includes(".") || /\.(local|lan|internal|home\.arpa|localhost)$/.test(bare)) {
    return true;
  }
  return false;
}
