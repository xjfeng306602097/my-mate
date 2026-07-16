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
  assert.match(mainSource, /access: "snapshot-read"/u);
  assert.match(mainSource, /projects: publicWorkspaceProjects\(\)/u);
  assert.match(mainSource, /workspace: publicWorkspaceGrant\(\)/u);
  assert.match(preloadSource, /moveTask: \(request\) => ipcRenderer\.invoke\("my-mate:workspace:move-task"/u);
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
