# MCP control plane

Open Dungeon Master can expose campaign administration to an MCP-capable agent without giving that agent shell access, a Docker socket, or direct SQLite access.

The design has two layers:

```text
MCP client
  -> MCP sidecar (HTTP bearer auth or local stdio)
  -> POST /api/internal/mcp (same bearer token)
  -> existing ODM domain/database functions
```

The sidecar is optional. With no `ODM_MCP_TOKEN`, the internal route fails closed and normal ODM operation is unchanged.

## What is exposed

Eight compact tools cover server status, users, campaigns, campaign settings, story state, membership, the character library, and live character sheets:

- `odm_server`
- `odm_users`
- `odm_campaigns`
- `odm_campaign_settings`
- `odm_story`
- `odm_members`
- `odm_characters`
- `odm_sheets`

Campaign and library-character deletion require `confirm=true`. Provider API keys can be written through story settings, but campaign reads use the existing masked story-settings representation and never return the stored key.

Account creation and host lifecycle operations are intentionally absent. MCP cannot create login credentials, run shell commands, update Docker, or perform backup/restore.

## Run locally over stdio

Start ODM with a random shared token:

```bash
export ODM_MCP_TOKEN="$(openssl rand -hex 32)"
npm run dev
```

Then install the isolated MCP package and start stdio transport:

```bash
cd mcp
npm install
ODM_MCP_TOKEN="$ODM_MCP_TOKEN" \
ODM_MCP_CONTROL_URL=http://127.0.0.1:3005/api/internal/mcp \
npm run stdio
```

## Run HTTP MCP

```bash
cd mcp
npm install
ODM_MCP_TOKEN="$ODM_MCP_TOKEN" npm start
```

The default listener is `127.0.0.1:3006/mcp`. Requests require `Authorization: Bearer <token>`. `/healthz` verifies that the sidecar can reach the ODM control route.

Browser-style `Origin` headers are denied unless the exact origins are listed in comma-separated `ODM_MCP_ALLOWED_ORIGINS`. Native MCP clients normally send no Origin header.

Do not expose port 3006 directly to the public Internet. Keep it on loopback/private networking or put it behind TLS and authentication at the deployment boundary.

## Container sidecar

`mcp/Dockerfile` builds an unprivileged standalone MCP process. It contains no game database and does not require the ODM data volume or Docker socket. Point `ODM_MCP_CONTROL_URL` at the ODM application on the private container network and pass the same `ODM_MCP_TOKEN` to both processes.

## Default owner

Operations that create a campaign or library character need an ODM user. The tool can pass a UUID/username explicitly, or the server can set `ODM_MCP_OWNER_USER_ID` / `ODM_MCP_OWNER_USERNAME`. As a convenience, exactly one existing admin is also an unambiguous default.

## Resources

The sidecar exposes `odm://server/status` and `odm://server/capabilities` for clients that prefer MCP resources to tool calls.
