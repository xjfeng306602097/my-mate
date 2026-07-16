import assert from "node:assert/strict";
import test from "node:test";
import { getCapabilityRegistry } from "../src/capability-registry.js";
import { executeConversationTool, getConversationToolDefinitions } from "../src/conversation-tools.js";
import { getCapabilityPluginHost } from "../src/plugin-host.js";
import { createSession } from "../src/session-store.js";
import { setWebRequestForTests } from "../src/web-capabilities.js";
import { resolvePublicWebUrl } from "../src/web-network.js";
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
