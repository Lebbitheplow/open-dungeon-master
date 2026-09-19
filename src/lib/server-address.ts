// Which address to hand a friend so they can reach this server: the one the
// QR code carries and the copy button copies (ServerAddressButton).
//
// Pure functions over plain data so scripts/test-server-address.mjs can
// drive them without a network interface or a browser. The route
// (src/app/api/server/addresses) feeds lanOrigins the machine's interfaces;
// the button feeds shareableAddresses what the route said plus the address
// its own tab is on.

export type InterfaceAddress = {
  address: string;
  family: string | number;
  internal: boolean;
};

// The http(s) origins other devices on the local network can use to reach
// this process: every non-loopback IPv4 address, on the port this request
// arrived at. Link-local 169.254.x.x is left out because nothing routes to
// it, and Docker-style bridge subnets are kept because a friend on the same
// Wi-Fi cannot reach them either way and the picker lets the host choose.
const VIRTUAL_INTERFACE = /^(docker\d*|br-[0-9a-f]+|veth|virbr|cni|flannel|podman)/i;

const PRIVATE_V4 = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

// The public URL an admin (or the desktop app, when it opens a tunnel) saved,
// or "" when it can no longer be true. A private address is only a way in on
// the network it was written on: once this machine no longer holds it (a new
// router, a copied data folder, the app that set it gone), it points at
// nothing, and the QR button and every invite link would carry it. A real
// hostname or a public address is taken at its word.
export function livePublicUrl(
  publicUrl: string | null | undefined,
  interfaces: Record<string, InterfaceAddress[] | undefined>,
): string {
  const clean = (publicUrl ?? "").trim().replace(/\/+$/, "");
  if (!clean) {
    return "";
  }
  let host = "";
  try {
    host = new URL(clean).hostname;
  } catch {
    return "";
  }
  if (!PRIVATE_V4.test(host)) {
    return clean;
  }
  const mine = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      mine.add(entry.address);
    }
  }
  return mine.has(host) ? clean : "";
}

export function lanOrigins(
  interfaces: Record<string, InterfaceAddress[] | undefined>,
  protocol: string,
  port: string,
): string[] {
  const scheme = protocol.replace(/:$/, "") === "https" ? "https" : "http";
  const suffix = port ? `:${port}` : "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    // A container bridge or a virtual pair is an address only this machine
    // can reach; offering it as a way in sends a guest nowhere.
    if (VIRTUAL_INTERFACE.test(name)) {
      continue;
    }
    for (const entry of entries ?? []) {
      const isV4 = entry.family === "IPv4" || entry.family === 4;
      if (!isV4 || entry.internal || entry.address.startsWith("169.254.")) {
        continue;
      }
      const origin = `${scheme}://${entry.address}${suffix}`;
      if (!seen.has(origin)) {
        seen.add(origin);
        out.push(origin);
      }
    }
  }
  // Private ranges first: they are the ones a friend on the same network
  // can actually use. A public address on an interface still lists after.
  const rank = (origin: string) => (/^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

// The candidates in the order the button offers them. The configured public
// URL comes first when there is one: a tunnel or a reverse proxy is the
// address that works from anywhere. Then the LAN addresses, ahead of the
// current tab's own address when that address is loopback (a host playing
// on 127.0.0.1 must never hand out 127.0.0.1), and behind it otherwise.
export function shareableAddresses(input: {
  publicUrl?: string | null;
  lanUrls?: string[] | null;
  current: string;
}): string[] {
  const clean = (value: string | null | undefined) => (value ?? "").trim().replace(/\/+$/, "");
  const current = clean(input.current);
  const lan = (input.lanUrls ?? []).map(clean).filter(Boolean);
  const ordered = [
    clean(input.publicUrl),
    ...(isLoopbackOrigin(current) ? [...lan, current] : [current, ...lan]),
  ];
  const seen = new Set<string>();
  return ordered.filter((origin) => {
    if (!origin || seen.has(origin)) {
      return false;
    }
    seen.add(origin);
    return true;
  });
}
