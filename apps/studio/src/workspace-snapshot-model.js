export function getWorkspaceSnapshotSessionId(snapshot) {
  return snapshot?.session?.session_id || snapshot?.session?.id || "";
}

export function getWorkspaceSnapshotRunId(snapshot) {
  return snapshot?.selected_run_id || snapshot?.latest_run?.run_id || "";
}

export function isSameWorkspaceSession(current, incoming) {
  const currentSessionId = getWorkspaceSnapshotSessionId(current);
  const incomingSessionId = getWorkspaceSnapshotSessionId(incoming);
  return Boolean(currentSessionId && incomingSessionId && currentSessionId === incomingSessionId);
}

export function isSameWorkspaceRun(current, incoming) {
  return isSameWorkspaceSession(current, incoming) &&
    getWorkspaceSnapshotRunId(current) === getWorkspaceSnapshotRunId(incoming);
}

export function shouldAcceptWorkspaceSnapshot(current, incoming) {
  if (!incoming || typeof incoming !== "object") return false;
  if (!current) return true;
  const currentSessionId = getWorkspaceSnapshotSessionId(current);
  const incomingSessionId = getWorkspaceSnapshotSessionId(incoming);
  return !currentSessionId || !incomingSessionId || currentSessionId === incomingSessionId;
}

export function cloneWorkspaceSnapshot(snapshot) {
  if (!snapshot) return snapshot;
  return typeof structuredClone === "function"
    ? structuredClone(snapshot)
    : JSON.parse(JSON.stringify(snapshot));
}
