import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getCapabilityRegistry } from "../src/capability-registry.js";
import { executeConversationTool, getConversationToolDefinitions } from "../src/conversation-tools.js";
import { getCapabilityPluginHost } from "../src/plugin-host.js";
import { createSession } from "../src/session-store.js";
import { getJson, postJson, resetTestRoot, startTestServer, TEST_ROOT } from "./helpers.js";

function writePlugin(root: string): void {
  const pluginRoot = path.join(root, "example-echo");
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "my-mate.plugin.json"), JSON.stringify({
    schema_version: 1,
    id: "example.echo",
    name: "Example Echo",
    version: "1.0.0",
    description: "Test capability plugin.",
    runtime: "control-plane",
    entrypoint: "index.cjs",
    capabilities: [
      {
        id: "example_echo",
        kind: "tool",
        name: "Echo text",
        description: "Return the supplied text through the capability plugin host.",
        risk_level: "T0",
        permission_scopes: ["conversation.read"],
        executor: "control-plane",
        progress_label: "Echoing text",
        input_schema: {
          type: "object",
          properties: { text: { type: "string", minLength: 1, maxLength: 100 } },
          required: ["text"],
          additionalProperties: false,
        },
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(pluginRoot, "index.cjs"), `
exports.register = (context) => {
  context.registerTool("example_echo", ({ arguments: args, session }) => ({
    ok: true,
    text: args.text,
    session_id: session.session_id,
  }));
};
`, "utf-8");
}

test("capability plugin host discovers disabled plugins and routes enabled tools through Conversation Actions", async () => {
  resetTestRoot();
  const priorPluginDirs = process.env.MY_MATE_PLUGIN_DIRS;
  const pluginRoot = path.join(TEST_ROOT, `plugins-${Date.now()}`);
  process.env.MY_MATE_PLUGIN_DIRS = pluginRoot;
  writePlugin(pluginRoot);
  const host = getCapabilityPluginHost();
  const registry = getCapabilityRegistry();
  host.resetForTests();
  registry.clear();
  try {
    assert.throws(() => registry.registerTool({
      descriptor: {
        capability_id: "system_clock_read",
        plugin_id: "example.override",
        name: "Unsafe override",
        description: "Must not replace a core tool.",
        version: "1.0.0",
        risk_level: "T0",
        permission_scopes: [],
        executor: "control-plane",
        metadata: {},
      },
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      handler: () => ({ ok: true }),
    }), /reserved by the core host/u);

    const discovered = host.discover();
    const browserPlugin = discovered.find((plugin) => plugin.plugin_id === "browser.core");
    assert.equal(browserPlugin?.status, "ready");
    assert.equal(registry.getCapability("browser_navigate")?.executor, "browser");
    assert.equal(getConversationToolDefinitions().some((tool) => tool.name === "browser_snapshot"), true);
    const disabled = discovered.find((plugin) => plugin.plugin_id === "example.echo");
    assert.equal(disabled?.status, "disabled");
    assert.equal(registry.hasTool("example_echo"), false);

    const enabled = host.setEnabled("example.echo", true);
    assert.equal(enabled.status, "ready");
    assert.equal(registry.hasTool("example_echo"), true);
    assert.equal(getConversationToolDefinitions().some((tool) => tool.name === "example_echo"), true);

    const session = createSession({ initial_message: "Echo this", created_by: "test" });
    const invalid = await executeConversationTool({
      session,
      call: { id: "plugin-invalid", name: "example_echo", arguments: {} },
    });
    assert.equal(invalid.is_error, true);
    assert.equal(invalid.content.code, "invalid_arguments");

    const result = await executeConversationTool({
      session,
      call: { id: "plugin-valid", name: "example_echo", arguments: { text: "hello" } },
    });
    assert.equal(result.is_error, false);
    assert.equal(result.content.text, "hello");
    assert.equal(result.content.session_id, session.session_id);

    const server = await startTestServer();
    try {
      const plugins = await getJson(`${server.baseUrl}/api/registry/plugins`);
      assert.equal(plugins.status, 200);
      assert.equal(plugins.body.items.some((plugin: { plugin_id: string }) => plugin.plugin_id === "example.echo"), true);
      const capabilities = await getJson(`${server.baseUrl}/api/registry/capabilities`);
      assert.equal(capabilities.status, 200);
      assert.equal(capabilities.body.items.some((item: { capability_id: string }) => item.capability_id === "example_echo"), true);
      const disabledResponse = await postJson(
        `${server.baseUrl}/api/registry/plugins/${encodeURIComponent("example.echo")}/disable`,
        {},
      );
      assert.equal(disabledResponse.status, 200);
      assert.equal(registry.hasTool("example_echo"), false);
    } finally {
      await server.close();
    }

    host.setEnabled("example.echo", true);
    assert.equal(registry.hasTool("example_echo"), true);
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    host.discover();
    assert.equal(registry.hasTool("example_echo"), false);
    assert.equal(host.listPlugins().some((plugin) => plugin.plugin_id === "example.echo"), false);
  } finally {
    host.resetForTests();
    registry.clear();
    if (priorPluginDirs === undefined) delete process.env.MY_MATE_PLUGIN_DIRS;
    else process.env.MY_MATE_PLUGIN_DIRS = priorPluginDirs;
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});
