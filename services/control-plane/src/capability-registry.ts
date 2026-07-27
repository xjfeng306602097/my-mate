import { createRequire } from "node:module";
import type { AnySchema, ValidateFunction } from "ajv";
import type { ConversationActionRiskLevel, SessionRecord } from "./types.js";

const require = createRequire(import.meta.url);
type AjvLike = { compile(schema: AnySchema): ValidateFunction };
type AjvConstructor = new (options?: { allErrors?: boolean; strict?: boolean }) => AjvLike;
const Ajv = require("ajv").default as AjvConstructor;

export const CAPABILITY_KINDS = [
  "tool",
  "provider",
  "hook",
  "skill",
  "exporter",
  "platform",
] as const;

export const CAPABILITY_EXECUTORS = [
  "control-plane",
  "desktop",
  "worker",
  "browser",
  "mcp",
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityExecutor = (typeof CAPABILITY_EXECUTORS)[number];

export type ToolSideEffects = "none" | "external_mutation";

export interface ToolExecutionPolicy {
  timeout_ms: number;
  max_attempts: number;
  initial_backoff_ms: number;
  max_backoff_ms: number;
  retryable_error_codes: string[];
  circuit_breaker: {
    failure_threshold: number;
    reset_timeout_ms: number;
  };
  side_effects: ToolSideEffects;
  idempotency_required: boolean;
}

export interface ToolExecutionPolicyInput {
  timeout_ms?: number;
  max_attempts?: number;
  initial_backoff_ms?: number;
  max_backoff_ms?: number;
  retryable_error_codes?: string[];
  circuit_breaker?: {
    failure_threshold?: number;
    reset_timeout_ms?: number;
  };
  side_effects?: ToolSideEffects;
  idempotency_required?: boolean;
}

export interface CapabilityDescriptor {
  capability_id: string;
  plugin_id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  version: string;
  risk_level: ConversationActionRiskLevel;
  permission_scopes: string[];
  executor: CapabilityExecutor;
  enabled: boolean;
  execution_policy: ToolExecutionPolicy | null;
  metadata: Record<string, unknown>;
}

export interface CapabilityToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CapabilityToolExecutionContext {
  session: SessionRecord;
  arguments: Record<string, unknown>;
  capability: CapabilityDescriptor;
  action_id: string | null;
  idempotency_key: string | null;
  attempt: number;
}

export type CapabilityToolHandler = (
  context: CapabilityToolExecutionContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export class CapabilityToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface CapabilityToolRegistration {
  descriptor: Omit<CapabilityDescriptor, "kind" | "enabled" | "execution_policy"> & {
    kind?: "tool";
    enabled?: boolean;
  };
  input_schema: Record<string, unknown>;
  handler: CapabilityToolHandler;
  timeout_ms?: number;
  execution_policy?: ToolExecutionPolicyInput;
  progress_label?: string;
}

interface RegisteredTool {
  descriptor: CapabilityDescriptor;
  definition: CapabilityToolDefinition;
  validate: ValidateFunction;
  handler: CapabilityToolHandler | null;
  executionPolicy: ToolExecutionPolicy;
  progressLabel: string;
}

interface ToolCircuitState {
  consecutiveFailures: number;
  openUntil: number;
}

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const PERMISSION_SCOPE_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOL_TIMEOUT_MS = 120_000;
const DEFAULT_RETRYABLE_ERROR_CODES = [
  "capability_tool_timeout",
  "mcp_server_unavailable",
  "mcp_tool_call_failed",
  "web_request_failed",
  "web_request_timeout",
  "web_response_timeout",
];

const CORE_TOOL_EXECUTION_POLICIES = new Map<string, ToolExecutionPolicy>([
  ["workspace_apply_operations", {
    timeout_ms: 120_000,
    max_attempts: 1,
    initial_backoff_ms: 250,
    max_backoff_ms: 5_000,
    retryable_error_codes: [],
    circuit_breaker: { failure_threshold: 3, reset_timeout_ms: 30_000 },
    side_effects: "external_mutation",
    idempotency_required: true,
  }],
  ["workspace_run_command", {
    timeout_ms: 120_000,
    max_attempts: 1,
    initial_backoff_ms: 250,
    max_backoff_ms: 5_000,
    retryable_error_codes: [],
    circuit_breaker: { failure_threshold: 3, reset_timeout_ms: 30_000 },
    side_effects: "external_mutation",
    idempotency_required: true,
  }],
]);

function assertIdentifier(value: string, label: string): void {
  if (!CAPABILITY_ID_PATTERN.test(value)) {
    throw new Error(`${label} must use lowercase letters, digits, dots, dashes, or underscores.`);
  }
}

function normalizeScopes(scopes: readonly string[]): string[] {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
  for (const scope of normalized) {
    if (!PERMISSION_SCOPE_PATTERN.test(scope)) {
      throw new Error(`Invalid capability permission scope: ${scope}`);
    }
  }
  return normalized.sort();
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function normalizeExecutionPolicy(input: CapabilityToolRegistration): ToolExecutionPolicy {
  const configured = input.execution_policy || {};
  const sideEffects = configured.side_effects === "external_mutation" ? "external_mutation" : "none";
  const timeoutMs = boundedInteger(
    configured.timeout_ms ?? input.timeout_ms,
    DEFAULT_TOOL_TIMEOUT_MS,
    1,
    MAX_TOOL_TIMEOUT_MS,
  );
  const initialBackoffMs = boundedInteger(configured.initial_backoff_ms, 250, 0, 30_000);
  return {
    timeout_ms: timeoutMs,
    max_attempts: boundedInteger(configured.max_attempts, sideEffects === "none" ? 2 : 1, 1, 10),
    initial_backoff_ms: initialBackoffMs,
    max_backoff_ms: boundedInteger(configured.max_backoff_ms, 5_000, initialBackoffMs, 120_000),
    retryable_error_codes: [...new Set(
      Array.isArray(configured.retryable_error_codes)
        ? configured.retryable_error_codes.map(String).map((value) => value.trim()).filter(Boolean)
        : DEFAULT_RETRYABLE_ERROR_CODES,
    )].sort(),
    circuit_breaker: {
      failure_threshold: boundedInteger(configured.circuit_breaker?.failure_threshold, 3, 1, 100),
      reset_timeout_ms: boundedInteger(configured.circuit_breaker?.reset_timeout_ms, 30_000, 100, 3_600_000),
    },
    side_effects: sideEffects,
    idempotency_required: sideEffects === "external_mutation" || configured.idempotency_required === true,
  };
}

function toolInputSchema(
  inputSchema: Record<string, unknown>,
  policy: ToolExecutionPolicy,
): Record<string, unknown> {
  const schema = structuredClone(inputSchema);
  if (!policy.idempotency_required) return schema;
  const properties = plainObject(schema.properties) ? schema.properties : {};
  schema.properties = {
    ...properties,
    idempotency_key: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Stable key reused when this same side effect is resumed or retried.",
    },
  };
  schema.required = [...new Set([
    ...(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []),
    "idempotency_key",
  ])];
  return schema;
}

function handlerArguments(args: Record<string, unknown>, policy: ToolExecutionPolicy): Record<string, unknown> {
  if (!policy.idempotency_required || !("idempotency_key" in args)) return structuredClone(args);
  const { idempotency_key: _idempotencyKey, ...rest } = args;
  return structuredClone(rest);
}

function executionErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "capability_tool_failed")
    : "capability_tool_failed";
}

function waitForBackoff(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isAvailableInWorkspace(descriptor: CapabilityDescriptor, workspaceId?: string): boolean {
  const scopedWorkspaceId = typeof descriptor.metadata.workspace_id === "string"
    ? descriptor.metadata.workspace_id
    : null;
  return !scopedWorkspaceId || !workspaceId || scopedWorkspaceId === workspaceId;
}

export class CapabilityRegistry {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly capabilities = new Map<string, CapabilityDescriptor>();
  private readonly reservedCapabilityIds = new Set<string>();
  private readonly circuitStates = new Map<string, ToolCircuitState>();

  reserveCapabilityIds(capabilityIds: readonly string[]): void {
    for (const capabilityId of capabilityIds) {
      assertIdentifier(capabilityId, "Reserved capability ID");
      this.reservedCapabilityIds.add(capabilityId);
    }
  }

  registerTool(input: CapabilityToolRegistration): CapabilityDescriptor {
    const capabilityId = input.descriptor.capability_id.trim();
    const pluginId = input.descriptor.plugin_id.trim();
    assertIdentifier(capabilityId, "Capability ID");
    assertIdentifier(pluginId, "Plugin ID");
    if (this.reservedCapabilityIds.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is reserved by the core host.`);
    }
    if (this.capabilities.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is already registered.`);
    }
    if (!plainObject(input.input_schema)) {
      throw new Error(`Capability ${capabilityId} requires an object input schema.`);
    }
    const executionPolicy = normalizeExecutionPolicy(input);
    const inputSchema = toolInputSchema(input.input_schema, executionPolicy);
    const validate = this.ajv.compile(inputSchema as AnySchema);
    const descriptor: CapabilityDescriptor = {
      ...input.descriptor,
      capability_id: capabilityId,
      plugin_id: pluginId,
      kind: "tool",
      name: input.descriptor.name.trim() || capabilityId,
      description: input.descriptor.description.trim(),
      version: input.descriptor.version.trim(),
      risk_level: input.descriptor.risk_level,
      permission_scopes: normalizeScopes(input.descriptor.permission_scopes),
      executor: input.descriptor.executor,
      enabled: input.descriptor.enabled !== false,
      execution_policy: executionPolicy,
      metadata: { ...input.descriptor.metadata },
    };
    if (descriptor.executor !== "control-plane") {
      throw new Error(
        `Tool capability ${capabilityId} cannot bind a Control Plane handler for executor ${descriptor.executor}.`,
      );
    }
    const registered: RegisteredTool = {
      descriptor,
      definition: {
        name: capabilityId,
        description: descriptor.description,
        input_schema: inputSchema,
      },
      validate,
      handler: input.handler,
      executionPolicy,
      progressLabel: input.progress_label?.trim() || descriptor.name,
    };
    this.capabilities.set(capabilityId, descriptor);
    this.tools.set(capabilityId, registered);
    return structuredClone(descriptor);
  }

  registerRemoteTool(
    input: Omit<CapabilityToolRegistration, "handler">,
  ): CapabilityDescriptor {
    if (input.descriptor.executor === "control-plane") {
      throw new Error(
        `Remote tool capability ${input.descriptor.capability_id} requires a non-Control Plane executor.`,
      );
    }
    const capabilityId = input.descriptor.capability_id.trim();
    const pluginId = input.descriptor.plugin_id.trim();
    assertIdentifier(capabilityId, "Capability ID");
    assertIdentifier(pluginId, "Plugin ID");
    if (this.reservedCapabilityIds.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is reserved by the core host.`);
    }
    if (this.capabilities.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is already registered.`);
    }
    if (!plainObject(input.input_schema)) {
      throw new Error(`Capability ${capabilityId} requires an object input schema.`);
    }
    const executionPolicy = normalizeExecutionPolicy({ ...input, handler: () => ({}) });
    const inputSchema = toolInputSchema(input.input_schema, executionPolicy);
    const validate = this.ajv.compile(inputSchema as AnySchema);
    const descriptor: CapabilityDescriptor = {
      ...input.descriptor,
      capability_id: capabilityId,
      plugin_id: pluginId,
      kind: "tool",
      name: input.descriptor.name.trim() || capabilityId,
      description: input.descriptor.description.trim(),
      version: input.descriptor.version.trim(),
      risk_level: input.descriptor.risk_level,
      permission_scopes: normalizeScopes(input.descriptor.permission_scopes),
      executor: input.descriptor.executor,
      enabled: input.descriptor.enabled !== false,
      execution_policy: executionPolicy,
      metadata: { ...input.descriptor.metadata },
    };
    this.capabilities.set(capabilityId, descriptor);
    this.tools.set(capabilityId, {
      descriptor,
      definition: {
        name: capabilityId,
        description: descriptor.description,
        input_schema: inputSchema,
      },
      validate,
      handler: null,
      executionPolicy,
      progressLabel: input.progress_label?.trim() || descriptor.name,
    });
    return structuredClone(descriptor);
  }

  registerHostedTool(input: CapabilityToolRegistration): CapabilityDescriptor {
    if (input.descriptor.executor !== "mcp") {
      throw new Error(
        `Hosted tool capability ${input.descriptor.capability_id} requires the MCP executor.`,
      );
    }
    const capabilityId = input.descriptor.capability_id.trim();
    const pluginId = input.descriptor.plugin_id.trim();
    assertIdentifier(capabilityId, "Capability ID");
    assertIdentifier(pluginId, "Plugin ID");
    if (this.reservedCapabilityIds.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is reserved by the core host.`);
    }
    if (this.capabilities.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is already registered.`);
    }
    if (!plainObject(input.input_schema)) {
      throw new Error(`Capability ${capabilityId} requires an object input schema.`);
    }
    const executionPolicy = normalizeExecutionPolicy(input);
    const inputSchema = toolInputSchema(input.input_schema, executionPolicy);
    const validate = this.ajv.compile(inputSchema as AnySchema);
    const descriptor: CapabilityDescriptor = {
      ...input.descriptor,
      capability_id: capabilityId,
      plugin_id: pluginId,
      kind: "tool",
      name: input.descriptor.name.trim() || capabilityId,
      description: input.descriptor.description.trim(),
      version: input.descriptor.version.trim(),
      risk_level: input.descriptor.risk_level,
      permission_scopes: normalizeScopes(input.descriptor.permission_scopes),
      executor: "mcp",
      enabled: input.descriptor.enabled !== false,
      execution_policy: executionPolicy,
      metadata: { ...input.descriptor.metadata },
    };
    this.capabilities.set(capabilityId, descriptor);
    this.tools.set(capabilityId, {
      descriptor,
      definition: {
        name: capabilityId,
        description: descriptor.description,
        input_schema: inputSchema,
      },
      validate,
      handler: input.handler,
      executionPolicy,
      progressLabel: input.progress_label?.trim() || descriptor.name,
    });
    return structuredClone(descriptor);
  }

  registerCapability(
    input: Omit<CapabilityDescriptor, "enabled" | "execution_policy"> & { enabled?: boolean },
  ): CapabilityDescriptor {
    const capabilityId = input.capability_id.trim();
    const pluginId = input.plugin_id.trim();
    assertIdentifier(capabilityId, "Capability ID");
    assertIdentifier(pluginId, "Plugin ID");
    if (this.reservedCapabilityIds.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is reserved by the core host.`);
    }
    if (this.capabilities.has(capabilityId)) {
      throw new Error(`Capability ${capabilityId} is already registered.`);
    }
    const descriptor: CapabilityDescriptor = {
      ...input,
      capability_id: capabilityId,
      plugin_id: pluginId,
      name: input.name.trim() || capabilityId,
      description: input.description.trim(),
      version: input.version.trim(),
      permission_scopes: normalizeScopes(input.permission_scopes),
      enabled: input.enabled !== false,
      execution_policy: null,
      metadata: { ...input.metadata },
    };
    this.capabilities.set(capabilityId, descriptor);
    return structuredClone(descriptor);
  }

  unregisterPlugin(pluginId: string): void {
    for (const [capabilityId, descriptor] of this.capabilities) {
      if (descriptor.plugin_id !== pluginId) continue;
      this.capabilities.delete(capabilityId);
      this.tools.delete(capabilityId);
    }
  }

  getCapability(capabilityId: string): CapabilityDescriptor | null {
    const descriptor = this.capabilities.get(capabilityId);
    return descriptor ? structuredClone(descriptor) : null;
  }

  listCapabilities(workspaceId?: string): CapabilityDescriptor[] {
    return [...this.capabilities.values()]
      .filter((descriptor) => isAvailableInWorkspace(descriptor, workspaceId))
      .map((descriptor) => structuredClone(descriptor))
      .sort((left, right) => left.capability_id.localeCompare(right.capability_id));
  }

  listToolDefinitions(workspaceId?: string): CapabilityToolDefinition[] {
    return [...this.tools.values()]
      .filter((tool) => tool.descriptor.enabled && isAvailableInWorkspace(tool.descriptor, workspaceId))
      .map((tool) => structuredClone(tool.definition))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  hasTool(toolName: string, workspaceId?: string): boolean {
    const tool = this.tools.get(toolName);
    return tool?.descriptor.enabled === true && isAvailableInWorkspace(tool.descriptor, workspaceId);
  }

  toolRiskLevel(toolName: string, workspaceId?: string): ConversationActionRiskLevel | null {
    const tool = this.tools.get(toolName);
    return tool && isAvailableInWorkspace(tool.descriptor, workspaceId) ? tool.descriptor.risk_level : null;
  }

  toolProgressLabel(toolName: string, workspaceId?: string): string | null {
    const tool = this.tools.get(toolName);
    return tool && isAvailableInWorkspace(tool.descriptor, workspaceId) ? tool.progressLabel : null;
  }

  toolExecutor(toolName: string, workspaceId?: string): CapabilityExecutor | null {
    const tool = this.tools.get(toolName);
    return tool && isAvailableInWorkspace(tool.descriptor, workspaceId) ? tool.descriptor.executor : null;
  }

  toolExecutionPolicy(toolName: string, workspaceId?: string): ToolExecutionPolicy | null {
    const tool = this.tools.get(toolName);
    if (tool && isAvailableInWorkspace(tool.descriptor, workspaceId)) {
      return structuredClone(tool.executionPolicy);
    }
    const corePolicy = CORE_TOOL_EXECUTION_POLICIES.get(toolName);
    return corePolicy ? structuredClone(corePolicy) : null;
  }

  validateToolArguments(toolName: string, args: Record<string, unknown>, workspaceId?: string): void {
    const tool = this.tools.get(toolName);
    if (!tool || !tool.descriptor.enabled || !isAvailableInWorkspace(tool.descriptor, workspaceId)) {
      throw new Error(`Capability tool ${toolName} is not registered.`);
    }
    if (tool.validate(args)) return;
    const detail = tool.validate.errors
      ?.map((error) => `${error.instancePath || "/"} ${error.message || "is invalid"}`)
      .join("; ");
    throw new Error(detail || `Arguments for ${toolName} do not match its schema.`);
  }

  async executeTool(input: {
    toolName: string;
    session: SessionRecord;
    arguments: Record<string, unknown>;
    actionId?: string | null;
  }): Promise<Record<string, unknown>> {
    const tool = this.tools.get(input.toolName);
    if (!tool || !tool.descriptor.enabled) {
      throw new Error(`Capability tool ${input.toolName} is not registered.`);
    }
    if (!isAvailableInWorkspace(tool.descriptor, input.session.workspace_id || "default")) {
      throw new CapabilityToolError(
        "capability_workspace_mismatch",
        `Capability tool ${input.toolName} is not available in this Workspace.`,
      );
    }
    if (!tool.handler) {
      throw new CapabilityToolError(
        "capability_executor_mismatch",
        `Capability tool ${input.toolName} must run on the ${tool.descriptor.executor} executor.`,
      );
    }
    this.validateToolArguments(input.toolName, input.arguments, input.session.workspace_id || "default");
    const workspaceId = input.session.workspace_id || "default";
    const circuitKey = `${workspaceId}\0${input.toolName}`;
    const circuit = this.circuitStates.get(circuitKey);
    if (circuit && circuit.openUntil > Date.now()) {
      throw new CapabilityToolError(
        "capability_circuit_open",
        `Capability tool ${input.toolName} is temporarily paused after repeated transient failures.`,
      );
    }
    if (circuit?.openUntil && circuit.openUntil <= Date.now()) this.circuitStates.delete(circuitKey);

    const policy = tool.executionPolicy;
    const idempotencyKey = policy.idempotency_required
      ? String(input.arguments.idempotency_key || "").trim()
      : null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= policy.max_attempts; attempt += 1) {
      let timer: NodeJS.Timeout | null = null;
      try {
        const result = await Promise.race([
          Promise.resolve(tool.handler({
            session: input.session,
            arguments: handlerArguments(input.arguments, policy),
            capability: structuredClone(tool.descriptor),
            action_id: input.actionId || null,
            idempotency_key: idempotencyKey,
            attempt,
          })),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new CapabilityToolError(
                "capability_tool_timeout",
                `Capability tool ${input.toolName} timed out after ${policy.timeout_ms} ms.`,
              )),
              policy.timeout_ms,
            );
          }),
        ]);
        if (!plainObject(result)) {
          throw new CapabilityToolError(
            "capability_result_invalid",
            `Capability tool ${input.toolName} returned an invalid result.`,
          );
        }
        this.circuitStates.delete(circuitKey);
        return result;
      } catch (error) {
        lastError = error;
        const code = executionErrorCode(error);
        const retryable = policy.retryable_error_codes.includes(code);
        if (!retryable || attempt >= policy.max_attempts) break;
        const delay = Math.min(
          policy.max_backoff_ms,
          policy.initial_backoff_ms * (2 ** Math.max(0, attempt - 1)),
        );
        await waitForBackoff(delay);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const code = executionErrorCode(lastError);
    if (policy.retryable_error_codes.includes(code)) {
      const prior = this.circuitStates.get(circuitKey);
      const consecutiveFailures = (prior?.consecutiveFailures || 0) + 1;
      this.circuitStates.set(circuitKey, {
        consecutiveFailures,
        openUntil: consecutiveFailures >= policy.circuit_breaker.failure_threshold
          ? Date.now() + policy.circuit_breaker.reset_timeout_ms
          : 0,
      });
    }
    throw lastError;
  }

  clear(): void {
    this.tools.clear();
    this.capabilities.clear();
    this.circuitStates.clear();
  }
}

const registry = new CapabilityRegistry();

export function getCapabilityRegistry(): CapabilityRegistry {
  return registry;
}
