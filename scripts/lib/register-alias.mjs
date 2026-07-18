// Module resolve hook mapping the tsconfig "@/" alias to src/ so test
// scripts can import alias-using TypeScript modules directly. Activate in
// a script with: register("./lib/register-alias.mjs", import.meta.url)
// before dynamically importing the module under test.
import path from "node:path";
import { pathToFileURL } from "node:url";

const srcRoot = pathToFileURL(path.resolve(import.meta.dirname, "../../src") + path.sep).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const bare = srcRoot + specifier.slice(2);
    return nextResolve(bare.endsWith(".ts") || bare.endsWith(".tsx") ? bare : `${bare}.ts`, context);
  }

  return nextResolve(specifier, context);
}
