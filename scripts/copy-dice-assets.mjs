// Copies dice-box-threejs textures/sounds into public/dice-box so the 3D
// dice work fully offline. Wired as postinstall; safe to rerun.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const source = path.join(
  process.cwd(),
  "node_modules",
  "@3d-dice",
  "dice-box-threejs",
  "public",
);
const destination = path.join(process.cwd(), "public", "dice-box");

if (!existsSync(source)) {
  console.warn("[dice-assets] @3d-dice/dice-box-threejs not installed; skipping.");
  process.exit(0);
}

cpSync(source, destination, { recursive: true });
console.log(`[dice-assets] Copied dice assets to ${destination}`);
