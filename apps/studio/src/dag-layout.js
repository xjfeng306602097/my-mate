const DEFAULT_OPTIONS = Object.freeze({
  paddingX: 24,
  paddingY: 24,
  columnGap: 72,
  rowGap: 28,
  invalidColumnGap: 108,
  minWidth: 320,
  minHeight: 220,
  barycenterPasses: 2,
});

function finiteNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function stableNodeCompare(left, right) {
  return left.order - right.order || left.id.localeCompare(right.id) || left.inputIndex - right.inputIndex;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sortColumnByBarycenter(column, neighborIds, positions) {
  column.sort((left, right) => {
    const leftCenter = average((neighborIds.get(left.id) || []).map((id) => positions.get(id)).filter(Number.isFinite));
    const rightCenter = average((neighborIds.get(right.id) || []).map((id) => positions.get(id)).filter(Number.isFinite));
    if (leftCenter !== null && rightCenter !== null && leftCenter !== rightCenter) return leftCenter - rightCenter;
    if (leftCenter !== null && rightCenter === null) return -1;
    if (leftCenter === null && rightCenter !== null) return 1;
    return stableNodeCompare(left, right);
  });
}

function buildPositions(columns) {
  const positions = new Map();
  for (const column of columns.values()) {
    column.forEach((node, index) => positions.set(node.id, index));
  }
  return positions;
}

function normalizeNodes(nodes) {
  const seen = new Map();
  return (Array.isArray(nodes) ? nodes : []).map((node, inputIndex) => {
    const requestedId = String(node?.id || "").trim();
    const baseId = requestedId || `invalid-node-${inputIndex + 1}`;
    const duplicateIndex = seen.get(baseId) || 0;
    seen.set(baseId, duplicateIndex + 1);
    const id = duplicateIndex ? `${baseId}#duplicate-${duplicateIndex + 1}` : baseId;
    return {
      id,
      requestedId,
      order: finiteNumber(node?.order, inputIndex, Number.NEGATIVE_INFINITY),
      width: finiteNumber(node?.width, 188, 1),
      height: finiteNumber(node?.height, 98, 1),
      inputIndex,
      invalidReason: !requestedId ? "missing_id" : duplicateIndex ? "duplicate_id" : null,
    };
  });
}

function normalizeEdges(edges, nodeById) {
  const seen = new Map();
  return (Array.isArray(edges) ? edges : []).map((edge, inputIndex) => {
    const requestedId = String(edge?.id || "").trim() || `edge-${inputIndex + 1}`;
    const duplicateIndex = seen.get(requestedId) || 0;
    seen.set(requestedId, duplicateIndex + 1);
    const id = duplicateIndex ? `${requestedId}#duplicate-${duplicateIndex + 1}` : requestedId;
    const from = String(edge?.from || "").trim();
    const to = String(edge?.to || "").trim();
    let reason = "";
    if (!from || !to) reason = "missing_endpoint";
    else if (!nodeById.has(from)) reason = "source_missing";
    else if (!nodeById.has(to)) reason = "target_missing";
    return {
      id,
      requestedId,
      from,
      to,
      inputIndex,
      valid: !reason,
      reason,
    };
  });
}

export function buildDagLayout(nodeInputs, edgeInputs, rawOptions = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...(rawOptions && typeof rawOptions === "object" ? rawOptions : {}),
  };
  options.paddingX = finiteNumber(options.paddingX, DEFAULT_OPTIONS.paddingX);
  options.paddingY = finiteNumber(options.paddingY, DEFAULT_OPTIONS.paddingY);
  options.columnGap = finiteNumber(options.columnGap, DEFAULT_OPTIONS.columnGap);
  options.rowGap = finiteNumber(options.rowGap, DEFAULT_OPTIONS.rowGap);
  options.invalidColumnGap = finiteNumber(options.invalidColumnGap, DEFAULT_OPTIONS.invalidColumnGap);
  options.minWidth = finiteNumber(options.minWidth, DEFAULT_OPTIONS.minWidth, 1);
  options.minHeight = finiteNumber(options.minHeight, DEFAULT_OPTIONS.minHeight, 1);
  options.barycenterPasses = Math.floor(finiteNumber(options.barycenterPasses, DEFAULT_OPTIONS.barycenterPasses));

  const normalizedNodes = normalizeNodes(nodeInputs);
  const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
  const normalizedEdges = normalizeEdges(edgeInputs, nodeById);
  const adjacency = new Map(normalizedNodes.map((node) => [node.id, []]));
  const incoming = new Map(normalizedNodes.map((node) => [node.id, []]));
  const indegree = new Map(normalizedNodes.map((node) => [node.id, 0]));

  for (const edge of normalizedEdges) {
    if (!edge.valid) continue;
    adjacency.get(edge.from).push(edge.to);
    incoming.get(edge.to).push(edge.from);
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  }
  for (const ids of adjacency.values()) ids.sort((a, b) => stableNodeCompare(nodeById.get(a), nodeById.get(b)));
  for (const ids of incoming.values()) ids.sort((a, b) => stableNodeCompare(nodeById.get(a), nodeById.get(b)));

  const remaining = new Map(indegree);
  const depth = new Map(normalizedNodes.map((node) => [node.id, 0]));
  const ready = normalizedNodes
    .filter((node) => !node.invalidReason && remaining.get(node.id) === 0)
    .sort(stableNodeCompare);
  const processed = new Set();
  while (ready.length) {
    const current = ready.shift();
    processed.add(current.id);
    for (const targetId of adjacency.get(current.id) || []) {
      const target = nodeById.get(targetId);
      if (!target || target.invalidReason) continue;
      depth.set(targetId, Math.max(depth.get(targetId) || 0, (depth.get(current.id) || 0) + 1));
      const nextIndegree = (remaining.get(targetId) || 0) - 1;
      remaining.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(target);
        ready.sort(stableNodeCompare);
      }
    }
  }

  const validNodes = normalizedNodes.filter((node) => processed.has(node.id));
  const invalidNodes = normalizedNodes.filter((node) => !processed.has(node.id));
  const maxValidDepth = validNodes.reduce((maximum, node) => Math.max(maximum, depth.get(node.id) || 0), -1);
  const invalidColumn = invalidNodes.length ? maxValidDepth + 1 : null;
  const columns = new Map();
  for (const node of validNodes) {
    const columnIndex = depth.get(node.id) || 0;
    columns.set(columnIndex, [...(columns.get(columnIndex) || []), node]);
  }
  if (invalidColumn !== null) columns.set(invalidColumn, [...invalidNodes]);
  for (const column of columns.values()) column.sort(stableNodeCompare);

  for (let pass = 0; pass < options.barycenterPasses; pass += 1) {
    let positions = buildPositions(columns);
    for (let columnIndex = 1; columnIndex <= maxValidDepth; columnIndex += 1) {
      const column = columns.get(columnIndex);
      if (column) sortColumnByBarycenter(column, incoming, positions);
      positions = buildPositions(columns);
    }
    for (let columnIndex = maxValidDepth - 1; columnIndex >= 0; columnIndex -= 1) {
      const column = columns.get(columnIndex);
      if (column) sortColumnByBarycenter(column, adjacency, positions);
      positions = buildPositions(columns);
    }
  }

  const orderedColumnIndexes = [...columns.keys()].sort((left, right) => left - right);
  const columnX = new Map();
  let nextX = options.paddingX;
  for (const columnIndex of orderedColumnIndexes) {
    if (invalidColumn !== null && columnIndex === invalidColumn && columnIndex > 0) {
      nextX += Math.max(0, options.invalidColumnGap - options.columnGap);
    }
    columnX.set(columnIndex, nextX);
    const maxWidth = Math.max(...columns.get(columnIndex).map((node) => node.width), 0);
    nextX += maxWidth + options.columnGap;
  }

  const positionedNodes = [];
  for (const columnIndex of orderedColumnIndexes) {
    let nextY = options.paddingY;
    columns.get(columnIndex).forEach((node, row) => {
      positionedNodes.push({
        id: node.id,
        order: node.order,
        inputIndex: node.inputIndex,
        width: node.width,
        height: node.height,
        column: columnIndex,
        row,
        depth: invalidColumn === columnIndex ? null : columnIndex,
        x: columnX.get(columnIndex),
        y: nextY,
        invalid: invalidColumn === columnIndex,
        invalidReason: node.invalidReason || (invalidColumn === columnIndex ? "cycle" : null),
      });
      nextY += node.height + options.rowGap;
    });
  }
  positionedNodes.sort((left, right) => left.inputIndex - right.inputIndex);
  const positionedById = new Map(positionedNodes.map((node) => [node.id, node]));
  const positionedEdges = normalizedEdges.map((edge) => {
    const fromNode = positionedById.get(edge.from) || null;
    const toNode = positionedById.get(edge.to) || null;
    const valid = edge.valid && !!fromNode && !!toNode;
    const forward = valid ? toNode.x >= fromNode.x : true;
    return {
      ...edge,
      valid,
      reason: valid ? "" : edge.reason || "node_not_positioned",
      fromX: fromNode ? (forward ? fromNode.x + fromNode.width : fromNode.x) : 0,
      fromY: fromNode ? fromNode.y + fromNode.height / 2 : 0,
      toX: toNode ? (forward ? toNode.x : toNode.x + toNode.width) : 0,
      toY: toNode ? toNode.y + toNode.height / 2 : 0,
    };
  });

  const contentMaxX = positionedNodes.reduce((maximum, node) => Math.max(maximum, node.x + node.width), 0);
  const contentMaxY = positionedNodes.reduce((maximum, node) => Math.max(maximum, node.y + node.height), 0);
  const width = Math.max(options.minWidth, contentMaxX + options.paddingX);
  const height = Math.max(options.minHeight, contentMaxY + options.paddingY);
  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    columns: orderedColumnIndexes.map((columnIndex) => ({
      index: columnIndex,
      invalid: invalidColumn === columnIndex,
      nodeIds: columns.get(columnIndex).map((node) => node.id),
      x: columnX.get(columnIndex),
    })),
    invalidNodeIds: invalidNodes.map((node) => node.id),
    bounds: {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
      width,
      height,
      contentWidth: contentMaxX,
      contentHeight: contentMaxY,
    },
    width,
    height,
  };
}

export function findDagLayoutOverlaps(layout) {
  const nodes = Array.isArray(layout?.nodes) ? layout.nodes : [];
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      const separated =
        left.x + left.width <= right.x ||
        right.x + right.width <= left.x ||
        left.y + left.height <= right.y ||
        right.y + right.height <= left.y;
      if (!separated) overlaps.push([left.id, right.id]);
    }
  }
  return overlaps;
}
