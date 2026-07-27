function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

export function connectionModels(connection) {
  if (!connection) return [];
  return uniqueStrings([connection.default_model, ...(connection.models || [])]);
}

export function isUsableAgentConnection(connection) {
  return connection?.status === "active" && connection?.verification?.status === "verified";
}

export function agentConnectionOptions(connections, currentConnectionId = "") {
  return (connections || []).filter((connection) =>
    isUsableAgentConnection(connection) || connection.connection_id === currentConnectionId
  );
}

export function preferredAgentBinding(connections, currentConnectionId = "", currentModel = "") {
  const usable = (connections || []).filter(isUsableAgentConnection);
  const connection = usable.find((item) => item.connection_id === currentConnectionId) || usable[0] || null;
  if (!connection) return { connectionId: "", model: "" };
  const models = connectionModels(connection);
  const model = models.includes(currentModel) ? currentModel : models[0] || "";
  return { connectionId: connection.connection_id, model };
}

export function modelOptionsForConnection(connections, connectionId, currentModel = "") {
  const connection = (connections || []).find((item) => item.connection_id === connectionId) || null;
  const models = connectionModels(connection);
  return {
    connection,
    models,
    unavailableModel: currentModel && !models.includes(currentModel) ? currentModel : "",
  };
}

export function validateAgentModelBinding(draft, connections) {
  if (!draft.connectionId && !draft.model) return [];
  if (!draft.connectionId) return ["Select a verified Provider Connection for the selected model."];
  const connection = (connections || []).find((item) => item.connection_id === draft.connectionId) || null;
  if (!connection) return ["The selected Provider Connection no longer exists."];
  if (connection.status !== "active") return ["The selected Provider Connection is disabled."];
  if (connection.verification?.status !== "verified") return ["Verify the selected Provider Connection before publishing this Agent."];
  if (!draft.model) return ["Select a model for this Agent."];
  if (!connectionModels(connection).includes(draft.model)) {
    return [`Model ${draft.model} is not available from ${connection.name || connection.connection_id}.`];
  }
  return [];
}
