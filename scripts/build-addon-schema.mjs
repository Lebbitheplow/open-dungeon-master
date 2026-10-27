#!/usr/bin/env node
// Writes docs/addons/addon.schema.json from the manifest schema the server
// checks addons with (src/lib/addons/manifest.ts), so an editor can offer
// completion and errors while an author writes addon.json. The
// cross-field checks (duplicate ids, a requirement's setting) are the
// server's alone; scripts/check-addon.mjs runs them.
//
//   node scripts/build-addon-schema.mjs           write the file
//   node scripts/build-addon-schema.mjs --check   exit 1 when it is stale
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

register("./lib/register-alias.mjs", import.meta.url);

const { addonManifestSchema, ADDON_API_VERSION } = await import("../src/lib/addons/manifest.ts");
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "addons", "addon.schema.json");

const schema = {
  ...z.toJSONSchema(addonManifestSchema, { io: "input", unrepresentable: "any" }),
  $id: "https://github.com/Lebbitheplow/open-dungeon-master/blob/main/docs/addons/addon.schema.json",
  title: `Open Game Master addon manifest (addon contract ${ADDON_API_VERSION})`,
};
const text = `${JSON.stringify(schema, null, 2)}\n`;

if (process.argv.includes("--check")) {
  // A Windows checkout may hand the file back with CRLF line ends.
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== text) {
    console.error("docs/addons/addon.schema.json is stale: run node scripts/build-addon-schema.mjs");
    process.exit(1);
  }
  console.log("addon.schema.json is current");
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}
