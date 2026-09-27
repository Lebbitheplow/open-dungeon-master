import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// npm test runs every scripts/test-*.mjs under Vitest, one file at a time.
// The scripts are plain Node programs with their own test() helpers, not
// Vitest suites: a file passes when its top level finishes without throwing,
// exactly as when each ran in its own node process, so they still run with
// `node scripts/<name>.mjs` too.

// Files in name order, as npm test always ran them. Vitest's default runs the
// slowest and last-failed first, which makes two runs' logs hard to compare.
class ByName extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
  }
}

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
    passWithNoTests: true,
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
