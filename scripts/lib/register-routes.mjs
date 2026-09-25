// Module hooks for test scripts that call route handlers directly: the "@/"
// alias of register-alias.mjs, plus next/headers answered by a stub
// (next-headers-stub.mjs), since a handler called outside Next has no request
// context to read cookies from. Activate with
// register("./lib/register-routes.mjs", import.meta.url), then sign a caller
// in by setting globalThis.__odmTestToken to a mintSession token.
import { load, resolve as resolveAlias } from "./register-alias.mjs";

const stub = new URL("./next-headers-stub.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") {
    return { url: stub, shortCircuit: true };
  }
  return resolveAlias(specifier, context, nextResolve);
}

export { load };
