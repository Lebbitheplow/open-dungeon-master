import { cleanPageError, keepPageError, PAGE_ERROR_LIMIT, type PageError } from "@/lib/report-bundle";

// The game pages' own errors, kept in this browser for the report bundle
// (issue #459): until now an error at the table was seen by nobody unless
// the player had the developer tools open. Uncaught errors and unhandled
// rejections are kept, newest PAGE_ERROR_LIMIT only, each cut to size with
// keys and tokens cut out (cleanPageError). They stay in this browser's
// storage and go nowhere unless the player saves a report and attaches it.

const KEY = "odm.page-errors.v1";

declare global {
  var __odmPageErrors: { installed: number } | undefined;
}

export function readPageErrors(): PageError[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry === "object").map((entry) => cleanPageError(entry)).slice(-PAGE_ERROR_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function keep(raw: Parameters<typeof cleanPageError>[0]) {
  try {
    const next = keepPageError(readPageErrors(), cleanPageError({ ...raw, at: new Date().toISOString(), where: window.location.pathname }));
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage refused (private window, full): the error is simply not kept.
  }
}

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack };
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

function onError(event: ErrorEvent) {
  const described = event.error ? describe(event.error) : { message: event.message || "Unknown error" };
  keep({ kind: "error", ...described });
}

function onRejection(event: PromiseRejectionEvent) {
  keep({ kind: "rejection", ...describe(event.reason) });
}

// Starts listening on a game page; the returned function stops. Counted, so
// two pages that both install it listen once and stop when both are gone.
export function installPageErrorRecorder(): () => void {
  const state = (globalThis.__odmPageErrors ??= { installed: 0 });
  state.installed += 1;
  if (state.installed === 1) {
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
  }
  return () => {
    state.installed = Math.max(0, state.installed - 1);
    if (state.installed === 0) {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    }
  };
}
