// Vitest global setup: one scratch root per run, removed when the run ends.
// The rules are in test-temp-root.mjs.
import os from "node:os";
import { makeRunRoot, removeReported, sweepStaleRunRoots } from "./test-temp-root.mjs";

export function setup() {
  const base = os.tmpdir();
  for (const root of sweepStaleRunRoots(base)) {
    console.log(`Removed test scratch left by an earlier run: ${root}`);
  }
  const root = makeRunRoot(base);
  // Read by vitest-file-setup.mjs in each worker; the workers are started
  // after this runs and inherit it.
  process.env.ODM_TEST_RUN_ROOT = root;
  return () => {
    removeReported(root);
  };
}
