const dns = require("node:dns");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");

const MAX_SNAPSHOT_ELEMENTS = 200;
const DEFAULT_SNAPSHOT_CHARS = 20_000;
const CDP_START_TIMEOUT_MS = 15_000;
const BROWSER_SNAPSHOT_TIMEOUT_MS = 30_000;
const CAPABILITY_IDS = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_back",
  "browser_close",
]);

function capabilityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function withTimeout(promise, timeoutMs, code, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(capabilityError(code, message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function isPrivateAddress(address) {
  const normalized = String(address || "").trim().toLowerCase().split("%")[0];
  if (net.isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (net.isIP(normalized) !== 6) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    return net.isIP(mapped) !== 4 || isPrivateIpv4(mapped);
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^(?:fe[89ab])/u.test(normalized) || normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:");
}

async function assertPublicBrowserUrl(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw capabilityError("browser_url_invalid", "Browser URL must be an absolute HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw capabilityError("browser_url_blocked", "Only credential-free public HTTP and HTTPS URLs are allowed.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw capabilityError("browser_url_private", "Local and private browser destinations are blocked.");
  }
  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await (options.lookup || dns.promises.lookup)(hostname, { all: true, verbatim: true }).catch(() => {
      throw capabilityError("browser_dns_failed", "Browser destination could not be resolved safely.");
    });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw capabilityError("browser_url_private", "Local, private, reserved, and non-routable browser destinations are blocked.");
  }
  return parsed;
}

function normalizeElementRef(value) {
  const ref = String(value || "").trim();
  if (!/^@e[1-9][0-9]{0,3}$/u.test(ref)) {
    throw capabilityError("browser_ref_invalid", "Browser element reference must come from the latest page snapshot.");
  }
  return ref.slice(1);
}

function snapshotScript(maxChars) {
  return `(() => {
    const maxChars = ${Math.max(1000, Math.min(50_000, Number(maxChars) || DEFAULT_SNAPSHOT_CHARS))};
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    document.querySelectorAll("[data-my-mate-ref]").forEach((element) => element.removeAttribute("data-my-mate-ref"));
    const selector = "a[href],button,input,textarea,select,[contenteditable=true],[role=button],[role=link],[role=checkbox],[role=tab]";
    const elements = [];
    for (const element of document.querySelectorAll(selector)) {
      if (visible(element)) elements.push(element);
      if (elements.length >= ${MAX_SNAPSHOT_ELEMENTS}) break;
    }
    const interactive = elements.map((element, index) => {
      const ref = "e" + (index + 1);
      element.setAttribute("data-my-mate-ref", ref);
      const role = element.getAttribute("role") || element.tagName.toLowerCase();
      const label = (element.getAttribute("aria-label") || element.innerText || element.getAttribute("placeholder") || element.getAttribute("name") || element.getAttribute("title") || element.value || "")
        .replace(/\\s+/g, " ").trim().slice(0, 240);
      const href = element instanceof HTMLAnchorElement ? element.href : "";
      const type = element.getAttribute("type") || "";
      return { ref: "@" + ref, role, label, href, type, disabled: Boolean(element.disabled) };
    });
    const contentRoot = document.querySelector("article,main,[role=main]") || document.body;
    const text = (contentRoot?.innerText || contentRoot?.textContent || "").replace(/\\n{3,}/g, "\\n\\n").trim();
    return {
      url: location.href,
      title: document.title || "",
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      interactive,
    };
  })()`;
}

function clickScript(ref) {
  return `(() => {
    const element = document.querySelector('[data-my-mate-ref="${ref}"]');
    if (!element) return { ok: false, code: "browser_ref_stale", message: "Element reference is stale; take a new snapshot." };
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { ok: true, tag: element.tagName.toLowerCase() };
  })()`;
}

function typeScript(ref, text) {
  const encodedText = JSON.stringify(String(text));
  return `(() => {
    const element = document.querySelector('[data-my-mate-ref="${ref}"]');
    if (!element) return { ok: false, code: "browser_ref_stale", message: "Element reference is stale; take a new snapshot." };
    const editable = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable;
    if (!editable) return { ok: false, code: "browser_ref_not_editable", message: "Referenced element is not editable." };
    element.focus();
    const value = ${encodedText};
    if (element.isContentEditable) element.textContent = value;
    else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value); else element.value = value;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, length: value.length };
  })()`;
}

class CdpClient {
  constructor(url, options = {}) {
    this.url = url;
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    if (this.socket) return;
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(capabilityError("browser_cdp_timeout", "Browser automation connection timed out.")), 10_000);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    socket.on("message", (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(capabilityError("browser_cdp_error", message.error.message || "Browser command failed."));
      else pending.resolve(message.result || {});
    });
    socket.on("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(capabilityError("browser_session_closed", "Browser session closed."));
      }
      this.pending.clear();
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => null);
  }

  send(method, params = {}, timeoutMs = 30_000) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) {
      return Promise.reject(capabilityError("browser_session_closed", "Browser session is not connected."));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(capabilityError("browser_command_timeout", `Browser command ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (response.exceptionDetails) throw capabilityError("browser_script_failed", "Browser page operation failed.");
    return response.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
    this.socket = null;
  }
}

function browserExecutableCandidates(mode, env = process.env) {
  const executable = mode === "edge" ? "msedge.exe" : "chrome.exe";
  const candidates = mode === "edge"
    ? [
        path.join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", executable),
        path.join(env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", executable),
        path.join(env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", executable),
      ]
    : [
        path.join(env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", executable),
        path.join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", executable),
        path.join(env.LOCALAPPDATA || "", "Google", "Chrome", "Application", executable),
      ];
  return [...new Set(candidates.filter(Boolean))];
}

function findBrowserExecutable(mode, fsImpl = fs) {
  return browserExecutableCandidates(mode).find((candidate) => fsImpl.existsSync(candidate)) || null;
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw capabilityError("browser_port_unavailable", "Could not reserve a local browser automation port.");
  return port;
}

async function waitForCdpPage(port, fetchImpl, timeoutMs = CDP_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = Array.isArray(pages) ? pages.find((item) => item?.type === "page" && item.webSocketDebuggerUrl) : null;
        if (page) return page;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw capabilityError("browser_launch_timeout", "Chrome/Edge did not expose its task-scoped automation connection in time.");
}

async function createCdpPage(port, url, fetchImpl) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!response.ok) throw capabilityError("browser_tab_create_failed", "Could not create a controlled Chrome/Edge tab.");
  const page = await response.json();
  if (!page?.webSocketDebuggerUrl) throw capabilityError("browser_tab_create_failed", "Chrome/Edge did not return a controlled tab.");
  return page;
}

class BrowserCapabilityHost {
  constructor(options) {
    this.BrowserWindow = options.BrowserWindow;
    this.electronSession = options.session;
    this.dialog = options.dialog;
    this.app = options.app;
    this.getParentWindow = options.getParentWindow || (() => null);
    this.fetchImpl = options.fetchImpl || fetch;
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.sessions = new Map();
    this.userBrowsers = new Map();
  }

  async execute(request) {
    const capabilityId = String(request?.capabilityId || "").trim();
    const sessionId = String(request?.sessionId || "").trim();
    const args = request?.arguments && typeof request.arguments === "object" && !Array.isArray(request.arguments)
      ? request.arguments
      : {};
    if (!CAPABILITY_IDS.has(capabilityId) || !sessionId) {
      throw capabilityError("browser_capability_invalid", "Browser capability request is invalid.");
    }
    if (capabilityId === "browser_navigate") return await this.navigate(sessionId, args);
    const browser = this.requireSession(sessionId, args.browser_session_id);
    if (capabilityId === "browser_snapshot") return await this.snapshot(browser, args.max_chars);
    if (capabilityId === "browser_click") return await this.click(browser, args.ref);
    if (capabilityId === "browser_type") return await this.type(browser, args.ref, args.text);
    if (capabilityId === "browser_back") return await this.back(browser);
    return await this.close(browser);
  }

  requireSession(ownerSessionId, browserSessionId) {
    const id = String(browserSessionId || "").trim();
    const browser = this.sessions.get(id);
    if (!browser || browser.ownerSessionId !== ownerSessionId) {
      throw capabilityError("browser_session_not_found", "Browser session is unavailable for this task.");
    }
    return browser;
  }

  async navigate(ownerSessionId, args) {
    const parsed = await assertPublicBrowserUrl(args.url);
    const requestedMode = ["chrome", "edge"].includes(args.mode) ? args.mode : "isolated";
    let browser = args.browser_session_id
      ? this.requireSession(ownerSessionId, args.browser_session_id)
      : null;
    if (browser && browser.mode !== requestedMode) {
      throw capabilityError("browser_mode_mismatch", "Browser session mode cannot be changed after creation.");
    }
    if (!browser) {
      browser = requestedMode === "isolated"
        ? await this.createIsolated(ownerSessionId)
        : await this.createUserBrowser(ownerSessionId, requestedMode, parsed.href);
      this.sessions.set(browser.id, browser);
    } else if (browser.mode !== "isolated" && new URL(browser.url || parsed.href).origin !== parsed.origin) {
      await this.confirm({
        title: `Allow ${browser.mode === "edge" ? "Edge" : "Chrome"} navigation`,
        message: `Allow this task to navigate the My Mate ${browser.mode === "edge" ? "Edge" : "Chrome"} profile to ${parsed.hostname}?`,
        detail: "The task can read the resulting page through browser snapshots.",
        approveLabel: "Navigate",
      });
    }
    await this.navigateSession(browser, parsed.href, args.read_only_extract === true);
    return await this.state(browser, { created: !args.browser_session_id });
  }

  async createIsolated(ownerSessionId) {
    const id = `browser_${randomUUID()}`;
    const partition = `my-mate-isolated-${randomUUID()}`;
    const isolatedSession = this.electronSession.fromPartition(partition, { cache: false });
    isolatedSession.setPermissionCheckHandler(() => false);
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolatedSession.on("will-download", (event) => event.preventDefault());
    isolatedSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
      void assertPublicBrowserUrl(details.url)
        .then(() => callback({ cancel: false }))
        .catch(() => callback({ cancel: true }));
    });
    const window = new this.BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      try {
        if (!["http:", "https:"].includes(new URL(url).protocol)) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    return { id, ownerSessionId, mode: "isolated", window, url: "", title: "" };
  }

  async createUserBrowser(ownerSessionId, mode, initialUrl) {
    const executable = findBrowserExecutable(mode);
    if (!executable) throw capabilityError("browser_not_installed", `${mode === "edge" ? "Microsoft Edge" : "Google Chrome"} is not installed.`);
    await this.confirm({
      title: `Connect My Mate ${mode === "edge" ? "Edge" : "Chrome"}`,
      message: `Allow this task to open and control a dedicated My Mate ${mode === "edge" ? "Edge" : "Chrome"} window?`,
      detail: `Destination: ${new URL(initialUrl).hostname}. This uses a separate persistent browser profile, not your normal browser profile. You can sign in there, and this task can read pages opened in its controlled tab.`,
      approveLabel: "Open browser",
    });
    let runtime = this.userBrowsers.get(mode) || null;
    let page = null;
    if (runtime) {
      try {
        page = await createCdpPage(runtime.port, initialUrl, this.fetchImpl);
      } catch {
        this.userBrowsers.delete(mode);
        runtime = null;
      }
    }
    if (!runtime) {
      const port = await reserveLoopbackPort();
      const profilePath = path.join(this.app.getPath("userData"), "browser-profiles", mode);
      fs.mkdirSync(profilePath, { recursive: true });
      const child = spawn(executable, [
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
        `--user-data-dir=${profilePath}`,
        "--no-first-run",
        "--no-default-browser-check",
        initialUrl,
      ], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      page = await waitForCdpPage(port, this.fetchImpl);
      runtime = { port, processId: child.pid || null };
      this.userBrowsers.set(mode, runtime);
    }
    const client = new CdpClient(page.webSocketDebuggerUrl, { WebSocketImpl: this.WebSocketImpl });
    await client.connect();
    return {
      id: `browser_${randomUUID()}`,
      ownerSessionId,
      mode,
      client,
      processId: runtime.processId,
      url: page.url || initialUrl,
      title: page.title || "",
    };
  }

  async confirm({ title, message, detail, approveLabel }) {
    const response = await this.dialog.showMessageBox(this.getParentWindow(), {
      type: "warning",
      title,
      message,
      detail,
      buttons: [approveLabel, "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response.response !== 0) throw capabilityError("browser_action_denied", "Browser action was cancelled by the user.");
  }

  async navigateSession(browser, url, readOnlyExtract = false) {
    if (browser.mode === "isolated") {
      if (readOnlyExtract) {
        const domReady = new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(capabilityError("browser_dom_ready_timeout", "Browser page DOM did not become ready in time.")),
            15_000,
          );
          browser.window.webContents.once("dom-ready", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        void browser.window.loadURL(url).catch(() => undefined);
        await domReady;
        browser.window.webContents.stop();
      } else {
        await browser.window.loadURL(url);
      }
    } else {
      await browser.client.send("Page.navigate", { url }, 60_000);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    browser.url = url;
  }

  async evaluate(browser, expression) {
    if (browser.mode === "isolated") return await browser.window.webContents.executeJavaScript(expression, true);
    return await browser.client.evaluate(expression);
  }

  async state(browser, extra = {}) {
    const state = await this.evaluate(browser, `({ url: location.href, title: document.title || "" })`).catch(() => ({
      url: browser.url || "",
      title: browser.title || "",
    }));
    browser.url = state?.url || browser.url || "";
    browser.title = state?.title || browser.title || "";
    return {
      ok: true,
      browser_session_id: browser.id,
      mode: browser.mode,
      url: browser.url,
      title: browser.title,
      visible: browser.mode !== "isolated",
      ...extra,
    };
  }

  async snapshot(browser, maxChars) {
    const result = await withTimeout(
      this.evaluate(browser, snapshotScript(maxChars)),
      BROWSER_SNAPSHOT_TIMEOUT_MS,
      "browser_snapshot_timeout",
      "Browser page snapshot timed out after 30000 ms.",
    );
    if (!result || typeof result !== "object") throw capabilityError("browser_snapshot_failed", "Browser page could not be read.");
    browser.url = result.url || browser.url;
    browser.title = result.title || browser.title;
    return {
      ok: true,
      browser_session_id: browser.id,
      mode: browser.mode,
      ...result,
      untrusted_content: true,
    };
  }

  async click(browser, value) {
    const ref = normalizeElementRef(value);
    await this.confirm({
      title: "Allow browser interaction",
      message: `Allow this task to click ${value} on ${new URL(browser.url).hostname}?`,
      detail: "Clicks can navigate, submit forms, or trigger actions on the current page. Review the current browser page before approving.",
      approveLabel: "Click element",
    });
    const result = await this.evaluate(browser, clickScript(ref));
    if (!result?.ok) throw capabilityError(result?.code || "browser_click_failed", result?.message || "Browser element could not be clicked.");
    await new Promise((resolve) => setTimeout(resolve, 250));
    return await this.state(browser, { clicked_ref: value });
  }

  async type(browser, value, text) {
    const ref = normalizeElementRef(value);
    const content = String(text ?? "");
    if (content.length > 4000) throw capabilityError("browser_text_too_long", "Browser input is limited to 4000 characters.");
    await this.confirm({
      title: "Allow text to be sent to a webpage",
      message: `Allow this task to type ${content.length} characters into ${value} on ${new URL(browser.url).hostname}?`,
      detail: "The text will be sent to the current webpage but the form will not be submitted automatically.",
      approveLabel: "Type text",
    });
    const result = await this.evaluate(browser, typeScript(ref, content));
    if (!result?.ok) throw capabilityError(result?.code || "browser_type_failed", result?.message || "Browser field could not be updated.");
    return await this.state(browser, { typed_ref: value, typed_length: content.length, submitted: false });
  }

  async back(browser) {
    if (browser.mode === "isolated") {
      const history = browser.window.webContents.navigationHistory;
      if (!history?.canGoBack()) throw capabilityError("browser_history_empty", "Browser session has no previous page.");
      history.goBack();
      await new Promise((resolve) => setTimeout(resolve, 300));
    } else {
      const history = await browser.client.send("Page.getNavigationHistory");
      const target = history.entries?.find((entry) => entry.id === history.currentIndex - 1) || history.entries?.[history.currentIndex - 1];
      if (!target) throw capabilityError("browser_history_empty", "Browser session has no previous page.");
      await browser.client.send("Page.navigateToHistoryEntry", { entryId: target.id });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return await this.state(browser);
  }

  async close(browser) {
    this.sessions.delete(browser.id);
    if (browser.mode === "isolated") {
      if (!browser.window.isDestroyed()) browser.window.destroy();
    } else {
      const hasSibling = [...this.sessions.values()].some((item) => item.mode === browser.mode);
      if (hasSibling) await browser.client.send("Page.close").catch(() => null);
      else {
        await browser.client.send("Browser.close").catch(() => null);
        this.userBrowsers.delete(browser.mode);
      }
      browser.client.close();
    }
    return { ok: true, browser_session_id: browser.id, mode: browser.mode, closed: true };
  }

  async closeAll(options = {}) {
    if (options.terminateUserBrowsers === true) {
      const notifiedModes = new Set();
      for (const browser of this.sessions.values()) {
        if (browser.mode === "isolated" || notifiedModes.has(browser.mode)) continue;
        notifiedModes.add(browser.mode);
        await browser.client.send("Browser.close").catch(() => null);
      }
    }
    for (const browser of [...this.sessions.values()]) await this.close(browser).catch(() => null);
    if (options.terminateUserBrowsers === true) this.userBrowsers.clear();
  }
}

module.exports = {
  BrowserCapabilityHost,
  CAPABILITY_IDS,
  assertPublicBrowserUrl,
  browserExecutableCandidates,
  findBrowserExecutable,
  isPrivateAddress,
  normalizeElementRef,
};
