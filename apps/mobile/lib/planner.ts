import type { PlannerValidationResult } from "@/lib/types";

export type WarningGroup = {
  key: "required_input" | "registry" | "graph" | "other";
  title: string;
  tone: "warn" | "danger";
  items: string[];
};

export function classifyWarning(warning: string): WarningGroup["key"] {
  const normalized = warning.toLowerCase();
  if (normalized.startsWith("missing required input:")) {
    return "required_input";
  }
  if (
    normalized.includes("agent profile") ||
    normalized.includes("openclaw agent") ||
    normalized.includes("unknown skill") ||
    normalized.includes("disabled skill") ||
    normalized.includes("registry")
  ) {
    return "registry";
  }
  if (
    normalized.includes("frontier") ||
    normalized.includes("terminal node") ||
    normalized.includes("cycle") ||
    normalized.includes("edge ")
  ) {
    return "graph";
  }
  return "other";
}

export function groupWarnings(warnings: string[]): WarningGroup[] {
  const groups: WarningGroup[] = [
    {
      key: "required_input",
      title: "Required input",
      tone: "danger",
      items: [],
    },
    {
      key: "registry",
      title: "Registry binding",
      tone: "warn",
      items: [],
    },
    {
      key: "graph",
      title: "Workflow graph",
      tone: "warn",
      items: [],
    },
    {
      key: "other",
      title: "Other checks",
      tone: "warn",
      items: [],
    },
  ];

  for (const warning of warnings) {
    const key = classifyWarning(warning);
    const group = groups.find((item) => item.key === key);
    group?.items.push(warning);
  }

  return groups.filter((group) => group.items.length > 0);
}

export function groupValidation(result: PlannerValidationResult | null): WarningGroup[] {
  if (!result) {
    return [];
  }

  if (!result.details?.length) {
    return groupWarnings(result.warnings || []);
  }

  const groups: WarningGroup[] = [
    {
      key: "required_input",
      title: "Required input",
      tone: "danger",
      items: [],
    },
    {
      key: "registry",
      title: "Registry binding",
      tone: "warn",
      items: [],
    },
    {
      key: "graph",
      title: "Workflow graph",
      tone: "warn",
      items: [],
    },
    {
      key: "other",
      title: "Other checks",
      tone: "warn",
      items: [],
    },
  ];

  for (const detail of result.details) {
    const group = groups.find((item) => item.key === detail.category);
    group?.items.push(detail.message);
  }

  return groups.filter((group) => group.items.length > 0);
}

export function formatWarnings(warnings: string[], limit = 5): string {
  if (warnings.length === 0) {
    return "Validation warnings were returned, but no details were provided.";
  }

  const visible = warnings.slice(0, limit).map((warning) => `- ${warning}`);
  const remaining = warnings.length - visible.length;
  if (remaining > 0) {
    visible.push(`- ${remaining} more warning(s)`);
  }
  return visible.join("\n");
}

export function formatWarningSummary(warnings: string[]): string {
  const groups = groupWarnings(warnings);
  if (groups.length === 0) {
    return formatWarnings(warnings);
  }

  return groups.map((group) => `${group.title}: ${group.items.length}`).join("\n");
}
