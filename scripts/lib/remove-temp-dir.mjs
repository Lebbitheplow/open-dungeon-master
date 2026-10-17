// Best-effort teardown of a suite's scratch directory.
//
// The suites that use this point SQLITE_DB_PATH at a throwaway database and
// leave the connection open on purpose: closing it would hand any in-flight
// background job a dead handle, which logs a caught failure that reads like a
// real break. POSIX unlinks an open file without complaint, so the untidiness
// never shows on Linux. Windows refuses, and rmSync throws EPERM -- teardown
// failing a suite whose assertions all passed. `force` does not cover that; it
// only swallows ENOENT.
//
// So retry briefly for a lock that is merely slow to clear, then give up
// quietly: the failure is the process's own open handle, not a fault. Under
// Vitest the run's scratch root removes the directory after the worker has
// exited and reports a removal that fails (scripts/lib/test-temp-root.mjs).
import { rmSync } from "node:fs";

export function removeTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Left for the OS to reclaim; see above.
  }
}
