const OPEN_STATUSES = new Set(["pending", "blocked", "apply_failed"]);

export function openWorkspaceChangeSets(items) {
  return (Array.isArray(items) ? items : []).filter((item) => OPEN_STATUSES.has(item?.status));
}

export function countWorkspaceChangeKinds(changeSet) {
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const change of changeSet?.changes || []) {
    if (change?.kind in counts) counts[change.kind] += 1;
  }
  return counts;
}

export function selectWorkspaceChangeSet(items, selectedId = "") {
  const open = openWorkspaceChangeSets(items);
  return open.find((item) => item.change_set_id === selectedId) || open[0] || null;
}

export function selectWorkspaceFile(changeSet, selectedPath = "") {
  const changes = Array.isArray(changeSet?.changes) ? changeSet.changes : [];
  return changes.find((item) => item.relative_path === selectedPath) || changes[0] || null;
}

export function workspaceChangeTone(status) {
  if (status === "blocked" || status === "apply_failed") return "danger";
  if (status === "pending") return "warn";
  if (status === "applied") return "success";
  return "neutral";
}

export function workspaceChangeKindSymbol(kind) {
  if (kind === "added") return "+";
  if (kind === "deleted") return "-";
  return "M";
}

export function formatWorkspaceBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
