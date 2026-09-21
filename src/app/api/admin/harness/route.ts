import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { saveGlobalConfig } from "@/lib/db/app-settings";
import { recentAgentActivity } from "@/lib/agents/activity";
import { activeBridgeSessions, harnessMcpUrl, harnessRateLimit } from "@/lib/harness/bridge";
import { generateHarnessImage } from "@/lib/harness/images";
import { forgetHarnessStatus, harnessConfig, probeAllHarnesses, probeHarness } from "@/lib/harness/status";
import { testHarness } from "@/lib/harness/test-run";
import { isHarnessId } from "@/lib/harness/types";
import { isDeviceWorld } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A test turn or a test picture runs a real program end to end.
export const maxDuration = 600;

// The agent programs on this machine (docs/harness-mcp-plan.md 6). Probing
// starts each program briefly, so answers are cached for five minutes and
// ?refresh=1 asks again. No vendor credential is ever read or returned: only
// whether the program says it is signed in, and a masked account name.
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const phone = url.searchParams.get("platform") === "android";
  const statuses = await probeAllHarnesses({ refresh, phone });
  return Response.json({
    statuses,
    config: harnessConfig(),
    usage: harnessRateLimit(),
    activeSessions: activeBridgeSessions(),
    mcpUrl: harnessMcpUrl(),
    deviceWorld: isDeviceWorld(),
    recent: recentAgentActivity({ limit: 30 }).filter((row) => row.grantKind === "turn"),
  });
}

const actionSchema = z.object({
  action: z.enum(["test", "picture", "refresh"]),
  id: z.enum(["claude", "codex", "opencode", "grok"]).optional(),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const { action, id } = parsed.data;
  if (action === "refresh") {
    forgetHarnessStatus(id);
    const status = id ? await probeHarness(id, { refresh: true }) : null;
    return Response.json({ status });
  }
  if (action === "test") {
    const config = harnessConfig();
    if (id && id !== config.id) {
      return Response.json({ error: "Save this program as the server's agent before testing it." }, { status: 409 });
    }
    return Response.json(await testHarness(isHarnessId(config.id) ? config.id : undefined));
  }
  // A real picture, made before tables are allowed to ask for one. Only a
  // success here switches the option on.
  try {
    const image = await generateHarnessImage({
      prompt: "a lantern-lit tavern doorway at dusk, painted in a warm fantasy style",
      mode: "fast",
      aspect: "square",
      force: true,
    });
    saveGlobalConfig({ harness: { imagesVerifiedAt: new Date().toISOString() } });
    forgetHarnessStatus();
    return Response.json({ image });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The picture could not be made." },
      { status: 502 },
    );
  }
}
