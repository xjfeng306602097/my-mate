import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  CAPABILITY_EXECUTORS,
  CAPABILITY_KINDS,
  getCapabilityRegistry,
  type CapabilityDescriptor,
  type CapabilityExecutor,
  type CapabilityKind,
  type CapabilityToolHandler,
} from "./capability-registry.js";
import { DATA_DIR, REPO_ROOT } from "./config.js";
import type { ConversationActionRiskLevel } from "./types.js";
import { getBundledPluginModule } from "./bundled-plugins.js";

const require = createRequire(import.meta.url);
const MANIFEST_NAME = "my-mate.plugin.json";
const PLUGIN_STATE_VERSION = 1;
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const RISK_LEVELS = new Set<ConversationActionRiskLevel>(["T0", "T1", "T2", "T3"]);

export interface CapabilityPluginManifestCapability {
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  risk_level: ConversationActionRiskLevel;
  permission_scopes: string[];
  executor: CapabilityExecutor;
  input_schema?: Record<string, unknown>;
  timeout_ms?: number;
  progress_label?: string;
  metadata?: Record<string, unknown>;
}

export interface CapabilityPluginManifest {
  schema_version: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  runtime: "control-plane" | "desktop" | "worker" | "browser" | "mcp";
  entrypoint?: string;
  enabled_by_default?: boolean;
  capabilities: CapabilityPluginManifestCapability[];
  metadata?: Record<string, unknown>;
}

export interface CapabilityPluginStatus {
  plugin_id: string;
  name: string;
  version: string;
  description: string;
  source: "bundled" | "data" | "custom";
  root_path: string;
  manifest_path: string;
  runtime: CapabilityPluginManifest["runtime"];
  enabled: boolean;
  loaded: boolean;
  status: "disabled" | "ready" | "error" | "unsupported";
  error: string | null;
  capabilities: CapabilityPluginManifestCapability[];
}

interface DiscoveredPlugin {
  manifest: CapabilityPluginManifest;
  source: CapabilityPluginStatus["source"];
  rootPath: string;
  manifestPath: string;
  enabled: boolean;
  loaded: boolean;
  error: string | null;
}

interface PluginState {
  schema_version: 1;
  enabled: string[];
  disabled: string[];
}

export interface CapabilityPluginContext {
  registerTool(capabilityId: string, handler: CapabilityToolHandler): CapabilityDescriptor;
  registerCapability(capabilityId: string): CapabilityDescriptor;
}

export interface CapabilityPluginModule {
  register(context: CapabilityPluginContext): void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value.map((item) => item.trim()).filter(Boolean);
}

function assertManifest(value: unknown, manifestPath: string): CapabilityPluginManifest {
  if (!isPlainObject(value) || value.schema_version !== 1) {
    throw new Error(`${manifestPath} must declare schema_version 1.`);
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const version = typeof value.version === "string" ? value.version.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const runtime = typeof value.runtime === "string" ? value.runtime : "";
  if (!PLUGIN_ID_PATTERN.test(id)) throw new Error(`${manifestPath} has an invalid plugin id.`);
  if (!name || !description) throw new Error(`${manifestPath} requires name and description.`);
  if (!VERSION_PATTERN.test(version)) throw new Error(`${manifestPath} requires a semantic version.`);
  if (!CAPABILITY_EXECUTORS.includes(runtime as CapabilityExecutor)) {
    throw new Error(`${manifestPath} has an unsupported runtime.`);
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    throw new Error(`${manifestPath} must declare at least one capability.`);
  }
  const seen = new Set<string>();
  const capabilities = value.capabilities.map((candidate, index) => {
    if (!isPlainObject(candidate)) throw new Error(`${manifestPath} capability ${index} is invalid.`);
    const capabilityId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const kind = typeof candidate.kind === "string" ? candidate.kind : "";
    const capabilityName = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const capabilityDescription = typeof candidate.description === "string"
      ? candidate.description.trim()
      : "";
    const riskLevel = typeof candidate.risk_level === "string" ? candidate.risk_level : "";
    const executor = typeof candidate.executor === "string" ? candidate.executor : "";
    const scopes = stringArray(candidate.permission_scopes);
    if (!PLUGIN_ID_PATTERN.test(capabilityId) || seen.has(capabilityId)) {
      throw new Error(`${manifestPath} capability ${index} has an invalid or duplicate id.`);
    }
    if (!CAPABILITY_KINDS.includes(kind as CapabilityKind)) {
      throw new Error(`${manifestPath} capability ${capabilityId} has an invalid kind.`);
    }
    if (!capabilityName || !capabilityDescription) {
      throw new Error(`${manifestPath} capability ${capabilityId} requires name and description.`);
    }
    if (!RISK_LEVELS.has(riskLevel as ConversationActionRiskLevel)) {
      throw new Error(`${manifestPath} capability ${capabilityId} has an invalid risk level.`);
    }
    if (!CAPABILITY_EXECUTORS.includes(executor as CapabilityExecutor)) {
      throw new Error(`${manifestPath} capability ${capabilityId} has an invalid executor.`);
    }
    if (!scopes) throw new Error(`${manifestPath} capability ${capabilityId} has invalid scopes.`);
    if (kind === "tool" && !isPlainObject(candidate.input_schema)) {
      throw new Error(`${manifestPath} tool ${capabilityId} requires input_schema.`);
    }
    seen.add(capabilityId);
    return {
      id: capabilityId,
      kind: kind as CapabilityKind,
      name: capabilityName,
      description: capabilityDescription,
      risk_level: riskLevel as ConversationActionRiskLevel,
      permission_scopes: scopes,
      executor: executor as CapabilityExecutor,
      input_schema: isPlainObject(candidate.input_schema) ? candidate.input_schema : undefined,
      timeout_ms: typeof candidate.timeout_ms === "number" ? candidate.timeout_ms : undefined,
      progress_label: typeof candidate.progress_label === "string" ? candidate.progress_label : undefined,
      metadata: isPlainObject(candidate.metadata) ? candidate.metadata : undefined,
    };
  });
  const entrypoint = typeof value.entrypoint === "string" ? value.entrypoint.trim() : undefined;
  if (runtime === "control-plane" && !entrypoint) {
    throw new Error(`${manifestPath} Control Plane plugins require an entrypoint.`);
  }
  return {
    schema_version: 1,
    id,
    name,
    version,
    description,
    runtime: runtime as CapabilityPluginManifest["runtime"],
    entrypoint,
    enabled_by_default: value.enabled_by_default === true,
    capabilities,
    metadata: isPlainObject(value.metadata) ? value.metadata : undefined,
  };
}

function readManifest(manifestPath: string): CapabilityPluginManifest {
  return assertManifest(JSON.parse(fs.readFileSync(manifestPath, "utf-8")), manifestPath);
}

function statePath(): string {
  return path.join(DATA_DIR, "capability-plugins", "state.json");
}

function readState(): PluginState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf-8")) as unknown;
    if (!isPlainObject(parsed) || parsed.schema_version !== PLUGIN_STATE_VERSION) throw new Error();
    return {
      schema_version: 1,
      enabled: stringArray(parsed.enabled) || [],
      disabled: stringArray(parsed.disabled) || [],
    };
  } catch {
    return { schema_version: 1, enabled: [], disabled: [] };
  }
}

function writeState(state: PluginState): void {
  const filePath = statePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function pluginRoots(): Array<{ path: string; source: CapabilityPluginStatus["source"] }> {
  const roots = [
    { path: path.join(REPO_ROOT, "plugins"), source: "bundled" as const },
    { path: path.join(DATA_DIR, "plugins"), source: "data" as const },
  ];
  const custom = (process.env.MY_MATE_PLUGIN_DIRS || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ path: path.resolve(item), source: "custom" as const }));
  return [...roots, ...custom];
}

function publicStatus(plugin: DiscoveredPlugin): CapabilityPluginStatus {
  const unsupported = !["control-plane", "desktop", "browser"].includes(plugin.manifest.runtime);
  return {
    plugin_id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    source: plugin.source,
    root_path: plugin.rootPath,
    manifest_path: plugin.manifestPath,
    runtime: plugin.manifest.runtime,
    enabled: plugin.enabled,
    loaded: plugin.loaded,
    status: plugin.error ? "error" : unsupported ? "unsupported" : plugin.loaded ? "ready" : "disabled",
    error: plugin.error,
    capabilities: structuredClone(plugin.manifest.capabilities),
  };
}

export class CapabilityPluginHost {
  private readonly plugins = new Map<string, DiscoveredPlugin>();
  private discovered = false;

  discover(): CapabilityPluginStatus[] {
    const state = readState();
    const enabled = new Set(state.enabled);
    const disabled = new Set(state.disabled);
    for (const pluginId of this.plugins.keys()) getCapabilityRegistry().unregisterPlugin(pluginId);
    this.plugins.clear();
    for (const root of pluginRoots()) {
      if (!fs.existsSync(root.path)) continue;
      const rootPath = fs.realpathSync(root.path);
      const directories = fs.readdirSync(rootPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => path.join(rootPath, entry.name));
      for (const directory of directories) {
        const manifestPath = path.join(directory, MANIFEST_NAME);
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = readManifest(manifestPath);
          if (this.plugins.has(manifest.id)) {
            throw new Error(`Duplicate plugin id ${manifest.id}.`);
          }
          const isEnabled = disabled.has(manifest.id)
            ? false
            : enabled.has(manifest.id) || (root.source === "bundled" && manifest.enabled_by_default === true);
          this.plugins.set(manifest.id, {
            manifest,
            source: root.source,
            rootPath: directory,
            manifestPath,
            enabled: isEnabled,
            loaded: false,
            error: null,
          });
        } catch (error) {
          const fallbackId = `invalid.${path.basename(directory).toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
          this.plugins.set(fallbackId, {
            manifest: {
              schema_version: 1,
              id: fallbackId,
              name: path.basename(directory),
              version: "0.0.0",
              description: "Invalid capability plugin manifest.",
              runtime: "control-plane",
              capabilities: [],
            },
            source: root.source,
            rootPath: directory,
            manifestPath,
            enabled: false,
            loaded: false,
            error: error instanceof Error ? error.message : "Plugin manifest could not be read.",
          });
        }
      }
    }
    this.discovered = true;
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled && !plugin.loaded && !plugin.error) this.load(plugin.manifest.id);
    }
    return this.listPlugins();
  }

  ensureDiscovered(): void {
    if (!this.discovered) this.discover();
  }

  listPlugins(): CapabilityPluginStatus[] {
    this.ensureDiscovered();
    return [...this.plugins.values()]
      .map(publicStatus)
      .sort((left, right) => left.plugin_id.localeCompare(right.plugin_id));
  }

  setEnabled(pluginId: string, enabled: boolean): CapabilityPluginStatus {
    this.ensureDiscovered();
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Capability plugin ${pluginId} was not found.`);
    if (enabled && !["control-plane", "desktop", "browser"].includes(plugin.manifest.runtime)) {
      throw new Error(`Capability plugin ${pluginId} requires the ${plugin.manifest.runtime} host.`);
    }
    const state = readState();
    const enabledSet = new Set(state.enabled);
    const disabledSet = new Set(state.disabled);
    if (enabled) {
      enabledSet.add(pluginId);
      disabledSet.delete(pluginId);
    } else {
      enabledSet.delete(pluginId);
      disabledSet.add(pluginId);
    }
    writeState({ schema_version: 1, enabled: [...enabledSet].sort(), disabled: [...disabledSet].sort() });
    plugin.enabled = enabled;
    plugin.error = null;
    if (enabled) this.load(pluginId);
    else {
      getCapabilityRegistry().unregisterPlugin(pluginId);
      plugin.loaded = false;
    }
    return publicStatus(plugin);
  }

  private load(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.enabled || plugin.loaded) return;
    if (!["control-plane", "desktop", "browser"].includes(plugin.manifest.runtime)) return;
    if (plugin.manifest.runtime !== "control-plane") {
      try {
        for (const capability of plugin.manifest.capabilities) {
          const descriptor = {
            capability_id: capability.id,
            plugin_id: pluginId,
            name: capability.name,
            description: capability.description,
            version: plugin.manifest.version,
            risk_level: capability.risk_level,
            permission_scopes: capability.permission_scopes,
            executor: capability.executor,
            metadata: { ...(plugin.manifest.metadata || {}), ...(capability.metadata || {}) },
          };
          if (capability.kind === "tool" && capability.input_schema) {
            if (capability.executor !== plugin.manifest.runtime) {
              throw new Error(
                `Plugin ${pluginId} tool ${capability.id} must use its ${plugin.manifest.runtime} executor.`,
              );
            }
            getCapabilityRegistry().registerRemoteTool({
              descriptor,
              input_schema: capability.input_schema,
              timeout_ms: capability.timeout_ms,
              progress_label: capability.progress_label,
            });
          } else {
            getCapabilityRegistry().registerCapability({
              ...descriptor,
              kind: capability.kind,
              enabled: true,
            });
          }
        }
        plugin.loaded = true;
        plugin.error = null;
      } catch (error) {
        getCapabilityRegistry().unregisterPlugin(pluginId);
        plugin.loaded = false;
        plugin.error = error instanceof Error ? error.message : `Plugin ${pluginId} could not be loaded.`;
      }
      return;
    }
    const entrypoint = plugin.manifest.entrypoint || "";
    try {
      let moduleValue: Partial<CapabilityPluginModule>;
      if (entrypoint.startsWith("builtin:")) {
        if (plugin.source !== "bundled" || entrypoint !== `builtin:${pluginId}`) {
          throw new Error(`Plugin ${pluginId} cannot use the bundled entrypoint ${entrypoint}.`);
        }
        moduleValue = getBundledPluginModule(pluginId) || {};
      } else {
        const candidate = path.resolve(plugin.rootPath, entrypoint);
        const relative = path.relative(plugin.rootPath, candidate);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new Error(`Plugin ${pluginId} entrypoint must stay inside the plugin directory.`);
        }
        const realEntrypoint = fs.realpathSync(candidate);
        const realRelative = path.relative(fs.realpathSync(plugin.rootPath), realEntrypoint);
        if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
          throw new Error(`Plugin ${pluginId} entrypoint escapes its plugin directory.`);
        }
        delete require.cache[realEntrypoint];
        moduleValue = require(realEntrypoint) as Partial<CapabilityPluginModule>;
      }
      if (typeof moduleValue.register !== "function") {
        throw new Error(`Plugin ${pluginId} must export register(context).`);
      }
      const declared = new Map(plugin.manifest.capabilities.map((capability) => [capability.id, capability]));
      const registered = new Set<string>();
      const descriptor = (capability: CapabilityPluginManifestCapability): Omit<CapabilityDescriptor, "kind" | "enabled"> => ({
        capability_id: capability.id,
        plugin_id: pluginId,
        name: capability.name,
        description: capability.description,
        version: plugin.manifest.version,
        risk_level: capability.risk_level,
        permission_scopes: capability.permission_scopes,
        executor: capability.executor,
        metadata: { ...(plugin.manifest.metadata || {}), ...(capability.metadata || {}) },
      });
      const context: CapabilityPluginContext = Object.freeze({
        registerTool: (capabilityId: string, handler: CapabilityToolHandler) => {
          const capability = declared.get(capabilityId);
          if (!capability || capability.kind !== "tool" || !capability.input_schema) {
            throw new Error(`Plugin ${pluginId} tried to register undeclared tool ${capabilityId}.`);
          }
          const result = getCapabilityRegistry().registerTool({
            descriptor: descriptor(capability),
            input_schema: capability.input_schema,
            handler,
            timeout_ms: capability.timeout_ms,
            progress_label: capability.progress_label,
          });
          registered.add(capabilityId);
          return result;
        },
        registerCapability: (capabilityId: string) => {
          const capability = declared.get(capabilityId);
          if (!capability || capability.kind === "tool") {
            throw new Error(`Plugin ${pluginId} tried to register undeclared capability ${capabilityId}.`);
          }
          const result = getCapabilityRegistry().registerCapability({
            ...descriptor(capability),
            kind: capability.kind,
            enabled: true,
          });
          registered.add(capabilityId);
          return result;
        },
      });
      moduleValue.register(context);
      const missing = plugin.manifest.capabilities
        .map((capability) => capability.id)
        .filter((capabilityId) => !registered.has(capabilityId));
      if (missing.length) throw new Error(`Plugin ${pluginId} did not register: ${missing.join(", ")}.`);
      plugin.loaded = true;
      plugin.error = null;
    } catch (error) {
      getCapabilityRegistry().unregisterPlugin(pluginId);
      plugin.loaded = false;
      plugin.error = error instanceof Error ? error.message : `Plugin ${pluginId} could not be loaded.`;
    }
  }

  resetForTests(): void {
    for (const pluginId of this.plugins.keys()) getCapabilityRegistry().unregisterPlugin(pluginId);
    this.plugins.clear();
    this.discovered = false;
  }
}

const pluginHost = new CapabilityPluginHost();

export function getCapabilityPluginHost(): CapabilityPluginHost {
  return pluginHost;
}

export function initializeCapabilityPluginHost(): CapabilityPluginStatus[] {
  return pluginHost.discover();
}
