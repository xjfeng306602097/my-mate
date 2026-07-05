import type {
  PlannerCandidatePlanRequest,
  PlannerCandidatePlanResponse,
  PlannerDagDraftRequest,
  PlannerDagDraftResponse,
  PlannerTemplateSelectionResponse,
} from "../types.js";
import { isPlainObject } from "../utils.js";
import {
  FALLBACK_PROVIDER_ID,
  type PlannerInvocationOptions,
  type PlannerProvider,
} from "./provider.js";
import { ruleBasedPlannerProvider } from "./rule-based.js";

const TERMINAL_TEMPLATE_ERRORS = new Set([
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_NOT_PUBLISHED",
]);

const providers: Map<string, PlannerProvider> = new Map();

function isTerminalTemplateError(error: unknown): boolean {
  return error instanceof Error && TERMINAL_TEMPLATE_ERRORS.has(error.message);
}

function annotatePlannerContext(
  context: Record<string, unknown> | undefined,
  providerId: string,
  fallback: { used: boolean; reason?: string },
  options?: PlannerInvocationOptions,
): Record<string, unknown> {
  const base = isPlainObject(context) ? { ...context } : {};
  base.provider_id = providerId;
  if (options?.providerId) {
    base.requested_provider_id = options.providerId;
  }
  if (options?.model) {
    base.requested_model = options.model;
  }
  if (options?.orchestratorProfileId) {
    base.orchestrator_profile_id = options.orchestratorProfileId;
  }
  if (options?.orchestratorSystemPrompt) {
    base.orchestrator_system_prompt = options.orchestratorSystemPrompt;
  }
  if (fallback.used) {
    base.fallback_used = true;
    if (fallback.reason) {
      base.fallback_reason = fallback.reason;
    }
  } else {
    base.fallback_used = false;
  }
  return base;
}

function annotateTemplateSelection(
  response: PlannerTemplateSelectionResponse | null,
  providerId: string,
  fallback: { used: boolean; reason?: string },
  options?: PlannerInvocationOptions,
): PlannerTemplateSelectionResponse | null {
  if (!response) {
    return response;
  }
  return {
    ...response,
    planner_context: annotatePlannerContext(response.planner_context, providerId, fallback, options) as
      PlannerTemplateSelectionResponse["planner_context"],
  };
}

function annotateDagDraft(
  response: PlannerDagDraftResponse,
  providerId: string,
  fallback: { used: boolean; reason?: string },
  options?: PlannerInvocationOptions,
): PlannerDagDraftResponse {
  return {
    ...response,
    template_recommendation: annotateTemplateSelection(
      response.template_recommendation,
      providerId,
      fallback,
      options,
    ),
    planner_context: annotatePlannerContext(response.planner_context, providerId, fallback, options) as
      PlannerDagDraftResponse["planner_context"],
  };
}

function annotateCandidatePlan(
  response: PlannerCandidatePlanResponse,
  providerId: string,
  fallback: { used: boolean; reason?: string },
  options?: PlannerInvocationOptions,
): PlannerCandidatePlanResponse {
  const planContext = isPlainObject(response.candidate_plan?.planner_context)
    ? annotatePlannerContext(response.candidate_plan.planner_context, providerId, fallback, options)
    : annotatePlannerContext({}, providerId, fallback, options);
  return {
    ...response,
    candidate_plan: {
      ...response.candidate_plan,
      planner_context: planContext,
    },
  };
}

function readEnvProviderId(): string {
  const raw = (process.env.MY_MATE_PLANNER_PROVIDER || "").trim();
  return raw || FALLBACK_PROVIDER_ID;
}

export function registerPlannerProvider(provider: PlannerProvider): void {
  providers.set(provider.id, provider);
}

export function listPlannerProviderIds(): string[] {
  return [...providers.keys()];
}

export function getPlannerProviderById(id: string): PlannerProvider | null {
  return providers.get(id) || null;
}

export function getCurrentPlannerProvider(): PlannerProvider {
  const desired = readEnvProviderId();
  return providers.get(desired) || providers.get(FALLBACK_PROVIDER_ID) || ruleBasedPlannerProvider;
}

function getPlannerProviderForInvocation(options?: PlannerInvocationOptions): PlannerProvider {
  const requested = options?.providerId?.trim();
  if (requested) {
    return providers.get(requested) || getCurrentPlannerProvider();
  }
  return getCurrentPlannerProvider();
}

export function getFallbackPlannerProvider(): PlannerProvider {
  return providers.get(FALLBACK_PROVIDER_ID) || ruleBasedPlannerProvider;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "planner provider error";
}

export async function recommendTemplate(
  intent: string,
  options?: PlannerInvocationOptions,
): Promise<PlannerTemplateSelectionResponse | null> {
  const primary = getPlannerProviderForInvocation(options);
  const fallback = getFallbackPlannerProvider();
  if (primary.id === fallback.id) {
    const result = await primary.recommendTemplate(intent, options);
    return annotateTemplateSelection(result, primary.id, { used: false }, options);
  }

  try {
    const result = await primary.recommendTemplate(intent, options);
    return annotateTemplateSelection(result, primary.id, { used: false }, options);
  } catch (error) {
    const reason = describeError(error);
    const fallbackResult = await fallback.recommendTemplate(intent, options);
    return annotateTemplateSelection(fallbackResult, fallback.id, { used: true, reason }, options);
  }
}

export async function generateDagDraft(
  request: PlannerDagDraftRequest,
  options?: PlannerInvocationOptions,
): Promise<PlannerDagDraftResponse> {
  const primary = getPlannerProviderForInvocation(options);
  const fallback = getFallbackPlannerProvider();
  if (primary.id === fallback.id) {
    return annotateDagDraft(await primary.generateDagDraft(request, options), primary.id, { used: false }, options);
  }

  try {
    return annotateDagDraft(await primary.generateDagDraft(request, options), primary.id, { used: false }, options);
  } catch (error) {
    if (isTerminalTemplateError(error)) {
      throw error;
    }
    const reason = describeError(error);
    return annotateDagDraft(await fallback.generateDagDraft(request, options), fallback.id, {
      used: true,
      reason,
    }, options);
  }
}

export async function generateCandidatePlan(
  request: PlannerCandidatePlanRequest,
  options?: PlannerInvocationOptions,
): Promise<PlannerCandidatePlanResponse> {
  const primary = getPlannerProviderForInvocation(options);
  const fallback = getFallbackPlannerProvider();
  if (primary.id === fallback.id) {
    return annotateCandidatePlan(await primary.generateCandidatePlan(request, options), primary.id, {
      used: false,
    }, options);
  }

  try {
    return annotateCandidatePlan(await primary.generateCandidatePlan(request, options), primary.id, {
      used: false,
    }, options);
  } catch (error) {
    if (isTerminalTemplateError(error)) {
      throw error;
    }
    const reason = describeError(error);
    return annotateCandidatePlan(
      await fallback.generateCandidatePlan(request, options),
      fallback.id,
      { used: true, reason },
      options,
    );
  }
}

registerPlannerProvider(ruleBasedPlannerProvider);
