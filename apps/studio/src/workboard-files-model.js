export function buildWorkboardPage(items, query = "", requestedPage = 1, pageSize = 10) {
  const values = Array.isArray(items) ? items : [];
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  const filteredItems = normalizedQuery
    ? values.filter((item) => `${item?.title || ""} ${item?.detail || ""} ${item?.mimeType || ""}`.toLocaleLowerCase().includes(normalizedQuery))
    : values;
  const normalizedPageSize = Math.max(1, Math.min(100, Number(pageSize) || 10));
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / normalizedPageSize));
  const page = Math.min(Math.max(1, Number(requestedPage) || 1), pageCount);
  return {
    items: filteredItems.slice((page - 1) * normalizedPageSize, page * normalizedPageSize),
    filteredCount: filteredItems.length,
    page,
    pageCount,
    pageSize: normalizedPageSize,
  };
}

export function filterWorkboardFileDeliverables(items) {
  return (Array.isArray(items) ? items : []).filter((item) => Boolean(
    item?.artifactId ||
    item?.uri ||
    item?.mimeType ||
    item?.source === "artifact"
  ));
}

export function mergeWorkspaceChangeSetHistory(changeSets, fallbackChangeSet = null, workspaceFiles = null) {
  if (Array.isArray(workspaceFiles) && workspaceFiles.length) {
    return workspaceFiles
      .filter((file) => file?.relative_path)
      .map((file) => ({
        change: {
          relative_path: file.relative_path,
          kind: file.kind,
          before_size_bytes: file.before_size_bytes ?? null,
          after_size_bytes: file.after_size_bytes ?? null,
          added_lines: Number(file.added_lines || 0),
          deleted_lines: Number(file.deleted_lines || 0),
        },
        changeSet: {
          change_set_id: file.change_set_id || "",
          status: file.status || "applied",
          source_root: file.source_root || "",
          created_at: file.created_at || "",
        },
      }));
  }
  const history = Array.isArray(changeSets) && changeSets.length
    ? changeSets
    : fallbackChangeSet
      ? [fallbackChangeSet]
      : [];
  const effectiveChanges = new Map();
  history
    .slice()
    .sort((left, right) => String(left?.created_at || "").localeCompare(String(right?.created_at || "")))
    .forEach((changeSet) => {
      if (!["applied", "pending"].includes(changeSet?.status)) return;
      (Array.isArray(changeSet?.changes) ? changeSet.changes : []).forEach((change) => {
        if (!change?.relative_path) return;
        effectiveChanges.set(change.relative_path, { change, changeSet });
      });
    });
  return [...effectiveChanges.values()]
    .sort((left, right) => String(left.change.relative_path).localeCompare(String(right.change.relative_path)));
}
