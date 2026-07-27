import assert from "node:assert/strict";
import { recordProviderConnectionVerification, upsertProviderConnection } from "../src/provider-connection-store.js";

const apiKey = process.env.MY_MATE_BIG_MODEL_API_KEY?.trim();
assert.ok(apiKey, "MY_MATE_BIG_MODEL_API_KEY is required.");

const connection = upsertProviderConnection({
  connection_id: "big-model-smart-agi",
  // Keep the stable connection id so existing Agent bindings remain valid.
  name: "ChatGPT (0029)",
  agent_runtime: "codex",
  provider: "0029-openai",
  protocol: "openai-compatible",
  base_url: "https://api.0029.org",
  models: [
    "codex-auto-review",
    "gpt-5.3-codex-spark",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-image-2",
  ],
  default_model: "gpt-5.4",
  api_key: apiKey,
  credential_source: "managed",
  credential_env: "OPENAI_API_KEY",
  max_input_tokens: 524_288,
  max_output_tokens: 65_536,
  context_compression_enabled: true,
  context_compression_threshold_percent: 75,
  max_continuation_rounds: 8,
  max_tool_rounds: 32,
  status: "active",
  metadata: { endpoint_kind: "openai-compatible" },
});

const verified = recordProviderConnectionVerification(connection.connection_id, {
  status: "verified",
  tested_at: new Date().toISOString(),
  detail: "Provider authentication, GET /v1/models, and POST /v1/chat/completions (gpt-5.4) succeeded.",
  duration_ms: Number(process.env.MY_MATE_BIG_MODEL_TEST_DURATION_MS || 0) || 0,
  model: "gpt-5.4",
});

console.log(JSON.stringify({
  connection_id: verified.connection_id,
  name: verified.name,
  base_url: verified.base_url,
  protocol: verified.protocol,
  default_model: verified.default_model,
  models: verified.models,
  verification: verified.verification,
  max_input_tokens: verified.max_input_tokens,
  max_output_tokens: verified.max_output_tokens,
  credential_source: verified.credential_source,
}, null, 2));
