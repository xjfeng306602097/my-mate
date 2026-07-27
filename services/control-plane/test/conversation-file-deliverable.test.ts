import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { ArtifactWorkerError } from "../src/artifact-worker-runner.js";
import { guardConversationArtifactClaims } from "../src/app.js";
import { listConversationActions } from "../src/conversation-action-store.js";
import { createSessionAttachment } from "../src/session-attachment-store.js";
import { createSession, getSession, saveSession } from "../src/session-store.js";
import { listUserSchedules } from "../src/user-schedule-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

test("artifact claim guard accepts a real generated artifact owned by another Agent session", () => {
  resetTestRoot();
  const source = createSession({ title: "Sub Agent artifact" });
  const target = createSession({ title: "Main Agent synthesis" });
  const artifact = createSessionAttachment({
    sessionId: source.session_id,
    request: {
      name: "result.md",
      storage_uri: "memory://result.md",
      kind: "generated_output",
      metadata: {
        source: "conversation_generated_output",
        generated_text_content: "verified result",
      },
    },
  });
  const uri = `/api/sessions/${source.session_id}/artifacts/${artifact.attachment_id}/download`;
  const guarded = guardConversationArtifactClaims(target.session_id, `Verified artifact: [result.md](${uri})`);
  assert.equal(guarded.rejected, false);
  assert.equal(guarded.text.includes(uri), true);
});

test("attachment translation repairs acknowledgement-only replies and returns a downloadable file", async () => {
  resetTestRoot();
  const providerRequests: Array<Record<string, unknown>> = [];
  let conversationCalls = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    providerRequests.push(body);
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationCalls += 1;
    if (conversationCalls === 1) {
      return new Response(JSON.stringify({ error: "temporary upstream failure" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    const system = String(body.system || "");
    const wantsFrench = /Target language: French\./u.test(system);
    const modifiesChinese = /Modify the complete source file guide-zh\.md/u.test(system);
    const modifiesFrench = /Modify the complete source file guide-fr\.md/u.test(system);
    const text = modifiesChinese
      ? [
          '<my-mate-file name="guide-zh.md">',
          "# \u4e2d\u6587\u6307\u5357",
          "",
          "## \u76ee\u5f55",
          "",
          "- [\u5b8c\u6574\u7ffb\u8bd1\u5185\u5bb9](#\u5b8c\u6574\u7ffb\u8bd1\u5185\u5bb9)",
          "",
          "## \u5b8c\u6574\u7ffb\u8bd1\u5185\u5bb9",
          "",
          "\u8fd9\u662f\u5b8c\u6574\u7ffb\u8bd1\u5185\u5bb9\u3002",
          "</my-mate-file>",
        ].join("\n")
      : modifiesFrench
        ? [
            '<my-mate-file name="guide-fr.md">',
            "# Guide fran\u00e7ais",
            "",
            "## Sommaire",
            "",
            "- [Document complet](#document-complet)",
            "",
            "## Document complet",
            "",
            "Ceci est le document traduit complet.",
            "</my-mate-file>",
          ].join("\n")
      : wantsFrench
      ? [
          '<my-mate-file name="guide-fr.md">',
          "# Guide fran\u00e7ais",
          "",
          "Ceci est le document traduit complet.",
          "</my-mate-file>",
        ].join("\n")
      : conversationCalls === 2
        ? "好的，我来把完整的中文翻译生成为文件给你。"
        : [
            '<my-mate-file name="guide-zh.md">',
            "# 中文指南",
            "",
            "这是完整翻译内容。",
            "</my-mate-file>",
          ].join("\n");
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":40}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: conversationCalls === 2 ? 20 : 80 } })}\n\n`,
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "file-deliverable-glm",
      name: "File Deliverable GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "file-deliverable-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/file-deliverable-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "请你告诉我当前广州的天气如何",
      provider_connection_id: "file-deliverable-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    await postJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`, {
      name: "guide-en.md",
      storage_uri: "studio-upload://guide-en.md",
      mime_type: "text/markdown",
      size_bytes: 64,
      kind: "context",
      metadata: {
        source: "studio_conversation_upload",
        relative_path: "guide-en.md",
        uploaded_text_content: "# English guide\n\nThis is the complete source document.",
      },
    });

    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "能帮我把这个文件翻译成中文，并生成文件给我吗？",
      provider_connection_id: "file-deliverable-glm",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.equal(conversationCalls, 3);
    assert.match(String(providerRequests.at(-1)?.system || ""), /semantic repair round 2/i);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "completed");
    assert.equal(detail.body.session.latest_run_id, null);
    assert.ok(detail.body.task_checkpoint.long_task_runtime.cumulative_input_tokens > 0);
    assert.ok(detail.body.task_checkpoint.long_task_runtime.cumulative_output_tokens > 0);
    assert.ok(detail.body.task_checkpoint.long_task_runtime.elapsed_ms >= 0);
    const messages = detail.body.messages as Array<Record<string, any>>;
    const assistant = messages.find(
      (message) => message.role === "orchestrator" &&
        message.kind === "text" &&
        message.content?.deliverable_status === "returned",
    );
    assert.match(String(assistant?.content?.text || ""), /guide-zh\.md/);
    assert.equal(assistant?.content?.semantic_continuation_rounds, 2);
    assert.doesNotMatch(String(assistant?.content?.text || ""), /\u6211\u6765/);
    const artifact = messages.find((message) => message.kind === "artifact_card");
    assert.ok(artifact);
    assert.equal(artifact?.content?.name, "guide-zh.md");
    assert.match(String(artifact?.content?.storage_uri || ""), /\/download$/);

    const inputs = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`);
    assert.deepEqual(
      (inputs.body.items as Array<Record<string, unknown>>).map((item) => item.name),
      ["guide-en.md"],
    );
    const protectedDelete = await fetch(
      `${server.baseUrl}/api/sessions/${sessionId}/attachments/${artifact?.content?.artifact_id}`,
      { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
    );
    assert.equal(protectedDelete.status, 409);

    const download = await fetch(`${server.baseUrl}${artifact?.content?.storage_uri}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") || "", /guide-zh\.md/);
    assert.equal(await download.text(), "# 中文指南\n\n这是完整翻译内容。");
    const preview = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${artifact?.content?.artifact_id}`,
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.artifact.name, "guide-zh.md");
    assert.equal(preview.body.artifact.version, 1);
    assert.equal(preview.body.preview_kind, "markdown");
    assert.equal(preview.body.previous_artifact_id, null);
    assert.equal(preview.body.versions.length, 1);

    const frenchTurn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Generate a French version and export it as guide-fr.md",
      provider_connection_id: "file-deliverable-glm",
      model: "glm-5.2",
    });
    assert.equal(frenchTurn.status, 201);
    assert.equal(conversationCalls, 4);
    assert.match(String(providerRequests.at(-1)?.system || ""), /Transform the complete source file guide-zh\.md/);
    assert.match(String(providerRequests.at(-1)?.system || ""), /File: guide-zh\.md/);

    const frenchDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const frenchMessages = frenchDetail.body.messages as Array<Record<string, any>>;
    const frenchArtifact = [...frenchMessages]
      .reverse()
      .find((message) => message.kind === "artifact_card" && message.content?.name === "guide-fr.md");
    assert.ok(frenchArtifact);
    assert.equal(frenchArtifact?.content?.source_attachment_id, artifact?.content?.artifact_id);
    assert.match(String(frenchArtifact?.content?.storage_uri || ""), /\/download$/);

    const frenchDownload = await fetch(`${server.baseUrl}${frenchArtifact?.content?.storage_uri}`);
    assert.equal(frenchDownload.status, 200);
    assert.match(frenchDownload.headers.get("content-disposition") || "", /guide-fr\.md/);
    assert.equal(
      await frenchDownload.text(),
      "# Guide fran\u00e7ais\n\nCeci est le document traduit complet.",
    );
    const frenchPreview = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${frenchArtifact?.content?.artifact_id}`,
    );
    assert.equal(frenchPreview.status, 200);
    assert.equal(frenchPreview.body.artifact.name, "guide-fr.md");
    assert.equal(frenchPreview.body.artifact.source_attachment_id, artifact?.content?.artifact_id);
    assert.equal(frenchPreview.body.preview_kind, "markdown");
    assert.equal(frenchPreview.body.content, "# Guide fran\u00e7ais\n\nCeci est le document traduit complet.");

    const inputsAfterFrench = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`);
    assert.deepEqual(
      (inputsAfterFrench.body.items as Array<Record<string, unknown>>).map((item) => item.name),
      ["guide-en.md"],
    );

    const modificationTurn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u6211\u60f3\u4f60\u4fee\u6539\u4e2d\u6587\u7684\u90a3\u4e2a\u6587\u4ef6\uff0c\u52a0\u4e00\u4e2a\u76ee\u5f55\u7d22\u5f15",
      provider_connection_id: "file-deliverable-glm",
      model: "glm-5.2",
    });
    assert.equal(modificationTurn.status, 201);
    assert.equal(conversationCalls, 5);
    assert.match(String(providerRequests.at(-1)?.system || ""), /Modify the complete source file guide-zh\.md/);
    assert.match(String(providerRequests.at(-1)?.system || ""), /Output file name: guide-zh\.md/);
    assert.doesNotMatch(String(providerRequests.at(-1)?.system || ""), /Modify the complete source file guide-fr\.md/);
    assert.doesNotMatch(String(providerRequests.at(-1)?.system || ""), /Target language:/);

    const modifiedDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const modifiedMessages = modifiedDetail.body.messages as Array<Record<string, any>>;
    const modifiedArtifact = [...modifiedMessages]
      .reverse()
      .find((message) => message.kind === "artifact_card" && message.content?.name === "guide-zh_v1.md");
    assert.ok(modifiedArtifact);
    assert.notEqual(modifiedArtifact?.content?.artifact_id, artifact?.content?.artifact_id);
    assert.equal(modifiedArtifact?.content?.source_attachment_id, artifact?.content?.artifact_id);
    const nextArtifactId = String(modifiedArtifact?.content?.artifact_id);
    const nextPreview = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${nextArtifactId}`,
    );
    assert.equal(nextPreview.body.artifact.version, 2);
    assert.equal(nextPreview.body.previous_artifact_id, artifact?.content?.artifact_id);
    assert.equal(nextPreview.body.versions.length, 2);
    assert.match(String(nextPreview.body.content || ""), /## \u76ee\u5f55/u);

    const modifiedDownload = await fetch(`${server.baseUrl}${modifiedArtifact?.content?.storage_uri}`);
    assert.equal(modifiedDownload.status, 200);
    assert.match(await modifiedDownload.text(), /## \u76ee\u5f55/u);

    const comparison = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${nextArtifactId}/compare`,
    );
    assert.equal(comparison.status, 200);
    assert.equal(comparison.body.base.version, 1);
    assert.equal(comparison.body.target.version, 2);
    assert.equal(comparison.body.changed, true);
    assert.ok(comparison.body.additions > 0);
    assert.equal(comparison.body.deletions, 0);

    const explicitTargetTurn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u8bf7\u4fee\u6539\u6cd5\u6587\u7684\u90a3\u4e2a\u6587\u4ef6\uff0c\u4f46\u4ee5\u6211\u660e\u786e\u9009\u4e2d\u7684\u7248\u672c\u4e3a\u51c6\uff0c\u52a0\u4e00\u4e2a\u76ee\u5f55\u7d22\u5f15",
      provider_connection_id: "file-deliverable-glm",
      model: "glm-5.2",
      target_artifact_id: artifact?.content?.artifact_id,
    });
    assert.equal(explicitTargetTurn.status, 201);
    assert.equal(conversationCalls, 6);
    assert.match(String(providerRequests.at(-1)?.system || ""), /Modify the complete source file guide-zh\.md/);
    assert.doesNotMatch(String(providerRequests.at(-1)?.system || ""), /Modify the complete source file guide-fr\.md/);

    const explicitDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const explicitMessages = explicitDetail.body.messages as Array<Record<string, any>>;
    const explicitArtifact = [...explicitMessages]
      .reverse()
      .find((message) => message.kind === "artifact_card" && message.content?.name === "guide-zh_v2.md");
    assert.ok(explicitArtifact);
    assert.equal(explicitArtifact?.content?.source_attachment_id, artifact?.content?.artifact_id);
    assert.equal(explicitArtifact?.content?.source_selection_source, "explicit");
    assert.equal(explicitArtifact?.content?.source_selection_confidence, 1);
    const explicitPreview = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${explicitArtifact?.content?.artifact_id}`,
    );
    assert.equal(explicitPreview.body.artifact.source_attachment_id, artifact?.content?.artifact_id);
    assert.equal(explicitPreview.body.artifact.source_selection_source, "explicit");
    assert.equal(explicitPreview.body.artifact.source_selection_confidence, 1);

    const frenchTocTurn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u5e2e\u6211\u7ed9\u6cd5\u8bed\u7684\u6587\u4ef6\u4e5f\u65b0\u589e\u4e00\u4e2a\u6cd5\u8bed\u7684\u989d\u76ee\u5f55\uff0c\u8c22\u8c22",
      provider_connection_id: "file-deliverable-glm",
      model: "glm-5.2",
    });
    assert.equal(frenchTocTurn.status, 201);
    assert.equal(conversationCalls, 7);
    assert.match(String(providerRequests.at(-1)?.system || ""), /Modify the complete source file guide-fr\.md/);
    assert.doesNotMatch(String(providerRequests.at(-1)?.system || ""), /Modify the complete source file guide-zh\.md/);

    const frenchTocDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const frenchTocMessages = frenchTocDetail.body.messages as Array<Record<string, any>>;
    const frenchTocArtifact = [...frenchTocMessages]
      .reverse()
      .find((message) => message.kind === "artifact_card" && message.content?.name === "guide-fr_v1.md");
    assert.ok(frenchTocArtifact);
    assert.notEqual(frenchTocArtifact?.content?.artifact_id, frenchArtifact?.content?.artifact_id);
    assert.equal(frenchTocArtifact?.content?.source_attachment_id, frenchArtifact?.content?.artifact_id);
    assert.equal(frenchTocArtifact?.content?.source_selection_source, "language");
    assert.equal(frenchTocArtifact?.content?.source_selection_confidence, 0.98);
    const frenchTocPreview = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${frenchTocArtifact?.content?.artifact_id}`,
    );
    assert.equal(frenchTocPreview.body.artifact.version, 2);
    assert.match(String(frenchTocPreview.body.content || ""), /## Sommaire/u);

    const inputsAfterModification = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`);
    assert.deepEqual(
      (inputsAfterModification.body.items as Array<Record<string, unknown>>).map((item) => item.name),
      ["guide-en.md"],
    );
  } finally {
    await server.close();
  }
});

test("ambiguous file targets use a structured model decision and inject only the selected source", async () => {
  resetTestRoot();
  let selectedAttachmentId = "";
  const providerSystems: string[] = [];
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const system = String(body.system || "");
    providerSystems.push(system);
    if (system.includes("SOURCE_FILE_SELECTION")) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{
          type: "text",
          text: JSON.stringify({
            source_attachment_id: selectedAttachmentId,
            confidence: 0.91,
            reason: "The latest instruction refers to the second document.",
          }),
        }],
        usage: { input_tokens: 40, output_tokens: 24 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const text = [
      '<my-mate-file name="beta.md">',
      "# Beta",
      "",
      "## Summary",
      "",
      "Selected source updated.",
      "</my-mate-file>",
    ].join("\n");
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":40}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":80}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "file-target-model",
      name: "File Target Model",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "file-target-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/file-target-model/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare two source documents",
      provider_connection_id: "file-target-model",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    await postJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`, {
      name: "alpha.md",
      storage_uri: "studio-upload://alpha.md",
      mime_type: "text/markdown",
      kind: "context",
      metadata: { source: "studio_conversation_upload", uploaded_text_content: "# Alpha\n\nFirst source." },
    });
    const beta = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`, {
      name: "beta.md",
      storage_uri: "studio-upload://beta.md",
      mime_type: "text/markdown",
      kind: "context",
      metadata: { source: "studio_conversation_upload", uploaded_text_content: "# Beta\n\nSecond source." },
    });
    selectedAttachmentId = String(beta.body.attachment.attachment_id);

    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u5e2e\u6211\u4fee\u6539\u90a3\u4e2a\u6587\u6863\uff0c\u52a0\u5165\u6458\u8981\u7d22\u5f15",
      provider_connection_id: "file-target-model",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.equal(providerSystems.length, 2);
    assert.match(providerSystems[0] || "", /SOURCE_FILE_SELECTION/);
    assert.match(providerSystems[1] || "", /Modify the complete source file beta\.md/);
    assert.match(providerSystems[1] || "", /File: beta\.md/);
    assert.doesNotMatch(providerSystems[1] || "", /File: alpha\.md/);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const messages = detail.body.messages as Array<Record<string, any>>;
    const artifact = [...messages].reverse().find((message) => message.kind === "artifact_card");
    assert.ok(artifact);
    assert.equal(artifact?.content?.source_attachment_id, selectedAttachmentId);
    assert.equal(artifact?.content?.source_selection_source, "model");
    assert.equal(artifact?.content?.source_selection_confidence, 0.91);
  } finally {
    await server.close();
  }
});

test("file language falls back to structured model intent when wording is outside the action lexicon", async () => {
  resetTestRoot();
  const providerSystems: string[] = [];
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const system = String(body.system || "");
    providerSystems.push(system);
    if (system.includes("FILE_OPERATION_CLASSIFICATION")) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{
          type: "text",
          text: JSON.stringify({
            operation: "modify",
            target_language_code: null,
            requested_output_name: null,
            confidence: 0.93,
            reason: "The user wants the existing French document restructured with a complete table of contents.",
          }),
        }],
        usage: { input_tokens: 32, output_tokens: 24 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const text = [
      '<my-mate-file name="notes-fr.md">',
      "# Notes fran\u00e7aises",
      "",
      "## Sommaire",
      "",
      "- [Contenu](#contenu)",
      "",
      "## Contenu",
      "",
      "Texte complet.",
      "</my-mate-file>",
    ].join("\n");
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":40}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":80}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "file-intent-model",
      name: "File Intent Model",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "file-intent-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/file-intent-model/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare French notes",
      provider_connection_id: "file-intent-model",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const attachment = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`, {
      name: "notes-fr.md",
      storage_uri: "studio-upload://notes-fr.md",
      mime_type: "text/markdown",
      kind: "context",
      metadata: {
        source: "studio_conversation_upload",
        target_language_code: "fr",
        uploaded_text_content: "# Notes fran\u00e7aises\n\nTexte complet.",
      },
    });

    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u8ba9\u8fd9\u4e2a\u6cd5\u8bed\u6587\u4ef6\u66f4\u9002\u5408\u6d4f\u89c8\uff0c\u76ee\u5f55\u8981\u5b8c\u6574",
      provider_connection_id: "file-intent-model",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.equal(providerSystems.length, 2);
    assert.match(providerSystems[0] || "", /FILE_OPERATION_CLASSIFICATION/);
    assert.doesNotMatch(providerSystems[0] || "", /File: notes-fr\.md/);
    assert.match(providerSystems[1] || "", /Modify the complete source file notes-fr\.md/);
    assert.match(providerSystems[1] || "", /File: notes-fr\.md/);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const messages = detail.body.messages as Array<Record<string, any>>;
    const artifact = [...messages].reverse().find((message) => message.kind === "artifact_card");
    assert.ok(artifact);
    assert.equal(artifact?.content?.source_attachment_id, attachment.body.attachment.attachment_id);
    assert.equal(artifact?.content?.name, "notes-fr.md");
  } finally {
    await server.close();
  }
});

test("web URLs are not misclassified as file extensions before the conversation turn", async () => {
  resetTestRoot();
  const providerSystems: string[] = [];
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    providerSystems.push(String(body.system || ""));
    return new Response(JSON.stringify({
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I will read the requested public webpage." }],
      usage: { input_tokens: 20, output_tokens: 12 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "url-read-glm",
      name: "URL Read GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "url-read-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/url-read-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Read a public page",
      provider_connection_id: "url-read-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "读取这个页面并告诉我标题和主要内容：https://zhuanlan.zhihu.com/p/7991262961",
      provider_connection_id: "url-read-glm",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.equal(providerSystems.length, 1);
    assert.doesNotMatch(providerSystems[0] || "", /FILE_OPERATION_CLASSIFICATION|SOURCE_FILE_SELECTION/u);
  } finally {
    await server.close();
  }
});

test("model version identifiers do not turn a cron request into an Artifact Worker request", async () => {
  resetTestRoot();
  let conversationRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationRound += 1;
    return new Response(JSON.stringify(conversationRound === 1 ? {
      model: "glm-5.2",
      stop_reason: "tool_use",
      content: [{
        type: "tool_use",
        id: "schedule-version-regression",
        name: "schedule_create",
        input: {
          name: "Version-safe cron",
          prompt: "Reply exactly CRON_E2E_TRIGGERED.",
          cron_expression: "0 9 * * *",
          timezone: "UTC",
          provider_connection_id: "cron-version-glm",
          model: "cron-version-glm/glm-5.2",
          autonomy_mode: "assisted",
        },
      }],
    } : {
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The schedule was created with its verified id." }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "cron-version-glm",
      name: "Cron Version GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "cron-version-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/cron-version-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Set up a scheduled task",
      provider_connection_id: "cron-version-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Create a real enabled cron schedule using cron-version-glm / glm-5.2 in Assisted mode. Create it now with the schedule tool.",
      provider_connection_id: "cron-version-glm",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.equal(listUserSchedules("default").length, 1);
    assert.equal(listUserSchedules("default")[0]?.model, "glm-5.2");
    assert.deepEqual(
      listConversationActions(sessionId).map((action) => action.tool_name),
      ["schedule_create"],
    );
  } finally {
    await server.close();
  }
});

test("deferred Excel requests create a one-time schedule before file generation", async () => {
  resetTestRoot();
  let conversationRound = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({ model: "glm-5.2", stop_reason: "end_turn", content: [{ type: "text", text: "OK" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    conversationRound += 1;
    return new Response(JSON.stringify(conversationRound === 1 ? {
      model: "glm-5.2",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "schedule-once-excel", name: "schedule_create", input: {
        name: "Twelve solar terms vegetables",
        prompt: "Create an Excel document listing vegetables for the twelve solar terms.",
        run_at: new Date(Date.now() + 300_000).toISOString(),
        timezone: "UTC",
        autonomy_mode: "assisted",
      } }],
    } : {
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The one-time schedule was created; the Excel task will run later." }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({ doctor: { fetchImpl: providerFetch }, conversation: { fetchImpl: providerFetch } });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "deferred-excel-glm", name: "Deferred Excel GLM", agent_runtime: "glm",
      provider: "anthropic-compatible", protocol: "anthropic-messages", base_url: "https://provider.example",
      models: ["glm-5.2"], default_model: "glm-5.2", credential_source: "managed", credential_env: "GLM_API_KEY",
      api_key: "deferred-excel-secret", status: "active", metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/deferred-excel-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a scheduled document task", provider_connection_id: "deferred-excel-glm", model: "glm-5.2", defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "5 minutes later, create an Excel document listing vegetables for the twelve solar terms.", provider_connection_id: "deferred-excel-glm", model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    const schedules = listUserSchedules("default");
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0]?.recurrence.kind, "once");
    assert.equal(listConversationActions(sessionId).map((action) => action.tool_name).join(","), "schedule_create");
    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal((detail.body.messages as Array<Record<string, any>>).some((message) => message.kind === "artifact_card"), false);
  } finally {
    await server.close();
  }
});

test("deferred Excel requests fall back to a one-time schedule when the model only acknowledges", async () => {
  resetTestRoot();
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I will arrange the spreadsheet task now." }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "deferred-fallback-glm",
      name: "Deferred Fallback GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "deferred-fallback-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/deferred-fallback-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare a scheduled spreadsheet task",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "In 5 minutes, create an Excel document listing vegetables for the twelve solar terms.",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    const schedules = listUserSchedules("default");
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0]?.recurrence.kind, "once");
    assert.equal(schedules[0]?.provider_connection_id, "deferred-fallback-glm");
    assert.equal(listConversationActions(sessionId).length, 0);
    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const messages = detail.body.messages as Array<Record<string, any>>;
    const reply = [...messages].reverse().find((message) => message.role === "orchestrator" && message.kind === "text");
    assert.match(String(reply?.content?.text || ""), /Schedule ID: schedule_/u);
    assert.equal(messages.some((message) => message.kind === "artifact_card"), false);

    const subAgentCreated = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare an internal review",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const subAgentSessionId = String(subAgentCreated.body.session.session_id);
    const subAgentSession = getSession(subAgentSessionId)!;
    subAgentSession.hidden = true;
    subAgentSession.metadata = { ...(subAgentSession.metadata || {}), subagent: true };
    saveSession(subAgentSession);
    const subAgentTurn = await postJson(`${server.baseUrl}/api/sessions/${subAgentSessionId}/messages`, {
      content: "Revise the containment plan content for a remediation that may be executed later after human approval.",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
    });
    assert.equal(subAgentTurn.status, 201);
    assert.equal(listUserSchedules("default").length, 1);
    const subAgentDetail = await getJson(`${server.baseUrl}/api/sessions/${subAgentSessionId}`);
    const subAgentMessages = subAgentDetail.body.messages as Array<Record<string, any>>;
    const subAgentReply = [...subAgentMessages].reverse().find((message) => message.role === "orchestrator" && message.kind === "text");
    assert.doesNotMatch(String(subAgentReply?.content?.text || ""), /Schedule ID:/u);
    assert.doesNotMatch(String(subAgentReply?.content?.text || ""), /No readable source file/u);

    const scheduledInvocationCreated = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Run a scheduled remediation review",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const scheduledInvocationSessionId = String(scheduledInvocationCreated.body.session.session_id);
    const scheduledInvocationSession = getSession(scheduledInvocationSessionId)!;
    scheduledInvocationSession.metadata = {
      ...(scheduledInvocationSession.metadata || {}),
      schedule_invocation: true,
      schedule_id: "schedule_parent",
      schedule_run_id: "schedule_run_parent",
    };
    saveSession(scheduledInvocationSession);
    const scheduledInvocationTurn = await postJson(`${server.baseUrl}/api/sessions/${scheduledInvocationSessionId}/messages`, {
      content: "Review an assess-only remediation that may be executed later after human approval.",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
    });
    assert.equal(scheduledInvocationTurn.status, 201);
    assert.equal(listUserSchedules("default").length, 1);
    const scheduledInvocationDetail = await getJson(`${server.baseUrl}/api/sessions/${scheduledInvocationSessionId}`);
    const scheduledInvocationMessages = scheduledInvocationDetail.body.messages as Array<Record<string, any>>;
    const scheduledInvocationReply = [...scheduledInvocationMessages].reverse().find((message) => message.role === "orchestrator" && message.kind === "text");
    assert.doesNotMatch(String(scheduledInvocationReply?.content?.text || ""), /Schedule ID:/u);

    const reduceCreated = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Aggregate an internal workflow result",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const reduceSessionId = String(reduceCreated.body.session.session_id);
    const reduceSession = getSession(reduceSessionId)!;
    reduceSession.metadata = { ...(reduceSession.metadata || {}), orchestration_reduce: true };
    saveSession(reduceSession);
    const reduceTurn = await postJson(`${server.baseUrl}/api/sessions/${reduceSessionId}/messages`, {
      content: "Revise the final report content that may be followed up later after human approval.",
      provider_connection_id: "deferred-fallback-glm",
      model: "glm-5.2",
    });
    assert.equal(reduceTurn.status, 201);
    assert.equal(listUserSchedules("default").length, 1);
  } finally {
    await server.close();
  }
});

test("low-confidence model file selection stops for explicit user choice", async () => {
  resetTestRoot();
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{
        type: "text",
        text: JSON.stringify({ source_attachment_id: "unknown", confidence: 0.35, reason: "Ambiguous." }),
      }],
      usage: { input_tokens: 40, output_tokens: 16 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "file-target-low-confidence",
      name: "File Target Low Confidence",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "file-target-low-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/file-target-low-confidence/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Prepare ambiguous sources",
      provider_connection_id: "file-target-low-confidence",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    for (const name of ["one.md", "two.md"]) {
      await postJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`, {
        name,
        storage_uri: `studio-upload://${name}`,
        mime_type: "text/markdown",
        kind: "context",
        metadata: { source: "studio_conversation_upload", uploaded_text_content: `# ${name}\n\nSource.` },
      });
    }

    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u4fee\u6539\u90a3\u4e2a\u6587\u6863\uff0c\u6dfb\u52a0\u76ee\u5f55\u7d22\u5f15",
      provider_connection_id: "file-target-low-confidence",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "waiting_human");
    assert.equal(detail.body.session.metadata.latest_orchestrator_intent, "file_target_clarification");
    const messages = detail.body.messages as Array<Record<string, any>>;
    assert.equal(messages.some((message) => message.kind === "artifact_card"), false);
    const assistant = [...messages].reverse().find(
      (message) => message.role === "orchestrator" && message.kind === "text",
    );
    assert.match(String(assistant?.content?.text || ""), /one\.md/u);
    assert.match(String(assistant?.content?.text || ""), /two\.md/u);
  } finally {
    await server.close();
  }
});

test("document-to-Excel requests create a real XLSX artifact instead of stopping at an acknowledgement", async () => {
  resetTestRoot();
  const providerRequests: Array<Record<string, unknown>> = [];
  let conversationCalls = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    providerRequests.push(body);
    conversationCalls += 1;
    const text = [
      '<my-mate-file name="guide-zh-summary.xlsx">',
      JSON.stringify({
        sheet_name: "\u6838\u5fc3\u89c2\u70b9",
        columns: ["\u5e8f\u53f7", "\u7ae0\u8282", "\u89c2\u70b9", "\u8be6\u7ec6\u8bf4\u660e", "\u5173\u952e\u8bcd"],
        rows: [
          [1, "\u7b2c 0 \u7ae0", "Agent Platform \u4ece\u804a\u5929\u8d70\u5411\u5b8c\u6210\u5de5\u4f5c", "\u6838\u5fc3\u4ef7\u503c\u662f\u5c06\u610f\u56fe\u8f6c\u5316\u4e3a\u53ef\u9a8c\u8bc1\u7684\u4ea7\u51fa\u3002", "Agent,\u4ea7\u51fa"],
          [2, "\u7b2c 1 \u7ae0", "\u5bb9\u5668\u5316\u662f\u5de5\u7a0b\u5316\u524d\u63d0", "\u6c99\u76d2\u9694\u79bb\u4e3a\u9ad8\u98ce\u9669\u64cd\u4f5c\u63d0\u4f9b\u8fb9\u754c\u3002", "Docker,\u6c99\u76d2"],
        ],
      }),
      "</my-mate-file>",
    ].join("\n");
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":40}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":120}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "excel-deliverable-glm",
      name: "Excel Deliverable GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "excel-deliverable-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/excel-deliverable-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Inspect the attached document.",
      provider_connection_id: "excel-deliverable-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    await postJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`, {
      name: "guide-zh.md",
      storage_uri: "studio-upload://guide-zh.md",
      mime_type: "text/markdown",
      size_bytes: 128,
      kind: "context",
      metadata: {
        source: "studio_conversation_upload",
        relative_path: "guide-zh.md",
        uploaded_text_content: "# Agent Platform\n\n\u5bb9\u5668\u5316\u3001\u591a Agent \u534f\u4f5c\u548c\u4eba\u5728\u73af\u4e2d\u662f\u6587\u6863\u7684\u6838\u5fc3\u4e3b\u9898\u3002",
      },
    });

    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u80fd\u9488\u5bf9\u4e2d\u6587\u7684\u6587\u6863\u751f\u6210\u4e00\u4e2aexcel\u8868\u683c\u5217\u51fa\u6765\u8868\u8fbe\u7684\u89c2\u70b9\u5417",
      provider_connection_id: "excel-deliverable-glm",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.equal(conversationCalls, 1);
    assert.match(String(providerRequests[0]?.system || ""), /server will create the XLSX binary/i);
    assert.doesNotMatch(JSON.stringify(turn.body), /\u6211\u73b0\u5728\u5f00\u59cb\u751f\u6210/u);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "completed");
    assert.equal(detail.body.session.metadata.latest_orchestrator_intent, "deliver_file");
    const messages = detail.body.messages as Array<Record<string, any>>;
    const artifact = messages.find((message) => message.kind === "artifact_card");
    assert.equal(artifact?.content?.name, "guide-zh-summary.xlsx");
    assert.equal(
      artifact?.content?.mime_type,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const download = await fetch(`${server.baseUrl}${artifact?.content?.storage_uri}`);
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const bytes = new Uint8Array(await download.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
    const workbookFiles = unzipSync(bytes);
    assert.ok(workbookFiles["[Content_Types].xml"]);
    assert.ok(workbookFiles["xl/workbook.xml"]);
    assert.ok(workbookFiles["xl/styles.xml"]);
    assert.ok(workbookFiles["xl/worksheets/sheet1.xml"]);
    assert.match(strFromU8(workbookFiles["xl/workbook.xml"]!), /name="\u6838\u5fc3\u89c2\u70b9"/u);
    assert.match(strFromU8(workbookFiles["xl/worksheets/sheet1.xml"]!), /Agent Platform/u);

    const preview = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${artifact?.content?.artifact_id}`,
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview_kind, "table");
    assert.deepEqual(preview.body.table_preview.columns, ["\u5e8f\u53f7", "\u7ae0\u8282", "\u89c2\u70b9", "\u8be6\u7ec6\u8bf4\u660e", "\u5173\u952e\u8bcd"]);
    assert.equal(preview.body.table_preview.rows.length, 2);
  } finally {
    await server.close();
  }
});

test("new Excel requests without attachments create a real XLSX artifact", async () => {
  resetTestRoot();
  const providerRequests: Array<Record<string, unknown>> = [];
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    providerRequests.push(body);
    const text = [
      '<my-mate-file name="十二节气.xlsx">',
      JSON.stringify({
        sheet_name: "\u5341\u4e8c\u8282\u6c14",
        columns: ["\u5e8f\u53f7", "\u8282\u6c14", "\u5b63\u8282", "\u5927\u81f4\u65e5\u671f"],
        rows: [
          [1, "\u7acb\u6625", "\u6625", "2\u67083-5\u65e5"],
          [2, "\u60ca\u86f0", "\u6625", "3\u67085-7\u65e5"],
          [3, "\u6e05\u660e", "\u6625", "4\u67084-6\u65e5"],
          [4, "\u7acb\u590f", "\u590f", "5\u67085-7\u65e5"],
          [5, "\u8292\u79cd", "\u590f", "6\u67085-7\u65e5"],
          [6, "\u5c0f\u6691", "\u590f", "7\u67086-8\u65e5"],
          [7, "\u7acb\u79cb", "\u79cb", "8\u67087-9\u65e5"],
          [8, "\u767d\u9732", "\u79cb", "9\u67087-9\u65e5"],
          [9, "\u5bd2\u9732", "\u79cb", "10\u67088-9\u65e5"],
          [10, "\u7acb\u51ac", "\u51ac", "11\u67087-8\u65e5"],
          [11, "\u5927\u96ea", "\u51ac", "12\u67086-8\u65e5"],
          [12, "\u5c0f\u5bd2", "\u51ac", "1\u67085-7\u65e5"],
        ],
      }),
      "</my-mate-file>",
    ].join("\n");
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":40}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":180}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "new-excel-glm",
      name: "New Excel GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "new-excel-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/new-excel-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a spreadsheet",
      provider_connection_id: "new-excel-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u5e2e\u6211\u751f\u6210\u4e00\u4e2aexcel\u6587\u6863\uff0c\u8bb0\u5f55\u5341\u4e8c\u8282\u6c14",
      provider_connection_id: "new-excel-glm",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.equal(providerRequests.length, 1);
    assert.match(String(providerRequests[0]?.system || ""), /Create a complete new file/i);
    assert.match(String(providerRequests[0]?.system || ""), /server will create the XLSX binary/i);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "completed");
    assert.equal(detail.body.session.metadata.latest_orchestrator_intent, "deliver_file");
    const artifact = (detail.body.messages as Array<Record<string, any>>).find(
      (message) => message.kind === "artifact_card" && message.content?.name === "十二节气.xlsx",
    );
    assert.ok(artifact);
    const preview = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/artifacts/${artifact?.content?.artifact_id}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview_kind, "table");
    assert.equal(preview.body.table_preview.rows.length, 12);
    assert.equal(preview.body.table_preview.rows[0][1], "\u7acb\u6625");
    const download = await fetch(`${server.baseUrl}${artifact?.content?.storage_uri}`);
    assert.equal(download.status, 200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
    const invocations = await getJson(
      `${server.baseUrl}/api/skill-host/invocations?session_id=${encodeURIComponent(sessionId)}`,
    );
    const spreadsheetInvocation = (invocations.body.items as Array<Record<string, any>>)
      .find((item) => item.skill_id === "artifact-spreadsheet");
    assert.equal(spreadsheetInvocation?.status, "completed", JSON.stringify(invocations.body));
    assert.equal(spreadsheetInvocation?.verification_status, "passed");

    const duplicateTurn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "帮我生成一个excel文档，记录十二节气",
      provider_connection_id: "new-excel-glm",
      model: "glm-5.2",
    });
    assert.equal(duplicateTurn.status, 201);
    const versionedDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const versionedNames = (versionedDetail.body.messages as Array<Record<string, any>>)
      .filter((message) => message.kind === "artifact_card")
      .map((message) => message.content?.name);
    assert.deepEqual(versionedNames, ["十二节气.xlsx", "十二节气_v1.xlsx"]);

    const providerRequestCountBeforePdf = providerRequests.length;
    const pdfTurn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "\u80fd\u5e2e\u6211\u8f6c\u6210PDF\u5417",
      provider_connection_id: "new-excel-glm",
      model: "glm-5.2",
    });
    assert.equal(pdfTurn.status, 201);
    assert.equal(providerRequests.length, providerRequestCountBeforePdf);
    const pdfDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(pdfDetail.body.session.status, "waiting_human");
    assert.equal(pdfDetail.body.session.metadata.latest_orchestrator_intent, "artifact_worker_approval_required");
    assert.equal(pdfDetail.body.session.metadata.requested_artifact_name, "十二节气_v1.pdf");
    assert.equal(pdfDetail.body.session.metadata.requested_artifact_worker_status, "pending_approval");
    const pdfReply = (pdfDetail.body.messages as Array<Record<string, any>>)
      .filter((message) => message.role === "orchestrator" && message.kind === "text")
      .at(-1)?.content?.text;
    assert.match(String(pdfReply), /Desktop/u);
    assert.equal(
      (pdfDetail.body.messages as Array<Record<string, any>>).some(
        (message) => message.kind === "artifact_card" && message.content?.name === "十二节气_v1.pdf",
      ),
      false,
    );
  } finally {
    await server.close();
  }
});

test("one conversation turn generates both Excel and Word artifacts before completing", async () => {
  resetTestRoot();
  const generationSystems: string[] = [];
  const workerInputs: Array<Record<string, unknown>> = [];
  const approvalArguments: Array<Record<string, unknown>> = [];
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const system = String(body.system || "");
    generationSystems.push(system);
    const isSpreadsheet = /Output file name: 十二节气\.xlsx/u.test(system);
    const text = isSpreadsheet
      ? [
          '<my-mate-file name="十二节气.xlsx">',
          JSON.stringify({
            sheet_name: "\u5341\u4e8c\u8282\u6c14",
            columns: ["\u5e8f\u53f7", "\u8282\u6c14", "\u542b\u4e49"],
            rows: [
              [1, "\u7acb\u6625", "\u6625\u5b63\u5f00\u59cb"],
              [2, "\u60ca\u86f0", "\u6625\u96f7\u60ca\u9192\u86f0\u866b"],
            ],
          }),
          "</my-mate-file>",
        ].join("\n")
      : [
          '<my-mate-file name="十二节气.docx">',
          "# \u5341\u4e8c\u8282\u6c14",
          "",
          "1. \u7acb\u6625 - \u6625\u5b63\u5f00\u59cb",
          "2. \u60ca\u86f0 - \u6625\u96f7\u60ca\u9192\u86f0\u866b",
          "</my-mate-file>",
        ].join("\n");
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":20}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":80}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const docx = Buffer.from(zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<document><p>\u5341\u4e8c\u8282\u6c14</p></document>"),
  }));
  const previewPdf = Buffer.from("%PDF-1.4\n%%EOF\n", "ascii");
  const server = await startTestServer({
    desktopBridgeToken: "multi-artifact-approval",
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
    artifactWorker: {
      run: async (input) => {
        workerInputs.push(input as unknown as Record<string, unknown>);
        return {
          outputName: input.outputName,
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          content: docx,
          extractedText: "\u5341\u4e8c\u8282\u6c14\n1. \u7acb\u6625\n2. \u60ca\u86f0",
          previewPdf,
          sha256: "multi-docx-digest",
          workerVersion: "test-worker",
          validation: { paragraph_count: 3 },
        };
      },
    },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "multi-artifact-glm",
      name: "Multi Artifact GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "multi-artifact-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/multi-artifact-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create multiple files",
      provider_connection_id: "multi-artifact-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const result = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "\u5e2e\u6211\u751f\u6210\u8bb0\u5f55\u5341\u4e8c\u8282\u6c14\u7684 Excel \u548c Word \u6587\u6863",
      providerConnectionId: "multi-artifact-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: async (request: {
        session_id: string;
        action_id: string;
        capability_id?: string;
        arguments?: Record<string, unknown>;
      }) => {
        approvalArguments.push(request.arguments || {});
        const response = await postJson(
          `${server.baseUrl}/api/internal/desktop/sessions/${request.session_id}/conversation-actions/${request.action_id}/result`,
          { status: "approved", capability_id: request.capability_id },
          { authorization: "Bearer multi-artifact-approval" },
        );
        assert.equal(response.status, 200);
      },
    });
    assert.match(String(result.assistantMessage.content.text), /十二节气\.docx/u);
    assert.equal(generationSystems.length, 2);
    assert.equal(workerInputs.length, 1);
    assert.equal(workerInputs[0]?.outputName, "十二节气.docx");
    assert.equal(approvalArguments.length, 1);
    assert.equal(approvalArguments[0]?.batch, true);
    assert.deepEqual(
      (approvalArguments[0]?.outputs as Array<Record<string, unknown>>).map((item) => item.output_name),
      ["十二节气.docx"],
    );

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "completed");
    assert.equal(detail.body.session.metadata.latest_orchestrator_intent, "deliver_files");
    assert.deepEqual(detail.body.session.metadata.completed_artifact_names, [
      "十二节气.xlsx",
      "十二节气.docx",
    ]);
    assert.equal(detail.body.task_checkpoint.status, "completed");
    const artifacts = (detail.body.messages as Array<Record<string, any>>)
      .filter((message) => message.kind === "artifact_card");
    const artifactNames = artifacts.map((message) => message.content?.name);
    assert.deepEqual(artifactNames, ["十二节气.xlsx", "十二节气.docx"]);
    for (const artifact of artifacts) {
      const download = await fetch(`${server.baseUrl}${artifact.content?.storage_uri}`);
      assert.equal(download.status, 200);
    }
  } finally {
    await server.close();
  }
});

test("Desktop approval runs the Artifact Worker for DOCX creation and source-preserving PDF conversion", async () => {
  resetTestRoot();
  let generationCalls = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    generationCalls += 1;
    const text = '<my-mate-file name="report.docx"># Quarterly report\n\nVerified worker content.\n</my-mate-file>';
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":20}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":40}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const docx = Buffer.from(zipSync({
    "[Content_Types].xml": strToU8("<Types/>") ,
    "word/document.xml": strToU8("<document><p>Verified worker content.</p></document>"),
  }));
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n", "ascii");
  const workerInputs: Array<Record<string, unknown>> = [];
  const server = await startTestServer({
    desktopBridgeToken: "artifact-worker-approval",
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
    artifactWorker: {
      run: async (input) => {
        workerInputs.push(input as unknown as Record<string, unknown>);
        const isPdf = input.outputName.endsWith(".pdf");
        return {
          outputName: input.outputName,
          mimeType: isPdf
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          content: isPdf ? pdf : docx,
          extractedText: "Quarterly report\nVerified worker content.",
          previewPdf: pdf,
          sha256: isPdf ? "pdf-digest" : "docx-digest",
          workerVersion: "test-worker",
          validation: isPdf ? { page_count: 1 } : { paragraph_count: 2 },
        };
      },
    },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "artifact-worker-glm",
      name: "Artifact Worker GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "artifact-worker-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/artifact-worker-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a report",
      provider_connection_id: "artifact-worker-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const approve = async (request: { session_id: string; action_id: string; capability_id?: string }) => {
      const response = await postJson(
        `${server.baseUrl}/api/internal/desktop/sessions/${request.session_id}/conversation-actions/${request.action_id}/result`,
        { status: "approved", capability_id: request.capability_id },
        { authorization: "Bearer artifact-worker-approval" },
      );
      assert.equal(response.status, 200);
    };
    const first = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "Generate report.docx and export the complete Word file",
      providerConnectionId: "artifact-worker-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: approve,
    });
    assert.match(String(first.assistantMessage.content.text), /Download report\.docx/u);
    assert.equal(generationCalls, 1);
    assert.match(String(workerInputs[0]?.content), /Verified worker content/u);
    const firstDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const docxArtifact = (firstDetail.body.messages as Array<Record<string, any>>).find(
      (message) => message.kind === "artifact_card" && message.content?.name === "report.docx",
    );
    assert.ok(docxArtifact);
    const docxPreview = await getJson(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${docxArtifact.content.artifact_id}`,
    );
    assert.equal(docxPreview.body.preview_kind, "pdf");
    const previewResponse = await fetch(`${server.baseUrl}${docxPreview.body.preview_uri}`);
    assert.equal(previewResponse.status, 200);
    assert.equal(Buffer.from(await previewResponse.arrayBuffer()).subarray(0, 5).toString("ascii"), "%PDF-");
    const docxDownload = await fetch(`${server.baseUrl}${docxArtifact.content.storage_uri}`);
    assert.deepEqual([...Buffer.from(await docxDownload.arrayBuffer()).subarray(0, 2)], [0x50, 0x4b]);

    const converted = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "Convert it to PDF",
      providerConnectionId: "artifact-worker-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: approve,
    });
    assert.match(String(converted.assistantMessage.content.text), /Download report\.pdf/u);
    assert.equal(generationCalls, 1, "A deterministic format conversion must not call the model again.");
    assert.equal(workerInputs[1]?.preferSourceConversion, true);
    assert.equal((workerInputs[1]?.sourceContent as Buffer).subarray(0, 2).toString("ascii"), "PK");
    const convertedDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const pdfArtifact = (convertedDetail.body.messages as Array<Record<string, any>>).find(
      (message) => message.kind === "artifact_card" && message.content?.name === "report.pdf",
    );
    assert.ok(pdfArtifact);
    const pdfDownload = await fetch(`${server.baseUrl}${pdfArtifact.content.storage_uri}`);
    assert.equal(Buffer.from(await pdfDownload.arrayBuffer()).subarray(0, 5).toString("ascii"), "%PDF-");

    const generationCallsBeforeRepair = generationCalls;
    const repaired = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "为什么里面的内容都是乱码？",
      providerConnectionId: "artifact-worker-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: approve,
    });
    assert.match(String(repaired.assistantMessage.content.text), /report_v1\.pdf/u);
    assert.equal(generationCalls, generationCallsBeforeRepair, "A rendering repair with extractable source text must not call the model.");
    assert.equal(workerInputs[2]?.outputName, "report.pdf");
    assert.equal(workerInputs[2]?.preferSourceConversion, false);
    assert.match(String(workerInputs[2]?.content), /Verified worker content/u);

    const regenerated = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "帮我重新生成了吗",
      providerConnectionId: "artifact-worker-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: approve,
    });
    assert.match(String(regenerated.assistantMessage.content.text), /report_v2\.pdf/u);
    assert.equal(generationCalls, generationCallsBeforeRepair, "Regenerating the latest verified artifact must not call the model.");
    assert.equal(workerInputs[3]?.outputName, "report_v1.pdf");
    const repairedDetail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.notEqual(repairedDetail.body.session.current_goal, "帮我重新生成了吗");

    const uploadedSession = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Convert an uploaded document",
      provider_connection_id: "artifact-worker-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const uploadedSessionId = String(uploadedSession.body.session.session_id);
    const uploaded = await postJson(`${server.baseUrl}/api/sessions/${uploadedSessionId}/attachments`, {
      name: "uploaded.docx",
      storage_uri: "browser-file://uploaded.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size_bytes: docx.byteLength,
      kind: "context",
      metadata: {
        source: "studio_conversation_upload",
        uploaded_binary_content_base64: docx.toString("base64"),
        encoding: "base64",
      },
    });
    assert.equal(uploaded.status, 201);
    await server.app.locals.streamConversationTurn({
      sessionId: uploadedSessionId,
      content: "Convert the attached document to PDF",
      providerConnectionId: "artifact-worker-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: approve,
    });
    assert.equal(generationCalls, 1, "Uploaded binary conversion must not call the model.");
    assert.equal(workerInputs[4]?.sourceName, "uploaded.docx");
    assert.equal((workerInputs[4]?.sourceContent as Buffer).subarray(0, 2).toString("ascii"), "PK");
    assert.equal(workerInputs[4]?.preferSourceConversion, true);
  } finally {
    await server.close();
  }
});

test("handwritten PDF payloads are rejected and repaired before the Artifact Worker runs", async () => {
  resetTestRoot();
  let generationCalls = 0;
  const generationSystems: string[] = [];
  const workerContents: string[] = [];
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    generationCalls += 1;
    generationSystems.push(String(body.system || ""));
    const text = generationCalls === 1
      ? [
          '<my-mate-file name="solar-terms.pdf">',
          "%PDF-1.7",
          "1 0 obj <</Type /Catalog>> endobj",
          "xref",
          "0 2",
          "trailer <</Root 1 0 R>>",
          "startxref",
          "42",
          "%%EOF",
          "</my-mate-file>",
        ].join("\n")
      : [
          '<my-mate-file name="solar-terms.pdf">',
          "# \u5341\u4e8c\u8282\u6c14",
          "",
          "\u7acb\u6625\u3001\u60ca\u86f0\u3001\u6e05\u660e\u3001\u7acb\u590f\u3001\u8292\u79cd\u3001\u5c0f\u6691\u3001\u7acb\u79cb\u3001\u767d\u9732\u3001\u5bd2\u9732\u3001\u7acb\u51ac\u3001\u5927\u96ea\u3001\u5c0f\u5bd2\u3002",
          "</my-mate-file>",
        ].join("\n");
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":20}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":80}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n", "ascii");
  const server = await startTestServer({
    desktopBridgeToken: "artifact-worker-pdf-repair",
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
    artifactWorker: {
      run: async (input) => {
        workerContents.push(String(input.content || ""));
        return {
          outputName: input.outputName,
          mimeType: "application/pdf",
          content: pdf,
          extractedText: "\u5341\u4e8c\u8282\u6c14\n\u7acb\u6625",
          previewPdf: pdf,
          sha256: "pdf-repair-digest",
          workerVersion: "test-worker",
          validation: { page_count: 1, embedded_font_count: 1, render_ink_pixels: 500 },
        };
      },
    },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "artifact-pdf-repair-glm",
      name: "Artifact PDF Repair GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "artifact-pdf-repair-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/artifact-pdf-repair-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a PDF",
      provider_connection_id: "artifact-pdf-repair-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const result = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "\u751f\u6210\u4e00\u4e2a\u5341\u4e8c\u8282\u6c14\u7684 solar-terms.pdf \u6587\u4ef6",
      providerConnectionId: "artifact-pdf-repair-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: async (request: { session_id: string; action_id: string; capability_id?: string }) => {
        const response = await postJson(
          `${server.baseUrl}/api/internal/desktop/sessions/${request.session_id}/conversation-actions/${request.action_id}/result`,
          { status: "approved", capability_id: request.capability_id },
          { authorization: "Bearer artifact-worker-pdf-repair" },
        );
        assert.equal(response.status, 200);
      },
    });
    assert.match(String(result.assistantMessage.content.text), /solar-terms\.pdf/u);
    assert.equal(generationCalls, 2);
    assert.match(generationSystems[0] || "", /Never handwrite PDF objects/u);
    assert.match(generationSystems[1] || "", /semantic repair round 1/u);
    assert.deepEqual(workerContents.length, 1);
    assert.doesNotMatch(workerContents[0] || "", /^%PDF-/u);
    assert.match(workerContents[0] || "", /\u5341\u4e8c\u8282\u6c14/u);
  } finally {
    await server.close();
  }
});

test("Artifact Worker preflight failure stops before model generation", async () => {
  resetTestRoot();
  let generationCalls = 0;
  let preflightCalls = 0;
  let workerCalls = 0;
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    generationCalls += 1;
    return new Response(JSON.stringify({ error: "The provider must not be called." }), { status: 500 });
  };
  const server = await startTestServer({
    desktopBridgeToken: "artifact-worker-preflight",
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
    artifactWorker: {
      preflight: async () => {
        preflightCalls += 1;
        throw new ArtifactWorkerError(
          "artifact_worker_image_unavailable",
          "Artifact Worker image my-mate-artifact-worker:0.1.0 is not available locally.",
        );
      },
      run: async () => {
        workerCalls += 1;
        throw new Error("Worker must not run after a failed preflight.");
      },
    },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "artifact-worker-preflight-glm",
      name: "Artifact Worker Preflight GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "artifact-worker-preflight-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/artifact-worker-preflight-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a PDF",
      provider_connection_id: "artifact-worker-preflight-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const result = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "Generate a PDF about the 12 solar terms",
      providerConnectionId: "artifact-worker-preflight-glm",
      model: "glm-5.2",
      onDelta: () => {},
      onDesktopCapability: async (request: { session_id: string; action_id: string; capability_id?: string }) => {
        const response = await postJson(
          `${server.baseUrl}/api/internal/desktop/sessions/${request.session_id}/conversation-actions/${request.action_id}/result`,
          { status: "approved", capability_id: request.capability_id },
          { authorization: "Bearer artifact-worker-preflight" },
        );
        assert.equal(response.status, 200);
      },
    });
    assert.equal(preflightCalls, 1);
    assert.equal(generationCalls, 0);
    assert.equal(workerCalls, 0);
    assert.match(String(result.assistantMessage.content.text), /not available locally/u);
    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "waiting_human");
    assert.equal(detail.body.session.metadata.latest_artifact_worker_error_code, "artifact_worker_image_unavailable");
  } finally {
    await server.close();
  }
});

test("artifact progress promises remain incomplete when no verified output exists", async () => {
  resetTestRoot();
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const system = JSON.stringify(body.system || "");
    const text = system.includes("FILE_OPERATION_CLASSIFICATION")
      ? '{"operation":"none","output_format":"worker","target_language_code":null,"requested_output_name":null,"confidence":0.99,"reason":"question only"}'
      : "请稍等，正在生成 PDF 文件。";
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":20}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "artifact-promise-glm",
      name: "Artifact Promise GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "artifact-promise-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/artifact-promise-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Inspect PDF rendering",
      provider_connection_id: "artifact-promise-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const result = await server.app.locals.streamConversationTurn({
      sessionId,
      content: "PDF 文件为什么显示异常？",
      providerConnectionId: "artifact-promise-glm",
      model: "glm-5.2",
      onDelta: () => {},
    });
    assert.match(String(result.assistantMessage.content.text), /本轮保持未完成/u);
    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "waiting_human");
    assert.equal(detail.body.session.metadata.latest_orchestrator_intent, "artifact_output_incomplete");
    assert.equal(detail.body.task_checkpoint.status, "waiting_human");
    const invocations = await getJson(
      `${server.baseUrl}/api/skill-host/invocations?session_id=${encodeURIComponent(sessionId)}`,
    );
    const invocation = (invocations.body.items as Array<Record<string, any>>)
      .find((item) => item.skill_id === "artifact-pdf");
    assert.equal(invocation?.status, "failed");
    assert.equal(invocation?.verification_status, "failed");
    assert.equal(invocation?.error_code, "skill_artifact_output_unverified");
  } finally {
    await server.close();
  }
});

test("provider artifact claims are rejected when no generated artifact was persisted", async () => {
  resetTestRoot();
  const fakeArtifactId = "att_20260714T095500000Z_000_frflow";
  let claimedSessionId = "not-created-yet";
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      model: "glm-5.2",
      stop_reason: "end_turn",
      content: [{
        type: "text",
        text: `File created: [Download result.md](http://127.0.0.1:6374/api/sessions/${claimedSessionId}/artifacts/${fakeArtifactId}/download)`,
      }],
      usage: { input_tokens: 20, output_tokens: 30 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });

  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "artifact-claim-glm",
      name: "Artifact Claim GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      max_input_tokens: 524_288,
      max_output_tokens: 65_536,
      context_compression_enabled: true,
      context_compression_threshold_percent: 75,
      max_continuation_rounds: 8,
      max_tool_rounds: 32,
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "artifact-claim-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/artifact-claim-glm/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Inspect the current task state.",
      provider_connection_id: "artifact-claim-glm",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    claimedSessionId = sessionId;

    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "What happened in the last step?",
      provider_connection_id: "artifact-claim-glm",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);

    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "waiting_human");
    assert.equal(detail.body.session.metadata.latest_orchestrator_intent, "artifact_claim_rejected");
    assert.deepEqual(detail.body.session.metadata.rejected_artifact_ids, [fakeArtifactId]);
    const messages = detail.body.messages as Array<Record<string, any>>;
    const assistant = [...messages].reverse().find(
      (message) => message.role === "orchestrator" && message.kind === "text",
    );
    assert.match(String(assistant?.content?.text || ""), /no matching server artifact exists/i);
    assert.doesNotMatch(String(assistant?.content?.text || ""), new RegExp(fakeArtifactId));
    assert.equal(messages.some((message) => message.kind === "artifact_card"), false);
    assert.deepEqual((await getJson(`${server.baseUrl}/api/sessions/${sessionId}/attachments`)).body.items, []);

    const fakeDownload = await fetch(
      `${server.baseUrl}/api/sessions/${sessionId}/artifacts/${fakeArtifactId}/download`,
    );
    assert.equal(fakeDownload.status, 404);
  } finally {
    await server.close();
  }
});

test("new code files are generated without requiring a source attachment", async () => {
  resetTestRoot();
  let generationSystem = "";
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    generationSystem = String(body.system || "");
    const text = '<my-mate-file name="Main.java">public class Main { public static void main(String[] args) {} }\n</my-mate-file>';
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.2","usage":{"input_tokens":20}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":40}}\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "new-code-file",
      name: "New code file",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://provider.example",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      credential_env: "GLM_API_KEY",
      api_key: "fixture-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/new-code-file/test`, {});
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a small Java program",
      provider_connection_id: "new-code-file",
      model: "glm-5.2",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Generate Main.java and export it as a file",
      provider_connection_id: "new-code-file",
      model: "glm-5.2",
    });
    assert.equal(turn.status, 201);
    assert.match(generationSystem, /Create a complete new file/);
    assert.doesNotMatch(generationSystem, /(?:Modify|Transform) the complete source file/);
    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    const artifact = (detail.body.messages as Array<Record<string, any>>).find(
      (message) => message.kind === "artifact_card" && message.content?.name === "Main.java",
    );
    assert.ok(artifact);
    const preview = await getJson(`${server.baseUrl}/api/sessions/${sessionId}/artifacts/${artifact?.content?.artifact_id}`);
    assert.equal(preview.body.preview_kind, "text");
    assert.match(String(preview.body.content), /public class Main/);
  } finally {
    await server.close();
  }
});

test("binary file requests create a pending Artifact Worker approval instead of accepting an acknowledgement", async () => {
  resetTestRoot();
  let providerCalled = false;
  const server = await startTestServer({
    conversation: {
      fetchImpl: async () => {
        providerCalled = true;
        throw new Error("Provider should not be called for a Worker binary request.");
      },
    },
  });
  try {
    const created = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a report",
      defer_conversation_reply: true,
    });
    const sessionId = String(created.body.session.session_id);
    const turn = await postJson(`${server.baseUrl}/api/sessions/${sessionId}/messages`, {
      content: "Generate report.pdf and export the complete file",
    });
    assert.equal(turn.status, 201);
    assert.equal(providerCalled, false);
    const detail = await getJson(`${server.baseUrl}/api/sessions/${sessionId}`);
    assert.equal(detail.body.session.status, "waiting_human");
    assert.equal(detail.body.session.latest_orchestrator_intent, "artifact_worker_approval_required");
    assert.equal(detail.body.session.metadata.requested_artifact_name, "report.pdf");
    const text = (detail.body.messages as Array<Record<string, any>>)
      .filter((message) => message.role === "orchestrator" && message.kind === "text")
      .at(-1)?.content?.text;
    assert.match(String(text), /Artifact Worker/);
    assert.doesNotMatch(String(text), /start generating|稍等/u);

    const unknownCreated = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create a custom binary package",
      defer_conversation_reply: true,
    });
    const unknownSessionId = String(unknownCreated.body.session.session_id);
    await postJson(`${server.baseUrl}/api/sessions/${unknownSessionId}/messages`, {
      content: "Generate bundle.acmebin and export the complete file",
    });
    const unknownDetail = await getJson(`${server.baseUrl}/api/sessions/${unknownSessionId}`);
    assert.equal(unknownDetail.body.session.latest_orchestrator_intent, "artifact_worker_approval_required");
    assert.equal(unknownDetail.body.session.metadata.requested_artifact_name, "bundle.acmebin");
    assert.equal(unknownDetail.body.session.metadata.requested_artifact_mime_type, "application/octet-stream");

    const multiCreated = await postJson(`${server.baseUrl}/api/sessions`, {
      initial_message: "Create multiple reports",
      defer_conversation_reply: true,
    });
    const multiSessionId = String(multiCreated.body.session.session_id);
    await postJson(`${server.baseUrl}/api/sessions/${multiSessionId}/messages`, {
      content: "\u751f\u6210\u5341\u4e8c\u8282\u6c14\u7684 Excel \u548c Word \u6587\u6863",
    });
    const multiDetail = await getJson(`${server.baseUrl}/api/sessions/${multiSessionId}`);
    assert.equal(multiDetail.body.session.status, "waiting_human");
    assert.equal(multiDetail.body.session.latest_orchestrator_intent, "artifact_worker_batch_approval_required");
    assert.deepEqual(multiDetail.body.session.metadata.requested_artifact_names, [
      "十二节气.xlsx",
      "十二节气.docx",
    ]);
    assert.equal(
      (multiDetail.body.messages as Array<Record<string, any>>).some((message) => message.kind === "artifact_card"),
      false,
    );
    assert.equal(providerCalled, false, "HTTP fallback must not generate only the first item in a mixed batch.");
  } finally {
    await server.close();
  }
});
