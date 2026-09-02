// Next's startup hook: the one code path a standalone server is guaranteed
// to run exactly once, which makes it the home for the background job loop.
// Guarded to the node runtime because register() is also evaluated for the
// edge bundle, where there is no database and no interval to own.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner } = await import("@/lib/jobs");
    startJobRunner();
  }
}
