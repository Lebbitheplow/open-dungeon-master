import { handleMcpRequest } from "@/lib/agents/mcp-server";

// ODM's MCP endpoint (src/lib/agents/mcp-server.ts). Stateless streamable
// HTTP: every request carries its own bearer token, so there is no session
// to resume and nothing for GET or DELETE to do.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

function notAllowed() {
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}

export const GET = notAllowed;
export const DELETE = notAllowed;
