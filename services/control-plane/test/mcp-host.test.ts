import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getCapabilityRegistry } from "../src/capability-registry.js";
import { MCP_SECRETS_DIR } from "../src/config.js";
import { executeConversationTool, getConversationToolDefinitions, type ConversationDesktopCapabilityRequest } from "../src/conversation-tools.js";
import { getMcpHost } from "../src/mcp-host.js";
import { publicMcpServer, upsertMcpServer } from "../src/mcp-server-store.js";
import { createSession } from "../src/session-store.js";
import { getJson, postJson, resetTestRoot, startTestServer, TEST_ROOT } from "./helpers.js";

const fixturePath = path.resolve("test/fixtures/mcp-echo-server.mjs");

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for MCP fixture state.");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("MCP Host discovers stdio tools and enforces Desktop approval, secrets, filters, and shutdown", { concurrency: false }, async () => {
  const host = getMcpHost();
  await host.shutdown();
  resetTestRoot();
  const registry = getCapabilityRegistry();
  const pidFile = path.join(TEST_ROOT, `mcp-fixture-${Date.now()}.pid`);
  const secret = `mcp-secret-${Date.now()}`;
  const record = upsertMcpServer("default", {
    server_id: "test.echo",
    name: "Test Echo MCP",
    transport: "stdio",
    command: process.execPath,
    args: [fixturePath],
    environment: {
      MCP_FIXTURE_PID_FILE: "${MCP_FIXTURE_PID_FILE}",
      MCP_FIXTURE_SECRET: "${MCP_FIXTURE_SECRET}",
    },
    secrets: { MCP_FIXTURE_PID_FILE: pidFile, MCP_FIXTURE_SECRET: secret },
    enabled: true,
  });

  try {
    const ready = await host.connect(record.server_id);
    assert.equal(ready.status, "ready");
    assert.deepEqual(
      ready.discovered_tools
        .map((tool) => [tool.tool_name, tool.risk_level])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
      [
        ["default_action", "T2"],
        ["echo", "T1"],
        ["secret_status", "T1"],
        ["write_record", "T3"],
      ],
    );
    assert.equal(registry.getCapability("mcp_default_test_echo_echo")?.executor, "mcp");
    const echoSchema = registry.listToolDefinitions().find((tool) => tool.name === "mcp_default_test_echo_echo")?.input_schema;
    assert.equal(echoSchema?.type, "object");
    assert.equal(typeof (echoSchema?.properties as Record<string, unknown>)?.note, "object");

    await waitFor(() => fs.existsSync(pidFile));
    const fixturePid = Number(fs.readFileSync(pidFile, "utf8"));
    assert.equal(processExists(fixturePid), true);

    const publicRecord = publicMcpServer(ready);
    assert.deepEqual(publicRecord.secret_names, ["MCP_FIXTURE_PID_FILE", "MCP_FIXTURE_SECRET"]);
    assert.equal(JSON.stringify(publicRecord).includes(secret), false);
    const secretStorage = fs.readFileSync(path.join(MCP_SECRETS_DIR, "default--test.echo.json"), "utf8");
    assert.equal(secretStorage.includes(secret), false);
    assert.equal(secretStorage.includes(pidFile), false);

    const session = createSession({ initial_message: "Test MCP", created_by: "test" });
    const echo = await executeConversationTool({
      session,
      call: { id: "mcp-echo", name: "mcp_default_test_echo_echo", arguments: { text: "hello", note: null } },
    });
    assert.equal(echo.is_error, false);
    assert.equal(echo.content.content, "hello");
    assert.deepEqual(echo.content.structured_content, { echoed: "hello", note: null });
    assert.equal(echo.content.untrusted_content, true);

    const secretStatus = await executeConversationTool({
      session,
      call: { id: "mcp-secret", name: "mcp_default_test_echo_secret_status", arguments: {} },
    });
    assert.equal(secretStatus.content.content, "configured");

    const desktopBridgeToken = `desktop-mcp-${Date.now()}`;
    const server = await startTestServer({ desktopBridgeToken });
    const approve = async (request: ConversationDesktopCapabilityRequest) => {
      const response = await postJson(
        `${server.baseUrl}/api/internal/desktop/sessions/${encodeURIComponent(request.session_id)}/conversation-actions/${encodeURIComponent(request.action_id)}/result`,
        { status: "approved", capability_id: request.capability_id },
        { authorization: `Bearer ${desktopBridgeToken}` },
      );
      assert.equal(response.status, 200);
    };
    try {
      const write = await executeConversationTool({
        session,
        call: { id: "mcp-write", name: "mcp_default_test_echo_write_record", arguments: { value: "approved" } },
        onDesktopCapability: approve,
      });
      assert.equal(write.is_error, false);
      assert.equal(write.content.content, "wrote:approved");

      const denied = await executeConversationTool({
        session,
        call: { id: "mcp-denied", name: "mcp_default_test_echo_default_action", arguments: { value: "blocked" } },
        onDesktopCapability: async (request) => {
          const response = await postJson(
            `${server.baseUrl}/api/internal/desktop/sessions/${encodeURIComponent(request.session_id)}/conversation-actions/${encodeURIComponent(request.action_id)}/result`,
            {
              status: "failed",
              capability_id: request.capability_id,
              code: "mcp_action_denied",
              result: { message: "Denied in test." },
            },
            { authorization: `Bearer ${desktopBridgeToken}` },
          );
          assert.equal(response.status, 200);
        },
      });
      assert.equal(denied.is_error, true);
      assert.equal(denied.content.code, "mcp_action_denied");

      const listed = await getJson(`${server.baseUrl}/api/registry/mcp-servers`);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.items[0].secret_configured, true);
      assert.equal(JSON.stringify(listed.body).includes(secret), false);

      const disabled = await postJson(`${server.baseUrl}/api/registry/mcp-servers/test.echo/disable`, {});
      assert.equal(disabled.status, 200);
      assert.equal(registry.hasTool("mcp_default_test_echo_echo"), false);
      await waitFor(() => !processExists(fixturePid));
    } finally {
      await server.close();
    }
  } finally {
    await host.shutdown();
    fs.rmSync(pidFile, { force: true });
  }
});

test("MCP configuration rejects executable abuse and private HTTP destinations", { concurrency: false }, async () => {
  const host = getMcpHost();
  await host.shutdown();
  resetTestRoot();

  assert.throws(() => upsertMcpServer("default", {
    name: "Shell MCP",
    transport: "stdio",
    command: "powershell.exe",
    args: ["-Command", "Get-Date"],
  }), /shell interpreters/u);
  assert.throws(() => upsertMcpServer("default", {
    name: "Inline MCP",
    transport: "stdio",
    command: process.execPath,
    args: ["--eval", "console.log('no')"],
  }), /inline code/u);
  assert.throws(() => upsertMcpServer("default", {
    name: "Persistence MCP",
    transport: "stdio",
    command: "custom-mcp.exe",
    args: ["--target", "authorized_keys"],
  }), /persistence indicator/u);

  const privateServer = upsertMcpServer("default", {
    server_id: "private.http",
    name: "Private HTTP MCP",
    transport: "streamable-http",
    url: "http://127.0.0.1:9911/mcp",
  });
  await assert.rejects(() => host.connect(privateServer.server_id), /private|local|public/iu);
  assert.equal(registryHasMcpTool(), false);
  await host.shutdown();
});

test("MCP servers, secrets, capabilities, and execution stay isolated by Workspace", { concurrency: false }, async () => {
  const host = getMcpHost();
  await host.shutdown();
  resetTestRoot();
  const registry = getCapabilityRegistry();
  const sharedInput = {
    server_id: "shared.echo",
    name: "Shared Echo",
    transport: "stdio" as const,
    command: process.execPath,
    args: [fixturePath],
    enabled: true,
  };
  upsertMcpServer("workspace-a", { ...sharedInput, secrets: { MCP_FIXTURE_SECRET: "secret-a" }, environment: { MCP_FIXTURE_SECRET: "${MCP_FIXTURE_SECRET}" } });
  upsertMcpServer("workspace-b", { ...sharedInput, secrets: { MCP_FIXTURE_SECRET: "secret-b" }, environment: { MCP_FIXTURE_SECRET: "${MCP_FIXTURE_SECRET}" } });
  try {
    await host.connect("shared.echo", "workspace-a");
    await host.connect("shared.echo", "workspace-b");
    const aTool = "mcp_workspace_a_shared_echo_echo";
    const bTool = "mcp_workspace_b_shared_echo_echo";
    assert.equal(registry.hasTool(aTool, "workspace-a"), true);
    assert.equal(registry.hasTool(aTool, "workspace-b"), false);
    assert.equal(registry.hasTool(bTool, "workspace-b"), true);
    assert.equal(registry.hasTool(bTool, "workspace-a"), false);
    assert.equal(getConversationToolDefinitions("workspace-a").some((tool) => tool.name === aTool), true);
    assert.equal(getConversationToolDefinitions("workspace-a").some((tool) => tool.name === bTool), false);

    const baseSession = createSession({ initial_message: "Workspace isolation", created_by: "test" });
    const allowed = await executeConversationTool({
      session: { ...baseSession, workspace_id: "workspace-a" },
      call: { id: "workspace-allowed", name: aTool, arguments: { text: "ok" } },
    });
    assert.equal(allowed.is_error, false);
    const blocked = await executeConversationTool({
      session: { ...baseSession, workspace_id: "workspace-b" },
      call: { id: "workspace-blocked", name: aTool, arguments: { text: "no" } },
    });
    assert.equal(blocked.is_error, true);
    assert.equal(blocked.content.code, "tool_not_allowed");

    const secretFiles = fs.readdirSync(MCP_SECRETS_DIR).filter((name) => name.endsWith("--shared.echo.json"));
    assert.deepEqual(secretFiles.sort(), ["workspace-a--shared.echo.json", "workspace-b--shared.echo.json"]);
    const serializedSecrets = secretFiles.map((name) => fs.readFileSync(path.join(MCP_SECRETS_DIR, name), "utf8")).join("\n");
    assert.equal(serializedSecrets.includes("secret-a"), false);
    assert.equal(serializedSecrets.includes("secret-b"), false);
  } finally {
    await host.shutdown();
  }
});

test("stdio MCP lifecycle requires the authenticated Desktop bridge", { concurrency: false }, async () => {
  const host = getMcpHost();
  await host.shutdown();
  resetTestRoot();
  const desktopBridgeToken = `desktop-mcp-config-${Date.now()}`;
  const server = await startTestServer({ desktopBridgeToken });
  const payload = {
    server_id: "desktop.only",
    name: "Desktop Only MCP",
    transport: "stdio",
    command: process.execPath,
    args: [fixturePath],
    enabled: false,
  };
  try {
    const publicSave = await postJson(`${server.baseUrl}/api/registry/mcp-servers`, payload);
    assert.equal(publicSave.status, 403);
    assert.equal(publicSave.body.code, "desktop_authorization_required");

    const unauthorized = await postJson(`${server.baseUrl}/api/internal/desktop/registry/mcp-servers`, payload);
    assert.equal(unauthorized.status, 401);

    const saved = await postJson(
      `${server.baseUrl}/api/internal/desktop/registry/mcp-servers`,
      payload,
      { authorization: `Bearer ${desktopBridgeToken}` },
    );
    assert.equal(saved.status, 201);
    assert.equal(saved.body.status, "disabled");

    const publicEnable = await postJson(`${server.baseUrl}/api/registry/mcp-servers/desktop.only/enable`, {});
    assert.equal(publicEnable.status, 403);

    const enabled = await postJson(
      `${server.baseUrl}/api/internal/desktop/registry/mcp-servers/desktop.only/enable`,
      {},
      { authorization: `Bearer ${desktopBridgeToken}` },
    );
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.status, "ready");
    assert.equal(getCapabilityRegistry().hasTool("mcp_default_desktop_only_echo"), true);
  } finally {
    await host.shutdown();
    await server.close();
  }
});

test("MCP include and exclude filters control dynamic capability registration", { concurrency: false }, async () => {
  const host = getMcpHost();
  await host.shutdown();
  resetTestRoot();
  const registry = getCapabilityRegistry();

  const included = upsertMcpServer("default", {
    server_id: "filter.include",
    name: "Include Filter MCP",
    transport: "stdio",
    command: process.execPath,
    args: [fixturePath],
    tool_filter: { include: ["echo"] },
  });
  try {
    const ready = await host.connect(included.server_id);
    assert.deepEqual(ready.discovered_tools.map((tool) => tool.tool_name), ["echo"]);
    assert.equal(registry.hasTool("mcp_default_filter_include_echo"), true);
    assert.equal(registry.hasTool("mcp_default_filter_include_write_record"), false);
  } finally {
    await host.shutdown();
  }

  const excluded = upsertMcpServer("default", {
    server_id: "filter.exclude",
    name: "Exclude Filter MCP",
    transport: "stdio",
    command: process.execPath,
    args: [fixturePath],
    tool_filter: { exclude: ["write_record"] },
  });
  try {
    const ready = await host.connect(excluded.server_id);
    assert.equal(ready.discovered_tools.some((tool) => tool.tool_name === "write_record"), false);
    assert.equal(registry.hasTool("mcp_default_filter_exclude_echo"), true);
    assert.equal(registry.hasTool("mcp_default_filter_exclude_write_record"), false);
  } finally {
    await host.shutdown();
  }
});

function registryHasMcpTool(): boolean {
  return getCapabilityRegistry().listCapabilities().some((item) => item.executor === "mcp");
}
