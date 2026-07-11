import type { UsageSummary } from "@my-mate/shared-types/runtime-protocol";
import type { EvaluationEvidenceView } from "./evaluator-view.js";
import type { EvaluationFinding, RunEvidenceSnapshot } from "./types.js";

export interface EvaluatorDescriptor {
  id: string;
  kind: "none" | "deterministic" | "model";
  version: string;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
}

export interface EvaluatorOutput {
  quality_verdict: "pass" | "fail" | "not_evaluated";
  findings: EvaluationFinding[];
  usage: UsageSummary | null;
}

export interface EvaluatorContext {
  snapshot: RunEvidenceSnapshot;
  view: EvaluationEvidenceView;
}

export interface EvaluatorProvider {
  descriptor(): EvaluatorDescriptor;
  evaluate(context: EvaluatorContext): Promise<EvaluatorOutput>;
}

const providers = new Map<string, EvaluatorProvider>();

export function registerEvaluatorProvider(provider: EvaluatorProvider): void {
  providers.set(provider.descriptor().id, provider);
}

export function unregisterEvaluatorProvider(id: string): void {
  providers.delete(id);
}

export function getEvaluatorProvider(id: string): EvaluatorProvider | null {
  return providers.get(id) || null;
}

export function listEvaluatorDescriptors(): EvaluatorDescriptor[] {
  return [...providers.values()].map((provider) => provider.descriptor())
    .sort((left, right) => left.id.localeCompare(right.id));
}
