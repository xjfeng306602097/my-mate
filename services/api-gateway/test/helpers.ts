import { createApp } from "../src/app.js";
import type { GatewayConfig } from "../src/config.js";

export async function startTestServer(overrides: Partial<GatewayConfig> = {}) {
  const app = createApp(overrides);
  return await new Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose an address.");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              done();
            });
          }),
      });
    });
  });
}

export async function getJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.trim() ? JSON.parse(text) : null,
  };
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.trim() ? JSON.parse(text) : null,
  };
}

export async function putJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.trim() ? JSON.parse(text) : null,
  };
}

export async function patchJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.trim() ? JSON.parse(text) : null,
  };
}
