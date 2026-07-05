import type { ReportPayload } from "./types.js";

function buildHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function postReport(
  callbackUrl: string,
  bearerToken: string | null,
  payload: ReportPayload,
): Promise<void> {
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: buildHeaders(bearerToken),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Callback failed (${response.status}): ${body || response.statusText}`,
    );
  }
}
