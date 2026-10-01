// A character the server refuses comes back with `error` (the first
// problem) and `problems` (all of them, src/lib/characters/admit.ts). The
// builder's hosts showed only the first, so a sheet with three things wrong
// was fixed and sent three times (U:UB8). This is the text a host keeps:
// every problem, one per line, which FinishStep lists.
export function refusalText(data: unknown, fallback: string): string {
  const body = (data ?? {}) as { error?: unknown; problems?: unknown };
  const problems = Array.isArray(body.problems)
    ? body.problems.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
  if (problems.length > 1) {
    return problems.join("\n");
  }
  return typeof body.error === "string" && body.error ? body.error : (problems[0] ?? fallback);
}
