function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function createGraphHistory(snapshot, limit = 50) {
  return { present: clone(snapshot), undo: [], redo: [], limit };
}

export function commitGraphHistory(history, snapshot) {
  const serialized = JSON.stringify(snapshot);
  if (serialized === JSON.stringify(history.present)) return history;
  return {
    ...history,
    present: clone(snapshot),
    undo: [...history.undo, clone(history.present)].slice(-history.limit),
    redo: [],
  };
}

export function undoGraphHistory(history) {
  if (!history.undo.length) return history;
  return {
    ...history,
    present: clone(history.undo.at(-1)),
    undo: history.undo.slice(0, -1),
    redo: [clone(history.present), ...history.redo].slice(0, history.limit),
  };
}

export function redoGraphHistory(history) {
  if (!history.redo.length) return history;
  return {
    ...history,
    present: clone(history.redo[0]),
    undo: [...history.undo, clone(history.present)].slice(-history.limit),
    redo: history.redo.slice(1),
  };
}

function edgeKey(edge) {
  return `${edge.from || ""}:${edge.from_port || ""}->${edge.to || ""}:${edge.to_port || ""}`;
}

export function validateGraphTopology(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const errors = [];
  const warnings = [];
  const idCounts = new Map();
  for (const node of nodes) {
    const id = String(node?.id || "").trim();
    if (!id) errors.push({ code: "node_id_missing", message: "A node is missing its ID." });
    else idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) errors.push({ code: "node_id_duplicate", message: `Node ID ${id} is duplicated.` });
  }
  const ids = new Set([...idCounts.keys()]);
  const seenEdges = new Set();
  for (const [index, edge] of edges.entries()) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      errors.push({ code: "edge_endpoint_missing", edgeIndex: index, message: `Edge ${index + 1} has a missing endpoint.` });
    }
    if (edge.from && edge.from === edge.to) {
      errors.push({ code: "edge_self_cycle", edgeIndex: index, message: `Edge ${index + 1} connects a node to itself.` });
    }
    const key = edgeKey(edge);
    if (seenEdges.has(key)) errors.push({ code: "edge_duplicate", edgeIndex: index, message: `Edge ${index + 1} is duplicated.` });
    seenEdges.add(key);
    if (edge.condition !== null && edge.condition !== undefined && (typeof edge.condition !== "object" || Array.isArray(edge.condition))) {
      errors.push({ code: "edge_condition_invalid", edgeIndex: index, message: `Edge ${index + 1} condition must be a JSON object.` });
    }
  }

  const adjacency = new Map([...ids].map((id) => [id, []]));
  const inbound = new Map([...ids].map((id) => [id, 0]));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
    adjacency.get(edge.from).push(edge.to);
    inbound.set(edge.to, (inbound.get(edge.to) || 0) + 1);
  }
  const queue = [...ids].filter((id) => inbound.get(id) === 0);
  const reachable = new Set(queue);
  const indegree = new Map(inbound);
  while (queue.length) {
    const id = queue.shift();
    for (const target of adjacency.get(id) || []) {
      reachable.add(target);
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (nodes.length && [...indegree.values()].some((value) => value > 0)) {
    errors.push({ code: "graph_cycle", message: "The graph contains a cycle." });
  }
  for (const id of ids) {
    if (!reachable.has(id)) warnings.push({ code: "node_unreachable", message: `Node ${id} is unreachable from a start node.` });
    if ((adjacency.get(id) || []).length === 0 && nodes.length > 1) {
      warnings.push({ code: "node_exit", message: `Node ${id} is an exit.` });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function buildGraphPatchPreview(saved, working) {
  const beforeNodes = new Map((saved.nodes || []).map((node) => [node.id, node]));
  const afterNodes = new Map((working.nodes || []).map((node) => [node.id, node]));
  const beforeEdges = new Map((saved.edges || []).map((edge) => [edgeKey(edge), edge]));
  const afterEdges = new Map((working.edges || []).map((edge) => [edgeKey(edge), edge]));
  return {
    nodes_added: [...afterNodes.keys()].filter((id) => !beforeNodes.has(id)),
    nodes_removed: [...beforeNodes.keys()].filter((id) => !afterNodes.has(id)),
    nodes_changed: [...afterNodes.keys()].filter(
      (id) => beforeNodes.has(id) && JSON.stringify(beforeNodes.get(id)) !== JSON.stringify(afterNodes.get(id)),
    ),
    edges_added: [...afterEdges.keys()].filter((key) => !beforeEdges.has(key)),
    edges_removed: [...beforeEdges.keys()].filter((key) => !afterEdges.has(key)),
    layout_changed: saved.metadataText !== working.metadataText,
  };
}
