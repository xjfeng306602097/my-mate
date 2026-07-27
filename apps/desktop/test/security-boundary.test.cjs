const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.cjs"), "utf8");

test("BrowserWindow keeps the Studio renderer sandboxed", () => {
  assert.match(mainSource, /contextIsolation:\s*true/u);
  assert.match(mainSource, /sandbox:\s*true/u);
  assert.match(mainSource, /nodeIntegration:\s*false/u);
  assert.match(mainSource, /webSecurity:\s*true/u);
  assert.match(mainSource, /setPermissionRequestHandler/u);
  assert.match(mainSource, /setWindowOpenHandler/u);
  assert.match(mainSource, /assertTrustedSender/u);
});

test("preload exposes named operations without arbitrary IPC or shell access", () => {
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\("myMateDesktop"/u);
  assert.match(preloadSource, /workspace: Object\.freeze/u);
  assert.match(preloadSource, /capability: Object\.freeze/u);
  assert.match(preloadSource, /my-mate:capability:execute/u);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.send\([^"']/u);
  assert.doesNotMatch(preloadSource, /child_process|shell\.open|require\("node:fs/u);
});

test("browser capabilities stay behind the typed Desktop host", () => {
  assert.match(mainSource, /new BrowserCapabilityHost/u);
  assert.match(mainSource, /my-mate:capability:execute/u);
  assert.match(mainSource, /reportDesktopConversationAction/u);
  assert.doesNotMatch(preloadSource, /debugger|remote-debugging|executeJavaScript|WebSocket/u);
});

test("stdio MCP configuration stays behind Desktop confirmation", () => {
  assert.match(preloadSource, /mcp: Object\.freeze/u);
  assert.match(preloadSource, /my-mate:mcp:configure/u);
  assert.match(mainSource, /async function configureMcpServer/u);
  assert.match(mainSource, /Allow local MCP process/u);
  assert.match(mainSource, /\/api\/internal\/desktop\/registry\/mcp-servers/u);
});

test("Desktop Projects register before a task requests workspace access", () => {
  assert.match(mainSource, /async function registerWorkspaceProject/u);
  assert.match(mainSource, /\/api\/internal\/desktop\/projects/u);
  assert.match(mainSource, /my-mate:workspace:projects", async/u);
  assert.match(mainSource, /await registerWorkspaceProject\(project\)/u);
});

test("task reassignment stays behind the trusted Desktop workspace bridge", () => {
  assert.match(mainSource, /my-mate:workspace:move-task/u);
  assert.match(mainSource, /async function bindSessionToWorkspaceProject/u);
  assert.match(mainSource, /options\.access === "sandbox-write" \? "sandbox-write" : "snapshot-read"/u);
  assert.match(mainSource, /projects: publicWorkspaceProjects\(\)/u);
  assert.match(mainSource, /workspace: publicWorkspaceGrant\(\)/u);
  assert.match(preloadSource, /moveTask: \(request\) => ipcRenderer\.invoke\("my-mate:workspace:move-task"/u);
});

test("external Workspace viewers stay capability-scoped and path validated", () => {
  assert.match(preloadSource, /openExternal: \(request\) => ipcRenderer\.invoke\("my-mate:workspace:open-external"/u);
  assert.match(mainSource, /my-mate:workspace:open-external/u);
  assert.match(mainSource, /requireWorkspace\(event, request\)/u);
  assert.match(mainSource, /resolveWithinRoot\(grant\.rootPath, relativePath/u);
  assert.match(mainSource, /\["editor", "explorer", "terminal", "open-with"\]/u);
  assert.match(mainSource, /shell32\.dll,OpenAs_RunDLL/u);
  assert.doesNotMatch(preloadSource, /execFile|spawn|powershell|explorer\.exe/u);
});

test("localhost Workspace previews stay capability-scoped and use the dedicated preview host", () => {
  assert.match(preloadSource, /preview: \(request\) => ipcRenderer\.invoke\("my-mate:workspace:preview"/u);
  assert.match(mainSource, /my-mate:workspace:preview/u);
  assert.match(mainSource, /workspacePreviewHost\.start/u);
  assert.match(mainSource, /requireWorkspace\(event, request\)/u);
  assert.match(mainSource, /workspacePreviewHost\.closeAll/u);
  assert.doesNotMatch(preloadSource, /createServer|127\.0\.0\.1|randomBytes/u);
});

test("workspace authorization repairs stale Desktop Project registrations", () => {
  assert.match(mainSource, /bindSessionToWorkspaceProject\(grant, sessionId, \{ access, scope \}\)/u);
  assert.match(mainSource, /async function reconcileWorkspaceProjects/u);
  assert.match(mainSource, /registerWorkspaceProject\(project, \{ refresh: true \}\)/u);
  assert.match(mainSource, /await reconcileWorkspaceProjects\(\)/u);
  assert.match(mainSource, /local_project_root_mismatch/u);
  assert.match(mainSource, /local_project_capability_mismatch/u);
  assert.match(mainSource, /project\.registeredProjectId = null/u);
});

test("application launch stays named, confirmed, and Desktop-attested", () => {
  assert.match(preloadSource, /application: Object\.freeze/u);
  assert.match(preloadSource, /my-mate:application:open/u);
  assert.match(mainSource, /async function openDesktopApplication/u);
  assert.match(mainSource, /Allow My Mate to open/u);
  assert.match(mainSource, /shell:AppsFolder/u);
  assert.match(mainSource, /conversation-actions\/\$\{encodeURIComponent\(actionId\)\}\/result/u);
  assert.doesNotMatch(preloadSource, /execFile|spawn|powershell|explorer\.exe/u);
});
