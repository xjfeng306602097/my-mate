import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProviderAdapterSession } from "../src/provider-adapters/registry.js";
import type { HarnessEvidenceEvent, RuntimeAgentRuntime } from "../src/types.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));

function parseFixture(runtime: RuntimeAgentRuntime): {
  events: HarnessEvidenceEvent[];
  output: string | null;
  usageCount: number;
} {
  const adapter = createProviderAdapterSession(runtime);
  assert.ok(adapter);
  const fixturePath = path.join(testDir, "fixtures", "providers", `${runtime}.jsonl`);
  const records = fs.readFileSync(fixturePath, "utf-8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const events = records.flatMap((record) => adapter.ingest(record));
  events.push(...adapter.finish());
  return { events, output: adapter.getOutputText(), usageCount: adapter.usageEventCount() };
}

for (const runtime of ["codex", "claude-sdk", "kimi"] as const) {
  test(`${runtime} recorded native events map to evidence V2 semantics`, () => {
    const { events, output, usageCount } = parseFixture(runtime);
    const kinds = events.map((event) => event.kind);
    assert.ok(kinds.includes("model_text"));
    assert.ok(kinds.includes("thinking"));
    assert.ok(kinds.includes("tool_call"));
    assert.ok(kinds.includes("tool_result"));
    assert.ok(kinds.includes("usage"));
    assert.ok(kinds.includes("error"));
    assert.ok(output?.includes("Hello"));
    assert.ok(usageCount >= 1);
    assert.ok(events.every((event) => event.source?.synthetic === false));
    assert.ok(events.every((event) => Boolean(event.source?.native_event_id)));

    const call = events.find((event) => event.kind === "tool_call");
    const result = events.find((event) => event.kind === "tool_result");
    assert.ok(call?.trace?.tool_call_id);
    assert.equal(result?.trace?.tool_call_id, call.trace.tool_call_id);
  });
}

test("native provider stream without usage does not invent usage", () => {
  const adapter = createProviderAdapterSession("kimi");
  assert.ok(adapter);
  const events = [
    ...adapter.ingest({ type: "text", text: "No usage here." }),
    ...adapter.ingest({ type: "done" }),
    ...adapter.finish(),
  ];
  assert.equal(adapter.usageEventCount(), 0);
  assert.equal(events.some((event) => event.kind === "usage"), false);
});

test("Codex app-server direct tool call retains provider arguments", () => {
  const adapter = createProviderAdapterSession("codex");
  assert.ok(adapter);
  const [event] = adapter.ingest({
    method: "item/tool/call",
    params: { callId: "direct-call-1", tool: "workspace_search", arguments: { query: "evidence" } },
  });
  assert.equal(event?.kind, "tool_call");
  assert.equal(event?.trace?.tool_call_id, "direct-call-1");
  assert.deepEqual(event?.inline_payload, {
    id: "direct-call-1",
    name: "workspace_search",
    input: { query: "evidence" },
  });
});

test("Codex app-server token usage notification maps current protocol totals", () => {
  const adapter = createProviderAdapterSession("codex");
  assert.ok(adapter);
  const [event] = adapter.ingest({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-live",
      turnId: "turn-live",
      tokenUsage: {
        total: {
          inputTokens: 120,
          cachedInputTokens: 20,
          outputTokens: 15,
          reasoningOutputTokens: 5,
          totalTokens: 135,
        },
      },
    },
  });
  assert.equal(event?.kind, "usage");
  assert.equal(event?.usage?.availability, "available");
  assert.equal(event?.usage?.total_tokens, 135);
  assert.equal(event?.usage?.reasoning_tokens, 5);
});

test("Claude streaming tool input is emitted only after complete JSON arrives", () => {
  const adapter = createProviderAdapterSession("claude-sdk");
  assert.ok(adapter);
  assert.deepEqual(adapter.ingest({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "stream-call", name: "read" } },
  }), []);
  assert.deepEqual(adapter.ingest({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"path\":\"README.md\"}" } },
  }), []);
  const [event] = adapter.ingest({
    type: "stream_event",
    event: { type: "content_block_stop", index: 0 },
  });
  assert.equal(event?.kind, "tool_call");
  assert.deepEqual((event?.inline_payload as { input?: unknown }).input, { path: "README.md" });
});
