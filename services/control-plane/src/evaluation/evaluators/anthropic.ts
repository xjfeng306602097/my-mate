import Anthropic from "@anthropic-ai/sdk";
import type { UsageSummary } from "@my-mate/shared-types/runtime-protocol";
import {
  EVALUATOR_MAX_TOKENS,
  EVALUATOR_MODEL,
  EVALUATOR_TIMEOUT_MS,
} from "../../config.js";
import type { EvaluationFinding } from "../types.js";
import type { EvaluatorProvider } from "../evaluator-registry.js";

const TOOL_NAME = "report_evaluation";
export type EvaluatorAnthropicClientFactory = () => Anthropic;
let clientFactory: EvaluatorAnthropicClientFactory | null = null;

export function setEvaluatorAnthropicClientFactory(factory: EvaluatorAnthropicClientFactory | null): void {
  clientFactory = factory;
}

function client(): Anthropic {
  if (clientFactory) return clientFactory();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set for model evaluation.");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Model evaluation timed out after ${EVALUATOR_TIMEOUT_MS}ms.`)), EVALUATOR_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function usageFrom(message: Anthropic.Message): UsageSummary {
  const usage = message.usage;
  const cacheRead = "cache_read_input_tokens" in usage ? Number(usage.cache_read_input_tokens || 0) : null;
  const cacheWrite = "cache_creation_input_tokens" in usage ? Number(usage.cache_creation_input_tokens || 0) : null;
  return {
    availability: "available",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: null,
    total_tokens: usage.input_tokens + usage.output_tokens,
    duration_ms: null,
    turn_count: 1,
    provider_reported_cost: null,
    estimated_cost: null,
  };
}

function parseOutput(message: Anthropic.Message): {
  quality_verdict: "pass" | "fail";
  findings: EvaluationFinding[];
} {
  const block = message.content.find((item) => item.type === "tool_use" && item.name === TOOL_NAME);
  if (!block || block.type !== "tool_use" || !block.input || typeof block.input !== "object") {
    throw new Error("Model evaluator did not return the required structured tool result.");
  }
  const input = block.input as Record<string, unknown>;
  if (input.quality_verdict !== "pass" && input.quality_verdict !== "fail") {
    throw new Error("Model evaluator returned an invalid quality_verdict.");
  }
  const rawFindings = Array.isArray(input.findings) ? input.findings : [];
  const findings = rawFindings.map((value, index): EvaluationFinding => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      check_id: typeof item.check_id === "string" ? item.check_id : `quality.model.${index + 1}`,
      dimension: "quality",
      severity: item.severity === "warning" ? "warning" : item.severity === "info" ? "info" : "error",
      passed: item.passed === true,
      summary: typeof item.summary === "string" && item.summary ? item.summary : "Model quality finding",
      detail: typeof item.detail === "string" ? item.detail : "",
      evidence_refs: Array.isArray(item.evidence_refs)
        ? item.evidence_refs.filter((ref): ref is string => typeof ref === "string")
        : [],
    };
  });
  const hardFailures = findings.filter((finding) => !finding.passed && finding.severity === "error").length;
  if (input.quality_verdict === "pass" && hardFailures > 0) {
    throw new Error("Model evaluator returned quality pass with failing error findings.");
  }
  if (input.quality_verdict === "fail" && hardFailures === 0) {
    throw new Error("Model evaluator returned quality fail without a failing error finding.");
  }
  return { quality_verdict: input.quality_verdict, findings };
}

export const anthropicEvaluator: EvaluatorProvider = {
  descriptor: () => ({
    id: "model-v1",
    kind: "model",
    version: "1",
    provider: "anthropic",
    model: EVALUATOR_MODEL,
    prompt_version: "quality-judge-v1",
  }),
  async evaluate(context) {
    const message = await withTimeout(client().messages.create({
      model: EVALUATOR_MODEL,
      max_tokens: EVALUATOR_MAX_TOKENS,
      system: [
        "You are the independent quality judge for a My Mate run.",
        "Judge only task-specific semantic quality from the supplied redacted evidence view.",
        "Do not infer runtime correctness from pipeline status.",
        `You MUST call ${TOOL_NAME} exactly once.`,
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify(context.view).slice(0, 100_000),
      }],
      tools: [{
        name: TOOL_NAME,
        description: "Return the structured semantic quality verdict and evidence-grounded findings.",
        input_schema: {
          type: "object",
          properties: {
            quality_verdict: { type: "string", enum: ["pass", "fail"] },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  check_id: { type: "string" },
                  severity: { type: "string", enum: ["error", "warning", "info"] },
                  passed: { type: "boolean" },
                  summary: { type: "string" },
                  detail: { type: "string" },
                  evidence_refs: { type: "array", items: { type: "string" } },
                },
                required: ["check_id", "severity", "passed", "summary", "detail", "evidence_refs"],
              },
            },
          },
          required: ["quality_verdict", "findings"],
        },
      }],
      tool_choice: { type: "tool", name: TOOL_NAME },
    }));
    const output = parseOutput(message);
    return { ...output, usage: usageFrom(message) };
  },
};
