const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ServiceSupervisor } = require("../src/service-supervisor.cjs");
const { BrowserCapabilityHost } = require("../src/browser-capability.cjs");
const {
  applicationExecutableLabel,
  selectInstalledApplication,
} = require("../src/application-capability.cjs");
const {
  canonicalDirectory,
  listWorkspaceDirectory,
  readWorkspaceText,
} = require("../src/workspace-capability.cjs");

const STUDIO_URL = process.env.MY_MATE_DESKTOP_STUDIO_URL || "http://127.0.0.1:6374/";
const STUDIO_ORIGIN = new URL(STUDIO_URL).origin;
const repoRoot = path.resolve(__dirname, "..", "..", "..");
let desktopInstanceId = process.env.MY_MATE_DESKTOP_INSTANCE_ID || "";
let desktopBridgeToken = process.env.MY_MATE_DESKTOP_BRIDGE_TOKEN || "";
let supervisor = null;
let mainWindow = null;
let browserCapabilityHost = null;
let workspaceGrant = null;
let workspaceProjects = [];
let quitting = false;
const execFileAsync = promisify(execFile);

function workspaceStatePath() {
  return path.join(app.getPath("userData"), "workspace-grant.json");
}

function workspaceProjectsStatePath() {
  return path.join(app.getPath("userData"), "workspace-projects.json");
}

function desktopIdentityPath() {
  return path.join(app.getPath("userData"), "desktop-identity.json");
}

async function restoreDesktopIdentity() {
  if (desktopInstanceId && desktopBridgeToken) return;
  try {
    const parsed = JSON.parse(await fs.promises.readFile(desktopIdentityPath(), "utf8"));
    desktopInstanceId = typeof parsed.desktopInstanceId === "string" && parsed.desktopInstanceId
      ? parsed.desktopInstanceId
      : randomUUID();
    desktopBridgeToken = typeof parsed.desktopBridgeToken === "string" && parsed.desktopBridgeToken
      ? parsed.desktopBridgeToken
      : randomBytes(32).toString("base64url");
  } catch {
    desktopInstanceId ||= randomUUID();
    desktopBridgeToken ||= randomBytes(32).toString("base64url");
  }
  await fs.promises.mkdir(path.dirname(desktopIdentityPath()), { recursive: true });
  await fs.promises.writeFile(
    desktopIdentityPath(),
    JSON.stringify({ desktopInstanceId, desktopBridgeToken }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
}

function publicWorkspaceGrant() {
  if (!workspaceGrant) return null;
  return {
    capabilityId: workspaceGrant.capabilityId,
    projectId: workspaceGrant.projectId,
    registeredProjectId: workspaceGrant.registeredProjectId || null,
    name: path.basename(workspaceGrant.rootPath),
    displayName: workspaceGrant.name || path.basename(workspaceGrant.rootPath),
    description: workspaceGrant.description || null,
    outputRelativePath: workspaceGrant.outputRelativePath || "outputs",
    rootPath: workspaceGrant.rootPath,
    readOnly: true,
  };
}

function publicWorkspaceProjects() {
  return workspaceProjects.map((project) => ({
    projectId: project.projectId,
    registeredProjectId: project.registeredProjectId || null,
    name: project.name || path.basename(project.rootPath),
    description: project.description || null,
    outputRelativePath: project.outputRelativePath || "outputs",
    rootPath: project.rootPath,
    active: workspaceGrant?.projectId === project.projectId,
    archived: project.archived === true,
    createdAt: project.createdAt || null,
  }));
}

function activateWorkspaceProject(project) {
  workspaceGrant = project || null;
  return publicWorkspaceGrant();
}

function upsertWorkspaceProject(input) {
  const existingIndex = workspaceProjects.findIndex((project) => project.rootPath === input.rootPath);
  const existing = existingIndex >= 0 ? workspaceProjects[existingIndex] : null;
  const project = {
    projectId: existing?.projectId || input.projectId || randomUUID(),
    registeredProjectId: input.registeredProjectId || existing?.registeredProjectId || null,
    capabilityId: input.capabilityId || existing?.capabilityId || randomUUID(),
    rootPath: input.rootPath,
    name: input.name || existing?.name || path.basename(input.rootPath),
    description: input.description ?? existing?.description ?? null,
    outputRelativePath: input.outputRelativePath || existing?.outputRelativePath || "outputs",
    archived: false,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  if (existingIndex >= 0) workspaceProjects[existingIndex] = project;
  else workspaceProjects.push(project);
  activateWorkspaceProject(project);
  return project;
}

async function restoreWorkspaceGrant() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(workspaceProjectsStatePath(), "utf8"));
    const restored = [];
    for (const candidate of Array.isArray(parsed.projects) ? parsed.projects : []) {
      try {
        const rootPath = await canonicalDirectory(candidate.rootPath);
        restored.push({
          projectId: typeof candidate.projectId === "string" && candidate.projectId ? candidate.projectId : randomUUID(),
          registeredProjectId: typeof candidate.registeredProjectId === "string" ? candidate.registeredProjectId : null,
          capabilityId: typeof candidate.capabilityId === "string" && candidate.capabilityId ? candidate.capabilityId : randomUUID(),
          rootPath,
          name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : path.basename(rootPath),
          description: typeof candidate.description === "string" && candidate.description.trim() ? candidate.description.trim() : null,
          outputRelativePath: typeof candidate.outputRelativePath === "string" && candidate.outputRelativePath.trim() ? candidate.outputRelativePath.trim() : "outputs",
          archived: candidate.archived === true,
          createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
        });
      } catch {}
    }
    workspaceProjects = restored;
    workspaceGrant = restored.find((project) => project.projectId === parsed.activeProjectId && !project.archived) ||
      restored.find((project) => !project.archived) || null;
    return;
  } catch {}
  try {
    const parsed = JSON.parse(await fs.promises.readFile(workspaceStatePath(), "utf8"));
    const rootPath = await canonicalDirectory(parsed.rootPath);
    workspaceGrant = {
      projectId: randomUUID(),
      registeredProjectId: null,
      capabilityId:
        typeof parsed.capabilityId === "string" && parsed.capabilityId ? parsed.capabilityId : randomUUID(),
      rootPath,
      name: path.basename(rootPath),
      description: null,
      outputRelativePath: "outputs",
      archived: false,
      createdAt: new Date().toISOString(),
    };
    workspaceProjects = [workspaceGrant];
  } catch {
    workspaceGrant = null;
    workspaceProjects = [];
  }
}

async function persistWorkspaceGrant() {
  const statePath = workspaceStatePath();
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  if (workspaceGrant) {
    await fs.promises.writeFile(statePath, JSON.stringify({
      capabilityId: workspaceGrant.capabilityId,
      rootPath: workspaceGrant.rootPath,
    }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  } else {
    await fs.promises.unlink(statePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  await fs.promises.writeFile(workspaceProjectsStatePath(), JSON.stringify({
    activeProjectId: workspaceGrant?.projectId || null,
    projects: workspaceProjects,
  }, null, 2), { encoding: "utf8", mode: 0o600 });
}

function validateProjectDirectoryName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|\0]/u.test(name)) {
    const error = new Error("Enter a valid folder name without path separators.");
    error.code = "invalid-project-name";
    throw error;
  }
  return name;
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || "";
  let origin = "";
  try { origin = new URL(senderUrl).origin; } catch {}
  if (origin !== STUDIO_ORIGIN) throw new Error("Desktop capability request came from an untrusted origin.");
}

function requireWorkspace(event, request) {
  assertTrustedSender(event);
  if (!workspaceGrant || request?.capabilityId !== workspaceGrant.capabilityId) {
    const error = new Error("Workspace capability is missing or expired. Select the folder again.");
    error.code = "invalid-capability";
    throw error;
  }
  return workspaceGrant;
}

async function desktopControlPlaneRequest(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:6372${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${desktopBridgeToken}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(body?.message || `Desktop workspace request failed (${response.status}).`);
    error.code = body?.code || "desktop-bridge-failed";
    throw error;
  }
  return body;
}

async function reportDesktopConversationAction(sessionId, actionId, result) {
  return await desktopControlPlaneRequest(
    `/api/internal/desktop/sessions/${encodeURIComponent(sessionId)}/conversation-actions/${encodeURIComponent(actionId)}/result`,
    { method: "POST", body: JSON.stringify(result) },
  );
}

async function executeDesktopCapability(request) {
  const sessionId = typeof request?.sessionId === "string" ? request.sessionId.trim() : "";
  const actionId = typeof request?.actionId === "string" ? request.actionId.trim() : "";
  const capabilityId = typeof request?.capabilityId === "string" ? request.capabilityId.trim() : "";
  const executor = request?.executor === "browser" ? "browser" : request?.executor === "desktop" ? "desktop" : "";
  if (!sessionId || !actionId || !capabilityId || !executor) {
    throw new Error("A valid Session, Action, capability, and executor are required.");
  }
  let report;
  try {
    if (executor !== "browser" || !browserCapabilityHost) {
      const error = new Error(`Desktop executor ${executor || "unknown"} does not host ${capabilityId}.`);
      error.code = "desktop_capability_unsupported";
      throw error;
    }
    const result = await browserCapabilityHost.execute({
      sessionId,
      capabilityId,
      riskLevel: request?.riskLevel,
      arguments: request?.arguments,
    });
    report = {
      status: "succeeded",
      capability_id: capabilityId,
      result,
    };
  } catch (error) {
    report = {
      status: "failed",
      capability_id: capabilityId,
      code: typeof error?.code === "string" ? error.code : "desktop_capability_failed",
      result: {
        message: error instanceof Error ? error.message : "Desktop capability failed.",
      },
    };
  }
  await reportDesktopConversationAction(sessionId, actionId, report);
  return report;
}

function redactedCapabilityArguments(value, depth = 0) {
  if (depth > 3) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => redactedCapabilityArguments(item, depth + 1));
  if (!value || typeof value !== "object") {
    return typeof value === "string" && value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 30)) {
    output[key] = /(?:password|secret|token|api.?key|credential|authorization|cookie)/iu.test(key)
      ? "[redacted]"
      : redactedCapabilityArguments(child, depth + 1);
  }
  return output;
}

async function approveDesktopCapability(request) {
  const sessionId = typeof request?.sessionId === "string" ? request.sessionId.trim() : "";
  const actionId = typeof request?.actionId === "string" ? request.actionId.trim() : "";
  const capabilityId = typeof request?.capabilityId === "string" ? request.capabilityId.trim() : "";
  const riskLevel = request?.riskLevel === "T3" ? "T3" : "T2";
  if (!sessionId || !actionId || !capabilityId || request?.executor !== "mcp") {
    throw new Error("A valid MCP capability approval request is required.");
  }
  const argumentsPreview = JSON.stringify(redactedCapabilityArguments(request?.arguments || {}), null, 2).slice(0, 1800);
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: riskLevel === "T3" ? "error" : "warning",
    title: riskLevel === "T3" ? "Approve destructive MCP action" : "Approve MCP action",
    message: `Allow My Mate to run ${capabilityId}?`,
    detail: `Risk: ${riskLevel}\n\nArguments:\n${argumentsPreview || "{}"}\n\nThis approval applies only to this one Conversation Action.`,
    buttons: [riskLevel === "T3" ? "Approve destructive action" : "Approve action", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  const approved = confirmation.response === 0;
  const report = approved
    ? {
        status: "approved",
        capability_id: capabilityId,
        result: { approved: true },
      }
    : {
        status: "failed",
        capability_id: capabilityId,
        code: "mcp_action_denied",
        result: { message: `The user denied ${capabilityId}.` },
      };
  await reportDesktopConversationAction(sessionId, actionId, report);
  return report;
}

async function configureMcpServer(request) {
  const operation = ["upsert", "test", "enable"].includes(request?.operation) ? request.operation : "";
  const serverId = typeof request?.serverId === "string" ? request.serverId.trim() : "";
  const workspaceId = typeof request?.workspaceId === "string" && request.workspaceId.trim()
    ? request.workspaceId.trim()
    : "default";
  const config = request?.config && typeof request.config === "object" && !Array.isArray(request.config)
    ? request.config
    : null;
  if (!operation || (operation !== "upsert" && !serverId)) {
    throw new Error("A valid MCP configuration operation is required.");
  }
  if (operation === "upsert" && config?.transport !== "stdio") {
    throw new Error("Desktop confirmation is reserved for stdio MCP servers.");
  }
  const command = typeof config?.command === "string" ? config.command : "";
  const args = Array.isArray(config?.args) ? config.args.map(String).slice(0, 32) : [];
  const secretNames = config?.secrets && typeof config.secrets === "object" && !Array.isArray(config.secrets)
    ? Object.keys(config.secrets).slice(0, 32)
    : [];
  const target = operation === "upsert" ? config?.server_id || config?.name || "new stdio MCP server" : serverId;
  const detail = operation === "upsert"
    ? `Executable: ${command}\nArguments: ${args.join(" ") || "(none)"}\nSecrets: ${secretNames.join(", ") || "(none)"}\n\nThe process will run with your user account and only its discovered tools will be exposed to My Mate.`
    : `Server: ${target}\n\nThis will ${operation === "enable" ? "enable and start" : "start and test"} the configured local MCP process.`;
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Allow local MCP process",
    message: `${operation === "upsert" ? "Save and start" : operation === "enable" ? "Enable" : "Test"} ${target}?`,
    detail,
    buttons: ["Allow once", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (confirmation.response !== 0) {
    const error = new Error("The local MCP operation was cancelled.");
    error.code = "mcp_configuration_denied";
    throw error;
  }
  if (operation === "upsert") {
    return await desktopControlPlaneRequest("/api/internal/desktop/registry/mcp-servers", {
      method: "POST",
      body: JSON.stringify({ ...config, workspace_id: workspaceId }),
    });
  }
  return await desktopControlPlaneRequest(
    `/api/internal/desktop/registry/mcp-servers/${encodeURIComponent(serverId)}/${operation}`,
    { method: "POST", body: JSON.stringify({ workspace_id: workspaceId }) },
  );
}

async function findInstalledApplications(applicationName) {
  if (process.platform !== "win32") return [];
  const script = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    "$needle = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:MY_MATE_APPLICATION_QUERY_B64))",
    "@(Get-StartApps | Where-Object { $_.Name -like ('*' + $needle + '*') } | Select-Object -First 12 Name,AppID) | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      env: {
        ...process.env,
        MY_MATE_APPLICATION_QUERY_B64: Buffer.from(applicationName, "utf16le").toString("base64"),
      },
    },
  );
  const text = stdout.trim();
  const parsed = text ? JSON.parse(text) : [];
  const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return items.filter((item) => item && typeof item.Name === "string" && typeof item.AppID === "string");
}

async function openDesktopApplication(request) {
  const sessionId = typeof request?.sessionId === "string" ? request.sessionId.trim() : "";
  const actionId = typeof request?.actionId === "string" ? request.actionId.trim() : "";
  const requestedName = typeof request?.applicationName === "string" ? request.applicationName.trim() : "";
  if (!sessionId || !actionId || !requestedName || requestedName.length > 120) {
    throw new Error("A valid Session, Action, and application name are required.");
  }
  let result;
  try {
    const selection = selectInstalledApplication(
      await findInstalledApplications(requestedName),
      requestedName,
    );
    if (!selection.ok) {
      result = {
        status: "failed",
        code: selection.code,
        application_name: requestedName,
        message: selection.message,
      };
    } else {
      const selected = selection.item;
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Open Desktop application",
        message: `Allow My Mate to open ${selected.Name}?`,
        detail: `Registered executable: ${applicationExecutableLabel(selected)}. No command line supplied by the model will be executed.`,
        buttons: ["Open application", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) {
        result = {
          status: "failed",
          code: "desktop_application_denied",
          application_name: selected.Name,
          message: `Opening ${selected.Name} was cancelled by the user.`,
        };
      } else {
        await execFileAsync("explorer.exe", [`shell:AppsFolder\\${selected.AppID}`], {
          timeout: 10_000,
          windowsHide: true,
        });
        result = {
          status: "succeeded",
          application_name: selected.Name,
          message: `${selected.Name} was opened after Desktop confirmation.`,
        };
      }
    }
  } catch {
    result = {
      status: "failed",
      code: "desktop_application_open_failed",
      application_name: requestedName,
      message: `${requestedName} could not be opened by My Mate Desktop.`,
    };
  }
  await reportDesktopConversationAction(sessionId, actionId, result);
  return result;
}

async function registerWorkspaceProject(project) {
  if (!project || project.archived || project.registeredProjectId) return project;
  const response = await desktopControlPlaneRequest("/api/internal/desktop/projects", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: "default",
      desktop_instance_id: desktopInstanceId,
      capability_id: project.capabilityId,
      root_path: project.rootPath,
      name: project.name || path.basename(project.rootPath),
      description: project.description || null,
      default_output_relative_path: project.outputRelativePath || "outputs",
    }),
  });
  if (response?.project?.project_id) {
    project.registeredProjectId = response.project.project_id;
  }
  return project;
}

async function bindSessionToWorkspaceProject(project, sessionId) {
  const requestBinding = (includeProjectId) => desktopControlPlaneRequest(
    "/api/internal/desktop/workspace-bindings",
    {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionId,
        desktop_instance_id: desktopInstanceId,
        capability_id: project.capabilityId,
        root_path: project.rootPath,
        display_name: project.name || path.basename(project.rootPath),
        description: project.description || null,
        output_relative_path: project.outputRelativePath || "outputs",
        ...(includeProjectId && project.registeredProjectId
          ? { project_id: project.registeredProjectId }
          : {}),
        access: "snapshot-read",
        scope: "session",
      }),
    },
  );
  let response;
  try {
    response = await requestBinding(true);
  } catch (error) {
    if (
      !project.registeredProjectId ||
      !["local_project_root_mismatch", "local_project_capability_mismatch"].includes(error?.code)
    ) throw error;
    project.registeredProjectId = null;
    response = await requestBinding(false);
  }
  if (response?.project?.project_id) project.registeredProjectId = response.project.project_id;
  await persistWorkspaceGrant();
  return response;
}

function registerIpcHandlers() {
  ipcMain.handle("my-mate:host:info", (event) => {
    assertTrustedSender(event);
    return { platform: process.platform, desktop: true, version: app.getVersion(), workspaceMode: "read-only" };
  });
  ipcMain.handle("my-mate:services:status", (event) => {
    assertTrustedSender(event);
    return supervisor?.snapshot() || [];
  });
  ipcMain.handle("my-mate:application:open", async (event, request) => {
    assertTrustedSender(event);
    return await openDesktopApplication(request);
  });
  ipcMain.handle("my-mate:capability:execute", async (event, request) => {
    assertTrustedSender(event);
    return await executeDesktopCapability(request);
  });
  ipcMain.handle("my-mate:capability:approve", async (event, request) => {
    assertTrustedSender(event);
    return await approveDesktopCapability(request);
  });
  ipcMain.handle("my-mate:mcp:configure", async (event, request) => {
    assertTrustedSender(event);
    return await configureMcpServer(request);
  });
  ipcMain.handle("my-mate:workspace:get", (event) => {
    assertTrustedSender(event);
    return publicWorkspaceGrant();
  });
  ipcMain.handle("my-mate:workspace:projects", async (event) => {
    assertTrustedSender(event);
    let changed = false;
    for (const project of workspaceProjects) {
      if (project.archived || project.registeredProjectId) continue;
      try {
        await registerWorkspaceProject(project);
        changed = changed || !!project.registeredProjectId;
      } catch {}
    }
    if (changed) await persistWorkspaceGrant();
    return { items: publicWorkspaceProjects(), activeProjectId: workspaceGrant?.projectId || null };
  });
  ipcMain.handle("my-mate:workspace:choose", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a My Mate workspace",
      defaultPath: workspaceGrant?.rootPath || repoRoot,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return publicWorkspaceGrant();
    const rootPath = await canonicalDirectory(result.filePaths[0]);
    const project = upsertWorkspaceProject({ capabilityId: randomUUID(), rootPath });
    await persistWorkspaceGrant();
    try {
      await registerWorkspaceProject(project);
      await persistWorkspaceGrant();
    } catch {}
    return publicWorkspaceGrant();
  });
  ipcMain.handle("my-mate:workspace:create", async (event, request) => {
    assertTrustedSender(event);
    const name = validateProjectDirectoryName(request?.name);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose where to create the My Mate project",
      defaultPath: workspaceGrant?.rootPath ? path.dirname(workspaceGrant.rootPath) : repoRoot,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return publicWorkspaceGrant();
    const parent = await canonicalDirectory(result.filePaths[0]);
    const rootPath = path.resolve(parent, name);
    const relation = path.relative(parent, rootPath);
    if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
      throw new Error("Project directory escapes the selected parent.");
    }
    if (fs.existsSync(rootPath)) throw new Error("A folder with this name already exists.");
    await fs.promises.mkdir(rootPath, { recursive: false });
    const project = upsertWorkspaceProject({
      capabilityId: randomUUID(),
      rootPath: await canonicalDirectory(rootPath),
      name,
      description: typeof request?.description === "string" ? request.description.trim() : null,
      outputRelativePath: typeof request?.outputRelativePath === "string" && request.outputRelativePath.trim()
        ? request.outputRelativePath.trim()
        : "outputs",
    });
    await persistWorkspaceGrant();
    try {
      await registerWorkspaceProject(project);
      await persistWorkspaceGrant();
    } catch {}
    return publicWorkspaceGrant();
  });
  ipcMain.handle("my-mate:workspace:select", async (event, request) => {
    assertTrustedSender(event);
    const projectId = typeof request?.projectId === "string" ? request.projectId : "";
    const registeredProjectId = typeof request?.registeredProjectId === "string" ? request.registeredProjectId : "";
    const project = workspaceProjects.find((item) =>
      !item.archived && (item.projectId === projectId || (registeredProjectId && item.registeredProjectId === registeredProjectId)));
    if (!project) throw new Error("Local Project is unavailable on this Desktop.");
    activateWorkspaceProject(project);
    await persistWorkspaceGrant();
    return publicWorkspaceGrant();
  });
  ipcMain.handle("my-mate:workspace:move-task", async (event, request) => {
    assertTrustedSender(event);
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId.trim() : "";
    const projectId = typeof request?.projectId === "string" ? request.projectId.trim() : "";
    if (!sessionId || !projectId) throw new Error("A Task and target Workspace are required.");
    const project = workspaceProjects.find((item) => item.projectId === projectId && !item.archived);
    if (!project) throw new Error("The target Workspace is unavailable on this Desktop.");
    const response = await bindSessionToWorkspaceProject(project, sessionId);
    if (request?.activate === true) {
      activateWorkspaceProject(project);
      await persistWorkspaceGrant();
    }
    return {
      ...response,
      workspace: publicWorkspaceGrant(),
      projects: publicWorkspaceProjects(),
    };
  });
  ipcMain.handle("my-mate:workspace:archive-project", async (event, request) => {
    assertTrustedSender(event);
    const projectId = typeof request?.projectId === "string" ? request.projectId : "";
    const project = workspaceProjects.find((item) => item.projectId === projectId);
    if (!project) throw new Error("Local Project not found.");
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Archive local project",
      message: `Archive ${project.name || path.basename(project.rootPath)} from My Mate?`,
      detail: "The physical folder and all files will remain on disk.",
      buttons: ["Archive reference", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) {
      return { items: publicWorkspaceProjects(), activeProjectId: workspaceGrant?.projectId || null };
    }
    if (project.registeredProjectId) {
      await desktopControlPlaneRequest(`/api/internal/desktop/projects/${encodeURIComponent(project.registeredProjectId)}/archive`, {
        method: "POST",
        body: "{}",
      });
    }
    project.archived = true;
    if (workspaceGrant?.projectId === project.projectId) {
      workspaceGrant = workspaceProjects.find((item) => !item.archived) || null;
    }
    await persistWorkspaceGrant();
    return { items: publicWorkspaceProjects(), activeProjectId: workspaceGrant?.projectId || null };
  });
  ipcMain.handle("my-mate:workspace:list", async (event, request) => {
    const grant = requireWorkspace(event, request);
    return await listWorkspaceDirectory(grant.rootPath, request?.relativePath || "");
  });
  ipcMain.handle("my-mate:workspace:read-text", async (event, request) => {
    const grant = requireWorkspace(event, request);
    return await readWorkspaceText(grant.rootPath, request?.relativePath || "");
  });
  ipcMain.handle("my-mate:workspace:authorize", async (event, request) => {
    const grant = requireWorkspace(event, request);
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId.trim() : "";
    const access = request?.access === "sandbox-write" ? "sandbox-write" : "snapshot-read";
    const scope = request?.scope === "run" || request?.scope === "persistent" ? request.scope : "session";
    if (!sessionId) throw new Error("A Session is required before authorizing a local workspace.");
    if (access === "sandbox-write") {
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Allow isolated workspace changes",
        message: `Allow this task to modify an isolated Docker copy of ${path.basename(grant.rootPath)}?`,
        detail: "The original folder will not be changed until you review and apply the generated diff.",
        buttons: ["Allow for this task", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) {
        const error = new Error("Workspace authorization was cancelled.");
        error.code = "workspace-authorization-cancelled";
        throw error;
      }
    }
    const response = await desktopControlPlaneRequest("/api/internal/desktop/workspace-bindings", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionId,
        desktop_instance_id: desktopInstanceId,
        capability_id: grant.capabilityId,
        root_path: grant.rootPath,
        display_name: grant.name || path.basename(grant.rootPath),
        description: grant.description || null,
        output_relative_path: grant.outputRelativePath || "outputs",
        ...(grant.registeredProjectId ? { project_id: grant.registeredProjectId } : {}),
        access,
        scope,
      }),
    });
    if (response?.project?.project_id) {
      grant.registeredProjectId = response.project.project_id;
      await persistWorkspaceGrant();
    }
    return response;
  });
  ipcMain.handle("my-mate:workspace:revoke", async (event, request) => {
    requireWorkspace(event, request);
    const bindingId = typeof request?.bindingId === "string" ? request.bindingId.trim() : "";
    if (!bindingId) throw new Error("Workspace Binding id is required.");
    return await desktopControlPlaneRequest(
      `/api/internal/desktop/workspace-bindings/${encodeURIComponent(bindingId)}/revoke`,
      { method: "POST", body: "{}" },
    );
  });
  ipcMain.handle("my-mate:workspace:apply-change-set", async (event, request) => {
    const grant = requireWorkspace(event, request);
    const changeSetId = typeof request?.changeSetId === "string" ? request.changeSetId.trim() : "";
    if (!changeSetId) throw new Error("Workspace Change Set id is required.");
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Apply reviewed workspace changes",
      message: `Write the reviewed changes to ${path.basename(grant.rootPath)}?`,
      detail: "My Mate will revalidate the source files and roll back completed writes if a later file fails.",
      buttons: ["Apply changes", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) {
      const error = new Error("Workspace change application was cancelled.");
      error.code = "workspace-apply-cancelled";
      throw error;
    }
    return await desktopControlPlaneRequest(
      `/api/internal/desktop/workspace-change-sets/${encodeURIComponent(changeSetId)}/apply`,
      {
        method: "POST",
        body: JSON.stringify({
          desktop_instance_id: desktopInstanceId,
          capability_id: grant.capabilityId,
          comment: "Reviewed and applied in My Mate Desktop",
        }),
      },
    );
  });
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function createMainWindow() {
  const window = new BrowserWindow({
    title: "My Mate Studio",
    width: 1480,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#f5f7fa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (["https:", "http:"].includes(new URL(url).protocol)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== STUDIO_ORIGIN) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { mainWindow = null; });
  void window.loadURL(STUDIO_URL);
  return window;
}

app.whenReady().then(async () => {
  await restoreDesktopIdentity();
  browserCapabilityHost = new BrowserCapabilityHost({
    app,
    BrowserWindow,
    session,
    dialog,
    getParentWindow: () => mainWindow,
  });
  supervisor = new ServiceSupervisor({ repoRoot, desktopBridgeToken, desktopInstanceId });
  supervisor.on("status", (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("my-mate:services:status", status);
  });
  configureSessionSecurity();
  registerIpcHandlers();
  await restoreWorkspaceGrant();
  try {
    await supervisor.startAll();
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "My Mate could not start",
      message: error instanceof Error ? error.message : String(error),
      detail: "Check the local service configuration and try again.",
    });
    app.quit();
    return;
  }
  mainWindow = createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
  void browserCapabilityHost?.closeAll({ terminateUserBrowsers: true });
  supervisor?.stopAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || quitting) app.quit();
});
