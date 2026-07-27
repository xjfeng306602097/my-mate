import type { DoctorRuntime } from "./types.js";
import { providerFetch } from "../provider-fetch.js";

interface ProviderConfiguration {
  harnessEnv: string | null;
  harnessConfigured: boolean;
  credentialConfigured: boolean;
  credentialSource: string | null;
}

const HARNESS_ENV: Partial<Record<DoctorRuntime, string>> = {
  kimi: "MY_MATE_KIMI_COMMAND",
};

const CREDENTIAL_ENVS: Partial<Record<DoctorRuntime, string[]>> = {
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY", "MY_MATE_CODEX_CREDENTIAL_REF"],
  "claude-sdk": ["ANTHROPIC_API_KEY", "MY_MATE_CLAUDE_CREDENTIAL_REF"],
  kimi: ["KIMI_API_KEY", "MOONSHOT_API_KEY", "MY_MATE_KIMI_CREDENTIAL_REF"],
  glm: ["GLM_API_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
};

export function inspectProviderConfiguration(
  runtime: DoctorRuntime,
  env: NodeJS.ProcessEnv,
): ProviderConfiguration {
  if (runtime === "local" || runtime === "docker-worker") {
    return {
      harnessEnv: null,
      harnessConfigured: false,
      credentialConfigured: false,
      credentialSource: null,
    };
  }
  if (runtime === "codex" || runtime === "claude-sdk") {
    const credentialSource = (CREDENTIAL_ENVS[runtime] || []).find(
      (name) => !!env[name]?.trim(),
    );
    return {
      harnessEnv: null,
      harnessConfigured: true,
      credentialConfigured: !!credentialSource,
      credentialSource: credentialSource || null,
    };
  }
  if (runtime === "glm") {
    const credentialSource = (CREDENTIAL_ENVS.glm || []).find(
      (name) => !!env[name]?.trim(),
    );
    return {
      harnessEnv: "MY_MATE_GLM_ANTHROPIC_BASE_URL",
      harnessConfigured: !!env.MY_MATE_GLM_ANTHROPIC_BASE_URL?.trim(),
      credentialConfigured: !!credentialSource,
      credentialSource: credentialSource || null,
    };
  }
  const harnessEnv = HARNESS_ENV[runtime] || null;
  const credentialSource = (CREDENTIAL_ENVS[runtime] || []).find(
    (name) => !!env[name]?.trim(),
  );
  return {
    harnessEnv,
    harnessConfigured: !!(harnessEnv && env[harnessEnv]?.trim()),
    credentialConfigured: !!credentialSource,
    credentialSource: credentialSource || null,
  };
}

async function fetchOk(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Provider returned HTTP ${response.status}${body ? `: ${body}` : ""}.`);
  }
  return response;
}

export async function runLiveProviderProbe(input: {
  runtime: DoctorRuntime;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl || providerFetch;
  if (input.runtime === "codex") {
    const key = input.env.OPENAI_API_KEY || input.env.CODEX_API_KEY;
    if (!key) throw new Error("No OpenAI API credential is available for a live probe.");
    const base = (input.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
    await fetchOk(fetchImpl, `${base}/v1/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    return;
  }
  if (input.runtime === "kimi") {
    const key = input.env.KIMI_API_KEY || input.env.MOONSHOT_API_KEY;
    if (!key) throw new Error("No Kimi API credential is available for a live probe.");
    const base = (input.env.KIMI_BASE_URL || "https://api.moonshot.cn").replace(/\/$/, "");
    const apiBase = base.endsWith("/v1") ? base : `${base}/v1`;
    const response = await fetchOk(fetchImpl, `${apiBase}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    const selectedModel = input.env.MY_MATE_KIMI_MODEL?.trim();
    if (selectedModel) {
      const body = await response.json() as { data?: Array<{ id?: unknown }> };
      const availableModels = Array.isArray(body.data)
        ? body.data.map((item) => typeof item.id === "string" ? item.id : "").filter(Boolean)
        : [];
      if (!availableModels.includes(selectedModel)) {
        throw new Error(`Kimi model ${selectedModel} is not available from this endpoint.`);
      }
    }
    return;
  }
  if (input.runtime === "claude-sdk") {
    const key = input.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("No Anthropic API credential is available for a live probe.");
    const base = (input.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
    await fetchOk(fetchImpl, `${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: input.env.MY_MATE_CLAUDE_MODEL || "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return;
  }
  if (input.runtime === "glm") {
    const key = input.env.GLM_API_KEY || input.env.ZAI_API_KEY || input.env.ZHIPU_API_KEY;
    if (!key) throw new Error("No GLM API credential is available for a live probe.");
    const configuredBase = input.env.MY_MATE_GLM_ANTHROPIC_BASE_URL;
    if (!configuredBase) {
      throw new Error("MY_MATE_GLM_ANTHROPIC_BASE_URL is required for a live GLM probe.");
    }
    const base = configuredBase.replace(/\/$/, "");
    await fetchOk(fetchImpl, `${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: input.env.MY_MATE_GLM_MODEL || "glm-5.2",
        max_tokens: 1,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return;
  }
  throw new Error(`Runtime ${input.runtime} does not have a model provider probe.`);
}
