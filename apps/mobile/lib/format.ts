export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatStatus(value: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    queued: "Queued",
    running: "Running",
    waiting_human: "Waiting",
    paused: "Paused",
    blocked: "Blocked",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    ready: "Ready",
    pending: "Pending",
    skipped: "Skipped",
  };
  return map[value] || value;
}
