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
export function lanOrigins(
  interfaces: Record<string, InterfaceAddress[] | undefined>,
  protocol: string,
  port: string,
): string[] {
  const scheme = protocol.replace(/:$/, "") === "https" ? "https" : "http";
  const suffix = port ? `:${port}` : "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entries of Object.values(interfaces)) {
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
