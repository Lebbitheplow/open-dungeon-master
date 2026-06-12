import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let cachedEnvServer: Record<string, string> | null = null;

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvServer() {
  if (cachedEnvServer) {
    return cachedEnvServer;
  }

  const envPath = path.join(process.cwd(), ".env.server");
  if (!existsSync(envPath)) {
    cachedEnvServer = {};
    return cachedEnvServer;
  }

  cachedEnvServer = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 0) {
          return ["", ""] as const;
        }

        return [line.slice(0, separator).trim(), unquote(line.slice(separator + 1))] as const;
      })
      .filter(([key]) => key),
  );

  return cachedEnvServer;
}

export function serverEnv(key: string, fallback = "") {
  return process.env[key] || loadEnvServer()[key] || fallback;
}
