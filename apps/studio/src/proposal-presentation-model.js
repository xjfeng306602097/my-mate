const AGENT_NODE_KINDS = new Set(["agent_task", "reviewer"]);

const KIND_LABELS = {
  agent_task: "Agent step",
  reviewer: "Review step",
  human_gate: "Approval gate",
  approval: "Approval gate",
  human_input: "User input",
  condition: "Decision",
  fanout: "Parallel / loop",
  combine: "Merge results",
  reducer: "Merge results",
  tool_task: "System tool",
  end: "Finish",
};

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function contractItems(contractValue) {
  const contract = parseRecord(contractValue);
  const artifacts = stringList(contract.expected_artifacts);
  if (artifacts.length) return artifacts;
  const required = stringList(contract.required);
  if (required.length) return required;
  const properties = Object.keys(record(contract.properties));
  if (properties.length) return properties;
  return [];
}

export function proposalNodeNeedsAgent(kind) {
  return AGENT_NODE_KINDS.has(String(kind || "agent_task"));
}

export function proposalNodeKindLabel(kind) {
  const normalized = String(kind || "agent_task");
  return KIND_LABELS[normalized] || normalized.replaceAll("_", " ");
}

export function proposalStepObjective(node = {}, configValue = {}) {
  const config = record(configValue);
  const candidates = [node.objective, config.objective, config.instruction, config.instructions, config.prompt, node.description];
  return candidates.find((item) => typeof item === "string" && item.trim())?.trim() ||
    "Complete this step using the Mission context and results from previous steps.";
}

export function proposalStepContractSummary(inputContract, outputContract) {
  const receives = contractItems(inputContract);
  const delivers = contractItems(outputContract);
  return {
    receives: receives.length ? receives : ["Mission context and upstream results"],
    delivers: delivers.length ? delivers : ["A structured result for the next step"],
  };
}

export function proposalStatusLabel(status) {
  return {
    draft: "Draft",
    review_ready: "Ready for approval",
    confirmed: "Approved",
    rejected: "Rejected",
    superseded: "Replaced",
  }[status] || "Preparing";
}
