import { createHash } from "node:crypto";

function configured(env, name) {
  return typeof env[name] === "string" && env[name].trim().length > 0;
}

function selectedIds(value) {
  return new Set((value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean));
}

function credentialSource(env, names) {
  return names.find((name) => configured(env, name)) || null;
}

export function buildLiveAcceptancePlan(manifest, env = process.env) {
  const providerSelection = selectedIds(env.MY_MATE_LIVE_PROVIDERS);
  const judgeSelection = selectedIds(env.MY_MATE_LIVE_JUDGE);
  const providersAuto = providerSelection.has("auto");
  const judgesAuto = judgeSelection.has("auto");
  const providerLanes = manifest.providers.map((provider) => {
    const execution = provider.execution || "runtime_worker";
    const harnessReady = execution === "openai_compatible"
      ? configured(env, provider.base_url_env)
      : provider.harness_builtin === true || configured(env, provider.harness_env);
    const credential = credentialSource(env, provider.credential_envs || []);
    const credentialsReady = provider.credential_optional === true || !!credential;
    const requiredMissing = (provider.required_envs || []).filter((name) => !configured(env, name));
    const selected = providerSelection.has(provider.id) ||
      (providersAuto && harnessReady && credentialsReady && requiredMissing.length === 0);
    const missing = [
      ...(!harnessReady ? [execution === "openai_compatible" ? provider.base_url_env : provider.harness_env] : []),
      ...requiredMissing,
      ...(!credentialsReady ? [`one of ${provider.credential_envs.join(", ")}`] : []),
    ];
    return {
      id: `provider:${provider.id}`,
      kind: "provider",
      provider: provider.id,
      execution,
      require_tools: provider.require_tools !== false,
      model: configured(env, provider.model_env)
        ? env[provider.model_env].trim()
        : provider.default_model || null,
      selected,
      runnable: selected && missing.length === 0,
      credential_source: credential || (provider.credential_optional && harnessReady
        ? provider.credential_mode || "credential_optional"
        : null),
      harness_source: harnessReady
        ? execution === "openai_compatible"
          ? provider.base_url_env
          : provider.harness_builtin === true ? `builtin:${provider.harness_name}` : provider.harness_env
        : null,
      missing,
    };
  });
  const judgeLanes = manifest.judges.map((judge) => {
    const credential = credentialSource(env, judge.credential_envs || []);
    const selected = judgeSelection.has(judge.id) || (judgesAuto && !!credential);
    const missing = credential ? [] : [`one of ${judge.credential_envs.join(", ")}`];
    return {
      id: `judge:${judge.id}`,
      kind: "model_judge",
      provider: judge.id,
      evaluator_id: judge.evaluator_id,
      model: configured(env, judge.model_env) ? env[judge.model_env].trim() : null,
      selected,
      runnable: selected && missing.length === 0,
      credential_source: credential,
      harness_source: null,
      missing,
    };
  });
  return [...providerLanes, ...judgeLanes];
}

function outputDigest(output) {
  return `sha256:${createHash("sha256").update(output || "").digest("hex")}`;
}

function redact(value, env) {
  let result = String(value || "");
  for (const [name, secret] of Object.entries(env)) {
    if (!/(KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)/i.test(name) || !secret || secret.length < 6) continue;
    result = result.replaceAll(secret, "[REDACTED]");
  }
  return result.slice(-2000);
}

function executionFailure(execution) {
  const raw = execution.stderr || execution.stdout || `Lane exited ${execution.exitCode}.`;
  const tapErrors = [...String(raw).matchAll(/^\s*error:\s*(['"])(.*?)\1\s*$/gm)];
  return tapErrors.at(-1)?.[2] || raw;
}

export async function runLiveAcceptance(input) {
  const startedAt = input.startedAt || new Date().toISOString();
  const plan = buildLiveAcceptancePlan(input.manifest, input.env);
  const results = [];
  for (const lane of plan) {
    if (!lane.selected) {
      results.push({
        id: lane.id,
        kind: lane.kind,
        provider: lane.provider,
        evaluator_id: lane.evaluator_id || null,
        model: lane.model,
        status: "skipped",
        credential_source: lane.credential_source,
        harness_source: lane.harness_source,
        duration_ms: 0,
        attempt_count: 0,
        evidence: null,
        output_digest: null,
        error: "Lane was not selected.",
      });
      continue;
    }
    if (!lane.runnable) {
      results.push({
        id: lane.id,
        kind: lane.kind,
        provider: lane.provider,
        evaluator_id: lane.evaluator_id || null,
        model: lane.model,
        status: "failed",
        credential_source: lane.credential_source,
        harness_source: lane.harness_source,
        duration_ms: 0,
        attempt_count: 0,
        evidence: null,
        output_digest: null,
        error: `Missing configuration: ${lane.missing.join("; ")}`,
      });
      continue;
    }
    const started = Date.now();
    try {
      const execution = await input.execute(lane);
      results.push({
        id: lane.id,
        kind: lane.kind,
        provider: lane.provider,
        evaluator_id: lane.evaluator_id || null,
        model: lane.model,
        status: execution.exitCode === 0 ? "passed" : "failed",
        credential_source: lane.credential_source,
        harness_source: lane.harness_source,
        duration_ms: Math.max(0, Date.now() - started),
        attempt_count: execution.attemptCount || 1,
        evidence: execution.evidence || null,
        output_digest: outputDigest(`${execution.stdout || ""}\n${execution.stderr || ""}`),
        error: execution.exitCode === 0
          ? null
          : redact(executionFailure(execution), input.env),
      });
    } catch (error) {
      results.push({
        id: lane.id,
        kind: lane.kind,
        provider: lane.provider,
        evaluator_id: lane.evaluator_id || null,
        model: lane.model,
        status: "failed",
        credential_source: lane.credential_source,
        harness_source: lane.harness_source,
        duration_ms: Math.max(0, Date.now() - started),
        attempt_count: 1,
        evidence: null,
        output_digest: null,
        error: redact(error instanceof Error ? error.message : error, input.env),
      });
    }
  }
  const selected = plan.filter((lane) => lane.selected);
  const failed = results.some((lane) => lane.status === "failed");
  const status = failed
    ? "failed"
    : selected.length === 0
      ? "skipped"
      : "passed";
  const completedAt = input.completedAt || new Date().toISOString();
  return {
    schema_version: 1,
    acceptance_id: `live_acceptance_${startedAt.replace(/[-:.]/g, "")}`,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      revision: input.env.GITHUB_SHA || input.env.MY_MATE_BUILD_REVISION || null,
    },
    lanes: results,
  };
}
