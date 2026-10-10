// The existing alias loader plus TSX compilation for server-rendered UI regressions.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { load as loadAlias } from "./register-alias.mjs";
export { resolve } from "./register-alias.mjs";
export function load(url, context, nextLoad) {
  if (url.endsWith(".tsx")) {
    return { format: "module", shortCircuit: true, source: ts.transpileModule(fs.readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  }
  return loadAlias(url, context, nextLoad);
}
