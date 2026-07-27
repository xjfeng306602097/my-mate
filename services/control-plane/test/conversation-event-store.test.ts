import assert from "node:assert/strict";
import test from "node:test";
import {
  appendConversationEvent,
  listConversationEvents,
} from "../src/conversation-event-store.js";
import { resetTestRoot } from "./helpers.js";

test("Conversation events persist monotonic sequence, cursor replay, and idempotency", () => {
  resetTestRoot();
  const first = appendConversationEvent({
    workspaceId: "default",
    sessionId: "conversation-event-test",
    type: "conversation.started",
    payload: { request_id: "request-1" },
    idempotencyKey: "started:request-1",
  });
  const second = appendConversationEvent({
    workspaceId: "default",
    sessionId: "conversation-event-test",
    type: "conversation.delta",
    payload: { request_id: "request-1", delta: "hello" },
  });
  const duplicate = appendConversationEvent({
    workspaceId: "default",
    sessionId: "conversation-event-test",
    type: "conversation.started",
    payload: { request_id: "request-1", changed: true },
    idempotencyKey: "started:request-1",
  });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(duplicate.event_id, first.event_id);
  assert.deepEqual(listConversationEvents({ workspaceId: "default", sessionId: "conversation-event-test", afterSequence: 1 }).map((event) => event.sequence), [2]);
});
