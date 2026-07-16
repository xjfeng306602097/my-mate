import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createSessionMessage, listSessionMessages } from "../src/session-message-store.js";
import { createSession } from "../src/session-store.js";
import {
  beginTaskCheckpoint,
  getLatestTaskCheckpoint,
  markInterruptedCheckpointsForRecovery,
  transitionTaskCheckpoint,
} from "../src/task-checkpoint-store.js";
import { getJson, postJson, resetTestRoot, startTestServer } from "./helpers.js";

test("Task checkpoints enforce bounded mode-aware resume transitions", () => {
  resetTestRoot();
  const assisted = createSession({
    initial_message: "Continue a long task",
    autonomy_mode: "assisted",
    created_by: "checkpoint-user",
  });
  const assistedUser = createSessionMessage({
    session_id: assisted.session_id,
    role: "user",
    kind: "text",
    content: { text: "Continue a long task" },
  });
  const started = beginTaskCheckpoint({ session: assisted, sourceUserMessageId: assistedUser.message_id });
  assert.equal(started.status, "in_progress");
  assert.equal(started.auto_resume_eligible, false);
  const interrupted = transitionTaskCheckpoint(started, {
    status: "resumable",
    reason: "provider_interrupted",
    progressSummary: "Completed the first section.",
    nextAction: "Continue with the second section.",
  });
  assert.throws(
    () => beginTaskCheckpoint({
      session: assisted,
      sourceUserMessageId: assistedUser.message_id,
      resumeFrom: interrupted,
      automaticResume: true,
    }),
    /TASK_CHECKPOINT_AUTO_RESUME_FORBIDDEN/u,
  );
  const manuallyResumed = beginTaskCheckpoint({
    session: assisted,
    sourceUserMessageId: assistedUser.message_id,
    resumeFrom: interrupted,
  });
  assert.equal(manuallyResumed.reason, "manual_resume");
  assert.equal(manuallyResumed.resume_attempts, 1);

  const autopilot = createSession({
    initial_message: "Run autonomously",
    autonomy_mode: "autopilot",
    created_by: "checkpoint-user",
  });
  const autopilotUser = createSessionMessage({
    session_id: autopilot.session_id,
    role: "user",
    kind: "text",
    content: { text: "Run autonomously" },
  });
  beginTaskCheckpoint({ session: autopilot, sourceUserMessageId: autopilotUser.message_id });
  const recovered = markInterruptedCheckpointsForRecovery();
  const recoveredAutopilot = recovered.find((checkpoint) => checkpoint.session_id === autopilot.session_id);
  assert.equal(recoveredAutopilot?.status, "resumable");
  assert.equal(recoveredAutopilot?.reason, "server_restart");
  assert.equal(recoveredAutopilot?.auto_resume_eligible, true);
});

test("Autopilot continues across a persisted continuation checkpoint while Assisted defers", async () => {
  resetTestRoot();
  const calls = new Map<string, number>();
  const providerFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (Number(body.max_tokens) === 1) {
      return new Response(JSON.stringify({
        model: "checkpoint-model",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const serializedMessages = JSON.stringify(body.messages || []);
    const key = serializedMessages.includes("exhaust checkpoint task")
      ? "exhaust"
      : serializedMessages.includes("assisted checkpoint task")
        ? "assisted"
        : "autopilot";
    const call = (calls.get(key) || 0) + 1;
    calls.set(key, call);
    const text = key === "exhaust" ? `Segment ${call}. ` : call === 1 ? "Phase one. " : "Phase two complete.";
    const reason = key === "exhaust" || call === 1 ? "max_tokens" : "end_turn";
    return new Response([
      `data: ${JSON.stringify({ type: "message_start", message: { model: "checkpoint-model", usage: { input_tokens: 4 } } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 3 } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const app = createApp({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  const server = await startTestServer({
    doctor: { fetchImpl: providerFetch },
    conversation: { fetchImpl: providerFetch },
  });
  try {
    await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "checkpoint-provider",
      name: "Checkpoint Provider",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://checkpoint.example",
      models: ["checkpoint-model"],
      default_model: "checkpoint-model",
      max_continuation_rounds: 0,
      credential_source: "managed",
      api_key: "checkpoint-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/checkpoint-provider/test`, {});

    let assistedSessionId = "";
    let assistedCheckpointId = "";
    for (const mode of ["autopilot", "assisted"] as const) {
      const session = createSession({
        initial_message: `${mode} checkpoint task`,
        autonomy_mode: mode,
        provider_connection_id: "checkpoint-provider",
        model: "checkpoint-model",
      });
      const user = createSessionMessage({
        session_id: session.session_id,
        role: "user",
        kind: "text",
        content: { text: `${mode} checkpoint task` },
      });
      const deltas: string[] = [];
      await app.locals.streamConversationTurn({
        sessionId: session.session_id,
        resumeLatestUser: true,
        onDelta: (delta: string) => { deltas.push(delta); },
      });
      const checkpoint = getLatestTaskCheckpoint(session.session_id);
      assert.ok(checkpoint);
      if (mode === "autopilot") {
        assert.equal(checkpoint.status, "completed");
        assert.equal(checkpoint.resume_attempts, 1);
        assert.ok(checkpoint.transitions.some((transition) => transition.reason === "continuation_limit"));
        assert.ok(checkpoint.transitions.some((transition) => transition.reason === "automatic_resume"));
        assert.equal(deltas.join(""), "Phase one. Phase two complete.");
      } else {
        assert.equal(checkpoint.status, "resumable");
        assert.equal(checkpoint.resume_attempts, 0);
        assert.equal(deltas.join(""), "Phase one. ");
        assistedSessionId = session.session_id;
        assistedCheckpointId = checkpoint.checkpoint_id;
      }
      assert.equal(checkpoint.source_user_message_id, user.message_id);
      assert.ok(listSessionMessages(session.session_id).some(
        (message) => message.role === "orchestrator" && message.kind === "text",
      ));
    }

    const checkpointList = await getJson(
      `${server.baseUrl}/api/sessions/${assistedSessionId}/checkpoints`,
    );
    const checkpointLatest = await getJson(
      `${server.baseUrl}/api/sessions/${assistedSessionId}/checkpoints/latest`,
    );
    assert.equal(checkpointList.status, 200);
    assert.equal(checkpointLatest.body.checkpoint_id, assistedCheckpointId);
    const manualResume = await postJson(
      `${server.baseUrl}/api/sessions/${assistedSessionId}/checkpoints/${assistedCheckpointId}/resume`,
      {},
    );
    assert.equal(manualResume.status, 200);
    assert.equal(manualResume.body.checkpoint.status, "completed");
    assert.equal(manualResume.body.checkpoint.reason, "turn_completed");
    assert.equal(manualResume.body.checkpoint.resume_attempts, 1);

    const interruptedSession = createSession({
      initial_message: "autopilot recovery checkpoint task",
      autonomy_mode: "autopilot",
      provider_connection_id: "checkpoint-provider",
      model: "checkpoint-model",
    });
    const interruptedUser = createSessionMessage({
      session_id: interruptedSession.session_id,
      role: "user",
      kind: "text",
      content: { text: "autopilot recovery checkpoint task" },
    });
    beginTaskCheckpoint({
      session: interruptedSession,
      sourceUserMessageId: interruptedUser.message_id,
    });
    const recovery = await app.locals.recoverConversationCheckpoints();
    assert.equal(recovery.recovered, 1);
    assert.equal(recovery.results[0]?.status, "resumed");
    assert.equal(getLatestTaskCheckpoint(interruptedSession.session_id)?.status, "completed");

    const exhaustedSession = createSession({
      initial_message: "autopilot exhaust checkpoint task",
      autonomy_mode: "autopilot",
      provider_connection_id: "checkpoint-provider",
      model: "checkpoint-model",
    });
    createSessionMessage({
      session_id: exhaustedSession.session_id,
      role: "user",
      kind: "text",
      content: { text: "autopilot exhaust checkpoint task" },
    });
    await app.locals.streamConversationTurn({
      sessionId: exhaustedSession.session_id,
      resumeLatestUser: true,
      onDelta: () => {},
    });
    const exhausted = getLatestTaskCheckpoint(exhaustedSession.session_id);
    assert.equal(calls.get("exhaust"), 4);
    assert.equal(exhausted?.status, "failed");
    assert.equal(exhausted?.reason, "resume_limit");
    assert.equal(exhausted?.resume_attempts, 3);
  } finally {
    await server.close();
  }
});
