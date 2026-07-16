import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

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
      .find((message) => message.kind === "artifact_card" && message.content?.name === "guide-zh.md");
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
      .find((message) => message.kind === "artifact_card" && message.content?.name === "guide-zh.md");
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
      .find((message) => message.kind === "artifact_card" && message.content?.name === "guide-fr.md");
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
          [1, "\u7b2c 0 \u7ae0", "OpenClaw \u4ece\u804a\u5929\u8d70\u5411\u5b8c\u6210\u5de5\u4f5c", "\u6838\u5fc3\u4ef7\u503c\u662f\u5c06\u610f\u56fe\u8f6c\u5316\u4e3a\u53ef\u9a8c\u8bc1\u7684\u4ea7\u51fa\u3002", "Agent,\u4ea7\u51fa"],
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
        uploaded_text_content: "# OpenClaw\n\n\u5bb9\u5668\u5316\u3001\u591a Agent \u534f\u4f5c\u548c\u4eba\u5728\u73af\u4e2d\u662f\u6587\u6863\u7684\u6838\u5fc3\u4e3b\u9898\u3002",
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
    assert.match(strFromU8(workbookFiles["xl/worksheets/sheet1.xml"]!), /OpenClaw/u);

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
      '<my-mate-file name="generated-output.xlsx">',
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
      (message) => message.kind === "artifact_card" && message.content?.name === "generated-output.xlsx",
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

test("binary file requests stop at the Artifact Worker boundary instead of accepting an acknowledgement", async () => {
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
    assert.equal(detail.body.session.latest_orchestrator_intent, "artifact_worker_required");
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
    assert.equal(unknownDetail.body.session.latest_orchestrator_intent, "artifact_worker_required");
    assert.equal(unknownDetail.body.session.metadata.requested_artifact_name, "bundle.acmebin");
    assert.equal(unknownDetail.body.session.metadata.requested_artifact_mime_type, "application/octet-stream");
  } finally {
    await server.close();
  }
});
