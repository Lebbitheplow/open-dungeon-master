// Module resolve hook mapping the tsconfig "@/" alias to src/ so test
// scripts can import alias-using TypeScript modules directly. Activate in
// a script with: register("./lib/register-alias.mjs", import.meta.url)
// before dynamically importing the module under test.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const srcDir = path.resolve(import.meta.dirname, "../../src");

export function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec.startsWith("@/")) {
    const bare = path.join(srcDir, spec.slice(2));
    let target = bare;
    if (!/\.(ts|tsx|json)$/.test(bare)) {
      target = fs.existsSync(path.join(bare, "index.ts"))
        ? path.join(bare, "index.ts")
        : `${bare}.ts`;
    }
    spec = pathToFileURL(target).href;
  }
  return nextResolve(spec, context);
}

// TS source imports JSON without attributes (the bundler allows it);
// plain Node insists on them, so stamp the attribute at load time.
export function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    return nextLoad(url, { ...context, importAttributes: { type: "json" } });
  }
  return nextLoad(url, context);
}
