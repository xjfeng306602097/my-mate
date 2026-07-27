export const AUTONOMY_MODES = ["review_first", "assisted", "autopilot"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const AGENT_ROLES = ["orchestrator", "supervisor", "worker", "reviewer", "specialist"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const RUN_ACTIONS = ["pause", "resume", "cancel"] as const;
export type RunAction = (typeof RUN_ACTIONS)[number];

export const WORKER_TARGET_KINDS = ["local", "docker-worker", "node-worker"] as const;
export type WorkerTargetKind = (typeof WORKER_TARGET_KINDS)[number];

export const PLAN_OPTIONS = ["primary", "alternative"] as const;
export type PlanOption = (typeof PLAN_OPTIONS)[number];

export type UiExecutionState =
  | "not_started"
  | "active"
  | "waiting"
  | "successful"
  | "unsuccessful";

export interface LifecycleDefinition<Status extends string> {
  readonly name: string;
  readonly values: readonly Status[];
  readonly initial: Status;
  readonly active: readonly Status[];
  readonly waiting: readonly Status[];
  readonly successful: readonly Status[];
  readonly unsuccessful: readonly Status[];
  readonly terminal: readonly Status[];
  readonly transitions: Readonly<Record<Status, readonly Status[]>>;
  readonly recoveryTransitions?: Readonly<Partial<Record<Status, readonly Status[]>>>;
}

export class LifecycleTransitionError extends Error {
  readonly code = "invalid_lifecycle_transition";

  constructor(
    readonly lifecycle: string,
    readonly from: string,
    readonly to: string,
    readonly recovery: boolean,
  ) {
    super(`Invalid ${lifecycle} transition: ${from} -> ${to}${recovery ? " (recovery)" : ""}.`);
    this.name = "LifecycleTransitionError";
  }
}

export class LifecycleStatusError extends TypeError {
  readonly code = "invalid_lifecycle_status";

  constructor(
    readonly lifecycle: string,
    readonly value: unknown,
  ) {
    super(`Unknown ${lifecycle} status: ${String(value)}.`);
    this.name = "LifecycleStatusError";
  }
}

export function defineLifecycle<Status extends string>(
  definition: LifecycleDefinition<Status>,
): LifecycleDefinition<Status> {
  const values = new Set(definition.values);
  if (!values.has(definition.initial)) {
    throw new Error(`${definition.name} initial status is not declared.`);
  }
  for (const status of definition.values) {
    if (!Object.hasOwn(definition.transitions, status)) {
      throw new Error(`${definition.name} is missing transitions for ${status}.`);
    }
    for (const target of definition.transitions[status]) {
      if (!values.has(target)) throw new Error(`${definition.name} transition target ${target} is not declared.`);
    }
    for (const target of definition.recoveryTransitions?.[status] || []) {
      if (!values.has(target)) throw new Error(`${definition.name} recovery target ${target} is not declared.`);
    }
  }
  return Object.freeze(definition);
}

export function isLifecycleStatus<Status extends string>(
  lifecycle: LifecycleDefinition<Status>,
  value: unknown,
): value is Status {
  return typeof value === "string" && lifecycle.values.includes(value as Status);
}

export function parseLifecycleStatus<Status extends string>(
  lifecycle: LifecycleDefinition<Status>,
  value: unknown,
): Status {
  if (isLifecycleStatus(lifecycle, value)) return value;
  throw new LifecycleStatusError(lifecycle.name, value);
}

export function isTerminalStatus<Status extends string>(
  lifecycle: LifecycleDefinition<Status>,
  status: Status,
): boolean {
  return lifecycle.terminal.includes(status);
}

export function canTransitionLifecycle<Status extends string>(
  lifecycle: LifecycleDefinition<Status>,
  from: Status,
  to: Status,
  options: { recovery?: boolean } = {},
): boolean {
  if (from === to) return true;
  if (lifecycle.transitions[from].includes(to)) return true;
  return options.recovery === true && (lifecycle.recoveryTransitions?.[from] || []).includes(to);
}

export function assertLifecycleTransition<Status extends string>(
  lifecycle: LifecycleDefinition<Status>,
  from: Status,
  to: Status,
  options: { recovery?: boolean } = {},
): void {
  if (!canTransitionLifecycle(lifecycle, from, to, options)) {
    throw new LifecycleTransitionError(lifecycle.name, from, to, options.recovery === true);
  }
}

export function projectLifecycleStatus<Status extends string>(
  lifecycle: LifecycleDefinition<Status>,
  status: Status,
): UiExecutionState {
  if (lifecycle.successful.includes(status)) return "successful";
  if (lifecycle.unsuccessful.includes(status)) return "unsuccessful";
  if (lifecycle.waiting.includes(status)) return "waiting";
  if (lifecycle.active.includes(status)) return "active";
  return "not_started";
}

export const RUN_STATUSES = [
  "draft", "queued", "running", "waiting_human", "paused", "blocked", "completed", "failed", "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_LIFECYCLE = defineLifecycle<RunStatus>({
  name: "Run",
  values: RUN_STATUSES,
  initial: "draft",
  active: ["queued", "running"],
  waiting: ["waiting_human", "paused", "blocked"],
  successful: ["completed"],
  unsuccessful: ["failed", "cancelled"],
  terminal: ["completed", "failed", "cancelled"],
  transitions: {
    draft: ["queued", "cancelled"],
    queued: ["running", "waiting_human", "blocked", "completed", "failed", "cancelled"],
    running: ["waiting_human", "paused", "blocked", "completed", "failed", "cancelled"],
    waiting_human: ["running", "paused", "blocked", "completed", "failed", "cancelled"],
    paused: ["running", "cancelled"],
    blocked: ["queued", "running", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  },
  recoveryTransitions: { failed: ["running"], cancelled: ["running"] },
});

export const NODE_STATUSES = ["pending", "ready", "running", "waiting_human", "completed", "failed", "skipped", "cancelled"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];
export const NODE_LIFECYCLE = defineLifecycle<NodeStatus>({
  name: "Node",
  values: NODE_STATUSES,
  initial: "pending",
  active: ["ready", "running"],
  waiting: ["waiting_human"],
  successful: ["completed", "skipped"],
  unsuccessful: ["failed", "cancelled"],
  terminal: ["completed", "failed", "skipped", "cancelled"],
  transitions: {
    pending: ["ready", "skipped", "cancelled"],
    ready: ["running", "waiting_human", "completed", "failed", "skipped", "cancelled"],
    running: ["waiting_human", "completed", "failed", "cancelled"],
    waiting_human: ["ready", "running", "completed", "failed", "skipped", "cancelled"],
    completed: [],
    failed: [],
    skipped: [],
    cancelled: [],
  },
  recoveryTransitions: { running: ["ready"], failed: ["ready"], cancelled: ["ready"] },
});

export const SESSION_STATUSES = ["draft", "planning", "ready_to_run", "running", "waiting_human", "completed", "failed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SESSION_LIFECYCLE = defineLifecycle<SessionStatus>({
  name: "Session",
  values: SESSION_STATUSES,
  initial: "draft",
  active: ["planning", "ready_to_run", "running"],
  waiting: ["waiting_human"],
  successful: ["completed"],
  unsuccessful: ["failed", "cancelled"],
  terminal: [],
  transitions: {
    draft: ["planning", "ready_to_run", "running", "waiting_human", "completed", "failed", "cancelled"],
    planning: ["draft", "ready_to_run", "running", "waiting_human", "completed", "failed", "cancelled"],
    ready_to_run: ["draft", "planning", "running", "waiting_human", "completed", "failed", "cancelled"],
    running: ["draft", "planning", "ready_to_run", "waiting_human", "completed", "failed", "cancelled"],
    waiting_human: ["draft", "planning", "ready_to_run", "running", "completed", "failed", "cancelled"],
    completed: ["draft", "planning", "ready_to_run", "running", "waiting_human"],
    failed: ["draft", "planning", "ready_to_run", "running", "waiting_human"],
    cancelled: ["draft", "planning", "ready_to_run", "running", "waiting_human"],
  },
});

export const AGENT_DAG_STATUSES = ["draft", "ready", "running", "waiting_human", "completed", "failed", "cancelled"] as const;
export type AgentDagStatus = (typeof AGENT_DAG_STATUSES)[number];
export const AGENT_DAG_LIFECYCLE = defineLifecycle<AgentDagStatus>({
  name: "AgentDag",
  values: AGENT_DAG_STATUSES,
  initial: "draft",
  active: ["ready", "running"],
  waiting: ["waiting_human"],
  successful: ["completed"],
  unsuccessful: ["failed", "cancelled"],
  terminal: ["completed", "failed", "cancelled"],
  transitions: {
    draft: ["ready", "cancelled"],
    ready: ["running", "failed", "cancelled"],
    running: ["waiting_human", "completed", "failed", "cancelled"],
    waiting_human: ["running", "completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  },
  recoveryTransitions: { running: ["ready"], waiting_human: ["ready"], failed: ["ready"] },
});

export const AGENT_TASK_STATUSES = ["queued", "accepted", "running", "blocked", "completed", "skipped", "failed", "cancelled"] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export const AGENT_TASK_LIFECYCLE = defineLifecycle<AgentTaskStatus>({
  name: "AgentTask",
  values: AGENT_TASK_STATUSES,
  initial: "queued",
  active: ["queued", "accepted", "running"],
  waiting: ["blocked"],
  successful: ["completed", "skipped"],
  unsuccessful: ["failed", "cancelled"],
  terminal: ["completed", "skipped", "failed", "cancelled"],
  transitions: {
    queued: ["accepted", "running", "blocked", "skipped", "failed", "cancelled"],
    accepted: ["running", "blocked", "failed", "cancelled"],
    running: ["blocked", "completed", "failed", "cancelled"],
    blocked: ["completed", "failed", "cancelled"],
    completed: [],
    skipped: [],
    failed: [],
    cancelled: [],
  },
  recoveryTransitions: { accepted: ["queued"], running: ["queued"], blocked: ["queued"], completed: ["queued"], skipped: ["queued"], failed: ["queued"] },
});

export const AGENT_RUN_STATUSES = ["queued", "running", "waiting_human", "completed", "failed", "cancelled"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export const AGENT_RUN_LIFECYCLE = defineLifecycle<AgentRunStatus>({
  name: "AgentRun",
  values: AGENT_RUN_STATUSES,
  initial: "queued",
  active: ["queued", "running"],
  waiting: ["waiting_human"],
  successful: ["completed"],
  unsuccessful: ["failed", "cancelled"],
  terminal: ["completed", "failed", "cancelled"],
  transitions: {
    queued: ["running", "failed", "cancelled"],
    running: ["waiting_human", "completed", "failed", "cancelled"],
    waiting_human: ["running", "completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  },
  recoveryTransitions: { failed: ["running"] },
});

export const TASK_CHECKPOINT_STATUSES = ["in_progress", "resumable", "waiting_human", "completed", "failed", "superseded"] as const;
export type TaskCheckpointStatus = (typeof TASK_CHECKPOINT_STATUSES)[number];
export const TASK_CHECKPOINT_LIFECYCLE = defineLifecycle<TaskCheckpointStatus>({
  name: "TaskCheckpoint",
  values: TASK_CHECKPOINT_STATUSES,
  initial: "in_progress",
  active: ["in_progress", "resumable"],
  waiting: ["waiting_human"],
  successful: ["completed", "superseded"],
  unsuccessful: ["failed"],
  terminal: ["completed", "failed", "superseded"],
  transitions: {
    in_progress: ["resumable", "waiting_human", "completed", "failed", "superseded"],
    resumable: ["in_progress", "waiting_human", "failed", "superseded"],
    waiting_human: ["in_progress", "completed", "failed", "superseded"],
    completed: [],
    failed: [],
    superseded: [],
  },
});
