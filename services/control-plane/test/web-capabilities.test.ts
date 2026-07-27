import assert from "node:assert/strict";
import test from "node:test";
import { completeConversationAction, getConversationAction, listConversationActions } from "../src/conversation-action-store.js";
import { getCapabilityRegistry } from "../src/capability-registry.js";
import {
  createConversationWebTurnState,
  executeConversationTool,
  getConversationToolDefinitions,
  type ConversationDesktopCapabilityRequest,
} from "../src/conversation-tools.js";
import { getCapabilityPluginHost } from "../src/plugin-host.js";
import { createSession } from "../src/session-store.js";
import { setWebRequestForTests } from "../src/web-capabilities.js";
import { resolvePublicWebUrl, WebNetworkError } from "../src/web-network.js";
import { resetTestRoot } from "./helpers.js";

function response(input: {
  url: string;
  contentType: string;
  body: string;
  status?: number;
}) {
  return Promise.resolve({
    url: input.url,
    status: input.status || 200,
    headers: { "content-type": input.contentType },
    body: new TextEncoder().encode(input.body),
  });
}

test("Web capability plugin searches, extracts HTML, and blocks local targets", async () => {
  resetTestRoot();
  const priorProvider = process.env.MY_MATE_WEB_SEARCH_PROVIDER;
  process.env.MY_MATE_WEB_SEARCH_PROVIDER = "duckduckgo";
  const host = getCapabilityPluginHost();
  const registry = getCapabilityRegistry();
  host.resetForTests();
  registry.clear();
  setWebRequestForTests(async (input) => {
    const url = String(input.url);
    if (url.startsWith("https://html.duckduckgo.com/")) {
      return await response({
        url,
        contentType: "text/html; charset=utf-8",
        body: `
          <html><body>
            <div class="result">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">Example Article</a>
              <a class="result__snippet">A useful current result.</a>
            </div>
          </body></html>
        `,
      });
    }
    return await response({
      url: "https://example.com/article",
      contentType: "text/html; charset=utf-8",
      body: `
        <html>
          <head><title>Example Article</title><meta name="description" content="Article summary"></head>
          <body>
            <nav>Navigation noise</nav>
            <main><h1>Web Capability</h1><p>Readable article content.</p><script>secret()</script></main>
          </body>
        </html>
      `,
    });
  });
  try {
    const plugins = host.discover();
    assert.equal(plugins.find((plugin) => plugin.plugin_id === "web.core")?.status, "ready");
    assert.equal(getConversationToolDefinitions().some((tool) => tool.name === "web_search"), true);
    assert.equal(getConversationToolDefinitions().some((tool) => tool.name === "web_fetch"), true);

    const session = createSession({ initial_message: "Research the web", created_by: "test" });
    const search = await executeConversationTool({
      session,
      call: { id: "web-search-1", name: "web_search", arguments: { query: "example", limit: 3 } },
    });
    assert.equal(search.is_error, false);
    assert.equal(search.content.provider, "duckduckgo");
    assert.equal((search.content.results as Array<{ url: string }>)[0]?.url, "https://example.com/article");
    assert.equal(search.content.untrusted_content, true);

    const fetched = await executeConversationTool({
      session,
      call: { id: "web-fetch-1", name: "web_fetch", arguments: { url: "https://example.com/article" } },
    });
    assert.equal(fetched.is_error, false);
    assert.equal(fetched.content.title, "Example Article");
    assert.match(String(fetched.content.content), /# Web Capability/u);
    assert.match(String(fetched.content.content), /Readable article content/u);
    assert.doesNotMatch(String(fetched.content.content), /Navigation noise|secret\(\)/u);

    setWebRequestForTests(null);
    const blocked = await executeConversationTool({
      session,
      call: { id: "web-fetch-blocked", name: "web_fetch", arguments: { url: "http://127.0.0.1/private" } },
    });
    assert.equal(blocked.is_error, true);
    assert.equal(blocked.content.code, "web_url_private_blocked");
    assert.match(String(blocked.content.message), /private|local/iu);

    await assert.rejects(resolvePublicWebUrl("http://127.0.0.1/private"), /private|local/iu);
    await assert.rejects(resolvePublicWebUrl("http://localhost/private"), /private|local/iu);
    await assert.rejects(resolvePublicWebUrl("file:///etc/passwd"), /HTTP and HTTPS/iu);
    assert.equal((await resolvePublicWebUrl("https://93.184.216.34/")).addresses[0]?.address, "93.184.216.34");
  } finally {
    setWebRequestForTests(null);
    host.resetForTests();
    registry.clear();
    if (priorProvider === undefined) delete process.env.MY_MATE_WEB_SEARCH_PROVIDER;
    else process.env.MY_MATE_WEB_SEARCH_PROVIDER = priorProvider;
  }
});

test("Web Fetch falls back to the isolated browser without exposing an intermediate failure", async () => {
  resetTestRoot();
  const host = getCapabilityPluginHost();
  const registry = getCapabilityRegistry();
  host.resetForTests();
  registry.clear();
  setWebRequestForTests(async (input) => await response({
    url: String(input.url),
    contentType: "text/html",
    body: "blocked",
    status: 403,
  }));
  try {
    host.discover();
    const session = createSession({ initial_message: "Read a protected article", created_by: "test" });
    const progress: string[] = [];
    const webTurnState = createConversationWebTurnState();
    let desktopCalls = 0;
    const renderedText = "Rendered article content with enough meaningful detail for the reader. ".repeat(3).trim();
    const desktop = async (request: ConversationDesktopCapabilityRequest) => {
      desktopCalls += 1;
      const action = getConversationAction(session.session_id, request.action_id);
      assert.ok(action);
      const capabilityId = String(request.capability_id || "");
      const result = capabilityId === "browser_navigate"
        ? { ok: true, browser_session_id: "browser_test_1", url: request.arguments?.url, title: "Protected article" }
        : capabilityId === "browser_snapshot"
          ? { ok: true, browser_session_id: "browser_test_1", url: "https://example.com/protected", title: "Protected article", text: renderedText, truncated: false }
          : { ok: true, browser_session_id: "browser_test_1", closed: true };
      completeConversationAction({ action, result });
    };
    const fetched = await executeConversationTool({
      session,
      call: { id: "web-fetch-fallback", name: "web_fetch", arguments: { url: "https://example.com/protected" } },
      webTurnState,
      onDesktopCapability: desktop,
      onProgress: (event) => { progress.push(event.summary); },
    });
    assert.equal(fetched.is_error, false);
    assert.equal(fetched.content.fetch_mode, "isolated_browser");
    assert.equal(fetched.content.content, renderedText);
    assert.equal((fetched.content.direct_fetch_error as { code?: string }).code, "web_fetch_access_denied");
    assert.equal(progress.some((summary) => summary === "Reading a webpage failed"), false);
    assert.equal(progress.includes("Direct read blocked; trying an isolated browser"), true);
    assert.equal(progress.includes("Webpage read in an isolated browser"), true);
    const actions = listConversationActions(session.session_id);
    assert.equal(actions.find((action) => action.tool_name === "web_fetch")?.status, "succeeded");
    assert.equal(actions.filter((action) => action.tool_name.startsWith("browser_")).length, 3);
    const duplicateNavigate = await executeConversationTool({
      session,
      call: { id: "browser-duplicate", name: "browser_navigate", arguments: { url: "https://example.com/protected/", mode: "isolated" } },
      webTurnState,
      onDesktopCapability: desktop,
    });
    assert.equal(duplicateNavigate.is_error, false);
    assert.equal(duplicateNavigate.content.skipped, true);
    assert.equal(duplicateNavigate.content.already_read, true);
    assert.equal(desktopCalls, 3);
    const secondDuplicate = await executeConversationTool({
      session,
      call: { id: "browser-duplicate-2", name: "browser_navigate", arguments: { url: "https://example.com/protected", mode: "isolated" } },
      webTurnState,
      onDesktopCapability: desktop,
    });
    assert.equal(secondDuplicate.content.skipped, true);
    assert.equal(webTurnState.budget_exhausted, true);
  } finally {
    setWebRequestForTests(null);
    host.resetForTests();
    registry.clear();
  }
});

test("Web Fetch retries one low-value isolated snapshot with a full load in the same browser session", async () => {
  resetTestRoot();
  const host = getCapabilityPluginHost();
  const registry = getCapabilityRegistry();
  host.resetForTests();
  registry.clear();
  setWebRequestForTests(async (input) => await response({
    url: String(input.url),
    contentType: "text/html",
    body: "blocked",
    status: 403,
  }));
  try {
    host.discover();
    const session = createSession({ initial_message: "Read a protected article", created_by: "test" });
    const webTurnState = createConversationWebTurnState();
    let snapshotCalls = 0;
    let fullNavigateCalls = 0;
    const desktop = async (request: ConversationDesktopCapabilityRequest) => {
      const action = getConversationAction(session.session_id, request.action_id);
      assert.ok(action);
      const capabilityId = String(request.capability_id || "");
      let result: Record<string, unknown>;
      if (capabilityId === "browser_navigate") {
        if (request.arguments?.read_only_extract === false) {
          fullNavigateCalls += 1;
          assert.equal(request.arguments.browser_session_id, "browser_retry_1");
        }
        result = { ok: true, browser_session_id: "browser_retry_1", url: request.arguments?.url, title: "" };
      } else if (capabilityId === "browser_snapshot") {
        snapshotCalls += 1;
        result = snapshotCalls === 1
          ? { ok: true, browser_session_id: "browser_retry_1", url: request.arguments?.url, title: "example.com", text: "Enable JavaScript to continue" }
          : { ok: true, browser_session_id: "browser_retry_1", url: "https://example.com/article", title: "Full article", text: "Full rendered article body. ".repeat(12) };
      } else {
        result = { ok: true, browser_session_id: "browser_retry_1", closed: true };
      }
      completeConversationAction({ action, result });
    };
    const fetched = await executeConversationTool({
      session,
      call: { id: "web-fetch-retry", name: "web_fetch", arguments: { url: "https://example.com/article" } },
      webTurnState,
      onDesktopCapability: desktop,
    });
    assert.equal(fetched.is_error, false);
    assert.equal(snapshotCalls, 2);
    assert.equal(fullNavigateCalls, 1);
    assert.match(String(fetched.content.content), /Full rendered article body/u);
    assert.equal(listConversationActions(session.session_id).filter((action) => action.tool_name === "browser_navigate").length, 2);
  } finally {
    setWebRequestForTests(null);
    host.resetForTests();
    registry.clear();
  }
});

test("Web Fetch opens a per-turn host circuit after direct and browser reads both fail", async () => {
  resetTestRoot();
  const host = getCapabilityPluginHost();
  const registry = getCapabilityRegistry();
  host.resetForTests();
  registry.clear();
  let directRequests = 0;
  setWebRequestForTests(async () => {
    directRequests += 1;
    throw new WebNetworkError("web_request_timeout", "Web request timed out.");
  });
  try {
    host.discover();
    const session = createSession({ initial_message: "Read an unavailable site", created_by: "test" });
    const webTurnState = createConversationWebTurnState();
    const desktop = async (request: ConversationDesktopCapabilityRequest) => {
      const action = getConversationAction(session.session_id, request.action_id);
      assert.ok(action);
      completeConversationAction({
        action,
        result: { ok: false, code: "browser_navigation_failed", message: "Browser navigation timed out." },
        errorCode: "browser_navigation_failed",
      });
    };
    const first = await executeConversationTool({
      session,
      call: { id: "web-fetch-timeout-1", name: "web_fetch", arguments: { url: "https://slow.example/article-1" } },
      webTurnState,
      onDesktopCapability: desktop,
    });
    const second = await executeConversationTool({
      session,
      call: { id: "web-fetch-timeout-2", name: "web_fetch", arguments: { url: "https://slow.example/article-2" } },
      webTurnState,
      onDesktopCapability: desktop,
    });
    assert.equal(first.is_error, true);
    assert.equal(first.content.code, "web_request_timeout");
    assert.equal(second.is_error, true);
    assert.equal(second.content.code, "web_host_circuit_open");
    assert.equal(directRequests, 2);
  } finally {
    setWebRequestForTests(null);
    host.resetForTests();
    registry.clear();
  }
});

test("Web research state stops additional searches after the bounded evidence budget", async () => {
  resetTestRoot();
  const priorProvider = process.env.MY_MATE_WEB_SEARCH_PROVIDER;
  process.env.MY_MATE_WEB_SEARCH_PROVIDER = "duckduckgo";
  const host = getCapabilityPluginHost();
  const registry = getCapabilityRegistry();
  host.resetForTests();
  registry.clear();
  let requests = 0;
  setWebRequestForTests(async (input) => {
    requests += 1;
    return await response({ url: String(input.url), contentType: "text/html", body: "<html><body></body></html>" });
  });
  try {
    host.discover();
    const session = createSession({ initial_message: "Bounded research", created_by: "test" });
    const webTurnState = createConversationWebTurnState();
    for (let index = 0; index < 8; index += 1) {
      const result = await executeConversationTool({
        session,
        call: { id: `web-search-${index}`, name: "web_search", arguments: { query: `distinct query ${index}` } },
        webTurnState,
      });
      assert.equal(result.is_error, false);
    }
    const blocked = await executeConversationTool({
      session,
      call: { id: "web-search-over-budget", name: "web_search", arguments: { query: "one query too many" } },
      webTurnState,
    });
    assert.equal(blocked.is_error, true);
    assert.equal(blocked.content.code, "web_research_budget_reached");
    assert.equal(webTurnState.budget_exhausted, true);
    assert.equal(requests, 8);
  } finally {
    setWebRequestForTests(null);
    host.resetForTests();
    registry.clear();
    if (priorProvider === undefined) delete process.env.MY_MATE_WEB_SEARCH_PROVIDER;
    else process.env.MY_MATE_WEB_SEARCH_PROVIDER = priorProvider;
  }
});
