// Cutting keys and tokens out of text, by shape and by known value. Pure, with
// no Node imports, so the browser can use it too: the server log
// (src/lib/server-log.ts) cuts every line with it, and the report bundle
// (src/lib/report-bundle.ts) cuts the page's own errors before they are kept.

// A config or environment name that holds a secret.
export const SECRET_NAME = /key|secret|token|password|passwd|credential/i;

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers, however they were printed.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // Provider key shapes: OpenAI and OpenRouter's sk-..., and their kin.
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, "[redacted key]"],
  // name=value and "name": "value" for anything named like a secret.
  [
    /\b([A-Za-z_]*(?:api[_-]?key|apikey|token|secret|password|passwd|authorization|access[_-]?key)[A-Za-z_]*)(["']?\s*[:=]\s*["']?)([^\s"',&;]{4,})/gi,
    "$1$2[redacted]",
  ],
  // Keys carried in a URL's query.
  [/([?&](?:key|token|api_key|apikey|access_token|sig|signature)=)[^&\s"']+/gi, "$1[redacted]"],
];

// Cuts each known secret value (longest first is the caller's job), then
// every key and token shape.
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) {
      out = out.split(secret).join("[redacted]");
    }
  }
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
