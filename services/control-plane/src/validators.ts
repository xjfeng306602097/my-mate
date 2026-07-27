import { compileValidator } from "./schema-loader.js";
import type { ValidateFunction } from "ajv";
import { DomainError } from "./domain-error.js";

export function assertSchemaValid(validator: ValidateFunction, value: unknown, label: string): void {
  if (validator(value)) return;
  const detail = validator.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ") || "unknown schema error";
  throw new DomainError({
    code: "schema_validation_failed",
    message: `${label} validation failed: ${detail}`,
    httpStatus: 422,
    retryable: false,
    severity: "error",
    remediation: "Correct the fields identified in details.validation_errors and submit the record again.",
    domain: "schema",
    details: {
      schema_label: label,
      validation_errors: validator.errors || [],
    },
  });
}

export const validateSession = compileValidator(
  "https://my-mate.local/schemas/conversation/session.schema.json",
);

export const validateTaskCheckpoint = compileValidator(
  "https://my-mate.local/schemas/conversation/task-checkpoint.schema.json",
);

export const validateAgentTask = compileValidator(
  "https://my-mate.local/schemas/orchestration/agent-task.schema.json",
);

export const validateAgentDag = compileValidator(
  "https://my-mate.local/schemas/orchestration/agent-dag.schema.json",
);

export const validateAgentRun = compileValidator(
  "https://my-mate.local/schemas/agent/agent-run.schema.json",
);

export const validateRunState = compileValidator(
  "https://my-mate.local/schemas/workflow/run-state.schema.json",
);

export const validateEvent = compileValidator(
  "https://my-mate.local/schemas/workflow/event.schema.json",
);

export const validateWorkflowTemplate = compileValidator(
  "https://my-mate.local/schemas/workflow/workflow-template.schema.json",
);

export const validateRunPlan = compileValidator(
  "https://my-mate.local/schemas/workflow/run-plan.schema.json",
);

export const validateRunRoute = compileValidator(
  "https://my-mate.local/schemas/workflow/run-route.schema.json",
);

export const validateNodeRun = compileValidator(
  "https://my-mate.local/schemas/workflow/node-run.schema.json",
);

export const validateArtifact = compileValidator(
  "https://my-mate.local/schemas/workflow/artifact.schema.json",
);

export const validateApproval = compileValidator(
  "https://my-mate.local/schemas/workflow/approval.schema.json",
);

export const validateHumanInput = compileValidator(
  "https://my-mate.local/schemas/workflow/human-input.schema.json",
);

export const validateProviderConnection = compileValidator(
  "https://my-mate.local/schemas/agent/provider-connection.schema.json",
);

export const validateSkill = compileValidator(
  "https://my-mate.local/schemas/agent/skill.schema.json",
);

export const validateRunEvidenceSnapshot = compileValidator(
  "https://my-mate.local/schemas/evaluation/run-evidence-snapshot.schema.json",
);

export const validateWorkerEvidence = compileValidator(
  "https://my-mate.local/schemas/runtime/worker-evidence.schema.json",
);

export const validateScorecardResult = compileValidator(
  "https://my-mate.local/schemas/evaluation/scorecard-result.schema.json",
);

export const validateEvaluationResult = compileValidator(
  "https://my-mate.local/schemas/evaluation/evaluation-result.schema.json",
);

export const validateReplayResult = compileValidator(
  "https://my-mate.local/schemas/evaluation/replay-result.schema.json",
);

export const validateReplayPlanResult = compileValidator(
  "https://my-mate.local/schemas/evaluation/replay-plan-result.schema.json",
);
