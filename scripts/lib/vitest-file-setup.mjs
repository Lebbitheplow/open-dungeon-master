// Vitest setup file: runs in each test file's worker before the file loads.
// Gives the file a scratch directory of its own inside the run's root and
// clears the ones finished files left. The rules are in test-temp-root.mjs.
import { makeFileDir, pointTempAt, sweepDeadFileDirs } from "./test-temp-root.mjs";

// No warm-up of the next turn's prompt (src/lib/dm/turn-warmup.ts) unless a
// suite asks for one: scripted models answer requests in order.
process.env.DM_TURN_WARMUP ??= "0";

const root = process.env.ODM_TEST_RUN_ROOT;
if (root) {
  sweepDeadFileDirs(root);
  pointTempAt(makeFileDir(root));
}
