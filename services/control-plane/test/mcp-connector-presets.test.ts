import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  expandMcpConnectorPreset,
  getMcpConnectorPreset,
  listMcpConnectorPresets,
} from "../src/mcp-connector-presets.js";
import { MCP_SECRETS_DIR } from "../src/config.js";
import { publicMcpServer, upsertMcpServer } from "../src/mcp-server-store.js";
import { getJson, resetTestRoot, startTestServer } from "./helpers.js";

test("GitHub MCP preset expands the official remote endpoint with explicit risk defaults", () => {
  const preset = getMcpConnectorPreset("github");
  assert.ok(preset);
  assert.equal(preset.transport, "streamable-http");
  assert.equal(preset.server.url, "https://api.githubcopilot.com/mcp/");
  assert.equal(preset.server.headers?.Authorization, "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}");
  assert.deepEqual(preset.server.tool_filter, { include: [], exclude: [] });
  assert.equal(preset.server.tool_risk_overrides?.get_file_contents, "T1");
  assert.equal(preset.server.tool_risk_overrides?.create_issue, "T2");
  assert.equal(preset.server.tool_risk_overrides?.merge_pull_request, "T3");
  assert.deepEqual(preset.secrets.map((secret) => secret.name), ["GITHUB_PERSONAL_ACCESS_TOKEN"]);

  const expanded = expandMcpConnectorPreset("github");
  assert.equal(expanded.enabled, false);
  assert.equal("secrets" in expanded, false);
  assert.throws(() => expandMcpConnectorPreset("unknown"), /Unknown MCP connector preset/u);
});

test("GitHub MCP token is encrypted and never appears in preset or public server responses", async () => {
  resetTestRoot();
  const token = `github_pat_test_${Date.now()}`;
  const record = upsertMcpServer("default", expandMcpConnectorPreset("github", {
    GITHUB_PERSONAL_ACCESS_TOKEN: token,
    UNDECLARED_SECRET: "must-not-be-stored",
  }));
  const publicRecord = publicMcpServer(record);
  assert.equal(publicRecord.secret_configured, true);
  assert.deepEqual(publicRecord.secret_names, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  assert.equal(JSON.stringify(publicRecord).includes(token), false);
  const encrypted = fs.readFileSync(path.join(MCP_SECRETS_DIR, "default--github.json"), "utf8");
  assert.equal(encrypted.includes(token), false);
  assert.equal(encrypted.includes("must-not-be-stored"), false);

  const server = await startTestServer();
  try {
    const response = await getJson(`${server.baseUrl}/api/registry/mcp-connector-presets`);
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, listMcpConnectorPresets().length);
    assert.equal(response.body.items[0].preset_id, "github");
    assert.equal(JSON.stringify(response.body).includes(token), false);
    assert.equal(JSON.stringify(response.body).includes("github_pat_test_"), false);
  } finally {
    await server.close();
  }
});

test("MCP sensitive headers accept secret templates and reject plaintext credentials", () => {
  resetTestRoot();
  assert.doesNotThrow(() => upsertMcpServer("default", {
    server_id: "bearer.template",
    name: "Bearer Template",
    transport: "streamable-http",
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer ${MCP_TOKEN}" },
    enabled: false,
  }));
  assert.throws(() => upsertMcpServer("default", {
    server_id: "plaintext.header",
    name: "Plaintext Header",
    transport: "streamable-http",
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer plaintext-token" },
    enabled: false,
  }), /secret reference/u);
  assert.throws(() => upsertMcpServer("default", {
    server_id: "lowercase.template",
    name: "Lowercase Template",
    transport: "streamable-http",
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer ${lowercase_token}" },
    enabled: false,
  }), /secret reference/u);
});
