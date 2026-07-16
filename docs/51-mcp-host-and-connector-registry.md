# MCP Host And Connector Registry

My Mate now supports generic Model Context Protocol servers through the Capability Registry. GitHub, Notion, Linear, databases, and future connectors can be added through configuration without adding provider-specific branches to the Conversation loop.

## Supported Transports

- `stdio`: a local MCP process owned by Control Plane and authorized through My Mate Desktop.
- `streamable-http`: a public HTTP or HTTPS MCP endpoint using pinned public DNS and origin checks.

SSE-only legacy MCP endpoints, OAuth, sampling, elicitation, prompts, resources-as-tools, and model-managed MCP configuration are not implemented in this slice.

## Connector Presets

Studio loads built-in connector presets from `GET /api/registry/mcp-connector-presets`. A preset supplies reviewed transport settings, secret names, tool filters, and risk overrides while the MCP Host continues to discover the actual tools dynamically.

The first preset is the official GitHub Remote MCP:

```text
https://api.githubcopilot.com/mcp/
Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}
```

The Personal Access Token is entered through a password field and stored only in the encrypted MCP Secret Store. The preset is disabled by default, and Studio refuses to enable it until the required token is configured. Read-only repository, issue, pull request, user, and search tools are explicitly classified as `T1`; known mutation tools are `T2`; merge and delete-style tools are `T3`. Server annotations still classify tools that are not listed in the reviewed override set.

The discontinued npm package `@modelcontextprotocol/server-github` is intentionally not used. Local Docker and binary variants remain available through Custom MCP configuration, but the built-in preset uses GitHub's maintained hosted endpoint.

## Dynamic Tool Contract

On connection, the host lists the server tools and registers each selected tool as:

```text
mcp_<workspace-id>_<server-id>_<tool-name>
```

Names are normalized and bounded. Collisions and long names receive a stable hash suffix. JSON Schemas are normalized before being exposed to model providers, including nullable values, legacy `definitions`, `$ref`, object properties, and invalid required fields.

Server records, encrypted secrets, active connections, plugin IDs, tool IDs, model-visible definitions, and execution checks are all Workspace-scoped. Two Workspaces may use the same MCP server ID without sharing configuration, tools, secrets, reloads, or calls.

Tool risk defaults are:

- destructive annotation: `T3`
- read-only annotation: `T1`
- no decisive annotation: `T2`

Per-server defaults and per-tool overrides can replace these values. `T0` and `T1` run directly after normal schema validation. `T2` and `T3` create a pending Conversation Action and require a one-action Desktop confirmation before the MCP call starts. A denial becomes a terminal, model-visible tool error.

## Configuration Boundary

Remote Streamable HTTP servers may be configured through the Registry API and Studio MCP screen.

Stdio configuration is privileged because it starts a local executable with the user's account. Studio sends stdio save, test, and enable operations through the named `mcp.configure` Desktop preload API. Electron shows the executable, arguments, and secret names, then calls a bearer-protected internal Control Plane route only after confirmation. The public Web API rejects stdio save, test, and enable operations.

The two approval layers are intentionally separate:

1. Desktop authorizes starting or configuring the local MCP process.
2. Conversation authorizes each `T2` or `T3` tool call.

Disabling a server is always allowed because it removes capabilities and stops the process.

## Secrets And Network Policy

Secrets are stored as AES-256-GCM ciphertext with workspace/server additional authenticated data. Public records expose secret names and configured state, never values. Environment variables and sensitive HTTP headers must reference `${ENV_NAME}` templates.

Stdio configuration rejects:

- shell interpreters as server executables;
- inline-code switches for Node, Python, Ruby, and Perl;
- shell operators, line breaks, and oversized arguments;
- known persistence-shaped arguments.

Streamable HTTP configuration rejects embedded URL credentials. Connection resolves only public addresses, pins the resolved origin, and does not follow redirects to another destination. Localhost, private, reserved, multicast, documentation, and non-routable addresses are blocked.

## Result Boundary

MCP text and textual resource content is bounded to 100,000 characters and marked `untrusted_content: true`. Structured content is accepted only when it is a bounded JSON object. Binary image and audio blocks are counted but omitted. MCP errors are returned as structured Conversation tool failures instead of being converted into assistant success text.

## Management API

- `GET /api/registry/mcp-servers`
- `GET /api/registry/mcp-connector-presets`
- `POST /api/registry/mcp-servers`
- `POST /api/registry/mcp-servers/reload`
- `POST /api/registry/mcp-servers/:serverId/test`
- `POST /api/registry/mcp-servers/:serverId/enable`
- `POST /api/registry/mcp-servers/:serverId/disable`

Desktop-only stdio routes live below `/api/internal/desktop/registry/mcp-servers` and require the per-installation Desktop bridge token. They are intentionally absent from API Gateway's public allowlist.

## Shutdown And Recovery

Disabling, reloading, or shutting down Control Plane unregisters all tools for that server and closes the MCP client transport. Stdio child processes are reaped with the transport. A failed connection persists `status: error` and a bounded `last_error`, while leaving unrelated MCP servers available.

## Verification

The MCP integration test uses a real SDK stdio server and covers discovery, schema normalization, invocation, T2/T3 approval, denial, filters, encrypted secrets, unsafe configuration rejection, private HTTP blocking, Desktop-only lifecycle routes, capability removal, and child-process shutdown. Connector tests additionally cover GitHub preset expansion, official endpoint/header configuration, reviewed risk levels, missing credentials, encrypted PAT storage, and plaintext Authorization rejection.

The local development environment used for this slice did not contain `GITHUB_TOKEN`, `GITHUB_PAT`, or `GH_TOKEN`, so no authenticated GitHub network call was made. Studio reports the connector as unconfigured until the user supplies a real PAT; it never fabricates a successful connection.

```powershell
cd C:\project\my-mate\services\control-plane
node --import tsx --test test/mcp-host.test.ts
npm test

cd C:\project\my-mate\services\api-gateway
npm test

cd C:\project\my-mate\apps\desktop
npm run check
```
