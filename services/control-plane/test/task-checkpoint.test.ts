import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createSessionMessage, listSessionMessages } from "../src/session-message-store.js";
import { archiveSession, createSession, getSession, saveSession } from "../src/session-store.js";
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
  assert.equal(started.auto_resume_eligible, true);
  const interrupted = transitionTaskCheckpoint(started, {
    status: "resumable",
    reason: "provider_interrupted",
    progressSummary: "Completed the first section.",
    nextAction: "Continue with the second section.",
  });
  const automaticallyResumed = beginTaskCheckpoint({
    session: assisted,
    sourceUserMessageId: assistedUser.message_id,
    resumeFrom: interrupted,
    automaticResume: true,
  });
  assert.equal(automaticallyResumed.reason, "automatic_resume");
  assert.equal(automaticallyResumed.resume_attempts, 1);

  const reviewFirst = createSession({
    initial_message: "Wait for review",
    autonomy_mode: "review_first",
    created_by: "checkpoint-user",
  });
  const reviewUser = createSessionMessage({
    session_id: reviewFirst.session_id,
    role: "user",
    kind: "text",
    content: { text: "Wait for review" },
  });
  const reviewStarted = beginTaskCheckpoint({ session: reviewFirst, sourceUserMessageId: reviewUser.message_id });
  assert.equal(reviewStarted.auto_resume_eligible, false);

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

test("Autopilot and Assisted continue across safe checkpoints while Review First defers", async () => {
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
      : serializedMessages.includes("budget checkpoint task")
        ? "budget"
      : serializedMessages.includes("transient auth checkpoint task")
        ? "transient_auth"
      : serializedMessages.includes("review_first checkpoint task")
        ? "review_first"
      : serializedMessages.includes("assisted checkpoint task")
        ? "assisted"
        : "autopilot";
    const call = (calls.get(key) || 0) + 1;
    calls.set(key, call);
    if (key === "transient_auth") {
      if (call === 1) {
        return new Response([
          `data: ${JSON.stringify({ type: "message_start", message: { model: "checkpoint-model", usage: { input_tokens: 4 } } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "transient_auth_clock", name: "system_clock_read", input: {} } })}\n\n`,
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } })}\n\n`,
          `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
        ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (call === 2) {
        return new Response(JSON.stringify({ error: "temporary upstream authorization failure" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response([
        `data: ${JSON.stringify({ type: "message_start", message: { model: "checkpoint-model", usage: { input_tokens: 4 } } })}\n\n`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Recovered after the transient provider authorization failure." } })}\n\n`,
        `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } })}\n\n`,
        `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const text = key === "exhaust" || key === "budget" ? `Segment ${call}. ` : call === 1 ? "Phase one. " : "Phase two complete.";
    const reason = key === "exhaust" || key === "budget" || call === 1 ? "max_tokens" : "end_turn";
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
      max_tool_rounds: 32,
      credential_source: "managed",
      api_key: "checkpoint-secret",
      status: "active",
      metadata: {},
    });
    await postJson(`${server.baseUrl}/api/registry/provider-connections/checkpoint-provider/test`, {});

    let reviewSessionId = "";
    let reviewCheckpointId = "";
    for (const mode of ["autopilot", "assisted", "review_first"] as const) {
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
      if (mode !== "review_first") {
        assert.equal(checkpoint.status, "completed");
        assert.equal(checkpoint.resume_attempts, 1);
        assert.ok(checkpoint.transitions.some((transition) => transition.reason === "continuation_limit"));
        assert.ok(checkpoint.transitions.some((transition) => transition.reason === "automatic_resume"));
        assert.equal(deltas.join(""), "Phase one. Phase two complete.");
      } else {
        assert.equal(checkpoint.status, "resumable");
        assert.equal(checkpoint.resume_attempts, 0);
        assert.equal(deltas.join(""), "Phase one. ");
        reviewSessionId = session.session_id;
        reviewCheckpointId = checkpoint.checkpoint_id;
      }
      assert.equal(checkpoint.source_user_message_id, user.message_id);
      assert.equal(checkpoint.long_task_runtime.schema_version, 1);
      assert.ok(checkpoint.long_task_runtime.turn_attempts >= 1);
      assert.ok(checkpoint.long_task_runtime.cumulative_total_tokens >= 0);
      assert.ok(listSessionMessages(session.session_id).some(
        (message) => message.role === "orchestrator" && message.kind === "text",
      ));
    }

    const checkpointList = await getJson(
      `${server.baseUrl}/api/sessions/${reviewSessionId}/checkpoints`,
    );
    const checkpointLatest = await getJson(
      `${server.baseUrl}/api/sessions/${reviewSessionId}/checkpoints/latest`,
    );
    assert.equal(checkpointList.status, 200);
    assert.equal(checkpointLatest.body.checkpoint_id, reviewCheckpointId);
    const manualResume = await postJson(
      `${server.baseUrl}/api/sessions/${reviewSessionId}/checkpoints/${reviewCheckpointId}/resume`,
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
    const archivedSession = createSession({
      initial_message: "archived recovery checkpoint task",
      autonomy_mode: "autopilot",
      provider_connection_id: "checkpoint-provider",
      model: "checkpoint-model",
    });
    const archivedUser = createSessionMessage({
      session_id: archivedSession.session_id,
      role: "user",
      kind: "text",
      content: { text: "archived recovery checkpoint task" },
    });
    const archivedCheckpoint = beginTaskCheckpoint({
      session: archivedSession,
      sourceUserMessageId: archivedUser.message_id,
    });
    archiveSession(archivedSession.session_id, "checkpoint-test", "Do not resume archived work.");
    const recovery = await app.locals.recoverConversationCheckpoints();
    assert.equal(recovery.recovered, 2);
    assert.equal(recovery.results.find((item: { checkpoint_id: string; status: string }) => item.checkpoint_id === archivedCheckpoint.checkpoint_id)?.status, "deferred");
    assert.equal(recovery.results.find((item: { checkpoint_id: string; status: string }) => item.checkpoint_id !== archivedCheckpoint.checkpoint_id)?.status, "resumed");
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
    assert.equal(calls.get("exhaust"), 9);
    assert.equal(exhausted?.status, "failed");
    assert.equal(exhausted?.reason, "resume_limit");
    assert.equal(exhausted?.resume_attempts, 8);

    const budgetSession = createSession({
      initial_message: "assisted budget checkpoint task",
      autonomy_mode: "assisted",
      provider_connection_id: "checkpoint-provider",
      model: "checkpoint-model",
    });
    budgetSession.metadata = {
      ...budgetSession.metadata,
      long_task_budget: {
        max_turn_attempts: 2,
        max_total_tokens: 16_384,
        max_wall_time_ms: 60_000,
      },
    };
    saveSession(budgetSession);
    createSessionMessage({
      session_id: budgetSession.session_id,
      role: "user",
      kind: "text",
      content: { text: "assisted budget checkpoint task" },
    });
    await app.locals.streamConversationTurn({
      sessionId: budgetSession.session_id,
      resumeLatestUser: true,
      onDelta: () => {},
    });
    const budgetCheckpoint = getLatestTaskCheckpoint(budgetSession.session_id);
    assert.equal(calls.get("budget"), 2);
    assert.equal(budgetCheckpoint?.status, "waiting_human");
    assert.equal(budgetCheckpoint?.reason, "budget_limit");
    assert.equal(budgetCheckpoint?.long_task_runtime.exhausted, true);
    assert.equal(budgetCheckpoint?.long_task_runtime.exhausted_reason, "turn_attempts");
    assert.equal(budgetCheckpoint?.long_task_runtime.turn_attempts, 2);

    const transientAuthSession = createSession({
      initial_message: "assisted transient auth checkpoint task",
      autonomy_mode: "assisted",
      provider_connection_id: "checkpoint-provider",
      model: "checkpoint-model",
    });
    createSessionMessage({
      session_id: transientAuthSession.session_id,
      role: "user",
      kind: "text",
      content: { text: "assisted transient auth checkpoint task" },
    });
    const transientAuthDeltas: string[] = [];
    await app.locals.streamConversationTurn({
      sessionId: transientAuthSession.session_id,
      resumeLatestUser: true,
      onDelta: (delta: string) => { transientAuthDeltas.push(delta); },
    });
    const transientAuthCheckpoint = getLatestTaskCheckpoint(transientAuthSession.session_id);
    assert.equal(calls.get("transient_auth"), 3);
    assert.equal(transientAuthCheckpoint?.status, "completed");
    assert.equal(transientAuthCheckpoint?.resume_attempts, 1);
    assert.ok(transientAuthCheckpoint?.transitions.some((transition) => transition.reason === "provider_interrupted"));
    assert.ok(transientAuthCheckpoint?.transitions.some((transition) => transition.reason === "automatic_resume"));
    assert.match(transientAuthDeltas.join(""), /Automatically resuming from the persistent checkpoint/u);
    assert.match(transientAuthDeltas.join(""), /Recovered after the transient provider authorization failure/u);
    const recoveredSession = getSession(transientAuthSession.session_id);
    assert.equal(
      (recoveredSession?.metadata.conversation_loop_context_snapshot as Record<string, unknown> | undefined)?.reason,
      "provider_interrupted_with_tool_evidence",
    );
    assert.match(String(transientAuthCheckpoint?.context_summary || ""), /system_clock_read/u);
  } finally {
    await server.close();
  }
});
