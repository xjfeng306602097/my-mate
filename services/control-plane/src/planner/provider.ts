import type {
  PlannerCandidatePlanRequest,
  PlannerCandidatePlanResponse,
  PlannerDagDraftRequest,
  PlannerDagDraftResponse,
  PlannerTemplateSelectionResponse,
} from "../types.js";

export interface PlannerInvocationOptions {
  providerId?: string | null;
  model?: string | null;
  orchestratorAgentId?: string | null;
  orchestratorSystemPrompt?: string | null;
  preferredAgentIds?: string[];
  preferDomainMatch?: boolean;
  defaultMaxAgentNodes?: number | null;
  requireReview?: boolean;
}

export interface PlannerProvider {
  readonly id: string;
  readonly displayName: string;
  recommendTemplate(
    intent: string,
    options?: PlannerInvocationOptions,
  ): Promise<PlannerTemplateSelectionResponse | null>;
  generateDagDraft(
    request: PlannerDagDraftRequest,
    options?: PlannerInvocationOptions,
  ): Promise<PlannerDagDraftResponse>;
  generateCandidatePlan(
    request: PlannerCandidatePlanRequest,
    options?: PlannerInvocationOptions,
  ): Promise<PlannerCandidatePlanResponse>;
}

export const FALLBACK_PROVIDER_ID = "rule_based_v1";
