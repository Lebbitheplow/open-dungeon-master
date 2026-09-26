// The edge gate in front of the Durable Object (src/index.js runs it, the
// tests in test.mjs exercise it).

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Before a request reaches the Durable Object it passes two of Cloudflare's
// free rate limiters, which keep their counters in the edge and cost no
// storage at all: one per calling address, one for the broker as a whole.
// The global one is a damper, not a quota: it caps how fast anyone can burn
// through the free plan's daily request allowance, so a scanner or a stuck
// client costs minutes of 429s rather than a day of outage for every table.
// Either binding missing (tests, a fork without them) means no gate.
export async function gate(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const checks = [
    [env.PER_IP, ip],
    [env.GLOBAL, "all"],
  ];
  for (const [limiter, key] of checks) {
    if (!limiter?.limit) continue;
    const { success } = await limiter.limit({ key });
    if (!success) {
      return json({ error: "Too many requests. Try again in a minute." }, 429);
    }
  }
  return null;
}

