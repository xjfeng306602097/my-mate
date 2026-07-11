import { randomUUID } from "node:crypto";
import type { CliConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly responseBody: unknown,
  ) {
    super(message);
  }
}

export interface ApiClientLike {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T>;
}

export class ApiClient implements ApiClientLike {
  constructor(
    private readonly config: CliConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 35_000,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("POST", path, body, headers);
  }

  private async request<T>(
    method: "GET" | "POST",
    requestPath: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(requestPath, `${this.config.baseUrl}/`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-request-id": `cli-${randomUUID()}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.config.workspaceId) headers["x-my-mate-workspace-id"] = this.config.workspaceId;
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (key.toLowerCase() !== "authorization") headers[key] = value;
    }
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim()) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = { message: text.slice(0, 500) };
        }
      }
      if (!response.ok) {
        const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
        throw new ApiError(
          typeof record.message === "string" ? record.message : `Gateway returned HTTP ${response.status}.`,
          response.status,
          typeof record.code === "string" ? record.code : null,
          parsed,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError("Gateway request timed out.", 0, "request_timeout", null);
      }
      throw new ApiError(
        error instanceof Error ? error.message : "Gateway request failed.",
        0,
        "gateway_unavailable",
        null,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
