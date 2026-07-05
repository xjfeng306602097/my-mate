import { compileValidator } from "./schema-loader.js";

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

export const validateAgentProfile = compileValidator(
  "https://my-mate.local/schemas/agent/agent-profile.schema.json",
);

export const validateSkill = compileValidator(
  "https://my-mate.local/schemas/agent/skill.schema.json",
);
