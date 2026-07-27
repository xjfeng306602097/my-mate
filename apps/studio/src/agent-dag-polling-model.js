const ACTIVE_DAG_STATUSES = new Set(["running", "waiting_human"]);
const SETTLED_AGGREGATION_STATUSES = new Set(["completed", "failed"]);

export function mergeAgentDagSummary(items, dag) {
  const summaries = Array.isArray(items) ? items : [];
  if (!dag?.dag_id) return summaries;
  const index = summaries.findIndex((item) => item?.dag_id === dag.dag_id);
  if (index < 0) return [dag, ...summaries];
  const next = [...summaries];
  next[index] = { ...summaries[index], ...dag };
  return next;
}

export function agentDagPollingDecision(detail) {
  const dagStatus = String(detail?.dag?.status || "");
  const aggregationStatus = String(detail?.aggregation?.status || "not_started");

  if (ACTIVE_DAG_STATUSES.has(dagStatus)) {
    return {
      shouldPoll: true,
      delayMs: dagStatus === "waiting_human" ? 2_000 : 1_000,
      reason: dagStatus,
    };
  }

  if (dagStatus === "completed" && !SETTLED_AGGREGATION_STATUSES.has(aggregationStatus)) {
    return {
      shouldPoll: true,
      delayMs: 1_000,
      reason: `aggregation_${aggregationStatus}`,
    };
  }

  return {
    shouldPoll: false,
    delayMs: 0,
    reason: SETTLED_AGGREGATION_STATUSES.has(aggregationStatus)
      ? `aggregation_${aggregationStatus}`
      : dagStatus || "missing_dag",
  };
}
