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
  descriptor: Omit<CapabilityDescriptor, "kind" | "enabled"> & {
    kind?: "tool";
    enabled?: boolean;
  };
  input_schema: Record<string, unknown>;
  handler: CapabilityToolHandler;
  timeout_ms?: number;
  progress_label?: string;
}

interface RegisteredTool {
  descriptor: CapabilityDescriptor;
  definition: CapabilityToolDefinition;
  validate: ValidateFunction;
  handler: CapabilityToolHandler | null;
  timeoutMs: number;
  progressLabel: string;
}

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const PERMISSION_SCOPE_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOL_TIMEOUT_MS = 120_000;

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
    const validate = this.ajv.compile(input.input_schema as AnySchema);
    const timeoutMs = Math.min(
      MAX_TOOL_TIMEOUT_MS,
      Math.max(1, Math.floor(input.timeout_ms || DEFAULT_TOOL_TIMEOUT_MS)),
    );
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
        input_schema: structuredClone(input.input_schema),
      },
      validate,
      handler: input.handler,
      timeoutMs,
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
    const validate = this.ajv.compile(input.input_schema as AnySchema);
    const timeoutMs = Math.min(
      MAX_TOOL_TIMEOUT_MS,
      Math.max(1, Math.floor(input.timeout_ms || DEFAULT_TOOL_TIMEOUT_MS)),
    );
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
      metadata: { ...input.descriptor.metadata },
    };
    this.capabilities.set(capabilityId, descriptor);
    this.tools.set(capabilityId, {
      descriptor,
      definition: {
        name: capabilityId,
        description: descriptor.description,
        input_schema: structuredClone(input.input_schema),
      },
      validate,
      handler: null,
      timeoutMs,
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
    const validate = this.ajv.compile(input.input_schema as AnySchema);
    const timeoutMs = Math.min(
      MAX_TOOL_TIMEOUT_MS,
      Math.max(1, Math.floor(input.timeout_ms || DEFAULT_TOOL_TIMEOUT_MS)),
    );
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
      metadata: { ...input.descriptor.metadata },
    };
    this.capabilities.set(capabilityId, descriptor);
    this.tools.set(capabilityId, {
      descriptor,
      definition: {
        name: capabilityId,
        description: descriptor.description,
        input_schema: structuredClone(input.input_schema),
      },
      validate,
      handler: input.handler,
      timeoutMs,
      progressLabel: input.progress_label?.trim() || descriptor.name,
    });
    return structuredClone(descriptor);
  }

  registerCapability(
    input: Omit<CapabilityDescriptor, "enabled"> & { enabled?: boolean },
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
    let timer: NodeJS.Timeout | null = null;
    try {
      const result = await Promise.race([
        Promise.resolve(tool.handler({
          session: input.session,
          arguments: structuredClone(input.arguments),
          capability: structuredClone(tool.descriptor),
          action_id: input.actionId || null,
        })),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new CapabilityToolError(
              "capability_tool_timeout",
              `Capability tool ${input.toolName} timed out.`,
            )),
            tool.timeoutMs,
          );
          timer.unref();
        }),
      ]);
      if (!plainObject(result)) {
        throw new CapabilityToolError(
          "capability_result_invalid",
          `Capability tool ${input.toolName} returned an invalid result.`,
        );
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  clear(): void {
    this.tools.clear();
    this.capabilities.clear();
  }
}

const registry = new CapabilityRegistry();

export function getCapabilityRegistry(): CapabilityRegistry {
  return registry;
}
