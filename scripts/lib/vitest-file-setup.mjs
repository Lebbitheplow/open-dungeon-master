// Vitest setup file: runs in each test file's worker before the file loads.
// Gives the file a scratch directory of its own inside the run's root and
// clears the ones finished files left. The rules are in test-temp-root.mjs.
import { makeFileDir, pointTempAt, sweepDeadFileDirs } from "./test-temp-root.mjs";

const root = process.env.ODM_TEST_RUN_ROOT;
if (root) {
  sweepDeadFileDirs(root);
  pointTempAt(makeFileDir(root));
}
