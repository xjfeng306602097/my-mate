import { parseHTML } from "linkedom";
import { safeWebRequest, WebNetworkError } from "./web-network.js";

type WebRequest = typeof safeWebRequest;
let webRequest: WebRequest = safeWebRequest;

export function setWebRequestForTests(request: WebRequest | null): void {
  webRequest = request || safeWebRequest;
}

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  position: number;
}

interface WebSearchProvider {
  id: string;
  available(): boolean;
  search(query: string, limit: number): Promise<WebSearchResult[]>;
}

function decodeBody(body: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function publicResultUrl(value: string, baseUrl?: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.hostname.endsWith("duckduckgo.com") && url.searchParams.get("uddg")) {
      return new URL(url.searchParams.get("uddg")!).toString();
    }
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const duckDuckGoProvider: WebSearchProvider = {
  id: "duckduckgo",
  available: () => true,
  async search(query, limit) {
    const response = await webRequest({
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      headers: { accept: "text/html,application/xhtml+xml" },
      max_bytes: 1_500_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new WebNetworkError("web_search_http_error", `DuckDuckGo returned HTTP ${response.status}.`);
    }
    const { document } = parseHTML(decodeBody(response.body));
    const candidates = [...document.querySelectorAll(".result")];
    const results: WebSearchResult[] = [];
    for (const candidate of candidates) {
      const anchor = candidate.querySelector(".result__a") as HTMLAnchorElement | null;
      const href = anchor?.getAttribute("href") || "";
      const url = publicResultUrl(href, response.url);
      const title = normalizedText(anchor?.textContent || "");
      if (!url || !title) continue;
      const snippet = normalizedText(candidate.querySelector(".result__snippet")?.textContent || "");
      results.push({ title, url, description: snippet, position: results.length + 1 });
      if (results.length >= limit) break;
    }
    return results;
  },
};

const bingProvider: WebSearchProvider = {
  id: "bing",
  available: () => true,
  async search(query, limit) {
    const response = await webRequest({
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`,
      headers: { accept: "text/html,application/xhtml+xml" },
      max_bytes: 1_500_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new WebNetworkError("web_search_http_error", `Bing returned HTTP ${response.status}.`);
    }
    const { document } = parseHTML(decodeBody(response.body));
    const results: WebSearchResult[] = [];
    for (const candidate of [...document.querySelectorAll("li.b_algo")]) {
      const anchor = candidate.querySelector("h2 a") as HTMLAnchorElement | null;
      const url = publicResultUrl(anchor?.getAttribute("href") || "", response.url);
      const title = normalizedText(anchor?.textContent || "");
      if (!url || !title) continue;
      results.push({
        title,
        url,
        description: normalizedText(candidate.querySelector(".b_caption p")?.textContent || ""),
        position: results.length + 1,
      });
      if (results.length >= limit) break;
    }
    return results;
  },
};

const braveProvider: WebSearchProvider = {
  id: "brave",
  available: () => Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()),
  async search(query, limit) {
    const response = await webRequest({
      url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
      headers: {
        accept: "application/json",
        "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY || "",
      },
      max_bytes: 1_500_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new WebNetworkError("web_search_http_error", `Brave Search returned HTTP ${response.status}.`);
    }
    const parsed = JSON.parse(decodeBody(response.body)) as { web?: { results?: unknown[] } };
    return (parsed.web?.results || []).flatMap((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const value = item as Record<string, unknown>;
      const url = typeof value.url === "string" ? publicResultUrl(value.url) : null;
      const title = typeof value.title === "string" ? normalizedText(value.title) : "";
      if (!url || !title) return [];
      return [{
        title,
        url,
        description: typeof value.description === "string" ? normalizedText(value.description) : "",
        position: index + 1,
      }];
    }).slice(0, limit);
  },
};

const tavilyProvider: WebSearchProvider = {
  id: "tavily",
  available: () => Boolean(process.env.TAVILY_API_KEY?.trim()),
  async search(query, limit) {
    const response = await webRequest({
      url: "https://api.tavily.com/search",
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY || "",
        query,
        max_results: limit,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
      }),
      max_bytes: 1_500_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new WebNetworkError("web_search_http_error", `Tavily returned HTTP ${response.status}.`);
    }
    const parsed = JSON.parse(decodeBody(response.body)) as { results?: unknown[] };
    return (parsed.results || []).flatMap((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const value = item as Record<string, unknown>;
      const url = typeof value.url === "string" ? publicResultUrl(value.url) : null;
      const title = typeof value.title === "string" ? normalizedText(value.title) : "";
      if (!url || !title) return [];
      return [{
        title,
        url,
        description: typeof value.content === "string" ? normalizedText(value.content) : "",
        position: index + 1,
      }];
    }).slice(0, limit);
  },
};

const searchProviders = new Map(
  [braveProvider, tavilyProvider, bingProvider, duckDuckGoProvider].map((provider) => [provider.id, provider]),
);

function activeSearchProvider(): WebSearchProvider {
  const configured = (process.env.MY_MATE_WEB_SEARCH_PROVIDER || "auto").trim().toLowerCase();
  if (configured !== "auto") {
    const provider = searchProviders.get(configured);
    if (!provider) throw new Error(`Unknown Web Search provider: ${configured}.`);
    if (!provider.available()) throw new Error(`Web Search provider ${configured} is not configured.`);
    return provider;
  }
  return braveProvider.available()
    ? braveProvider
    : tavilyProvider.available()
      ? tavilyProvider
      : bingProvider;
}

export async function searchWeb(query: string, limit: number): Promise<Record<string, unknown>> {
  const provider = activeSearchProvider();
  const results = await provider.search(query, limit);
  return {
    ok: true,
    provider: provider.id,
    query,
    results,
    result_count: results.length,
    untrusted_content: true,
  };
}

function extractedHtml(html: string, sourceUrl: string): {
  title: string;
  description: string;
  content: string;
} {
  const { document } = parseHTML(html);
  for (const selector of ["script", "style", "noscript", "template", "svg", "canvas", "iframe", "nav", "footer"]) {
    for (const node of [...document.querySelectorAll(selector)]) node.remove();
  }
  const title = normalizedText(document.querySelector("title")?.textContent || "");
  const description = normalizedText(
    document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
  );
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  if (!root) return { title, description, content: "" };
  const lines: string[] = [];
  for (const node of [...root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr")]) {
    const text = normalizedText(node.textContent || "");
    if (!text) continue;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/u.test(tag)) lines.push(`${"#".repeat(Number(tag[1]))} ${text}`);
    else if (tag === "li") lines.push(`- ${text}`);
    else if (tag === "pre") lines.push(`\`\`\`\n${node.textContent?.trim() || ""}\n\`\`\``);
    else if (tag === "blockquote") lines.push(`> ${text}`);
    else if (tag === "tr") {
      const cells = [...node.querySelectorAll("th,td")].map((cell) => normalizedText(cell.textContent || "")).filter(Boolean);
      if (cells.length) lines.push(cells.join(" | "));
    } else lines.push(text);
  }
  const content = lines.length ? lines.join("\n\n") : normalizedText(root.textContent || "");
  return {
    title: title || new URL(sourceUrl).hostname,
    description,
    content,
  };
}

export async function fetchWeb(input: {
  url: string;
  max_chars: number;
  format: "text" | "html";
}): Promise<Record<string, unknown>> {
  const response = await webRequest({
    url: input.url,
    headers: { accept: "text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9,*/*;q=0.2" },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new WebNetworkError("web_fetch_http_error", `Web page returned HTTP ${response.status}.`);
  }
  const contentType = (response.headers["content-type"] || "application/octet-stream").toLowerCase();
  const textual = contentType.startsWith("text/") || /(?:json|xml|javascript|xhtml|yaml)/u.test(contentType);
  if (!textual) {
    throw new WebNetworkError(
      "web_fetch_binary_unsupported",
      `Web Fetch does not extract binary content of type ${contentType}.`,
    );
  }
  const raw = decodeBody(response.body);
  const extracted = contentType.includes("html") || contentType.includes("xhtml")
    ? extractedHtml(raw, response.url)
    : { title: new URL(response.url).hostname, description: "", content: raw };
  const selected = input.format === "html" && contentType.includes("html") ? raw : extracted.content;
  const truncated = selected.length > input.max_chars;
  return {
    ok: true,
    url: response.url,
    status: response.status,
    content_type: contentType,
    title: extracted.title,
    description: extracted.description,
    format: input.format,
    content: truncated ? selected.slice(0, input.max_chars) : selected,
    truncated,
    untrusted_content: true,
  };
}
