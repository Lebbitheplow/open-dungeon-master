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

  // ODM_ENV_FILE points a server at another settings file: the browser
  // runner names one that does not exist, so this machine's own models and
  // keys never reach its scenarios (an empty value in process.env falls
  // back to the file, so blanking a key there could not keep it out).
  const envPath = process.env.ODM_ENV_FILE
    ? path.resolve(/*turbopackIgnore: true*/ process.env.ODM_ENV_FILE)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), ".env.server");
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

// A world the desktop or Android app is hosting, rather than a server
// someone set up and administers. Both shells launch their bundled server
// with ODM_DEVICE_WORLD=1. One reader for every route, so the providers
// probe, the signup rule and the admin panel can never disagree about it.
export function isDeviceWorld(): boolean {
  return serverEnv("ODM_DEVICE_WORLD") === "1";
}
