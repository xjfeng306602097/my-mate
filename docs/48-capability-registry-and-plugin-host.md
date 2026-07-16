# Capability Registry And Plugin Host

## Status

The first capability-platform slice is implemented in the Control Plane.

It provides:

- a typed Capability Registry;
- manifest discovery for bundled, data-directory, and configured plugin roots;
- disabled-by-default third-party plugins;
- persistent enable and disable state;
- strict manifest, identifier, schema, permission-scope, and entrypoint validation;
- dynamic Conversation tool definitions for Anthropic and OpenAI-compatible providers;
- execution through the existing Conversation Action, risk, progress, timeout, and audit path;
- management APIs for plugins and registered capabilities.

Web, Browser, and MCP integrations now register against this host rather than add
new condition branches to the Conversation loop. Memory, Cron, media, and later
connectors should follow the same boundary.

## Plugin Locations

The host scans one directory below each root for `my-mate.plugin.json`:

1. `<repo>/plugins` for bundled plugins;
2. `<data-dir>/plugins` for locally installed plugins;
3. each path in `MY_MATE_PLUGIN_DIRS`, separated with the operating-system path delimiter.

Only bundled plugins may use `enabled_by_default: true`. Data-directory and
custom plugins remain disabled until explicitly enabled.

## Manifest

```json
{
  "schema_version": 1,
  "id": "example.echo",
  "name": "Example Echo",
  "version": "1.0.0",
  "description": "Example capability plugin.",
  "runtime": "control-plane",
  "entrypoint": "index.cjs",
  "capabilities": [
    {
      "id": "example_echo",
      "kind": "tool",
      "name": "Echo text",
      "description": "Return the supplied text.",
      "risk_level": "T0",
      "permission_scopes": ["conversation.read"],
      "executor": "control-plane",
      "timeout_ms": 30000,
      "input_schema": {
        "type": "object",
        "properties": {
          "text": { "type": "string", "minLength": 1 }
        },
        "required": ["text"],
        "additionalProperties": false
      }
    }
  ]
}
```

The entrypoint binds implementations to capabilities already declared by the
manifest:

```js
exports.register = (context) => {
  context.registerTool("example_echo", ({ arguments: args }) => ({
    ok: true,
    text: args.text,
  }));
};
```

Plugin code cannot register undeclared capabilities. Every declared capability
must be registered, and capability IDs reserved by the core host cannot be
overridden.

## Capability Contract

Current capability kinds are:

- `tool`
- `provider`
- `hook`
- `skill`
- `exporter`
- `platform`

Current executor locations are:

- `control-plane`
- `desktop`
- `worker`
- `browser`
- `mcp`

`control-plane`, `desktop`, `browser`, and `mcp` execution are active. Runtime
Worker execution continues through the existing worker and Change Set path.

Risk levels use the existing `T0` through `T3` Conversation Action model.
Permission scopes are explicit, stable strings such as `network.public.read`,
`browser.session.interact`, or `workspace.artifact.write`.

## Management API

- `GET /api/registry/capabilities`
- `GET /api/registry/plugins`
- `POST /api/registry/plugins/reload`
- `POST /api/registry/plugins/:pluginId/enable`
- `POST /api/registry/plugins/:pluginId/disable`

These routes use the existing `registry.manage` workspace permission and audit
middleware.

## Security Boundary

Control Plane plugins execute in-process and must therefore be treated as trusted
code. Non-bundled plugins are disabled by default and require explicit enablement.

The host additionally enforces:

- no symlink plugin directories during discovery;
- entrypoints must resolve inside the plugin directory;
- no duplicate plugin or capability IDs;
- no override of core Conversation tools;
- JSON Schema validation before handler execution;
- bounded tool timeouts;
- object-only tool results;
- automatic capability removal on disable or reload;
- normal Conversation Action persistence for success and failure.

Third-party plugins that require stronger isolation should use a future
`worker`, `browser`, or `mcp` executor instead of an in-process Control Plane
entrypoint.

## Planned Capability Order

1. Web Search and Web Fetch provider plugins. Implemented in `web.core`.
2. Isolated Browser Worker and Desktop Chrome/Edge broker plugins.
3. MCP host and connector discovery. Implemented for stdio and Streamable HTTP.
4. Executable Skill Host, long-term Memory providers, and user Cron.
5. Voice, image, video, meetings, smart-home, media, and messaging integrations.
6. Plugin marketplace, signatures, compatibility ranges, permission review, and observability exporters.
