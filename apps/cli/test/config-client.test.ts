import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ApiClient } from "../src/client.js";
import { resolveCliConfig } from "../src/config.js";

const TEST_ROOT = path.resolve("C:/project/my-mate/tmp/test-cli");

test("CLI config applies option, environment, credential reference, and default precedence", () => {
  const caseDir = fs.mkdtempSync(`${TEST_ROOT}-`);
  const configPath = path.join(caseDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      base_url: "http://file.example:4030/",
      api_key_env: "FILE_KEY_REF",
    }),
    "utf-8",
  );
  try {
    const fromFile = resolveCliConfig({
      options: { config: configPath },
      env: { FILE_KEY_REF: "file-secret" },
    });
    assert.equal(fromFile.baseUrl, "http://file.example:4030");
    assert.equal(fromFile.apiKey, "file-secret");
    assert.equal(fromFile.workspaceId, null);

    const fromEnvironment = resolveCliConfig({
      options: { config: configPath },
      env: {
        MY_MATE_BASE_URL: "http://env.example:4030",
        MY_MATE_API_KEY: "env-secret",
        FILE_KEY_REF: "file-secret",
      },
    });
    assert.equal(fromEnvironment.baseUrl, "http://env.example:4030");
    assert.equal(fromEnvironment.apiKey, "env-secret");

    const fromOptions = resolveCliConfig({
      options: {
        config: configPath,
        baseUrl: "http://option.example:4030/",
        apiKey: "option-secret",
        workspace: "workspace-option",
      },
      env: { MY_MATE_API_KEY: "env-secret" },
    });
    assert.equal(fromOptions.baseUrl, "http://option.example:4030");
    assert.equal(fromOptions.apiKey, "option-secret");
    assert.equal(fromOptions.workspaceId, "workspace-option");
  } finally {
    fs.rmSync(caseDir, { recursive: true, force: true });
  }
});

test("API client sends Bearer authentication without placing the key in the URL or response", async () => {
  const observed: Array<{ url: string; authorization: string | null; requestId: string | null; workspaceId: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    observed.push({
      url: String(input),
      authorization: headers.get("authorization"),
      requestId: headers.get("x-request-id"),
      workspaceId: headers.get("x-my-mate-workspace-id"),
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new ApiClient(
    {
      baseUrl: "http://127.0.0.1:4030",
      apiKey: "top-secret",
      configPath: "unused",
      workspaceId: "workspace-test",
    },
    fetchImpl,
  );
  const response = await client.get<{ ok: boolean }>("/api/runs");
  assert.equal(response.ok, true);
  assert.equal(observed[0]?.authorization, "Bearer top-secret");
  assert.match(observed[0]?.requestId || "", /^cli-/);
  assert.equal(observed[0]?.url.includes("top-secret"), false);
  assert.equal(observed[0]?.workspaceId, "workspace-test");
});
