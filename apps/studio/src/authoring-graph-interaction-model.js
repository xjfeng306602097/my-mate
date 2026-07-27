export function authoringSelectionIncludesNode(selection, index) {
  return (selection?.type === "node" && selection.index === index) ||
    (selection?.type === "nodes" && selection.indexes?.includes(index));
}

export function authoringConnectionPath(input) {
  const fromX = Number(input.fromX) || 0;
  const fromY = Number(input.fromY) || 0;
  const toX = Number(input.toX) || 0;
  const toY = Number(input.toY) || 0;
  const bend = Math.max(fromX + 36, toX - 36);
  return `M ${fromX} ${fromY} C ${bend} ${fromY}, ${bend} ${toY}, ${toX} ${toY}`;
}

export function authoringNodesInRectangle(nodes, rectangle) {
  const left = Math.min(rectangle.startX, rectangle.endX);
  const top = Math.min(rectangle.startY, rectangle.endY);
  const right = Math.max(rectangle.startX, rectangle.endX);
  const bottom = Math.max(rectangle.startY, rectangle.endY);
  return nodes
    .filter((node) =>
      node.left < right &&
      node.left + node.width > left &&
      node.top < bottom &&
      node.top + node.height > top,
    )
    .map((node) => node.index);
}

