import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

import { Agent, fetch as undiciFetch } from "undici";

const WINDOWS_TRUST_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

const windowsTrustedAgents = new Map<string, Agent>();

function errorChain(error: unknown): Array<{ code: string | null; message: string }> {
  const chain: Array<{ code: string | null; message: string }> = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (current instanceof Error) {
      const code = typeof (current as Error & { code?: unknown }).code === "string"
        ? String((current as Error & { code?: unknown }).code)
        : null;
      chain.push({ code, message: current.message });
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as { code?: unknown; message?: unknown; cause?: unknown };
      chain.push({
        code: typeof record.code === "string" ? record.code : null,
        message: typeof record.message === "string" ? record.message : String(current),
      });
      current = record.cause;
      continue;
    }
    chain.push({ code: null, message: String(current) });
    break;
  }
  return chain;
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function tlsTrustError(error: unknown): { code: string; message: string } | null {
  return errorChain(error).find((item) => item.code && WINDOWS_TRUST_ERROR_CODES.has(item.code)) as {
    code: string;
    message: string;
  } | undefined || null;
}

function readPeerIssuer(target: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: target.hostname,
      port: Number(target.port || 443),
      servername: target.hostname,
      rejectUnauthorized: false,
    });
    socket.setTimeout(5_000);
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      const issuer = certificate?.issuer?.CN;
      socket.end();
      if (typeof issuer === "string" && issuer.trim()) {
        resolve(issuer.trim());
      } else {
        reject(new Error(`The TLS peer for ${target.hostname} did not provide an issuer name.`));
      }
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timed out while inspecting the TLS certificate for ${target.hostname}.`));
    });
    socket.once("error", reject);
  });
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "root";
}

function exportWindowsTrustedRoot(issuerName: string): string {
  const directory = path.join(os.tmpdir(), "my-mate-provider-ca");
  mkdirSync(directory, { recursive: true });
  const stores = [
    { args: ["-f", "-store", "Root", issuerName], suffix: "machine" },
    { args: ["-f", "-user", "-store", "Root", issuerName], suffix: "user" },
  ];
  for (const store of stores) {
    const outputPath = path.join(directory, `${safeFileName(issuerName)}-${store.suffix}.cer`);
    rmSync(outputPath, { force: true });
    const result = spawnSync("certutil.exe", [...store.args, outputPath], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) continue;
    try {
      const certificate = new X509Certificate(readFileSync(outputPath));
      if (!certificate.subject.toLowerCase().includes(issuerName.toLowerCase())) continue;
      return certificate.toString();
    } catch {
      // Try the next trusted Windows root store.
    }
  }
  throw new Error(`Windows does not contain a readable trusted root named "${issuerName}".`);
}

async function windowsTrustedAgent(target: URL): Promise<Agent> {
  const cached = windowsTrustedAgents.get(target.hostname);
  if (cached) return cached;
  const issuerName = await readPeerIssuer(target);
  const ca = exportWindowsTrustedRoot(issuerName);
  const agent = new Agent({ connect: { ca } });
  windowsTrustedAgents.set(target.hostname, agent);
  return agent;
}

export function describeProviderTransportError(error: unknown, input: Parameters<typeof fetch>[0]): string {
  const target = requestUrl(input);
  const chain = errorChain(error);
  const coded = chain.find((item) => item.code);
  const detail = [...chain].reverse().find((item) => item.message)?.message || "Unknown transport error.";
  const code = coded?.code || null;
  if (code && WINDOWS_TRUST_ERROR_CODES.has(code)) {
    return `Provider TLS verification failed for ${target.hostname} (${code}): ${detail}`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `Provider DNS lookup failed for ${target.hostname} (${code}): ${detail}`;
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT") {
    return `Provider network request to ${target.hostname} failed (${code}): ${detail}`;
  }
  if (chain.some((item) => item.code === "ABORT_ERR" || /timed?\s*out/i.test(item.message))) {
    return `Provider request to ${target.hostname} timed out.`;
  }
  return `Provider request to ${target.hostname} failed${code ? ` (${code})` : ""}: ${detail}`;
}

async function runFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  dispatcher?: Agent,
): Promise<Response> {
  const response = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    ...(dispatcher ? { dispatcher } : {}),
  });
  return response as unknown as Response;
}

export const providerFetch: typeof fetch = async (input, init) => {
  try {
    return await runFetch(input, init);
  } catch (error) {
    const trustError = tlsTrustError(error);
    const target = requestUrl(input);
    if (!trustError || process.platform !== "win32" || target.protocol !== "https:") {
      throw new Error(describeProviderTransportError(error, input), { cause: error });
    }
    try {
      const agent = await windowsTrustedAgent(target);
      return await runFetch(input, init, agent);
    } catch (retryError) {
      throw new Error(describeProviderTransportError(retryError, input), { cause: retryError });
    }
  }
};
