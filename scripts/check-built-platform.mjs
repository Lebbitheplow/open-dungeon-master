// After `next build`: the compiled server must still carry its Windows
// branches. The desktop apps ship one payload built on Linux to every
// platform, and a platform check the bundler can evaluate is compiled away
// on the build machine (src/lib/host-platform.ts, client issue 14). Each
// marker below is a literal that only a Windows branch contains.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".next/server");
const MARKERS = {
  "the agent search trying .exe and .cmd names (harness/discover.ts candidatesIn)": ".COM;.EXE;.BAT;.CMD",
  "the npm shim resolver (harness/discover.ts resolveWindowsShim)": "~dp0",
  "the Windows install hint for Claude Code (harness/adapters/claude.ts)": "claude.ai/install.ps1",
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") yield* files(full);
    } else if (name.endsWith(".js")) {
      yield full;
    }
  }
}

const missing = new Set(Object.keys(MARKERS));
for (const file of files(root)) {
  const text = readFileSync(file, "utf8");
  for (const label of [...missing]) {
    if (text.includes(MARKERS[label])) missing.delete(label);
  }
  if (!missing.size) break;
}
if (missing.size) {
  console.error(`The built server at ${root} lost its Windows code:\n  ${[...missing].join("\n  ")}\nA platform check was compiled away; read it through src/lib/host-platform.ts.`);
  process.exit(1);
}
console.log("built server keeps its Windows branches");
