import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// npm test runs every scripts/test-*.mjs under Vitest, one file at a time.
// The scripts are plain Node programs with their own test() helpers, not
// Vitest suites: a file passes when its top level finishes without throwing,
// exactly as when each ran in its own node process, so they still run with
// `node scripts/<name>.mjs` too.
// A failure is a throw or a process.exit(1) (which Vitest turns into an
// error); a bare process.exitCode = 1 passes unseen.
// A worker is killed when its file is done, so a suite's process "exit"
// handler never runs here: the global setup and the setup file own the
// suites' scratch directories instead (scripts/lib/test-temp-root.mjs).

// Files in name order, as npm test always ran them. Vitest's default runs the
// slowest and last-failed first, which makes two runs' logs hard to compare.
class ByName extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
  }
}

// passWithNoTests is what lets a script with no Vitest test() in it pass. It
// would also let a run that found no files at all pass (an include that
// stopped matching, a filter with a typo), so that case fails here instead.
const failAnEmptyRun = {
  onTestRunEnd(modules: readonly unknown[]) {
    if (modules.length === 0) {
      console.error("No test files ran. Check the include pattern or the file filter.");
      process.exitCode = 1;
    }
  },
};

export default defineConfig({
  resolve: {
    // What scripts/lib/register-routes.mjs does for a plain Node run.
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
      { find: /^next\/headers$/, replacement: fileURLToPath(new URL("./scripts/lib/next-headers-stub.mjs", import.meta.url)) },
    ],
  },
  test: {
    include: ["scripts/test-*.mjs"],
    globalSetup: ["scripts/lib/vitest-global-setup.mjs"],
    setupFiles: ["scripts/lib/vitest-file-setup.mjs"],
    passWithNoTests: true,
    reporters: ["default", failAnEmptyRun],
    fileParallelism: false,
    sequence: { sequencer: ByName },
    coverage: {
      provider: "v8",
      // Script tests reach src/lib and route handlers but render no UI, so
      // .tsx would only add unreachable lines to the totals.
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      reporter: ["text-summary", "html"],
      reportOnFailure: true,
    },
  },
});
