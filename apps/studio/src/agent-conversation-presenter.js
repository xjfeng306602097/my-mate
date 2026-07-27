const INTERNAL_CONTEXT_MARKERS = [
  "Mission inputs (authoritative user-supplied workflow inputs):",
  "DAG state input:",
  "Direct dependency results (durable Control Plane records):",
  "Return a JSON object matching this output contract:",
  "Acceptance criteria:",
  "Verification steps:",
  "Reviewer feedback from the previous attempt:",
  "Upstream execution evidence (durable Control Plane records, not model claims):",
];

const HIDDEN_RESULT_FIELDS = new Set([
  "agent_run_id",
  "agent_binding_snapshot",
  "dag_id",
  "dag_state",
  "dependency_results",
  "evidence_snapshot_revision",
  "expected_artifacts",
  "input_contract",
  "mission_inputs",
  "node_id",
  "output_contract",
  "result_id",
  "session_id",
  "state_revision",
  "task_id",
]);

function messageText(message) {
  const content = message?.content && typeof message.content === "object" ? message.content : {};
  for (const key of ["text", "narrative_reply", "summary", "message"]) {
    if (typeof content[key] === "string" && content[key].trim()) return content[key].trim();
  }
  return "";
}

export function stripAgentProtocolContext(text) {
  const value = String(text || "").trim();
  let end = value.length;
  for (const marker of INTERNAL_CONTEXT_MARKERS) {
    const index = value.indexOf(`\n\n${marker}`);
    if (index >= 0) end = Math.min(end, index);
  }
  return value.slice(0, end).trim();
}

export function isAgentProtocolPrompt(text) {
  const value = String(text || "");
  return INTERNAL_CONTEXT_MARKERS.some((marker) => value.includes(marker));
}

export function parseAgentStructuredResult(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const candidate = fenced ? fenced[1].trim() : source;
  try {
    const value = JSON.parse(candidate);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function agentFieldLabel(key) {
  const value = String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "Result";
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function visibleAgentResultEntries(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(([key, item]) => {
    if (HIDDEN_RESULT_FIELDS.has(key)) return false;
    if (Array.isArray(item)) {
      return !item.length || item.some((entry) =>
        !entry || typeof entry !== "object" || Array.isArray(entry) || visibleAgentResultEntries(entry, depth + 1).length,
      );
    }
    if (item && typeof item === "object") {
      return visibleAgentResultEntries(item, depth + 1).length > 0;
    }
    return true;
  });
}

export function buildAgentEventConversation(events = []) {
  const orderedEvents = Array.isArray(events)
    ? [...events].sort((left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0))
    : [];
  const completedTexts = orderedEvents
    .filter((event) => event?.type === "agent.message.completed" && typeof event.payload?.text === "string")
    .map((event) => event.payload.text.trim())
    .filter(Boolean);
  const conversation = [];
  let current = null;
  const flush = () => {
    if (current?.text?.trim()) {
      let text = current.text.trim();
      for (const completedText of completedTexts) {
        if (text.length <= completedText.length || text.length % completedText.length !== 0) continue;
        const copies = text.length / completedText.length;
        if (completedText.repeat(copies) === text) {
          text = completedText;
          break;
        }
      }
      conversation.push({ ...current, text });
    }
    current = null;
  };

  for (const event of orderedEvents) {
    if (event?.type === "agent.message.delta" && typeof event.payload?.text === "string") {
      if (!current) {
        current = {
          role: "agent",
          source: "event",
          text: "",
          created_at: event.created_at || null,
          sequence: Number(event.sequence || 0),
        };
      }
      current.text += event.payload.text;
      continue;
    }
    flush();
    if (event?.type === "agent.progress" && typeof event.summary === "string" && event.summary.trim()) {
      conversation.push({
        role: "agent",
        source: "progress",
        text: event.summary.trim(),
        created_at: event.created_at || null,
        sequence: Number(event.sequence || 0),
      });
    }
  }
  flush();
  return conversation;
}

export function buildSubAgentConversationPresentation(input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const textMessages = messages.filter((message) =>
    (message?.role === "user" || message?.role === "orchestrator") && message?.kind === "text",
  );
  const assignmentMessage = textMessages.find(
    (message) => message.role === "user" && isAgentProtocolPrompt(messageText(message)),
  );
  const assignment = String(input.objective || "").trim() ||
    (assignmentMessage ? stripAgentProtocolContext(messageText(assignmentMessage)) : "");
  const agentReplies = textMessages.filter((message) => message.role === "orchestrator" && messageText(message));
  const latestReply = agentReplies.at(-1) || null;
  const latestReplyText = latestReply ? messageText(latestReply) : "";
  const suppliedSummary = String(input.latestSummary || "").trim();
  const resultText = suppliedSummary || latestReplyText;
  const suppliedResult = input.latestResult && typeof input.latestResult === "object" && !Array.isArray(input.latestResult)
    ? input.latestResult
    : null;
  const structuredResult = suppliedResult || parseAgentStructuredResult(resultText);

  const messageConversation = textMessages.flatMap((message) => {
    const text = messageText(message);
    if (!text) return [];
    if (message === assignmentMessage) return [];
    if (message.role === "user" && isAgentProtocolPrompt(text)) return [];
    if (message.role === "orchestrator") {
      if (message === latestReply || text === resultText || parseAgentStructuredResult(text)) return [];
    }
    return [{ role: message.role === "user" ? "user" : "agent", text, message }];
  });
  const eventConversation = buildAgentEventConversation(input.events);
  const seenAgentText = new Set(messageConversation
    .filter((entry) => entry.role === "agent")
    .map((entry) => entry.text));
  const conversation = [
    ...messageConversation,
    ...eventConversation.filter((entry) => !seenAgentText.has(entry.text)),
  ];

  return {
    assignment,
    conversation,
    result: resultText || structuredResult ? {
      text: resultText,
      structured: structuredResult,
      message: latestReply,
    } : null,
  };
}
