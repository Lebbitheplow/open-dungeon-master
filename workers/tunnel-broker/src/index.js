// The Cloudflare shell around src/broker.js: a Worker that gates each
// request through the free rate limiters and hands it to the one Durable
// Object, where the broker's handlers run against SQLite. Every broker
// request is exactly one Worker request plus one Durable Object request,
// both inside the free plan's daily 100,000.
//
// Assistant links (/w/..., src/relay.js) are the exception: the Worker
// forwards those itself, with its own limits, and asks the Durable Object
// only where a world is, at most once a minute per world per isolate.
//
// Nothing here is unit tested (it imports cloudflare:workers); everything
// it calls is, in test.mjs.
import { DurableObject } from "cloudflare:workers";
import worker from "./broker.js";
import { gate } from "./gate.js";
import { createRelay, isRelayPath } from "./relay.js";
import { SqlStore, importLegacy } from "./store.js";
import { worldRoute } from "./worlds.js";

const INSTANCE = "broker";

function stub(env) {
  return env.BROKER.get(env.BROKER.idFromName(INSTANCE));
}

export class Broker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new SqlStore((sql, ...bindings) => ctx.storage.sql.exec(sql, ...bindings).toArray());
    // The handlers see the SQLite store where they used to see KV; the
    // legacy KV binding, while it is still declared, is read once to move
    // the claims and live sessions over.
    this.handlerEnv = { ...env, SESSIONS: this.store };
    this.ready = ctx.blockConcurrencyWhile(() =>
      importLegacy(this.store, env.LEGACY_KV).catch((err) => console.error("legacy import", err)),
    );
  }

  async fetch(request) {
    await this.ready;
    return worker.fetch(request, this.handlerEnv);
  }

  async cron(cron) {
    await this.ready;
    await worker.scheduled({ cron }, this.handlerEnv);
  }

  // Where a world is, for the relay. RPC only: no HTTP path reaches it.
  async world(key) {
    await this.ready;
    return worldRoute(this.handlerEnv, key);
  }
}

const relay = createRelay({ lookup: (env, key) => stub(env).world(key) });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isRelayPath(url.pathname)) return relay(request, env);
    // The assistants' hostname carries assistant links and nothing else.
    if (env.AGENTS_ORIGIN && url.origin === new URL(env.AGENTS_ORIGIN).origin) {
      return new Response(JSON.stringify({ error: "Not found." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const refused = await gate(request, env);
    if (refused) return refused;
    return stub(env).fetch(request);
  },

  async scheduled(event, env) {
    await stub(env).cron(event.cron);
  },
};
