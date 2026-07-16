import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRuntimeWorkerJob } from "../src/worker-runtime.js";
import { setClaudeAgentSdkQueryForTest } from "../src/harness/claude-agent-sdk.js";
import { buildJob } from "./worker-runtime.test.js";

test("Codex app-server harness preserves native tool, text, and usage evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-codex-appserver-"));
  const fixture = path.join(root, "appserver-fixture.mjs");
  fs.writeFileSync(fixture, [
    "import readline from 'node:readline';",
    "if(process.env.OPENAI_API_KEY!=='fixture-codex-key') process.exit(42);",
    "const rl=readline.createInterface({input:process.stdin});",
    "rl.on('line',(line)=>{const msg=JSON.parse(line);",
    "if(msg.method==='initialize') console.log(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{}}));",
    "if(msg.method==='thread/start'){if(msg.params.sandbox!=='read-only') process.exit(43);console.log(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{thread:{id:'thread-fixture'}}}));}",
    "if(msg.method==='turn/start'){",
    "console.log(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{turn:{id:'turn-fixture'}}}));",
    "console.log(JSON.stringify({jsonrpc:'2.0',method:'item/started',params:{item:{id:'tool-fixture',type:'commandExecution',command:'read fixture'}}}));",
    "console.log(JSON.stringify({jsonrpc:'2.0',method:'item/completed',params:{item:{id:'tool-fixture',type:'commandExecution',aggregatedOutput:'fixture value',exitCode:0}}}));",
    "console.log(JSON.stringify({jsonrpc:'2.0',method:'item/completed',params:{item:{id:'message-fixture',type:'agent_message',text:'fixture-token|42'}}}));",
    "console.log(JSON.stringify({jsonrpc:'2.0',method:'turn/completed',params:{usage:{input_tokens:10,output_tokens:3}}}));",
    "}});",
  ].join("\n"), "utf-8");
  const previous = {
    workspace: process.env.MY_MATE_WORKSPACE,
    mode: process.env.MY_MATE_CODEX_HARNESS,
  };
  process.env.MY_MATE_WORKSPACE = root;
  process.env.MY_MATE_CODEX_HARNESS = "app-server";
  try {
    const job = buildJob();
    job.harness.agent_runtime = "codex";
    job.provision.env = {
      MY_MATE_CODEX_BIN: process.execPath,
      MY_MATE_CODEX_APP_SERVER_ARGS_JSON: JSON.stringify([fixture]),
      CODEX_API_KEY: "fixture-codex-key",
      MY_MATE_WORKSPACE: root,
    };
    const result = await runRuntimeWorkerJob(job);
    const native = result.evidence.filter((item) => item.source?.synthetic === false);
    assert.ok(native.some((item) => item.kind === "tool_call"));
    assert.ok(native.some((item) => item.kind === "tool_result"));
    assert.equal(native.find((item) => item.kind === "model_text")?.summary, "fixture-token|42");
    assert.equal(native.find((item) => item.kind === "usage")?.usage?.total_tokens, 13);
    assert.equal(result.events.at(-1)?.kind, "worker.completed");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envName = key === "workspace" ? "MY_MATE_WORKSPACE"
        : "MY_MATE_CODEX_HARNESS";
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude Agent SDK harness supports Anthropic-compatible GLM identity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-glm-agent-sdk-"));
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  const previousBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
  process.env.MY_MATE_WORKSPACE = root;
  process.env.CLAUDE_CODE_USE_BEDROCK = "true";
  let queryOptions: Record<string, unknown> | undefined;
  setClaudeAgentSdkQueryForTest(((params) => {
    queryOptions = params.options as unknown as Record<string, unknown>;
    return (async function* () {
    yield {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "glm-tool", name: "Read", input: { file_path: "fixture.json" } },
          { type: "text", text: "glm-fixture|42" },
        ],
        usage: { input_tokens: 20, output_tokens: 5 },
      },
    };
    yield {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "glm-tool", content: "fixture", is_error: false }] },
    };
    yield { type: "result", subtype: "success", result: "glm-fixture|42", usage: { input_tokens: 20, output_tokens: 5 } };
    })();
  }));
  try {
    const job = buildJob();
    job.harness.agent_runtime = "glm";
    job.harness.runtime_agent_ref = null;
    job.harness.allowed_tools = ["read"];
    job.provision.env = {
      MY_MATE_GLM_ANTHROPIC_BASE_URL: "https://glm.example.test/anthropic/",
      MY_MATE_GLM_BASE_URL: "https://wrong.example.test/v1",
      MY_MATE_GLM_MODEL: "glm-5.2-provisioned",
      GLM_API_KEY: "fixture-secret",
      MY_MATE_WORKSPACE: root,
    };
    const result = await runRuntimeWorkerJob(job);
    const native = result.evidence.filter((item) => item.source?.synthetic === false);
    assert.ok(native.every((item) => item.source?.provider === "glm"));
    assert.ok(native.every((item) => item.source?.model === "glm-5.2-provisioned"));
    assert.ok(native.some((item) => item.kind === "tool_call"));
    assert.ok(native.some((item) => item.kind === "tool_result"));
    assert.ok(native.some((item) => item.kind === "usage" && item.usage?.availability === "available"));
    assert.equal(queryOptions?.model, "glm-5.2-provisioned");
    assert.equal(queryOptions?.cwd, root);
    const sdkEnv = queryOptions?.env as NodeJS.ProcessEnv;
    assert.equal(sdkEnv.ANTHROPIC_BASE_URL, "https://glm.example.test/anthropic");
    assert.equal(sdkEnv.ANTHROPIC_API_KEY, "fixture-secret");
    assert.equal(sdkEnv.CLAUDE_CODE_USE_BEDROCK, undefined);
    assert.equal(sdkEnv.ANTHROPIC_MODEL, "glm-5.2-provisioned");
    assert.equal(sdkEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL, "glm-5.2-provisioned");
    assert.equal(sdkEnv.ANTHROPIC_SMALL_FAST_MODEL, "glm-5.2-provisioned");
    assert.equal(sdkEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
    assert.deepEqual(queryOptions?.settingSources, []);
  } finally {
    setClaudeAgentSdkQueryForTest(null);
    if (previousWorkspace === undefined) delete process.env.MY_MATE_WORKSPACE;
    else process.env.MY_MATE_WORKSPACE = previousWorkspace;
    if (previousBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = previousBedrock;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GLM Agent Harness rejects a non-Anthropic-compatible base URL", async () => {
  const job = buildJob();
  job.harness.agent_runtime = "glm";
  job.provision.env = {
    MY_MATE_GLM_BASE_URL: "https://glm.example.test/v1",
    GLM_API_KEY: "fixture-secret",
  };
  await assert.rejects(
    runRuntimeWorkerJob(job),
    /requires MY_MATE_GLM_ANTHROPIC_BASE_URL/,
  );
});

test("Claude Agent SDK harness terminates when the Worker signal is aborted", async () => {
  setClaudeAgentSdkQueryForTest((() => ({
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<unknown>>(() => {}),
        return: async () => ({ done: true, value: undefined }),
      };
    },
  })) as Parameters<typeof setClaudeAgentSdkQueryForTest>[0]);
  const controller = new AbortController();
  try {
    const job = buildJob();
    job.harness.agent_runtime = "claude-sdk";
    const execution = runRuntimeWorkerJob(job, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(execution, /execution was aborted/);
  } finally {
    setClaudeAgentSdkQueryForTest(null);
  }
});
