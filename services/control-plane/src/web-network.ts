import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { CapabilityToolError } from "./capability-registry.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = "MyMate/0.1 (+https://localhost; capability-web)";
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".lan", ".internal", ".home", ".test"];
const SENSITIVE_REDIRECT_HEADERS = ["authorization", "cookie", "proxy-authorization", "x-api-key"];

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv6");

export class WebNetworkError extends CapabilityToolError {
  constructor(readonly code: string, message: string) {
    super(code, message);
  }
}

export interface SafeWebResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/u, "");
}

function blockedHostname(hostname: string): boolean {
  return hostname === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function blockedAddress(address: string, family: number): boolean {
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) {
    const mapped = address.slice("::ffff:".length);
    if (isIP(mapped) === 4) return blockedAddresses.check(mapped, "ipv4");
  }
  return blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

export async function resolvePublicWebUrl(value: string | URL): Promise<{
  url: URL;
  addresses: ResolvedAddress[];
}> {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw new WebNetworkError("web_url_invalid", "A valid absolute web URL is required.");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new WebNetworkError("web_url_scheme_blocked", "Only HTTP and HTTPS URLs are supported.");
  }
  if (url.username || url.password) {
    throw new WebNetworkError("web_url_credentials_blocked", "Credentials cannot be embedded in a web URL.");
  }
  const hostname = normalizedHostname(url);
  if (!hostname || blockedHostname(hostname)) {
    throw new WebNetworkError("web_url_private_blocked", "Private and local network hostnames are not available to Web tools.");
  }
  const literalFamily = isIP(hostname);
  const resolved = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true }).catch((error) => {
        throw new WebNetworkError(
          "web_dns_failed",
          `DNS lookup failed for ${hostname}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      });
  if (!resolved.length) throw new WebNetworkError("web_dns_empty", `DNS returned no addresses for ${hostname}.`);
  const addresses = resolved.map((item) => ({ address: item.address, family: item.family as 4 | 6 }));
  if (addresses.some((item) => blockedAddress(item.address, item.family))) {
    throw new WebNetworkError(
      "web_url_private_blocked",
      "The URL resolves to a private, local, reserved, or non-routable network address.",
    );
  }
  return { url, addresses };
}

function pinnedAgent(addresses: ResolvedAddress[]): Agent {
  return new Agent({
    connect: {
      lookup: ((
        _hostname: string,
        options: { family?: number; all?: boolean },
        callback: (error: Error | null, address: unknown, family?: number) => void,
      ) => {
        const requestedFamily = typeof options?.family === "number" ? options.family : 0;
        const eligible = requestedFamily === 4 || requestedFamily === 6
          ? addresses.filter((item) => item.family === requestedFamily)
          : addresses;
        const selected = eligible[0];
        if (!selected) {
          callback(new Error("No public DNS address matches the requested network family."), "");
          return;
        }
        if (options?.all) {
          callback(null, eligible.map((item) => ({ address: item.address, family: item.family })));
          return;
        }
        callback(null, selected.address, selected.family);
      }) as never,
    },
    pipelining: 0,
    connections: 1,
  });
}

export async function createPinnedPublicFetch(baseUrl: string | URL): Promise<{
  url: URL;
  fetch: typeof fetch;
  close: () => Promise<void>;
}> {
  const resolved = await resolvePublicWebUrl(baseUrl);
  const agent = pinnedAgent(resolved.addresses);
  const origin = resolved.url.origin;
  const pinnedFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = input instanceof Request
      ? new URL(input.url)
      : input instanceof URL
        ? new URL(input)
        : new URL(input);
    if (requestUrl.origin !== origin) {
      throw new WebNetworkError(
        "web_cross_origin_blocked",
        "Pinned public requests cannot leave the configured origin.",
      );
    }
    const response = await undiciFetch(requestUrl, {
      ...init,
      redirect: "manual",
      dispatcher: agent,
    } as never);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new WebNetworkError(
        "web_redirect_blocked",
        "Pinned public requests do not follow redirects. Configure the final endpoint URL.",
      );
    }
    return response as unknown as Response;
  };
  return {
    url: resolved.url,
    fetch: pinnedFetch as typeof fetch,
    close: async () => { await agent.close(); },
  };
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) {
    throw new WebNetworkError("web_response_too_large", `Web response exceeds ${maximumBytes} bytes.`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new WebNetworkError("web_response_too_large", `Web response exceeds ${maximumBytes} bytes.`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

export async function safeWebRequest(input: {
  url: string | URL;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeout_ms?: number;
  max_bytes?: number;
}): Promise<SafeWebResponse> {
  let current = input.url instanceof URL ? new URL(input.url) : new URL(input.url);
  let method = input.method || "GET";
  let body = input.body;
  let headers = new Headers(input.headers || {});
  headers.set("user-agent", USER_AGENT);
  headers.set("accept-encoding", "gzip, deflate, br");
  const timeoutMs = Math.min(60_000, Math.max(1_000, Math.floor(input.timeout_ms || DEFAULT_TIMEOUT_MS)));
  const maximumBytes = Math.min(10 * 1024 * 1024, Math.max(1_024, Math.floor(input.max_bytes || DEFAULT_MAX_BYTES)));

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const resolved = await resolvePublicWebUrl(current);
    const agent = pinnedAgent(resolved.addresses);
    let response: Response;
    try {
      response = await undiciFetch(resolved.url, {
        method,
        headers,
        body: method === "GET" ? undefined : body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: agent,
      }) as unknown as Response;
    } catch (error) {
      throw new WebNetworkError(
        "web_request_failed",
        `Web request to ${resolved.url.hostname} failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      await agent.close().catch(() => undefined);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new WebNetworkError("web_redirect_invalid", "Web response redirected without a Location header.");
      if (redirectCount === MAX_REDIRECTS) {
        throw new WebNetworkError("web_redirect_limit", `Web request exceeded ${MAX_REDIRECTS} redirects.`);
      }
      const next = new URL(location, resolved.url);
      if (next.origin !== resolved.url.origin) {
        const nextHeaders = new Headers(headers);
        for (const name of SENSITIVE_REDIRECT_HEADERS) nextHeaders.delete(name);
        headers = nextHeaders;
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
      }
      current = next;
      continue;
    }

    return {
      url: resolved.url.toString(),
      status: response.status,
      headers: responseHeaders(response),
      body: await readBoundedBody(response, maximumBytes),
    };
  }
  throw new WebNetworkError("web_redirect_limit", `Web request exceeded ${MAX_REDIRECTS} redirects.`);
}
