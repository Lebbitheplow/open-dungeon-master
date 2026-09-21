// The environment an agent program is started with. Built from an allowlist,
// never by copying process.env: the server's own environment holds
// DB_ENCRYPTION_KEY and every provider key, and a program that reads player
// text must never be one prompt away from printing them. Pure, no `@/`
// imports, so scripts/test-harness-env.mjs can load it directly.

// What a program needs to find its own sign-in, config and temp space.
const PASSED_THROUGH = [
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SHELL",
  "TERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  // Windows: profile folders, where the programs keep their sign-in.
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
  "PROGRAMDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "NUMBER_OF_PROCESSORS",
  // Proxies and certificates, so a program behind a corporate proxy still
  // reaches its vendor.
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

// Each program's own sign-in and home variables. A key set here belongs to
// the admin and to that program; it is handed only to the program it names.
const PER_HARNESS: Record<string, readonly string[]> = {
  claude: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "AWS_REGION",
    "AWS_PROFILE",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "CLOUD_ML_REGION",
  ],
  codex: ["CODEX_HOME", "OPENAI_API_KEY", "CODEX_API_KEY"],
  opencode: ["OPENCODE_CONFIG_DIR"],
  grok: ["GROK_HOME", "XAI_API_KEY"],
};

// Names that must never pass, whatever an allowlist entry above might
// match in the future. Checked last.
const NEVER = /^(DB_ENCRYPTION_KEY|OPENAI_COMPAT_API_KEY|OPENROUTER_API_KEY|OPENAI_IMAGE_API_KEY|DISCORD_CLIENT_SECRET|SQLITE_DB_PATH|CONTENT_DB_PATH|ODM_.*)$/;

export function buildChildEnv(
  parent: Record<string, string | undefined>,
  harness: string,
  path: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...PASSED_THROUGH, ...(PER_HARNESS[harness] ?? [])]) {
    const value = parent[name];
    if (typeof value === "string" && value !== "" && !NEVER.test(name)) {
      env[name] = value;
    }
  }
  env.PATH = path;
  for (const [name, value] of Object.entries(extra)) {
    if (!NEVER.test(name) || name === "ODM_MCP_TOKEN") {
      env[name] = value;
    }
  }
  return env;
}

// True when nothing the server holds as a secret reached the child. Used by
// the runner as a last check before spawning, and by the tests.
export function leaksServerSecret(
  env: Record<string, string>,
  parent: Record<string, string | undefined>,
): string | null {
  for (const [name, value] of Object.entries(env)) {
    if (name === "ODM_MCP_TOKEN") {
      continue;
    }
    if (NEVER.test(name)) {
      return name;
    }
    for (const secretName of ["DB_ENCRYPTION_KEY", "OPENAI_COMPAT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_IMAGE_API_KEY"]) {
      const secret = parent[secretName];
      if (secret && secret.length >= 8 && value.includes(secret)) {
        return name;
      }
    }
  }
  return null;
}
