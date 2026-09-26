// The Cloudflare shell around src/broker.js: a Worker that gates each
// request through the free rate limiters and hands it to the one Durable
// Object, where the broker's handlers run against SQLite. Every broker
// request is exactly one Worker request plus one Durable Object request,
// both inside the free plan's daily 100,000.
//
// Nothing here is unit tested (it imports cloudflare:workers); everything
// it calls is, in test.mjs.
import { DurableObject } from "cloudflare:workers";
import worker from "./broker.js";
import { gate } from "./gate.js";
import { SqlStore, importLegacy } from "./store.js";

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

  async cron() {
    await this.ready;
    await worker.scheduled({}, this.handlerEnv);
  }
}

export default {
  async fetch(request, env) {
    const refused = await gate(request, env);
    if (refused) return refused;
    return stub(env).fetch(request);
  },

  async scheduled(_event, env) {
    await stub(env).cron();
  },
};
